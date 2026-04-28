import { wireHelpPopovers } from "../shared/helpPopover";
import { applyI18n, t } from "../shared/i18n";
import { MESSAGE_TYPES } from "../shared/messages";
import { getStorageState } from "../shared/storage";
import type { CreatorVote, ExtensionSettings, PlatformStatus, ScoreBreakdown, Sensitivity, SignalMatch } from "../shared/types";

type SettingsPatch = Pick<Partial<ExtensionSettings>, "enabled" | "reelsAutoExpandCaption" | "debugMode" | "pauseOnManualRevisit" | "sensitivity">;

let stickyStatusUntil = 0;
let actionButtonsBusy = false;

function isExtensionUnavailable(error: unknown): boolean {
  if (error instanceof Error) {
    return /Extension context invalidated|Receiving end does not exist|Could not establish connection/i.test(error.message);
  }
  return /Extension context invalidated|Receiving end does not exist|Could not establish connection/i.test(String(error));
}

function runPopupTask(task: () => Promise<void>): void {
  void task().catch((error) => {
    if (isExtensionUnavailable(error)) {
      setStatusHint(t("popupStatusLoading"), "error", 4200);
      return;
    }
    setStatusHint("Something went wrong. Try reopening SlopSkip.", "error", 4200);
  });
}

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
  } catch (error) {
    if (!isExtensionUnavailable(error)) {
      console.error("[SlopSkip]", error);
    }
    return { ok: false };
  }
}

function getSettingsControls(): {
  enabled: HTMLInputElement;
  reelsAutoExpandCaption: HTMLInputElement;
  debugMode: HTMLInputElement;
  pauseOnManualRevisit: HTMLInputElement;
  sensitivity: HTMLSelectElement;
} {
  return {
    enabled: document.getElementById("enabled") as HTMLInputElement,
    reelsAutoExpandCaption: document.getElementById("reelsAutoExpandCaption") as HTMLInputElement,
    debugMode: document.getElementById("debugMode") as HTMLInputElement,
    pauseOnManualRevisit: document.getElementById("pauseOnManualRevisit") as HTMLInputElement,
    sensitivity: document.getElementById("sensitivity") as HTMLSelectElement
  };
}

function applySettingsToControls(settings: ExtensionSettings): void {
  const controls = getSettingsControls();
  controls.enabled.checked = settings.enabled;
  controls.reelsAutoExpandCaption.checked = settings.reelsAutoExpandCaption;
  controls.debugMode.checked = settings.debugMode;
  controls.pauseOnManualRevisit.checked = settings.pauseOnManualRevisit;
  controls.sensitivity.value = settings.sensitivity;
}

function setControlsBusy(busy: boolean): void {
  const controls = getSettingsControls();
  controls.enabled.disabled = busy;
  controls.reelsAutoExpandCaption.disabled = busy;
  controls.debugMode.disabled = busy;
  controls.pauseOnManualRevisit.disabled = busy;
  controls.sensitivity.disabled = busy;
}

