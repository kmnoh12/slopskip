import { LOOP_INTERVAL_MS, MANUAL_REVISIT_WINDOW_MS, SKIP_COOLDOWN_MS } from "../shared/constants";
import { MESSAGE_TYPES } from "../shared/messages";
import { clearCreatorVote, getStorageState, learnPhraseScores, patchSettings, setCreatorVote } from "../shared/storage";
import type { CreatorVote, DebugSnapshot, ExtractedSignals, PlatformStatus, StorageState } from "../shared/types";
import { renderDebugPanel } from "./debugPanel";
import { resolvePlatformAdapter } from "./platformRouter";
import { computeScore } from "./scoring";
import { waitForItemChange } from "./skip";
import { showToast } from "./toast";

const adapter = resolvePlatformAdapter();

/** 인스타 릴스용 디바운스 (DOM 변경이 매우 빈번하므로 더 길게) */
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

function shouldPauseForManualRevisit(itemId: string, state: StorageState): boolean {
  if (!state.settings.pauseOnManualRevisit) {
    return false;
  }

  if (manuallyReviewedItemIds.has(itemId)) {
    return true;
  }

  if (Date.now() > manualRevisitIntentUntil) {
    return false;
  }

  if (!autoSkippedItemIds.has(itemId)) {
    return false;
  }

  manuallyReviewedItemIds.add(itemId);
  return true;
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
  skippedItemIds.clear();
}

async function evaluateCurrentItem(reason = "loop"): Promise<void> {
  if (!adapter || !adapter.detect()) {
    return;
  }

  // skip 진행 중이거나 추출 중이면 evaluation 차단 (진동/연타 방지)
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

  // itemId가 바뀌면 이전 릴의 상태를 클리어
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
    console.info("[SlopSkip Reels]", { itemId: signals.itemId, score: score.total, shouldSkip: score.shouldSkip, creator: signals.creator?.handle });
  }

  if (adapter.platform === "instagram-reels" && signals.raw?.commentPanelTriggered) {
    commentPanelGraceItemId = signals.itemId;
    commentPanelGraceUntil = Date.now() + 1800;
  }

  // 이미 처리한 아이템이면 스킵 (force 제외)
  if (signals.itemId === lastProcessedItemId && reason !== "force") {
    return;
  }

  lastProcessedItemId = signals.itemId;

  // 쿨다운 중이면 스킵
  if (Date.now() < skipCooldownUntil) {
    return;
  }

  // 이미 skip 시도한 아이템이면 재시도하지 않음
  if (skippedItemIds.has(signals.itemId)) {
    return;
  }

  if (shouldPauseForManualRevisit(signals.itemId, state)) {
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

  if (!score.shouldSkip) {
    return;
  }

  // 토스트 표시
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

  // ── Skip 실행 ──
  const previousId = signals.itemId;
  skippedItemIds.add(previousId);
  autoSkippedItemIds.add(previousId);
  skipInFlight = true;

  try {
    const didRequestSkip = await adapter.skipToNext(activeItem);
    if (!didRequestSkip) {
      return;
    }

    // itemId 변경 대기 (최대 2초)
    const changed = await waitForItemChange(() => {
      // skip 중에도 findActiveItem + extractSignals를 간이 호출해서 현재 itemId 확인
      // 하지만 여기서는 이미 갱신된 currentSignals를 쓰지 않고, 새로 찾음
      const newActive = adapter!.findActiveItem();
      if (!newActive) return currentSignals?.itemId;
      const video = newActive.querySelector("video");
      const src = video?.src || video?.currentSrc || video?.poster || "";
      // 간이 비교: 이전 active와 같은 video이면 같은 itemId
      return src ? `quick::${src}` : currentSignals?.itemId;
    }, `quick::${_getVideoSrc(activeItem)}`, 2000);

    skipCooldownUntil = Date.now() + SKIP_COOLDOWN_MS;

    if (!changed) {
      // 전환이 확인되지 않았지만, 재시도하지 않음 (skippedItemIds에 이미 등록됨)
      skipCooldownUntil = Date.now() + 3000;
      if (state.settings.showToast) {
        showToast(chrome.i18n.getMessage("toastSkipTransitionUnconfirmed"));
      }
    }
  } finally {
    skipInFlight = false;
    // skip 완료 후 즉시 재평가
    lastProcessedItemId = undefined;
  }
}

/** activeItem에서 video src를 꺼내는 헬퍼 */
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
