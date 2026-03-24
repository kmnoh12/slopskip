import { DEFAULT_SETTINGS, PLATFORM_FLAGS_DEFAULT, STORAGE_SCHEMA_VERSION } from "./constants";
import type { CreatorVote, ExtensionSettings, ExtractedSignals, StorageState } from "./types";

const DEFAULT_STORAGE_STATE: StorageState = {
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

function getArea() {
  return chrome.storage.local;
}

export async function getStorageState(): Promise<StorageState> {
  const result = await getArea().get(DEFAULT_STORAGE_STATE as unknown as Record<string, unknown>);
  return migrateStorageState(result as unknown as Partial<StorageState>);
}

export async function setStorageState(state: StorageState): Promise<void> {
  await getArea().set(state);
}

export async function patchSettings(settingsPatch: Partial<ExtensionSettings>): Promise<StorageState> {
  const state = await getStorageState();
  const next = {
    ...state,
    settings: {
      ...state.settings,
      ...settingsPatch
    }
  };
  await setStorageState(next);
  return next;
}

export async function setCreatorVote(key: string, vote: CreatorVote): Promise<StorageState> {
  const state = await getStorageState();
  const creatorVotes = {
    ...state.creatorVotes,
    [key]: vote
  };
  const next = { ...state, creatorVotes };
  await setStorageState(next);
  return next;
}

export async function clearCreatorVote(key: string): Promise<StorageState> {
  const state = await getStorageState();
  const creatorVotes = { ...state.creatorVotes };
  delete creatorVotes[key];
  const next = { ...state, creatorVotes };
  await setStorageState(next);
  return next;
}

function normalizeLearningText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
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
  const state = await getStorageState();
  const delta = vote === "slop" ? 2 : -2;
  const nextScores = { ...state.learnedPhraseScores };

  for (const phrase of extractLearnablePhrases(signals)) {
    const nextValue = (nextScores[phrase] ?? 0) + delta;
    if (nextValue === 0) {
      delete nextScores[phrase];
      continue;
    }
    nextScores[phrase] = Math.max(-6, Math.min(6, nextValue));
  }

  const next = { ...state, learnedPhraseScores: nextScores };
  await setStorageState(next);
  return next;
}

export function migrateStorageState(input: Partial<StorageState> | undefined): StorageState {
  const state = {
    ...DEFAULT_STORAGE_STATE,
    ...input,
    settings: {
      ...DEFAULT_STORAGE_STATE.settings,
      ...(input?.settings ?? {})
    },
    platformFlags: {
      tiktok: {
        ...DEFAULT_STORAGE_STATE.platformFlags.tiktok,
        ...(input?.platformFlags?.tiktok ?? {})
      },
      reelsProbe: {
        ...DEFAULT_STORAGE_STATE.platformFlags.reelsProbe,
        ...(input?.platformFlags?.reelsProbe ?? {})
      }
    },
    ruleOverrides: {
      ...DEFAULT_STORAGE_STATE.ruleOverrides,
      ...(input?.ruleOverrides ?? {})
    },
    learnedPhraseScores: {
      ...DEFAULT_STORAGE_STATE.learnedPhraseScores,
      ...(input?.learnedPhraseScores ?? {})
    }
  } satisfies StorageState;

  state.schemaVersion = STORAGE_SCHEMA_VERSION;
  return state;
}
