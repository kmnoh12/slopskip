import { LOOP_INTERVAL_MS, MANUAL_REVISIT_WINDOW_MS, SKIP_COOLDOWN_MS } from "../shared/constants";
import { MESSAGE_TYPES } from "../shared/messages";
import { clearCreatorVote, getStorageState, learnPhraseScores, patchSettings, setCreatorVote } from "../shared/storage";
import type { CreatorVote, DebugSnapshot, ExtractedSignals, PlatformStatus, StorageState } from "../shared/types";
import { renderDebugPanel } from "./debugPanel";
import { resolvePlatformAdapter } from "./platformRouter";
import { computeScore } from "./scoring";
import { waitForItemChange } from "./skip";
import { hideToast, showCancelableCountdownToast, showToast } from "./toast";

const adapter = resolvePlatformAdapter();
const EVAL_DEBOUNCE_MS = adapter?.platform === "instagram-reels" ? 500 : 250;

let storageState: StorageState | null = null;
let currentSignals: ExtractedSignals | null = null;
let currentSnapshot: DebugSnapshot | null = null;
let currentStatus: PlatformStatus = {
  platform: adapter?.platform ?? "unsupported",
  supported: Boolean(adapter)
};
let pendingTimer: number | undefined;
let lastProcessedItemId: string | undefined;
let skipCooldownUntil = 0;
let manualRevisitIntentUntil = 0;
let lastLocationKey = `${window.location.pathname}${window.location.search}`;
let skipInFlight = false;
let isExtracting = false;
let evaluationSequence = 0;
let commentPanelGraceItemId: string | undefined;
let commentPanelGraceUntil = 0;
let pendingManualReskipItemId: string | undefined;
const skippedItemIds = new Set<string>();
const autoSkippedItemIds = new Set<string>();
const manuallyReviewedItemIds = new Set<string>();

function isContextInvalidatedError(error: unknown): boolean {
  return error instanceof Error && /Extension context invalidated/i.test(error.message);
}

function runSafely(task: () => Promise<void>): void {
  void task().catch((error) => {
    if (isContextInvalidatedError(error)) {
      return;
    }
    console.error("[SlopSkip]", error);
  });
}

async function refreshStorageState(): Promise<StorageState> {
  storageState = await getStorageState();
  return storageState;
}

function getCurrentVote(): CreatorVote | undefined {
  const key = currentSignals?.creator?.key;
  if (!key || !storageState) return undefined;
  return storageState.creatorVotes[key];
}

function noteManualRevisitIntent(): void {
  manualRevisitIntentUntil = Date.now() + MANUAL_REVISIT_WINDOW_MS;
}

function shouldHandleManualRevisit(itemId: string, state: StorageState): boolean {
  return (
    state.settings.pauseOnManualRevisit
    && Date.now() <= manualRevisitIntentUntil
    && autoSkippedItemIds.has(itemId)
  );
}

function clearPendingManualReskip(): void {
  pendingManualReskipItemId = undefined;
  hideToast();
}

function clearTransientState(): void {
  currentSignals = null;
  currentSnapshot = null;
  currentStatus = {
    platform: adapter?.platform ?? "unsupported",
    supported: Boolean(adapter)
  };
  lastProcessedItemId = undefined;
  skipCooldownUntil = 0;
  skipInFlight = false;
  commentPanelGraceItemId = undefined;
  commentPanelGraceUntil = 0;
  clearPendingManualReskip();
  skippedItemIds.clear();
}

function getManualReskipMessage(secondsLeft: number): string {
  const localized = chrome.i18n.getMessage("toastManualRevisitCountdown", [String(secondsLeft)]);
  if (localized) {
    return localized;
  }
  return `다시 올린 슬롭입니다. ${secondsLeft}초 후 다시 넘깁니다.`;
}

async function executeSkip(activeItem: HTMLElement, signals: ExtractedSignals, state: StorageState): Promise<void> {
  const previousId = signals.itemId;
  skippedItemIds.add(previousId);
  autoSkippedItemIds.add(previousId);
  skipInFlight = true;

  try {
    const didRequestSkip = await adapter!.skipToNext(activeItem);
    if (!didRequestSkip) {
      return;
    }

    let changed = await waitForItemChange(() => {
      const newActive = adapter!.findActiveItem();
      if (!newActive) return currentSignals?.itemId;
      const video = newActive.querySelector("video");
      const src = video?.src || video?.currentSrc || video?.poster || "";
      return src ? `quick::${src}` : currentSignals?.itemId;
    }, `quick::${_getVideoSrc(activeItem)}`, 2800);

    skipCooldownUntil = Date.now() + SKIP_COOLDOWN_MS;

    if (!changed) {
      const latestActiveItem = adapter!.findActiveItem();
      if (latestActiveItem) {
        await adapter!.skipToNext(latestActiveItem);
        changed = await waitForItemChange(() => {
          const newActive = adapter!.findActiveItem();
          if (!newActive) return currentSignals?.itemId;
          const video = newActive.querySelector("video");
          const src = video?.src || video?.currentSrc || video?.poster || "";
          return src ? `quick::${src}` : currentSignals?.itemId;
        }, `quick::${_getVideoSrc(activeItem)}`, 2200);
      }
    }

    if (!changed) {
      skipCooldownUntil = Date.now() + 3000;
      if (state.settings.showToast) {
        showToast(chrome.i18n.getMessage("toastSkipTransitionUnconfirmed"));
      }
    }
  } finally {
    skipInFlight = false;
    lastProcessedItemId = undefined;
  }
}

