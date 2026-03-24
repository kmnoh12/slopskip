// src/shared/i18n.ts
function t(key, substitutions) {
  const translated = chrome.i18n.getMessage(key, substitutions);
  return translated || key;
}
function applyI18n(root = document) {
  const nodes = root.querySelectorAll("[data-i18n]");
  nodes.forEach((node) => {
    const key = node.dataset.i18n;
    if (!key) return;
    node.textContent = t(key);
  });
  const titleNodes = root.querySelectorAll("[data-i18n-title]");
  titleNodes.forEach((node) => {
    const key = node.dataset.i18nTitle;
    if (!key) return;
    node.title = t(key);
  });
  const placeholderNodes = root.querySelectorAll("[data-i18n-placeholder]");
  placeholderNodes.forEach((node) => {
    const key = node.dataset.i18nPlaceholder;
    if (!key || !("placeholder" in node)) return;
    node.placeholder = t(key);
  });
}

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

// src/popup/popup.ts
async function getActiveTabId() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab?.id;
}
async function sendToActiveTab(type, payload) {
  const tabId = await getActiveTabId();
  if (tabId === void 0) {
    return { ok: false };
  }
  try {
    return await chrome.tabs.sendMessage(tabId, { type, payload });
  } catch {
    return { ok: false };
  }
}
function renderVoteText(vote) {
  if (vote === "allow") return t("popupVoteAllow");
  if (vote === "slop") return t("popupVoteSlop");
  return t("popupVoteNone");
}
function setText(id, value) {
  const node = document.getElementById(id);
  if (node) {
    node.textContent = value;
  }
}
async function render() {
  applyI18n();
  const state = await getStorageState();
  const response = await sendToActiveTab(MESSAGE_TYPES.GET_STATUS);
  const status = response.status;
  const enabled = document.getElementById("enabled");
  const reelsAutoExpandCaption = document.getElementById("reelsAutoExpandCaption");
  const debugMode = document.getElementById("debugMode");
  const pauseOnManualRevisit = document.getElementById("pauseOnManualRevisit");
  const sensitivity = document.getElementById("sensitivity");
  enabled.checked = state.settings.enabled;
  reelsAutoExpandCaption.checked = state.settings.reelsAutoExpandCaption;
  debugMode.checked = state.settings.debugMode;
  pauseOnManualRevisit.checked = state.settings.pauseOnManualRevisit;
  sensitivity.value = state.settings.sensitivity;
  if (status) {
    setText("platformText", status.platform);
    setText("creatorText", status.currentCreator?.handle ?? status.currentCreator?.key ?? t("popupNoCreator"));
    setText("scoreText", status.lastScore ? `${status.lastScore.total} / ${status.lastScore.threshold}` : t("popupNoScore"));
    setText("voteText", renderVoteText(status.currentVote));
    setText("statusHint", status.supported ? t("popupStatusReady") : t("popupStatusUnsupported"));
  } else {
    setText("platformText", t("popupStatusUnknown"));
    setText("creatorText", t("popupNoCreator"));
    setText("scoreText", t("popupNoScore"));
    setText("voteText", t("popupVoteNone"));
    setText("statusHint", t("popupStatusLoading"));
  }
}
async function saveSettings(patch) {
  await chrome.runtime.sendMessage({ type: MESSAGE_TYPES.SET_SETTINGS, payload: patch });
  await sendToActiveTab(MESSAGE_TYPES.SET_SETTINGS, patch);
  await render();
}
function wireEvents() {
  document.getElementById("enabled").addEventListener("change", (event) => {
    void saveSettings({ enabled: event.target.checked });
  });
  document.getElementById("reelsAutoExpandCaption").addEventListener("change", (event) => {
    void saveSettings({ reelsAutoExpandCaption: event.target.checked });
  });
  document.getElementById("debugMode").addEventListener("change", (event) => {
    void saveSettings({ debugMode: event.target.checked });
  });
  document.getElementById("pauseOnManualRevisit").addEventListener("change", (event) => {
    void saveSettings({ pauseOnManualRevisit: event.target.checked });
  });
  document.getElementById("sensitivity").addEventListener("change", (event) => {
    void saveSettings({ sensitivity: event.target.value });
  });
  document.getElementById("markSlop").addEventListener("click", () => {
    void sendToActiveTab(MESSAGE_TYPES.MARK_CREATOR_SLOP).then(() => render());
  });
  document.getElementById("markAllow").addEventListener("click", () => {
    void sendToActiveTab(MESSAGE_TYPES.MARK_CREATOR_ALLOW).then(() => render());
  });
  document.getElementById("clearVote").addEventListener("click", () => {
    void sendToActiveTab(MESSAGE_TYPES.CLEAR_CREATOR_VOTE).then(() => render());
  });
  document.getElementById("openOptions").addEventListener("click", (event) => {
    event.preventDefault();
    void chrome.runtime.openOptionsPage();
  });
}
void render().then(wireEvents);
//# sourceMappingURL=popup.js.map
