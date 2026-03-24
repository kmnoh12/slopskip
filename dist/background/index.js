// src/shared/messages.ts
var MESSAGE_TYPES = {
  GET_STATUS: "GET_STATUS",
  SET_SETTINGS: "SET_SETTINGS",
  MARK_CREATOR_SLOP: "MARK_CREATOR_SLOP",
  MARK_CREATOR_ALLOW: "MARK_CREATOR_ALLOW",
  CLEAR_CREATOR_VOTE: "CLEAR_CREATOR_VOTE",
  REQUEST_DEBUG_SNAPSHOT: "REQUEST_DEBUG_SNAPSHOT"
};

// src/shared/constants.ts
var STORAGE_SCHEMA_VERSION = 1;
var DEFAULT_SETTINGS = {
  enabled: true,
  dryRun: false,
  reelsAutoExpandCaption: false,
  debugMode: false,
  pauseOnManualRevisit: true,
  showToast: true,
  sensitivity: "balanced",
  reelsProbeEnabled: true,
  thresholdOverrides: {},
  localeRuleVisibility: "compact"
};
var PLATFORM_FLAGS_DEFAULT = {
  tiktok: { enabled: true },
  reelsProbe: { enabled: true }
};

// src/shared/storage.ts
var DEFAULT_STORAGE_STATE = {
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
async function getStorageState() {
  const result = await getArea().get(DEFAULT_STORAGE_STATE);
  return migrateStorageState(result);
}
async function setStorageState(state) {
  await getArea().set(state);
}
async function patchSettings(settingsPatch) {
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
function migrateStorageState(input) {
  const state = {
    ...DEFAULT_STORAGE_STATE,
    ...input,
    settings: {
      ...DEFAULT_STORAGE_STATE.settings,
      ...input?.settings ?? {}
    },
    platformFlags: {
      tiktok: {
        ...DEFAULT_STORAGE_STATE.platformFlags.tiktok,
        ...input?.platformFlags?.tiktok ?? {}
      },
      reelsProbe: {
        ...DEFAULT_STORAGE_STATE.platformFlags.reelsProbe,
        ...input?.platformFlags?.reelsProbe ?? {}
      }
    },
    ruleOverrides: {
      ...DEFAULT_STORAGE_STATE.ruleOverrides,
      ...input?.ruleOverrides ?? {}
    },
    learnedPhraseScores: {
      ...DEFAULT_STORAGE_STATE.learnedPhraseScores,
      ...input?.learnedPhraseScores ?? {}
    }
  };
  state.schemaVersion = STORAGE_SCHEMA_VERSION;
  return state;
}

// src/background/index.ts
chrome.runtime.onInstalled.addListener(async () => {
  const state = await getStorageState();
  await chrome.storage.local.set(migrateStorageState(state));
});
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message?.type) {
    return false;
  }
  if (message.type === MESSAGE_TYPES.SET_SETTINGS) {
    void patchSettings(message.payload ?? {}).then((state) => {
      sendResponse({ ok: true, settings: state.settings });
    });
    return true;
  }
  return false;
});
//# sourceMappingURL=index.js.map
