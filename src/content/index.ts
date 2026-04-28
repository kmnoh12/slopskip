import { LOOP_INTERVAL_MS, MANUAL_REVISIT_WINDOW_MS, SKIP_COOLDOWN_MS } from "../shared/constants";
import { t } from "../shared/i18n";
import { MESSAGE_TYPES } from "../shared/messages";
import { clearCreatorVote, getStorageState, learnPhraseScores, migrateStorageState, setCreatorVote } from "../shared/storage";
import type { CreatorVote, DebugSnapshot, ExtensionSettings, ExtractedSignals, PlatformStatus, ScoreBreakdown, SignalMatch, StorageState } from "../shared/types";
import { renderDebugPanel } from "./debugPanel";
import { resolvePlatformAdapter } from "./platformRouter";
import { computeScore } from "./scoring";
import { waitForItemChange } from "./skip";
import { hideToast, showCancelableCountdownToast, showToast } from "./toast";

const adapter = resolvePlatformAdapter();
const EVAL_DEBOUNCE_MS = adapter?.platform === "instagram-reels" ? 500 : 250;
const MAX_FAILED_SKIP_RETRIES = 2;
const MAX_TRACKED_ITEM_IDS = 160;
const REELS_SKIP_TACTIC_EVENT = "slopskip:reels-skip-tactic";
const CONTENT_INSTANCE_EVENT = "slopskip:content-instance";
const CONTENT_INSTANCE_STARTED_AT = Date.now();
const CONTENT_INSTANCE_ID = `${CONTENT_INSTANCE_STARTED_AT.toString(36)}-${Math.random().toString(36).slice(2)}`;

type SkipFailureReason = "request-rejected" | "transition-unconfirmed";

interface SkipResult {
  skipped: boolean;
  failureReason?: SkipFailureReason;
  attempts: number;
}

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
let pendingFailedSkipRetryTimer: number | undefined;
let pendingPostSkipRefreshTimer: number | undefined;
let pendingCommentRefreshTimer: number | undefined;
let pendingStorageRefreshTimer: number | undefined;
let contentScriptActive = true;
let observer: MutationObserver | undefined;
let loopTimer: number | undefined;
let cleanupListeners: Array<() => void> = [];
const skippedItemIds = new Set<string>();
const autoSkippedItemIds = new Set<string>();
const manuallyReviewedItemIds = new Set<string>();
const skippedItemOrder: string[] = [];
const autoSkippedItemOrder: string[] = [];
const manuallyReviewedItemOrder: string[] = [];
const failedSkipRetryCounts = new Map<string, number>();
const failedSkipRetryOrder: string[] = [];
const transitionElementIds = new WeakMap<HTMLElement, number>();
let nextTransitionElementId = 1;

function isContextInvalidatedError(error: unknown): boolean {
  if (error instanceof Error) {
    return /Extension context invalidated/i.test(error.message);
  }
  if (typeof error === "string") {
    return /Extension context invalidated/i.test(error);
  }
  if (typeof error === "object" && error && "message" in error) {
    return /Extension context invalidated/i.test(String((error as { message?: unknown }).message));
  }
  return false;
}

function isContextInvalidatedReason(reason: unknown): boolean {
  if (isContextInvalidatedError(reason)) return true;
  return typeof reason === "string" && /Extension context invalidated/i.test(reason);
}

function deactivateContentScript(): void {
  if (!contentScriptActive) return;
  contentScriptActive = false;
  renderDebugPanel(null, false);
  if (pendingTimer) {
    window.clearTimeout(pendingTimer);
    pendingTimer = undefined;
  }
  clearPendingFailedSkipRetry();
  clearPendingPostSkipRefresh();
  clearPendingCommentRefresh();
  clearPendingStorageRefresh();
  clearPendingManualReskip();
  hideToast();
  if (loopTimer) {
    window.clearInterval(loopTimer);
    loopTimer = undefined;
  }
  observer?.disconnect();
  observer = undefined;
  for (const cleanup of cleanupListeners.splice(0)) {
    try {
      cleanup();
    } catch {
      // Ignore cleanup errors after Chrome has invalidated the extension context.
    }
  }
}

