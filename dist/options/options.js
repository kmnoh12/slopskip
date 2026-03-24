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

// src/options/options.ts
async function render() {
  applyI18n();
  const state = await getStorageState();
  document.getElementById("thresholdConservative").value = String(state.settings.thresholdOverrides.conservative ?? 80);
  document.getElementById("thresholdBalanced").value = String(state.settings.thresholdOverrides.balanced ?? 60);
  document.getElementById("thresholdAggressive").value = String(state.settings.thresholdOverrides.aggressive ?? 45);
  document.getElementById("overrideEn").value = state.ruleOverrides.en.join("\n");
  document.getElementById("overrideKo").value = state.ruleOverrides.ko.join("\n");
  document.getElementById("overrideDefault").value = state.ruleOverrides.default.join("\n");
}
async function save() {
  const state = await getStorageState();
  state.settings.thresholdOverrides = {
    conservative: Number(document.getElementById("thresholdConservative").value || 80),
    balanced: Number(document.getElementById("thresholdBalanced").value || 60),
    aggressive: Number(document.getElementById("thresholdAggressive").value || 45)
  };
  state.ruleOverrides = {
    en: document.getElementById("overrideEn").value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean),
    ko: document.getElementById("overrideKo").value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean),
    default: document.getElementById("overrideDefault").value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  };
  await setStorageState(state);
}
function wireEvents() {
  for (const id of ["thresholdConservative", "thresholdBalanced", "thresholdAggressive", "overrideEn", "overrideKo", "overrideDefault"]) {
    document.getElementById(id)?.addEventListener("change", () => {
      void save();
    });
  }
  document.getElementById("exportState")?.addEventListener("click", async () => {
    const state = await getStorageState();
    document.getElementById("exportOutput").textContent = JSON.stringify(state, null, 2);
  });
}
void render().then(wireEvents);
//# sourceMappingURL=options.js.map