function startManualReskipCountdown(signals: ExtractedSignals, state: StorageState): void {
  if (pendingManualReskipItemId === signals.itemId || manuallyReviewedItemIds.has(signals.itemId)) {
    return;
  }

  pendingManualReskipItemId = signals.itemId;

  showCancelableCountdownToast({
    seconds: 3,
    cancelLabel: chrome.i18n.getMessage("toastManualRevisitCancel") || "X",
    getMessage: getManualReskipMessage,
    onCancel: () => {
      manuallyReviewedItemIds.add(signals.itemId);
      pendingManualReskipItemId = undefined;
      if (state.settings.showToast) {
        const canceled = chrome.i18n.getMessage("toastManualRevisitCanceled") || "이번에는 자동 넘김을 취소했습니다.";
        showToast(canceled);
      }
    },
    onExpire: () => {
      runSafely(async () => {
        if (pendingManualReskipItemId !== signals.itemId) {
          return;
        }

        pendingManualReskipItemId = undefined;
        const latestState = storageState ?? await refreshStorageState();
        const latestActiveItem = adapter?.findActiveItem();
        if (!latestActiveItem || currentSignals?.itemId !== signals.itemId) {
          return;
        }

        await executeSkip(latestActiveItem, signals, latestState);
      });
    }
  });
}

async function evaluateCurrentItem(reason = "loop"): Promise<void> {
  if (!adapter || !adapter.detect()) {
    return;
  }

  if (skipInFlight || isExtracting) {
    return;
  }

  isExtracting = true;
  try {
    await performEvaluation(reason);
  } finally {
    isExtracting = false;
  }
}

async function performEvaluation(reason: string): Promise<void> {
  if (!adapter) return;
  const locationKey = `${window.location.pathname}${window.location.search}`;
  if (locationKey !== lastLocationKey) {
    lastLocationKey = locationKey;
    clearTransientState();
  }

  if (!storageState) {
    await refreshStorageState();
  }

  const state = storageState!;
  const supported = adapter.platform === "tiktok"
    ? state.platformFlags.tiktok.enabled
    : state.platformFlags.reelsProbe.enabled && state.settings.reelsProbeEnabled;
  if (!state.settings.enabled || !supported) {
    renderDebugPanel(currentSnapshot, state.settings.debugMode);
    return;
  }

  const activeItem = adapter.findActiveItem();
  if (!activeItem) {
    return;
  }

  const evaluationId = ++evaluationSequence;
  const signals = await adapter.extractSignals(activeItem);
  if (!signals) {
    return;
  }
  if (evaluationId !== evaluationSequence) {
    return;
  }

  if (currentSignals && currentSignals.itemId !== signals.itemId) {
    currentSignals = null;
    currentSnapshot = null;
  }

  currentSignals = signals;
  currentSnapshot = await adapter.getDebugSnapshot(activeItem, signals);
  if (evaluationId !== evaluationSequence) {
    return;
  }

  const vote = getCurrentVote();
  const thresholdOverride = state.settings.thresholdOverrides[state.settings.sensitivity];
  const score = computeScore(signals, state.settings.sensitivity, vote, thresholdOverride, state.learnedPhraseScores);
  currentStatus = {
    platform: adapter.platform,
    supported: true,
    currentCreator: signals.creator,
    currentVote: vote,
    currentItemId: signals.itemId,
    lastScore: score,
    debugSnapshot: {
      ...currentSnapshot,
      score
    }
  };

  renderDebugPanel(currentStatus.debugSnapshot ?? null, state.settings.debugMode);
  if (adapter.platform === "instagram-reels" && state.settings.debugMode) {
    console.info("[SlopSkip Reels]", {
      itemId: signals.itemId,
      score: score.total,
      shouldSkip: score.shouldSkip,
      creator: signals.creator?.handle
    });
  }

  if (adapter.platform === "instagram-reels" && signals.raw?.commentPanelTriggered) {
    commentPanelGraceItemId = signals.itemId;
    commentPanelGraceUntil = Date.now() + 1800;
  }

  if (signals.itemId === lastProcessedItemId && reason !== "force") {
    return;
  }

  lastProcessedItemId = signals.itemId;

  if (pendingManualReskipItemId && pendingManualReskipItemId !== signals.itemId) {
    clearPendingManualReskip();
  }

  if (Date.now() < skipCooldownUntil) {
    return;
  }

  if (skippedItemIds.has(signals.itemId)) {
    return;
  }

  if (manuallyReviewedItemIds.has(signals.itemId)) {
    return;
  }

  if (
    adapter.platform === "instagram-reels"
    && signals.raw?.commentPanelOpen
    && commentPanelGraceItemId === signals.itemId
    && Date.now() < commentPanelGraceUntil
  ) {
    return;
  }

  if (shouldHandleManualRevisit(signals.itemId, state)) {
    startManualReskipCountdown(signals, state);
    return;
  }

  if (!score.shouldSkip) {
    return;
  }

  const primaryReason = score.matches[0]?.reasonKey ?? "reasonWouldSkip";
  const localizedReason = chrome.i18n.getMessage(primaryReason) || primaryReason;
  const toastMessage = state.settings.dryRun
    ? chrome.i18n.getMessage("toastWouldSkip", [localizedReason, String(score.total)])
    : chrome.i18n.getMessage("toastSkipped", [localizedReason, String(score.total)]);
  if (state.settings.showToast) {
    showToast(toastMessage);
  }

  if (state.settings.dryRun) {
    return;
  }

  await executeSkip(activeItem, signals, state);
}