function trackCleanup(cleanup: () => void): void {
  cleanupListeners.push(cleanup);
}

function registerWindowListener<K extends keyof WindowEventMap>(
  type: K,
  listener: (event: WindowEventMap[K]) => void,
  options?: AddEventListenerOptions
): void {
  try {
    window.addEventListener(type, listener as EventListener, options);
    trackCleanup(() => window.removeEventListener(type, listener as EventListener, options));
  } catch (error) {
    if (isContextInvalidatedReason(error)) {
      deactivateContentScript();
      return;
    }
    console.error("[SlopSkip]", error);
  }
}

function registerCustomWindowListener(
  type: string,
  listener: EventListener,
  options?: AddEventListenerOptions
): void {
  try {
    window.addEventListener(type, listener, options);
    trackCleanup(() => window.removeEventListener(type, listener, options));
  } catch (error) {
    if (isContextInvalidatedReason(error)) {
      deactivateContentScript();
      return;
    }
    console.error("[SlopSkip]", error);
  }
}

function registerStorageChangedListener(listener: Parameters<typeof chrome.storage.onChanged.addListener>[0]): void {
  try {
    chrome.storage.onChanged.addListener(listener);
    trackCleanup(() => chrome.storage.onChanged.removeListener(listener));
  } catch (error) {
    if (isContextInvalidatedReason(error)) {
      deactivateContentScript();
      return;
    }
    console.error("[SlopSkip]", error);
  }
}

function registerRuntimeMessageListener(listener: Parameters<typeof chrome.runtime.onMessage.addListener>[0]): void {
  try {
    chrome.runtime.onMessage.addListener(listener);
    trackCleanup(() => chrome.runtime.onMessage.removeListener(listener));
  } catch (error) {
    if (isContextInvalidatedReason(error)) {
      deactivateContentScript();
      return;
    }
    console.error("[SlopSkip]", error);
  }
}

function handleGlobalUnhandledRejection(event: PromiseRejectionEvent): void {
  if (!isContextInvalidatedReason(event.reason)) {
    return;
  }
  event.preventDefault();
  deactivateContentScript();
}

function handleGlobalError(event: ErrorEvent): void {
  if (!isContextInvalidatedReason(event.error) && !/Extension context invalidated/i.test(event.message)) {
    return;
  }
  event.preventDefault();
  deactivateContentScript();
}

function announceContentInstance(): void {
  try {
    window.dispatchEvent(new CustomEvent(CONTENT_INSTANCE_EVENT, {
      detail: {
        instanceId: CONTENT_INSTANCE_ID,
        startedAt: CONTENT_INSTANCE_STARTED_AT
      }
    }));
  } catch (error) {
    if (isContextInvalidatedReason(error)) {
      deactivateContentScript();
      return;
    }
    console.error("[SlopSkip]", error);
  }
}

function runSafely(task: () => Promise<void>): void {
  if (!contentScriptActive) {
    return;
  }
  void task().catch((error) => {
    if (isContextInvalidatedError(error)) {
      deactivateContentScript();
      return;
    }
    console.error("[SlopSkip]", error);
  });
}

function sendResponseSafely(sendResponse: (response?: unknown) => void, response: unknown): void {
  try {
    sendResponse(response);
  } catch (error) {
    if (isContextInvalidatedError(error)) {
      deactivateContentScript();
      return;
    }
    console.error("[SlopSkip]", error);
  }
}

function runMessageSafely(sendResponse: (response?: unknown) => void, task: () => Promise<unknown>): void {
  runSafely(async () => {
    try {
      sendResponseSafely(sendResponse, await task());
    } catch (error) {
      if (isContextInvalidatedError(error)) {
        deactivateContentScript();
        return;
      }
      console.error("[SlopSkip]", error);
      sendResponseSafely(sendResponse, { ok: false });
    }
  });
}

function i18nMessage(key: string, substitutions?: string | string[], fallback = key): string {
  const value = t(key, substitutions);
  return value === key ? fallback : value;
}

