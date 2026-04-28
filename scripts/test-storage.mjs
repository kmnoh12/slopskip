import { mkdir, rm, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import esbuild from "esbuild";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const tempDir = path.join(root, ".tmp-storage-test");
const entry = path.join(tempDir, "entry.ts");
const bundle = path.join(tempDir, "entry.mjs");

await rm(tempDir, { recursive: true, force: true });
await mkdir(tempDir, { recursive: true });

await writeFile(entry, `
  export {
    clearCreatorVote,
    getStorageState,
    learnPhraseScores,
    migrateStorageState,
    patchSettings,
    setCreatorVote
  } from "../src/shared/storage";
`);

await esbuild.build({
  entryPoints: [entry],
  outfile: bundle,
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node20",
  logLevel: "silent"
});

let storedState = {};
let blockNextSet = false;
let blockedSetRelease;
let blockedSetStarted;
globalThis.chrome = {
  storage: {
    local: {
      get: async (defaults) => ({ ...defaults, ...storedState }),
      set: async (state) => {
        if (blockNextSet) {
          await new Promise((resolve) => {
            blockedSetRelease = resolve;
            blockedSetStarted?.();
          });
        }
        storedState = { ...state };
      }
    }
  }
};

const {
  clearCreatorVote,
  getStorageState,
  learnPhraseScores,
  migrateStorageState,
  patchSettings,
  setCreatorVote
} = await import(pathToFileURL(bundle).href);

const noisyScores = Object.fromEntries(
  Array.from({ length: 1200 }, (_, index) => [
    ` noisy phrase ${index}!!! `,
    index % 3 === 0 ? 1 : 6
  ])
);
noisyScores[" IMPORTANT AI SIGNAL "] = 6;
noisyScores["zeroed signal"] = 0;

const migrated = migrateStorageState({
  learnedPhraseScores: noisyScores
});

const learnedEntries = Object.entries(migrated.learnedPhraseScores);
assert.ok(learnedEntries.length <= 800, "learned phrase scores should be pruned");
assert.equal(migrated.learnedPhraseScores["important ai signal"], 6, "strong normalized learned phrase should survive pruning");
assert.equal(migrated.learnedPhraseScores["zeroed signal"], undefined, "zero learned phrase should be removed");
assert.ok(learnedEntries.every(([phrase]) => phrase === phrase.trim()), "learned phrases should be trimmed");
assert.ok(learnedEntries.every(([, score]) => score >= -6 && score <= 6), "learned scores should be clamped");

const invalidThresholds = migrateStorageState({
  settings: {
    thresholdOverrides: {
      conservative: 10,
      balanced: 90,
      aggressive: 80
    }
  }
});
assert.deepEqual(
  invalidThresholds.settings.thresholdOverrides,
  { conservative: 80, balanced: 60, aggressive: 45 },
  "invalid threshold ordering should reset to defaults"
);

const manyCreatorVotes = Object.fromEntries(
  Array.from({ length: 2105 }, (_, index) => [` creator-${index} `, index % 2 === 0 ? "slop" : "allow"])
);
manyCreatorVotes.invalid = "maybe";
const migratedCreatorVotes = migrateStorageState({ creatorVotes: manyCreatorVotes });
assert.equal(Object.keys(migratedCreatorVotes.creatorVotes).length, 2000, "creator votes should be capped");
assert.equal(migratedCreatorVotes.creatorVotes.invalid, undefined, "invalid creator votes should be removed");

const longPhrase = "x".repeat(240);
const migratedRules = migrateStorageState({
  ruleOverrides: {
    en: [" ai slop ", "ai slop", "", longPhrase],
    ko: [" phrase-ko ", "phrase-ko"],
    default: Array.from({ length: 2100 }, (_, index) => `phrase ${index}`)
  }
});
assert.deepEqual(migratedRules.ruleOverrides.en.slice(0, 2), ["ai slop", "x".repeat(160)], "rules should be trimmed, deduped, and truncated");
assert.deepEqual(migratedRules.ruleOverrides.ko, ["phrase-ko"], "locale rules should be deduped");
assert.equal(migratedRules.ruleOverrides.default.length, 2000, "default rules should be capped");

storedState = {};
const patched = await patchSettings({
  sensitivity: "impossible",
  thresholdOverrides: {
    conservative: 3,
    balanced: 2,
    aggressive: 1
  }
});
assert.equal(patched.settings.sensitivity, "balanced", "patchSettings should return sanitized sensitivity");
assert.deepEqual(patched.settings.thresholdOverrides, { conservative: 3, balanced: 2, aggressive: 1 }, "patchSettings should return sanitized thresholds");
assert.deepEqual(storedState.settings, patched.settings, "patchSettings should persist the same sanitized state it returns");

storedState = {};
const emptyVote = await setCreatorVote("", "slop");
assert.equal(emptyVote.creatorVotes[""], undefined, "setCreatorVote should return sanitized creator votes");
const validVote = await setCreatorVote("creator-a", "slop");
assert.equal(validVote.creatorVotes["creator-a"], "slop", "valid creator vote should persist");
const clearedVote = await clearCreatorVote("creator-a");
assert.equal(clearedVote.creatorVotes["creator-a"], undefined, "clearCreatorVote should return cleared creator vote");

storedState = {};
await Promise.all([
  patchSettings({ debugMode: true }),
  setCreatorVote("creator-a", "slop"),
  setCreatorVote("creator-b", "allow")
]);
assert.equal(storedState.settings.debugMode, true, "queued writes should preserve settings patches");
assert.equal(storedState.creatorVotes["creator-a"], "slop", "queued writes should preserve first creator vote");
assert.equal(storedState.creatorVotes["creator-b"], "allow", "queued writes should preserve second creator vote");

const learningSignals = {
  itemId: "item-1",
  caption: "generated with ai slop",
  hashtags: [],
  comments: [{ text: "ai slop", author: "viewer" }],
  officialAiTexts: [],
  raw: {}
};
await Promise.all([
  learnPhraseScores(learningSignals, "slop"),
  learnPhraseScores(learningSignals, "slop")
]);
assert.equal(storedState.learnedPhraseScores["ai slop"], 4, "queued learning writes should accumulate instead of losing an update");

storedState = {};
blockNextSet = true;
const blockedSetStartedPromise = new Promise((resolve) => {
  blockedSetStarted = resolve;
});
const pendingWrite = patchSettings({ debugMode: true });
await blockedSetStartedPromise;
const pendingRead = getStorageState();
await Promise.resolve();
assert.equal(storedState.settings?.debugMode, undefined, "delayed write should not have persisted yet");
blockedSetRelease();
blockNextSet = false;
blockedSetStarted = undefined;
blockedSetRelease = undefined;
await pendingWrite;
const readAfterQueuedWrite = await pendingRead;
assert.equal(readAfterQueuedWrite.settings.debugMode, true, "getStorageState should wait for queued writes before reading");

await rm(tempDir, { recursive: true, force: true });
console.log("storage smoke tests passed");
