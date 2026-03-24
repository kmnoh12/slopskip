import { applyI18n, t } from "../shared/i18n";
import { MESSAGE_TYPES } from "../shared/messages";
import { getStorageState } from "../shared/storage";
import type { CreatorVote, PlatformStatus, Sensitivity } from "../shared/types";

async function getActiveTabId(): Promise<number | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab?.id;
}

async function sendToActiveTab(type: string, payload?: unknown): Promise<{ status?: PlatformStatus; ok?: boolean }> {
  const tabId = await getActiveTabId();
  if (tabId === undefined) {
    return { ok: false };
  }
  try {
    return await chrome.tabs.sendMessage(tabId, { type, payload });
  } catch {
    return { ok: false };
  }
}

function renderVoteText(vote: CreatorVote | undefined): string {
  if (vote === "allow") return t("popupVoteAllow");
  if (vote === "slop") return t("popupVoteSlop");
  return t("popupVoteNone");
}

function setText(id: string, value: string): void {
  const node = document.getElementById(id);
  if (node) {
    node.textContent = value;
  }
}

async function render(): Promise<void> {
  applyI18n();
  const state = await getStorageState();
  const response = await sendToActiveTab(MESSAGE_TYPES.GET_STATUS);
  const status = response.status;

  const enabled = document.getElementById("enabled") as HTMLInputElement;
  const reelsAutoExpandCaption = document.getElementById("reelsAutoExpandCaption") as HTMLInputElement;
  const debugMode = document.getElementById("debugMode") as HTMLInputElement;
  const pauseOnManualRevisit = document.getElementById("pauseOnManualRevisit") as HTMLInputElement;
  const sensitivity = document.getElementById("sensitivity") as HTMLSelectElement;
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

async function saveSettings(patch: {
  enabled?: boolean;
  reelsAutoExpandCaption?: boolean;
  debugMode?: boolean;
  pauseOnManualRevisit?: boolean;
  sensitivity?: Sensitivity;
}): Promise<void> {
  await chrome.runtime.sendMessage({ type: MESSAGE_TYPES.SET_SETTINGS, payload: patch });
  await sendToActiveTab(MESSAGE_TYPES.SET_SETTINGS, patch);
  await render();
}

function wireEvents(): void {
  (document.getElementById("enabled") as HTMLInputElement).addEventListener("change", (event) => {
    void saveSettings({ enabled: (event.target as HTMLInputElement).checked });
  });
  (document.getElementById("reelsAutoExpandCaption") as HTMLInputElement).addEventListener("change", (event) => {
    void saveSettings({ reelsAutoExpandCaption: (event.target as HTMLInputElement).checked });
  });
  (document.getElementById("debugMode") as HTMLInputElement).addEventListener("change", (event) => {
    void saveSettings({ debugMode: (event.target as HTMLInputElement).checked });
  });
  (document.getElementById("pauseOnManualRevisit") as HTMLInputElement).addEventListener("change", (event) => {
    void saveSettings({ pauseOnManualRevisit: (event.target as HTMLInputElement).checked });
  });
  (document.getElementById("sensitivity") as HTMLSelectElement).addEventListener("change", (event) => {
    void saveSettings({ sensitivity: (event.target as HTMLSelectElement).value as Sensitivity });
  });
  (document.getElementById("markSlop") as HTMLButtonElement).addEventListener("click", () => {
    void sendToActiveTab(MESSAGE_TYPES.MARK_CREATOR_SLOP).then(() => render());
  });
  (document.getElementById("markAllow") as HTMLButtonElement).addEventListener("click", () => {
    void sendToActiveTab(MESSAGE_TYPES.MARK_CREATOR_ALLOW).then(() => render());
  });
  (document.getElementById("clearVote") as HTMLButtonElement).addEventListener("click", () => {
    void sendToActiveTab(MESSAGE_TYPES.CLEAR_CREATOR_VOTE).then(() => render());
  });
  (document.getElementById("openOptions") as HTMLAnchorElement).addEventListener("click", (event) => {
    event.preventDefault();
    void chrome.runtime.openOptionsPage();
  });
}

void render().then(wireEvents);