async function refreshStorageState(): Promise<StorageState> {
  storageState = await getStorageState();
  return storageState;
}

function patchLocalSettings(settingsPatch: Partial<ExtensionSettings>): StorageState | null {
  if (!storageState) return null;
  storageState = migrateStorageState({
    ...storageState,
    settings: {
      ...storageState.settings,
      ...settingsPatch
    }
  });
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

function rememberTrackedItem(set: Set<string>, order: string[], itemId: string): void {
  if (set.has(itemId)) return;
  set.add(itemId);
  order.push(itemId);

  while (order.length > MAX_TRACKED_ITEM_IDS) {
    const expiredItemId = order.shift();
    if (expiredItemId) {
      set.delete(expiredItemId);
    }
  }
}

function forgetTrackedItem(set: Set<string>, order: string[], itemId: string): void {
  if (!set.delete(itemId)) return;
  const index = order.indexOf(itemId);
  if (index >= 0) {
    order.splice(index, 1);
  }
}

function clearTrackedItems(set: Set<string>, order: string[]): void {
  set.clear();
  order.length = 0;
}

function rememberFailedSkipRetry(itemId: string, retryCount: number): void {
  if (!failedSkipRetryCounts.has(itemId)) {
    failedSkipRetryOrder.push(itemId);
  }
  failedSkipRetryCounts.set(itemId, retryCount);

  while (failedSkipRetryOrder.length > MAX_TRACKED_ITEM_IDS) {
    const expiredItemId = failedSkipRetryOrder.shift();
    if (expiredItemId) {
      failedSkipRetryCounts.delete(expiredItemId);
    }
  }
}

function forgetFailedSkipRetry(itemId: string): void {
  failedSkipRetryCounts.delete(itemId);
  const index = failedSkipRetryOrder.indexOf(itemId);
  if (index >= 0) {
    failedSkipRetryOrder.splice(index, 1);
  }
}

function clearFailedSkipRetries(): void {
  failedSkipRetryCounts.clear();
  failedSkipRetryOrder.length = 0;
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

function clearPendingFailedSkipRetry(): void {
  if (pendingFailedSkipRetryTimer) {
    window.clearTimeout(pendingFailedSkipRetryTimer);
    pendingFailedSkipRetryTimer = undefined;
  }
}

function clearPendingPostSkipRefresh(): void {
  if (pendingPostSkipRefreshTimer) {
    window.clearTimeout(pendingPostSkipRefreshTimer);
    pendingPostSkipRefreshTimer = undefined;
  }
}

function clearPendingCommentRefresh(): void {
  if (pendingCommentRefreshTimer) {
    window.clearTimeout(pendingCommentRefreshTimer);
    pendingCommentRefreshTimer = undefined;
  }
}

function clearPendingStorageRefresh(): void {
  if (pendingStorageRefreshTimer) {
    window.clearTimeout(pendingStorageRefreshTimer);
    pendingStorageRefreshTimer = undefined;
  }
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
  clearPendingFailedSkipRetry();
  clearPendingPostSkipRefresh();
  clearPendingCommentRefresh();
  clearTrackedItems(skippedItemIds, skippedItemOrder);
  clearTrackedItems(autoSkippedItemIds, autoSkippedItemOrder);
  clearTrackedItems(manuallyReviewedItemIds, manuallyReviewedItemOrder);
  clearFailedSkipRetries();
}

function clearInactivePageState(): void {
  clearTransientState();
  currentStatus = {
    platform: adapter?.platform ?? "unsupported",
    supported: false
  };
  renderDebugPanel(null, false);
}

function getManualReskipMessage(secondsLeft: number): string {
  return i18nMessage(
    "toastManualRevisitCountdown",
    [String(secondsLeft)],
    `Revisited reel. Skipping again in ${secondsLeft} seconds.`
  );
}

function reasonPriority(match: SignalMatch): number {
  if (match.source === "vote") return 60;
  if (match.source === "official") return 50;
  if (match.source === "caption") return 40;
  if (match.source === "hashtags") return 30;
  if (match.source === "comments") return 20;
  return 0;
}

function selectPrimaryReason(score: ScoreBreakdown): string {
  const positiveMatches = score.matches
    .filter((match) => match.weight > 0 && match.source !== "contradiction")
    .sort((left, right) => {
      const priorityDelta = reasonPriority(right) - reasonPriority(left);
      if (priorityDelta !== 0) return priorityDelta;
      return right.weight - left.weight;
    });

  return positiveMatches[0]?.reasonKey ?? "reasonWouldSkip";
}

function getSkipToastMessage(score: ScoreBreakdown, dryRun: boolean): string {
  const primaryReason = selectPrimaryReason(score);
  const localizedReason = i18nMessage(primaryReason);
  return dryRun
    ? i18nMessage("toastWouldSkip", [localizedReason, String(score.total)], `Would skip: ${localizedReason} (${score.total})`)
    : i18nMessage("toastSkipped", [localizedReason, String(score.total)], `Skipped: ${localizedReason} (${score.total})`);
}

function addDebugBreadcrumb(event: string, details: Record<string, unknown> = {}): void {
  const entry = {
    event,
    at: new Date().toISOString(),
    ...details
  };

  const snapshot = currentStatus.debugSnapshot ?? currentSnapshot;
  if (snapshot) {
    const probe = snapshot.probe ?? {};
    const breadcrumbs = Array.isArray(probe.skipBreadcrumbs)
      ? [...probe.skipBreadcrumbs, entry]
      : [entry];
    snapshot.probe = {
      ...probe,
      skipBreadcrumbs: breadcrumbs.slice(-8)
    };
  }

  if (adapter?.platform === "instagram-reels" && storageState?.settings.debugMode) {
    console.info("[SlopSkip Reels skip]", entry);
  }
}

function getActiveTransitionKey(previousActiveItem: HTMLElement): string | undefined {
  const activeItem = adapter?.findActiveItem();
  if (!activeItem) return currentSignals?.itemId;

  const videoKey = _getVideoSrc(activeItem);
  const elementKey = getTransitionElementKey(activeItem);
  const source = activeItem === previousActiveItem ? "same" : "changed";
  return videoKey
    ? `${source}::video::${videoKey}`
    : `${source}::element::${elementKey}`;
}

function getTransitionElementKey(element: HTMLElement): number {
  const existingId = transitionElementIds.get(element);
  if (existingId) return existingId;

  const nextId = nextTransitionElementId;
  nextTransitionElementId += 1;
  transitionElementIds.set(element, nextId);
  return nextId;
}

function scheduleFailedSkipRetry(signals: ExtractedSignals, failureReason: SkipFailureReason): void {
  const retryCount = failedSkipRetryCounts.get(signals.itemId) ?? 0;
  if (retryCount >= MAX_FAILED_SKIP_RETRIES) {
    addDebugBreadcrumb("skip-retry-exhausted", {
      itemId: signals.itemId,
      failureReason,
      retryCount
    });
    return;
  }

  rememberFailedSkipRetry(signals.itemId, retryCount + 1);
  clearPendingFailedSkipRetry();

  const delayMs = Math.max(700, skipCooldownUntil - Date.now() + 250);
  addDebugBreadcrumb("skip-retry-scheduled", {
    itemId: signals.itemId,
    failureReason,
    retryCount: retryCount + 1,
    delayMs
  });

  pendingFailedSkipRetryTimer = window.setTimeout(() => {
    pendingFailedSkipRetryTimer = undefined;
    runSafely(async () => {
      if (currentSignals?.itemId !== signals.itemId) {
        addDebugBreadcrumb("skip-retry-canceled-item-changed", {
          expectedItemId: signals.itemId,
          currentItemId: currentSignals?.itemId
        });
        return;
      }

      await evaluateCurrentItem("force");
    });
  }, delayMs);
}

function schedulePostSkipRefresh(signals: ExtractedSignals, delayMs = 520): void {
  const previousItemId = signals.itemId;
  clearPendingPostSkipRefresh();
  addDebugBreadcrumb("post-skip-refresh-scheduled", { previousItemId, delayMs });

  pendingPostSkipRefreshTimer = window.setTimeout(() => {
    pendingPostSkipRefreshTimer = undefined;
    runSafely(async () => {
      if (skipInFlight || isExtracting) {
        addDebugBreadcrumb("post-skip-refresh-deferred-busy", { previousItemId });
        schedulePostSkipRefresh(signals, 350);
        return;
      }

      addDebugBreadcrumb("post-skip-refresh-started", {
        previousItemId,
        currentItemId: currentSignals?.itemId
      });
      await evaluateCurrentItem("force");

      if (currentSignals?.itemId === previousItemId) {
        forgetTrackedItem(skippedItemIds, skippedItemOrder, previousItemId);
        forgetTrackedItem(autoSkippedItemIds, autoSkippedItemOrder, previousItemId);
        skipCooldownUntil = Date.now() + 450;
        addDebugBreadcrumb("post-skip-refresh-still-previous", { previousItemId });
        scheduleFailedSkipRetry(signals, "transition-unconfirmed");
      } else {
        addDebugBreadcrumb("post-skip-refresh-completed", {
          previousItemId,
          currentItemId: currentSignals?.itemId
        });
      }
    });
  }, delayMs);
}

async function executeSkip(activeItem: HTMLElement, signals: ExtractedSignals, state: StorageState): Promise<SkipResult> {
  const previousId = signals.itemId;
  const previousTransitionKey = getActiveTransitionKey(activeItem);
  skipInFlight = true;
  let attempts = 0;

  try {
    addDebugBreadcrumb("skip-requested", {
      itemId: previousId,
      transitionKey: previousTransitionKey
    });

    const didRequestSkip = await adapter!.skipToNext(activeItem);
    attempts += 1;
    if (!didRequestSkip) {
      addDebugBreadcrumb("skip-request-rejected", { itemId: previousId, attempts });
      return { skipped: false, failureReason: "request-rejected", attempts };
    }

    let changeResult = await waitForItemChange(() => getActiveTransitionKey(activeItem), previousTransitionKey, 2800);

    skipCooldownUntil = Date.now() + SKIP_COOLDOWN_MS;

    if (!changeResult.changed) {
      const latestActiveItem = adapter!.findActiveItem();
      if (latestActiveItem) {
        const retryTransitionKey = getActiveTransitionKey(latestActiveItem);
        await adapter!.skipToNext(latestActiveItem);
        attempts += 1;
        changeResult = await waitForItemChange(() => getActiveTransitionKey(latestActiveItem), retryTransitionKey, 2200);
      }
    }

    if (!changeResult.changed) {
      skipCooldownUntil = Date.now() + 3000;
      addDebugBreadcrumb("skip-transition-unconfirmed", {
        itemId: previousId,
        attempts,
        elapsedMs: changeResult.elapsedMs,
        currentTransitionKey: changeResult.currentId
      });
      if (state.settings.showToast) {
        showToast(i18nMessage("toastSkipTransitionUnconfirmed", undefined, "Next reel transition was not confirmed. Retrying."));
      }
      return { skipped: false, failureReason: "transition-unconfirmed", attempts };
    }

    rememberTrackedItem(skippedItemIds, skippedItemOrder, previousId);
    rememberTrackedItem(autoSkippedItemIds, autoSkippedItemOrder, previousId);
    forgetFailedSkipRetry(previousId);
    clearPendingFailedSkipRetry();
    schedulePostSkipRefresh(signals);
    addDebugBreadcrumb("skip-confirmed", {
      itemId: previousId,
      attempts,
      elapsedMs: changeResult.elapsedMs,
      currentTransitionKey: changeResult.currentId
    });
    return { skipped: true, attempts };
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
    cancelLabel: i18nMessage("toastManualRevisitCancel", undefined, "Cancel"),
    getMessage: getManualReskipMessage,
    onCancel: () => {
      rememberTrackedItem(manuallyReviewedItemIds, manuallyReviewedItemOrder, signals.itemId);
      pendingManualReskipItemId = undefined;
      if (state.settings.showToast) {
        const canceled = i18nMessage("toastManualRevisitCanceled", undefined, "Auto-skip was canceled for this post.");
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

        const score = currentStatus.lastScore;
        const skipResult = await executeSkip(latestActiveItem, signals, latestState);
        if (skipResult.skipped && score && latestState.settings.showToast) {
          showToast(getSkipToastMessage(score, false));
        }
        if (!skipResult.skipped && skipResult.failureReason) {
          scheduleFailedSkipRetry(signals, skipResult.failureReason);
        }
      });
    }
  });
}

