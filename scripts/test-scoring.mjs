import { mkdir, rm, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import esbuild from "esbuild";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const tempDir = path.join(root, ".tmp-scoring-test");
const entry = path.join(tempDir, "entry.ts");
const bundle = path.join(tempDir, "entry.mjs");

await rm(tempDir, { recursive: true, force: true });
await mkdir(tempDir, { recursive: true });

await writeFile(entry, `
  export { computeScore } from "../src/content/scoring";
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

const { computeScore } = await import(pathToFileURL(bundle).href);

function signals(overrides = {}) {
  return {
    itemId: "test-item",
    platform: "tiktok",
    caption: "",
    hashtags: [],
    comments: [],
    officialAiLabel: false,
    officialAiTexts: [],
    visibleTexts: [],
    aiDisclosureTexts: [],
    ...overrides
  };
}

function score(input, sensitivity = "balanced", vote, learned = {}, overrides = { en: [], ko: [], default: [] }) {
  return computeScore(input, sensitivity, vote, undefined, learned, overrides);
}

const officialAi = score(signals({
  officialAiLabel: true,
  officialAiTexts: ["Creator labeled this as AI-generated"]
}));
assert.equal(officialAi.shouldSkip, true, "official AI label should hard-block");
assert.equal(officialAi.hardBlock, true, "official AI label should be marked as hard block");

const allowedCreator = score(signals({
  officialAiLabel: true,
  officialAiTexts: ["AI-generated"]
}), "balanced", "allow");
assert.equal(allowedCreator.shouldSkip, false, "allow vote should protect creator before official labels");
assert.equal(allowedCreator.protectedByAllow, true, "allow vote should be visible in score");

const koreanSuspicion = score(signals({
  caption: "오늘도 이상한 영상",
  comments: [
    { text: "이거 ai 같음", locale: "ko" },
    { text: "ai 티남", locale: "ko" },
    { text: "가짜 같은데", locale: "ko" }
  ]
}), "aggressive");
assert.equal(koreanSuspicion.shouldSkip, true, "multiple Korean suspicion comments should skip on strong preset");
assert.ok(koreanSuspicion.matches.some((match) => match.reasonKey === "reasonCommentStrongKo"), "Korean suspicion should use Korean reason");

const contradictedKorean = score(signals({
  caption: "사람이 직접 찍은 작업 영상",
  comments: [
    { text: "이거 ai 같음", locale: "ko" },
    { text: "ai 아님", locale: "ko" },
    { text: "실제 사람이 직접 찍은 거임", locale: "ko" }
  ]
}), "balanced");
assert.equal(contradictedKorean.shouldSkip, false, "multiple contradiction signals should prevent marginal skip");
assert.ok(contradictedKorean.matches.some((match) => match.reasonKey === "reasonContradictionNotAi"), "contradiction should be visible");

const weakAiMentions = score(signals({
  comments: [
    { text: "ai?", locale: "en" },
    { text: "maybe ai", locale: "en" }
  ]
}), "balanced");
assert.equal(weakAiMentions.shouldSkip, false, "weak AI mentions alone should not skip on balanced preset");

const customCaptionRule = score(signals({
  caption: "another plastidream remix"
}), "balanced", undefined, {}, { en: ["plastidream"], ko: [], default: [] });
assert.equal(customCaptionRule.shouldSkip, true, "user caption keywords should affect real scoring");
assert.ok(customCaptionRule.matches.some((match) => match.excerpt === "plastidream"), "custom keyword match should be visible");

const customCommentPileOn = score(signals({
  comments: [
    { text: "plastidream again", locale: "en" },
    { text: "yep plastidream", locale: "en" }
  ]
}), "balanced", undefined, {}, { en: ["plastidream"], ko: [], default: [] });
assert.equal(customCommentPileOn.shouldSkip, true, "repeated user comment keywords should skip");

const singleMultiFeatureComment = score(signals({
  comments: [
    { text: "this is obviously ai slop and looks fake", locale: "en" }
  ]
}), "balanced");
assert.equal(singleMultiFeatureComment.shouldSkip, false, "one loaded comment should not count as a crowd pile-on by itself");

const customRuleBoundary = score(signals({
  caption: "the education channel is back"
}), "balanced", undefined, {}, { en: ["cat"], ko: [], default: [] });
assert.equal(customRuleBoundary.shouldSkip, false, "custom keyword should not match inside unrelated words");

const customRulePunctuationBoundary = score(signals({
  caption: "new clip: cat, but generated"
}), "balanced", undefined, {}, { en: ["cat"], ko: [], default: [] });
assert.equal(customRulePunctuationBoundary.shouldSkip, true, "custom keyword should match punctuation boundaries");

const manyCustomRules = Array.from({ length: 1000 }, (_, index) => `unused-rule-${index}`);
manyCustomRules.unshift("needle-signal");
const customRuleCapStillMatchesPriorityRule = score(signals({
  caption: "needle-signal appears in the caption"
}), "balanced", undefined, {}, { en: manyCustomRules, ko: [], default: [] });
assert.equal(customRuleCapStillMatchesPriorityRule.shouldSkip, true, "custom rule cap should still score early useful rules");

const learnedPhraseBoundary = score(signals({
  comments: [
    { text: "education channel", locale: "en" },
    { text: "still educational", locale: "en" }
  ]
}), "balanced", undefined, { cat: 6 });
assert.equal(learnedPhraseBoundary.shouldSkip, false, "learned phrases should not match inside unrelated words");

const learnedPhrasePunctuationBoundary = score(signals({
  comments: [
    { text: "cat, again", locale: "en" }
  ]
}), "balanced", undefined, { cat: 6 });
assert.ok(learnedPhrasePunctuationBoundary.matches.some((match) => match.excerpt === "cat"), "learned phrases should match punctuation boundaries");

await rm(tempDir, { recursive: true, force: true });
console.log("scoring smoke tests passed");