function _getVideoSrc(el: HTMLElement): string {
  const v = el.querySelector("video");
  return v?.src || v?.currentSrc || v?.poster || "";
}

function scheduleEvaluation(reason = "mutation"): void {
  if (pendingTimer) {
    window.clearTimeout(pendingTimer);
  }
  pendingTimer = window.setTimeout(() => {
    void evaluateCurrentItem(reason);
  }, EVAL_DEBOUNCE_MS);
}

if (adapter) {
  window.addEventListener("wheel", (event) => {
    if (event.deltaY < 0) {
      noteManualRevisitIntent();
    }
  }, { passive: true });

  window.addEventListener("keydown", (event) => {
    if (event.key === "ArrowUp" || event.key === "PageUp") {
      noteManualRevisitIntent();
    }
  });

  runSafely(async () => {
    await refreshStorageState();
    await evaluateCurrentItem("boot");
  });

  const observer = new MutationObserver(() => {
    scheduleEvaluation();
  });
  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    characterData: true
  });

  window.setInterval(() => {
    runSafely(async () => {
      await evaluateCurrentItem("loop");
    });
  }, LOOP_INTERVAL_MS);

  chrome.storage.onChanged.addListener(() => {
    runSafely(async () => {
      await refreshStorageState();
      await evaluateCurrentItem("force");
    });
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message?.type) {
      return false;
    }

    if (message.type === MESSAGE_TYPES.GET_STATUS) {
      sendResponse({ ok: true, status: currentStatus });
      return true;
    }

    if (message.type === MESSAGE_TYPES.REQUEST_DEBUG_SNAPSHOT) {
      sendResponse({ ok: true, snapshot: currentStatus.debugSnapshot });
      return true;
    }

    if (message.type === MESSAGE_TYPES.SET_SETTINGS) {
      runSafely(async () => {
        await patchSettings(message.payload ?? {});
        await refreshStorageState();
        await evaluateCurrentItem("force");
        sendResponse({ ok: true, status: currentStatus });
      });
      return true;
    }

    if (
      message.type === MESSAGE_TYPES.MARK_CREATOR_SLOP
      || message.type === MESSAGE_TYPES.MARK_CREATOR_ALLOW
      || message.type === MESSAGE_TYPES.CLEAR_CREATOR_VOTE
    ) {
      const creatorKey = currentSignals?.creator?.key;
      if (!creatorKey) {
        sendResponse({ ok: false });
        return true;
      }

      runSafely(async () => {
        if (message.type === MESSAGE_TYPES.MARK_CREATOR_SLOP) {
          await setCreatorVote(creatorKey, "slop");
          await learnPhraseScores(currentSignals!, "slop");
        } else if (message.type === MESSAGE_TYPES.MARK_CREATOR_ALLOW) {
          await setCreatorVote(creatorKey, "allow");
          await learnPhraseScores(currentSignals!, "allow");
        } else {
          await clearCreatorVote(creatorKey);
        }
        await refreshStorageState();
        await evaluateCurrentItem("force");
        sendResponse({ ok: true, status: currentStatus });
      });
      return true;
    }

    return false;
  });
}