async function evaluateCurrentItem(reason = "loop"): Promise<void> {
  if (!contentScriptActive) {
    return;
  }
  if (!adapter) {
    return;
  }
  if (!adapter.detect()) {
    clearInactivePageState();
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
    clearInactivePageState();
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
  const score = computeScore(
    signals,
    state.settings.sensitivity,
    vote,
    thresholdOverride,
    state.learnedPhraseScores,
    state.ruleOverrides
  );
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
    clearPendingCommentRefresh();
    pendingCommentRefreshTimer = window.setTimeout(() => {
      pendingCommentRefreshTimer = undefined;
      runSafely(async () => {
        await evaluateCurrentItem("force");
      });
    }, 1850);
  }

  if (pendingManualReskipItemId && pendingManualReskipItemId !== signals.itemId) {
    clearPendingManualReskip();
  }

  if (Date.now() < skipCooldownUntil) {
    addDebugBreadcrumb("skip-deferred-cooldown", {
      itemId: signals.itemId,
      remainingMs: skipCooldownUntil - Date.now()
    });
    return;
  }

  if (manuallyReviewedItemIds.has(signals.itemId)) {
    addDebugBreadcrumb("skip-deferred-manual-review", { itemId: signals.itemId });
    return;
  }

  if (
    adapter.platform === "instagram-reels"
    && signals.raw?.commentPanelOpen
    && commentPanelGraceItemId === signals.itemId
    && Date.now() < commentPanelGraceUntil
  ) {
    addDebugBreadcrumb("skip-deferred-comment-grace", {
      itemId: signals.itemId,
      remainingMs: commentPanelGraceUntil - Date.now()
    });
    return;
  }

  if (signals.itemId === lastProcessedItemId && reason !== "force" && !score.shouldSkip) {
    return;
  }

  if (shouldHandleManualRevisit(signals.itemId, state)) {
    addDebugBreadcrumb("skip-deferred-manual-revisit-countdown", { itemId: signals.itemId });
    startManualReskipCountdown(signals, state);
    return;
  }

  if (skippedItemIds.has(signals.itemId)) {
    addDebugBreadcrumb("skip-deferred-already-skipped", { itemId: signals.itemId });
    return;
  }

  if (!score.shouldSkip) {
    lastProcessedItemId = signals.itemId;
    return;
  }

  if (state.settings.dryRun) {
    if (state.settings.showToast) {
      showToast(getSkipToastMessage(score, true));
    }
    lastProcessedItemId = signals.itemId;
    return;
  }

  const skipResult = await executeSkip(activeItem, signals, state);
  if (skipResult.skipped && state.settings.showToast) {
    showToast(getSkipToastMessage(score, false));
  }
  if (!skipResult.skipped && skipResult.failureReason) {
    scheduleFailedSkipRetry(signals, skipResult.failureReason);
  }
}