function setActionButtonsBusy(busy: boolean): void {
  actionButtonsBusy = busy;
  for (const id of ["markSlop", "markAllow", "clearVote"]) {
    const button = document.getElementById(id) as HTMLButtonElement | null;
    if (!button) continue;
    button.dataset.busy = String(busy);
    button.disabled = busy || button.getAttribute("aria-disabled") === "true";
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

function setActionButtonsEnabled(enabled: boolean): void {
  for (const id of ["markSlop", "markAllow", "clearVote"]) {
    const button = document.getElementById(id) as HTMLButtonElement | null;
    if (!button) continue;
    button.disabled = actionButtonsBusy || !enabled;
    button.setAttribute("aria-disabled", String(!enabled));
    button.dataset.busy = String(actionButtonsBusy);
  }
}

function canActOnCreator(status: PlatformStatus | undefined): boolean {
  return Boolean(status?.supported && status.currentCreator?.key);
}

function reasonPriority(match: SignalMatch): number {
  if (match.source === "vote") return 60;
  if (match.source === "official") return 50;
  if (match.source === "caption") return 40;
  if (match.source === "hashtags") return 30;
  if (match.source === "comments") return 20;
  return 0;
}

function getTopReasons(score: ScoreBreakdown): SignalMatch[] {
  return score.matches
    .filter((match) => match.weight !== 0)
    .sort((left, right) => {
      const signDelta = Number(right.weight > 0) - Number(left.weight > 0);
      if (signDelta !== 0) return signDelta;
      const priorityDelta = reasonPriority(right) - reasonPriority(left);
      if (priorityDelta !== 0) return priorityDelta;
      return Math.abs(right.weight) - Math.abs(left.weight);
    })
    .slice(0, 3);
}

function renderReasonSummary(score?: ScoreBreakdown): void {
  const node = document.getElementById("reasonSummary");
  if (!node) return;

  if (!score || score.matches.length === 0) {
    node.textContent = "";
    node.hidden = true;
    return;
  }

  node.hidden = false;
  node.replaceChildren(...getTopReasons(score).map((match) => {
    const chip = document.createElement("span");
    chip.className = `reason-chip ${match.weight < 0 ? "negative" : "positive"}`;
    const label = t(match.reasonKey) || match.reasonKey;
    chip.textContent = `${match.weight > 0 ? "+" : ""}${match.weight} ${label}`;
    if (match.excerpt) {
      chip.title = match.excerpt;
    }
    return chip;
  }));
}

function setStatusHint(message: string, tone: "ready" | "saving" | "error" = "ready", stickyMs = 0): void {
  const node = document.getElementById("statusHint");
  if (!node) return;
  node.textContent = message;
  node.dataset.tone = tone;
  stickyStatusUntil = stickyMs > 0 ? Date.now() + stickyMs : 0;
}

function setStatusHintFromRender(message: string): void {
  if (Date.now() < stickyStatusUntil) {
    return;
  }
  setStatusHint(message);
}

async function render(): Promise<void> {
  applyI18n();
  const state = await getStorageState();
  const response = await sendToActiveTab(MESSAGE_TYPES.GET_STATUS);
  const status = response.status;

  applySettingsToControls(state.settings);

  if (status) {
    setActionButtonsEnabled(canActOnCreator(status));
    setText("platformText", status.platform);
    setText("creatorText", status.currentCreator?.handle ?? status.currentCreator?.key ?? t("popupNoCreator"));
    setText("scoreText", status.lastScore ? `${status.lastScore.total} / ${status.lastScore.threshold}` : t("popupNoScore"));
    setText("voteText", renderVoteText(status.currentVote));
    renderReasonSummary(status.lastScore);
    setStatusHintFromRender(status.supported ? t("popupStatusReady") : t("popupStatusUnsupported"));
  } else {
    setActionButtonsEnabled(false);
    setText("platformText", t("popupStatusUnknown"));
    setText("creatorText", t("popupNoCreator"));
    setText("scoreText", t("popupNoScore"));
    setText("voteText", t("popupVoteNone"));
    renderReasonSummary();
    setStatusHintFromRender(t("popupStatusLoading"));
  }
}

async function saveSettings(patch: SettingsPatch): Promise<void> {
  const previousState = await getStorageState();
  setControlsBusy(true);
  setStatusHint(t("optionsStatusSaving"), "saving");

  try {
    const runtimeResponse = await chrome.runtime.sendMessage({ type: MESSAGE_TYPES.SET_SETTINGS, payload: patch });
    if (!runtimeResponse?.ok) {
      throw new Error("Settings save failed");
    }

    const tabResponse = await sendToActiveTab(MESSAGE_TYPES.SET_SETTINGS, patch);
    if (tabResponse.ok === false) {
      setStatusHint("Saved locally. Refresh this tab if the page keeps the old behavior.", "saving", 3600);
    }

    await render();
  } catch {
    applySettingsToControls(previousState.settings);
    setStatusHint("Save failed. Reverted to the previous settings.", "error", 4600);
  } finally {
    setControlsBusy(false);
  }
}

async function handleCreatorAction(type: string): Promise<void> {
  setActionButtonsBusy(true);
  setStatusHint("Updating creator rule...", "saving", 1800);
  try {
    const response = await sendToActiveTab(type);
    if (!response.ok) {
      setStatusHint("Creator rule could not be updated on this page.", "error", 4200);
      return;
    }
    setStatusHint("Creator rule updated.", "saving", 1800);
    await render();
  } catch {
    setStatusHint("Creator rule update failed.", "error", 4200);
  } finally {
    setActionButtonsBusy(false);
  }
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
    if ((document.getElementById("markSlop") as HTMLButtonElement).disabled) return;
    void handleCreatorAction(MESSAGE_TYPES.MARK_CREATOR_SLOP);
  });
  (document.getElementById("markAllow") as HTMLButtonElement).addEventListener("click", () => {
    if ((document.getElementById("markAllow") as HTMLButtonElement).disabled) return;
    void handleCreatorAction(MESSAGE_TYPES.MARK_CREATOR_ALLOW);
  });
  (document.getElementById("clearVote") as HTMLButtonElement).addEventListener("click", () => {
    if ((document.getElementById("clearVote") as HTMLButtonElement).disabled) return;
    void handleCreatorAction(MESSAGE_TYPES.CLEAR_CREATOR_VOTE);
  });
  (document.getElementById("openOptions") as HTMLAnchorElement).addEventListener("click", (event) => {
    event.preventDefault();
    runPopupTask(async () => {
      await chrome.runtime.openOptionsPage();
    });
  });
  wireHelpPopovers({ maxWidth: 280 });
}

runPopupTask(async () => {
  await render();
  wireEvents();
});
