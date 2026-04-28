import { DEFAULT_SETTINGS, PLATFORM_FLAGS_DEFAULT, SENSITIVITY_THRESHOLDS, STORAGE_SCHEMA_VERSION } from "./constants";
import type { CreatorVote, ExtensionSettings, ExtractedSignals, Sensitivity, StorageState } from "./types";

const MAX_IMPORTED_RECORDS = 2000;
const MAX_PHRASE_LENGTH = 160;
const MAX_LEARNED_PHRASE_SCORES = 800;
let storageWriteQueue: Promise<unknown> = Promise.resolve();

export function createDefaultStorageState(): StorageState {
  return {
    schemaVersion: STORAGE_SCHEMA_VERSION,
    settings: { ...DEFAULT_SETTINGS },
    creatorVotes: {},
    learnedPhraseScores: {},
    platformFlags: {
      tiktok: { ...PLATFORM_FLAGS_DEFAULT.tiktok },
      reelsProbe: { ...PLATFORM_FLAGS_DEFAULT.reelsProbe }
    },
    ruleOverrides: {
      en: [],
      ko: [],
      default: []
    }
  };
}

const DEFAULT_STORAGE_STATE = createDefaultStorageState();

function getArea() {
  return chrome.storage.local;
}

function enqueueStorageWrite<T>(task: () => Promise<T>): Promise<T> {
  const queued = storageWriteQueue.then(task, task);
  storageWriteQueue = queued.catch(() => undefined);
  return queued;
}

async function readStorageStateDirect(): Promise<StorageState> {
  const result = await getArea().get(DEFAULT_STORAGE_STATE as unknown as Record<string, unknown>);
  return migrateStorageState(result as unknown as Partial<StorageState>);
}

export async function getStorageState(): Promise<StorageState> {
  await storageWriteQueue.catch(() => undefined);
  return readStorageStateDirect();
}

export async function setStorageState(state: StorageState): Promise<void> {
  await enqueueStorageWrite(async () => {
    await getArea().set(migrateStorageState(state));
  });
}

export async function patchSettings(settingsPatch: Partial<ExtensionSettings>): Promise<StorageState> {
  return enqueueStorageWrite(async () => {
    const state = await readStorageStateDirect();
    const next = {
      ...state,
      settings: {
        ...state.settings,
        ...settingsPatch
      }
    };
    const migrated = migrateStorageState(next);
    await getArea().set(migrated);
    return migrated;
  });
}

export async function setCreatorVote(key: string, vote: CreatorVote): Promise<StorageState> {
  return enqueueStorageWrite(async () => {
    const state = await readStorageStateDirect();
    const creatorVotes = {
      ...state.creatorVotes,
      [key]: vote
    };
    const next = { ...state, creatorVotes };
    const migrated = migrateStorageState(next);
    await getArea().set(migrated);
    return migrated;
  });
}

export async function clearCreatorVote(key: string): Promise<StorageState> {
  return enqueueStorageWrite(async () => {
    const state = await readStorageStateDirect();
    const creatorVotes = { ...state.creatorVotes };
    delete creatorVotes[key];
    const next = { ...state, creatorVotes };
    const migrated = migrateStorageState(next);
    await getArea().set(migrated);
    return migrated;
  });
}

function normalizeLearningText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeLearnedPhrase(phrase: string): string {
  return normalizeLearningText(phrase).slice(0, MAX_PHRASE_LENGTH);
}

function extractLearnablePhrases(signals: ExtractedSignals): string[] {
  const seedTexts = [
    signals.caption,
    ...signals.hashtags,
    ...signals.comments.map((comment) => comment.text),
    ...signals.officialAiTexts
  ];
  const phrases = new Set<string>();

  for (const raw of seedTexts) {
    const normalized = normalizeLearningText(raw);
    if (!normalized) continue;
    const tokens = normalized.split(" ").filter(Boolean);
    for (let size = 1; size <= 3; size += 1) {
      for (let index = 0; index <= tokens.length - size; index += 1) {
        const phrase = tokens.slice(index, index + size).join(" ");
        if (phrase.length < 3) continue;
        if (!/(ai|fake|real|generated|render|cgi|slop|aigc|prompt)/i.test(phrase)) continue;
        phrases.add(phrase);
      }
    }
  }

  return [...phrases].slice(0, 80);
}

export async function learnPhraseScores(signals: ExtractedSignals, vote: CreatorVote): Promise<StorageState> {
  return enqueueStorageWrite(async () => {
    const state = await readStorageStateDirect();
    const delta = vote === "slop" ? 2 : -2;
    const nextScores = sanitizePhraseScores(state.learnedPhraseScores);

    for (const phrase of extractLearnablePhrases(signals)) {
      const normalizedPhrase = normalizeLearnedPhrase(phrase);
      if (!normalizedPhrase) continue;
      const nextValue = (nextScores[normalizedPhrase] ?? 0) + delta;
      if (nextValue === 0) {
        delete nextScores[normalizedPhrase];
        continue;
      }
      nextScores[normalizedPhrase] = Math.max(-6, Math.min(6, nextValue));
    }

    const next = migrateStorageState({ ...state, learnedPhraseScores: pruneLearnedPhraseScores(nextScores) });
    await getArea().set(next);
    return next;
  });
}