function _getVideoSrc(el: HTMLElement): string {
  const v = el.querySelector("video");
  return v?.src || v?.currentSrc || v?.poster || "";
}

function scheduleEvaluation(reason = "mutation"): void {
  if (!contentScriptActive) {
    return;
  }
  if (pendingTimer) {
    window.clearTimeout(pendingTimer);
  }
  pendingTimer = window.setTimeout(() => {
    runSafely(async () => {
      await evaluateCurrentItem(reason);
    });
  }, EVAL_DEBOUNCE_MS);
}

if (adapter) {
  registerWindowListener("unhandledrejection", handleGlobalUnhandledRejection);
  registerWindowListener("error", handleGlobalError);

  const handleContentInstance = (event: Event): void => {
    const detail = event instanceof CustomEvent && typeof event.detail === "object"
      ? event.detail as { instanceId?: unknown; startedAt?: unknown }
      : {};
    const instanceId = detail.instanceId;
    const startedAt = detail.startedAt;
    if (
      typeof instanceId === "string"
      && instanceId !== CONTENT_INSTANCE_ID
      && typeof startedAt === "number"
      && startedAt > CONTENT_INSTANCE_STARTED_AT
    ) {
      deactivateContentScript();
    }
  };
  registerCustomWindowListener(CONTENT_INSTANCE_EVENT, handleContentInstance);
  announceContentInstance();

  const handleReelsSkipTactic = (event: Event): void => {
    const detail = event instanceof CustomEvent && typeof event.detail === "object"
      ? event.detail as Record<string, unknown>
      : {};
    addDebugBreadcrumb("reels-skip-tactic", detail);
  };
  registerCustomWindowListener(REELS_SKIP_TACTIC_EVENT, handleReelsSkipTactic);

  const handleWheel = (event: WheelEvent): void => {
    if (event.deltaY < 0) {
      noteManualRevisitIntent();
    }
  };
  registerWindowListener("wheel", handleWheel, { passive: true });

  const handleKeydown = (event: KeyboardEvent): void => {
    if (event.key === "ArrowUp" || event.key === "PageUp") {
      noteManualRevisitIntent();
    }
  };
  registerWindowListener("keydown", handleKeydown);

  runSafely(async () => {
    await refreshStorageState();
    await evaluateCurrentItem("boot");
  });

  observer = new MutationObserver(() => {
    scheduleEvaluation();
  });
  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    characterData: true
  });

  loopTimer = window.setInterval(() => {
    runSafely(async () => {
      await evaluateCurrentItem("loop");
    });
  }, LOOP_INTERVAL_MS);

  const handleStorageChanged: Parameters<typeof chrome.storage.onChanged.addListener>[0] = (changes, areaName): void => {
    if (areaName !== "local") {
      return;
    }

    const relevantKeys: Array<keyof StorageState> = [
      "settings",
      "creatorVotes",
      "learnedPhraseScores",
      "platformFlags",
      "ruleOverrides"
    ];
    if (!relevantKeys.some((key) => key in changes)) {
      return;
    }

    clearPendingStorageRefresh();
    pendingStorageRefreshTimer = window.setTimeout(() => {
      pendingStorageRefreshTimer = undefined;
      runSafely(async () => {
        await refreshStorageState();
        await evaluateCurrentItem("force");
      });
    }, 120);
  };
  registerStorageChangedListener(handleStorageChanged);

  const handleRuntimeMessage = (message: { type?: string; payload?: unknown }, _sender: chrome.runtime.MessageSender, sendResponse: (response?: unknown) => void): boolean => {
    if (!message?.type) {
      return false;
    }

    if (message.type === MESSAGE_TYPES.GET_STATUS) {
      sendResponseSafely(sendResponse, { ok: true, status: currentStatus });
      return true;
    }

    if (message.type === MESSAGE_TYPES.REQUEST_DEBUG_SNAPSHOT) {
      sendResponseSafely(sendResponse, { ok: true, snapshot: currentStatus.debugSnapshot });
      return true;
    }

    if (message.type === MESSAGE_TYPES.SET_SETTINGS) {
      runMessageSafely(sendResponse, async () => {
        if (!storageState) {
          await refreshStorageState();
        }
        patchLocalSettings((message.payload ?? {}) as Partial<ExtensionSettings>);
        await evaluateCurrentItem("force");
        return { ok: true, status: currentStatus };
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
        sendResponseSafely(sendResponse, { ok: false });
        return true;
      }

      runMessageSafely(sendResponse, async () => {
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
        return { ok: true, status: currentStatus };
      });
      return true;
    }

    return false;
  };
  registerRuntimeMessageListener(handleRuntimeMessage);
}