export function migrateStorageState(input: Partial<StorageState> | undefined): StorageState {
  const source = isRecord(input) ? input : {};

  return {
    schemaVersion: STORAGE_SCHEMA_VERSION,
    settings: sanitizeSettings(source.settings),
    creatorVotes: sanitizeCreatorVotes(source.creatorVotes),
    learnedPhraseScores: sanitizePhraseScores(source.learnedPhraseScores),
    platformFlags: sanitizePlatformFlags(source.platformFlags),
    ruleOverrides: sanitizeRuleOverrides(source.ruleOverrides)
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boolOrDefault(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function numberOrDefault(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function isSensitivity(value: unknown): value is Sensitivity {
  return value === "conservative" || value === "balanced" || value === "aggressive";
}

function sanitizeThreshold(value: unknown, fallback: number): number {
  const numericValue = numberOrDefault(value, fallback);
  return Math.max(0, Math.min(200, Math.round(numericValue)));
}

function sanitizeSettings(value: unknown): ExtensionSettings {
  const source = isRecord(value) ? value : {};
  const thresholdOverrides = isRecord(source.thresholdOverrides) ? source.thresholdOverrides : {};
  const localeRuleVisibility = source.localeRuleVisibility === "full" ? "full" : DEFAULT_SETTINGS.localeRuleVisibility;

  return {
    enabled: boolOrDefault(source.enabled, DEFAULT_SETTINGS.enabled),
    dryRun: boolOrDefault(source.dryRun, DEFAULT_SETTINGS.dryRun),
    reelsAutoExpandCaption: boolOrDefault(source.reelsAutoExpandCaption, DEFAULT_SETTINGS.reelsAutoExpandCaption),
    debugMode: boolOrDefault(source.debugMode, DEFAULT_SETTINGS.debugMode),
    pauseOnManualRevisit: boolOrDefault(source.pauseOnManualRevisit, DEFAULT_SETTINGS.pauseOnManualRevisit),
    showToast: boolOrDefault(source.showToast, DEFAULT_SETTINGS.showToast),
    sensitivity: isSensitivity(source.sensitivity) ? source.sensitivity : DEFAULT_SETTINGS.sensitivity,
    reelsProbeEnabled: boolOrDefault(source.reelsProbeEnabled, DEFAULT_SETTINGS.reelsProbeEnabled),
    thresholdOverrides: sanitizeThresholdOverrides(thresholdOverrides),
    localeRuleVisibility
  };
}

function sanitizeThresholdOverrides(value: Record<string, unknown>): Partial<Record<Sensitivity, number>> {
  const conservative = sanitizeThreshold(value.conservative, SENSITIVITY_THRESHOLDS.conservative);
  const balanced = sanitizeThreshold(value.balanced, SENSITIVITY_THRESHOLDS.balanced);
  const aggressive = sanitizeThreshold(value.aggressive, SENSITIVITY_THRESHOLDS.aggressive);

  if (conservative > balanced && balanced > aggressive) {
    return { conservative, balanced, aggressive };
  }

  return {
    conservative: SENSITIVITY_THRESHOLDS.conservative,
    balanced: SENSITIVITY_THRESHOLDS.balanced,
    aggressive: SENSITIVITY_THRESHOLDS.aggressive
  };
}

function sanitizeCreatorVotes(value: unknown): Record<string, CreatorVote> {
  if (!isRecord(value)) return {};
  const entries = Object.entries(value)
    .filter(([key, vote]) => key.trim().length > 0 && (vote === "slop" || vote === "allow"))
    .slice(0, MAX_IMPORTED_RECORDS);
  return Object.fromEntries(entries) as Record<string, CreatorVote>;
}

function sanitizePhraseScores(value: unknown): Record<string, number> {
  if (!isRecord(value)) return {};
  const entries = Object.entries(value)
    .filter(([phrase, score]) => phrase.trim().length > 0 && typeof score === "number" && Number.isFinite(score))
    .map(([phrase, score]) => [normalizeLearnedPhrase(phrase), Math.max(-6, Math.min(6, Math.round(score as number)))] as const)
    .filter(([phrase]) => phrase.length > 0);
  return pruneLearnedPhraseScores(Object.fromEntries(entries));
}

function pruneLearnedPhraseScores(scores: Record<string, number>): Record<string, number> {
  const entries = Object.entries(scores)
    .filter(([, score]) => score !== 0)
    .sort((left, right) => {
      const scoreDelta = Math.abs(right[1]) - Math.abs(left[1]);
      if (scoreDelta !== 0) return scoreDelta;
      return right[0].length - left[0].length;
    })
    .slice(0, MAX_LEARNED_PHRASE_SCORES);
  return Object.fromEntries(entries);
}

function sanitizePlatformFlags(value: unknown): StorageState["platformFlags"] {
  const source = isRecord(value) ? value : {};
  const tiktok = isRecord(source.tiktok) ? source.tiktok : {};
  const reelsProbe = isRecord(source.reelsProbe) ? source.reelsProbe : {};

  return {
    tiktok: {
      enabled: boolOrDefault(tiktok.enabled, PLATFORM_FLAGS_DEFAULT.tiktok.enabled)
    },
    reelsProbe: {
      enabled: boolOrDefault(reelsProbe.enabled, PLATFORM_FLAGS_DEFAULT.reelsProbe.enabled)
    }
  };
}

function sanitizePhraseList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const phrases = value
    .filter((phrase): phrase is string => typeof phrase === "string")
    .map((phrase) => phrase.trim())
    .filter(Boolean)
    .map((phrase) => phrase.slice(0, MAX_PHRASE_LENGTH));
  return [...new Set(phrases)].slice(0, MAX_IMPORTED_RECORDS);
}

function sanitizeRuleOverrides(value: unknown): StorageState["ruleOverrides"] {
  const source = isRecord(value) ? value : {};
  return {
    en: sanitizePhraseList(source.en),
    ko: sanitizePhraseList(source.ko),
    default: sanitizePhraseList(source.default)
  };
}
