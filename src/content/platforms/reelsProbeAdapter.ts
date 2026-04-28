import { IG_SELECTORS } from "../../shared/constants";
import type { CreatorIdentity, DebugSnapshot, ExtractedSignals, PlatformAdapter } from "../../shared/types";
import { getStorageState } from "../../shared/storage";
import { collectVisibleText, normalizeText, uniqStrings } from "../dom";
import { detectLocaleBucket, detectLocaleBuckets } from "../language";

const REELS_DISCLOSURE_RE = /\b(aigc|ai generated|generated with ai|made with ai|created with ai|artificial intelligence|inteligencia artificial)\b/i;
const REELS_AI_TEXT_RE = /\b(ai|ia|aigc|artificial intelligence|inteligencia artificial|generated|generated with ai|made with ai|ai generated)\b/i;
const MAX_ATTEMPTED_COMMENT_ITEMS = 80;
const SKIP_TACTIC_EVENT = "slopskip:reels-skip-tactic";

interface ActiveReelCandidate {
  container: HTMLElement;
  score: number;
  visibleRatio: number;
  centerDistance: number;
  playingVideoCount: number;
  index: number;
}

interface ReelIdentity {
  itemId: string;
  source: "permalink" | "video" | "element-caption";
  hashInputLength: number;
  elementId: number;
  hasVideoKey: boolean;
  hasPermalink: boolean;
}

const reelElementIds = new WeakMap<HTMLElement, number>();
let nextReelElementId = 1;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return hash.toString(36);
}

function findMeaningfulAncestor(video: HTMLElement): HTMLElement | null {
  let current: HTMLElement | null = video.parentElement;
  let bestCandidate: HTMLElement | null = null;

  while (current) {
    const tag = current.tagName.toLowerCase();
    if (tag === "main" || tag === "body" || tag === "html") break;

    const rect = current.getBoundingClientRect();
    if (rect.width < 200 || rect.height < 200) {
      current = current.parentElement;
      continue;
    }

    if (
      tag === "article"
      || tag === "section"
      || current.getAttribute("role") === "presentation"
      || current.getAttribute("style")?.includes("transform")
    ) {
      bestCandidate = current;
      if (tag === "article") break;
    }

    if (!bestCandidate && rect.height >= 400) {
      bestCandidate = current;
    }

    current = current.parentElement;
  }

  return bestCandidate;
}

function findReelContainers(): HTMLElement[] {
  const videos = [...document.querySelectorAll<HTMLVideoElement>("main video, article video")];
  const containers = new Set<HTMLElement>();

  for (const video of videos) {
    const container = findMeaningfulAncestor(video);
    if (container) {
      containers.add(container);
    }
  }

  return [...containers];
}

function getVisibleRatio(rect: DOMRect): number {
  if (rect.width <= 0 || rect.height <= 0) return 0;

  const visibleWidth = Math.max(0, Math.min(rect.right, window.innerWidth) - Math.max(rect.left, 0));
  const visibleHeight = Math.max(0, Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0));
  return (visibleWidth * visibleHeight) / (rect.width * rect.height);
}

function getPlayingVideoCount(container: HTMLElement): number {
  return [...container.querySelectorAll<HTMLVideoElement>("video")]
    .filter((video) => !video.paused && !video.ended && video.readyState > 1)
    .length;
}

function scoreReelCandidates(containers: HTMLElement[]): ActiveReelCandidate[] {
  const viewportCenterY = window.innerHeight / 2;

  return containers.map((container, index) => {
    const rect = container.getBoundingClientRect();
    const centerY = rect.top + rect.height / 2;
    const centerDistance = Math.abs(centerY - viewportCenterY);
    const visibleRatio = getVisibleRatio(rect);
    const playingVideoCount = getPlayingVideoCount(container);
    const centerCloseness = Math.max(0, 1 - centerDistance / Math.max(window.innerHeight, 1));
    const score = (visibleRatio * 1000) + (centerCloseness * 220) + (playingVideoCount * 260);

    return {
      container,
      score,
      visibleRatio,
      centerDistance,
      playingVideoCount,
      index
    };
  }).sort((left, right) => right.score - left.score);
}

function findActiveReel(): HTMLElement | null {
  const containers = findReelContainers();
  if (!containers.length) return null;
  if (containers.length === 1) return containers[0];

  return scoreReelCandidates(containers)[0]?.container ?? null;
}

function getActiveSelectionDiagnostics(activeItem: HTMLElement | null): Record<string, unknown> {
  const candidates = scoreReelCandidates(findReelContainers());
  const selected = candidates.find((candidate) => candidate.container === activeItem);

  return {
    candidateCount: candidates.length,
    selectedIndex: selected?.index,
    selectedScore: selected ? Math.round(selected.score) : undefined,
    selectedVisibleRatio: selected ? Number(selected.visibleRatio.toFixed(3)) : undefined,
    selectedCenterDistance: selected ? Math.round(selected.centerDistance) : undefined,
    selectedPlayingVideoCount: selected?.playingVideoCount,
    topCandidates: candidates.slice(0, 3).map((candidate) => ({
      index: candidate.index,
      score: Math.round(candidate.score),
      visibleRatio: Number(candidate.visibleRatio.toFixed(3)),
      centerDistance: Math.round(candidate.centerDistance),
      playingVideoCount: candidate.playingVideoCount
    }))
  };
}

function isSameReel(left: HTMLElement | null, right: HTMLElement | null): boolean {
  return Boolean(left && right && left === right);
}

function findNextReelAfter(activeItem: HTMLElement): HTMLElement | null {
  const containers = findReelContainers();
  const activeRect = activeItem.getBoundingClientRect();
  const activeCenterY = activeRect.top + activeRect.height / 2;

  return containers
    .map((container) => {
      const rect = container.getBoundingClientRect();
      return {
        container,
        top: rect.top,
        centerY: rect.top + rect.height / 2
      };
    })
    .filter((candidate) => candidate.container !== activeItem && candidate.centerY > activeCenterY + 40)
    .sort((left, right) => left.centerY - right.centerY)[0]?.container ?? null;
}

function recordSkipTactic(name: string, moved: boolean): void {
  window.dispatchEvent(new CustomEvent(SKIP_TACTIC_EVENT, {
    detail: {
      name,
      moved,
      at: new Date().toISOString()
    }
  }));
}

async function runSkipTactic(name: string, activeItem: HTMLElement, tactic: () => void | Promise<void>, waitMs = 420): Promise<boolean> {
  await tactic();
  await wait(waitMs);
  const moved = !isSameReel(findActiveReel(), activeItem);
  recordSkipTactic(name, moved);
  return moved;
}

function getReelElementId(activeItem: HTMLElement): number {
  const existingId = reelElementIds.get(activeItem);
  if (existingId) return existingId;

  const nextId = nextReelElementId;
  nextReelElementId += 1;
  reelElementIds.set(activeItem, nextId);
  return nextId;
}

function extractCreator(activeItem: HTMLElement): CreatorIdentity | undefined {
  const links = [
    ...activeItem.querySelectorAll<HTMLAnchorElement>("a[href]"),
    ...document.querySelectorAll<HTMLAnchorElement>('header a[href], div[role="dialog"] a[href], div[scrollable="true"] a[href]')
  ];

  const validLinks = links.filter((link) => {
    const href = link.getAttribute("href") || "";
    const rect = link.getBoundingClientRect();
    if (rect.width < 5 || rect.height < 5) return false;

    try {
      const urlObj = new URL(href, window.location.origin);
      if (urlObj.hostname !== window.location.hostname && !urlObj.hostname.includes("instagram.com")) return false;

      const parts = urlObj.pathname.split("/").filter(Boolean);
      if (parts.length !== 1) return false;

      const username = parts[0];
      const ignore = ["p", "reels", "explore", "tags", "direct", "stories", "tv"];
      return !ignore.includes(username.toLowerCase());
    } catch {
      return false;
    }
  });

  const chosen = validLinks.sort((a, b) => {
    const aInActive = activeItem.contains(a);
    const bInActive = activeItem.contains(b);
    if (aInActive && !bInActive) return -1;
    if (!aInActive && bInActive) return 1;
    return a.getBoundingClientRect().top - b.getBoundingClientRect().top;
  })[0];

  if (!chosen) return undefined;

  try {
    const href = chosen.getAttribute("href") || "";
    const urlObj = new URL(href, window.location.origin);
    const username = urlObj.pathname.split("/").filter(Boolean)[0];
    if (!username) return undefined;

    return {
      key: `instagram:/${username}/`,
      handle: username,
      profileUrl: `https://www.instagram.com/${username}/`
    };
  } catch {
    return undefined;
  }
}

function extractReelPermalink(activeItem: HTMLElement): string {
  const links = [...activeItem.querySelectorAll<HTMLAnchorElement>("a[href]")];
  const reelLink = links
    .map((link) => {
      try {
        return new URL(link.getAttribute("href") || "", window.location.origin);
      } catch {
        return null;
      }
    })
    .find((urlObj) => {
      if (!urlObj) return false;
      if (urlObj.hostname !== window.location.hostname && !urlObj.hostname.includes("instagram.com")) return false;
      return /^\/(?:reel|reels|p)\//.test(urlObj.pathname);
    });

  return reelLink ? `${reelLink.pathname}${reelLink.search}` : "";
}

function getStableItemIdentity(activeItem: HTMLElement, caption: string, creator?: CreatorIdentity): ReelIdentity {
  const video = activeItem.querySelector("video");
  const videoKey = video?.src || video?.currentSrc || video?.poster || "";
  const permalink = extractReelPermalink(activeItem);
  const elementId = getReelElementId(activeItem);
  const creatorKey = creator?.handle ?? "unknown";
  const captionKey = caption.slice(0, 80);

  if (permalink) {
    const hashInput = `${creatorKey}|${permalink}`;
    return {
      itemId: `ig::${creatorKey}::permalink::${simpleHash(hashInput)}`,
      source: "permalink",
      hashInputLength: hashInput.length,
      elementId,
      hasVideoKey: Boolean(videoKey),
      hasPermalink: true
    };
  }

  if (videoKey) {
    const hashInput = `${creatorKey}|${videoKey}`;
    return {
      itemId: `ig::${creatorKey}::video::${simpleHash(hashInput)}`,
      source: "video",
      hashInputLength: hashInput.length,
      elementId,
      hasVideoKey: true,
      hasPermalink: false
    };
  }

  const hashInput = `${creatorKey}|${window.location.pathname}|${captionKey}|element:${elementId}`;
  return {
    itemId: `ig::${creatorKey}::element::${simpleHash(hashInput)}`,
    source: "element-caption",
    hashInputLength: hashInput.length,
    elementId,
    hasVideoKey: false,
    hasPermalink: false
  };
}

function extractCaptionTexts(activeItem: HTMLElement): string[] {
  const texts = collectVisibleText(activeItem);
  const innerTexts = [...activeItem.querySelectorAll<HTMLElement>("h1")]
    .map((node) => normalizeText(node.textContent));

  const scripts = [...document.querySelectorAll<HTMLScriptElement>('script[type="application/ld+json"], script[type="application/json"]')];
  const joinedScripts = scripts.map((script) => script.textContent ?? "").join("\n");
  const captionMatch = joinedScripts.match(/"caption":\{"text":"([^"]+)/);
  const jsonCaption = captionMatch ? normalizeText(captionMatch[1].replace(/\\"/g, '"')) : "";
  const metaDesc = document.querySelector<HTMLMetaElement>('meta[name="description"]')?.content ?? "";

  return uniqStrings([jsonCaption, metaDesc, ...innerTexts, ...texts])
    .filter((text) => text.length >= 8)
    .slice(0, 30);
}

function extractCommentTexts(activeItem: HTMLElement): string[] {
  const commentNodes: HTMLElement[] = [];

  for (const selector of IG_SELECTORS.commentItems) {
    commentNodes.push(...activeItem.querySelectorAll<HTMLElement>(selector));
  }

  const dialog = document.querySelector<HTMLElement>('div[role="dialog"]') || document.querySelector<HTMLElement>('div[scrollable="true"]');
  if (dialog) {
    for (const selector of IG_SELECTORS.commentItems) {
      commentNodes.push(...dialog.querySelectorAll<HTMLElement>(selector));
    }
    commentNodes.push(...dialog.querySelectorAll<HTMLElement>('span[dir="auto"]'));
  }

  return uniqStrings(commentNodes.map((node) => normalizeText(node.textContent)))
    .filter((text) => text.length >= 2)
    .slice(0, 30);
}

function isCommentPanelOpen(): boolean {
  if (document.querySelector('div[role="dialog"]')) return true;
  if (document.querySelector('div[scrollable="true"]')) return true;
  if (document.querySelector('form textarea')) return true;
  if (document.querySelector('textarea[placeholder*="comment" i]')) return true;
  if (document.querySelector('textarea[placeholder*="댓글" i]')) return true;
  return false;
}

const attemptedCommentItemIds = new Set<string>();
const attemptedCommentItemOrder: string[] = [];

function rememberCommentAttempt(itemId: string): void {
  if (attemptedCommentItemIds.has(itemId)) {
    return;
  }

  attemptedCommentItemIds.add(itemId);
  attemptedCommentItemOrder.push(itemId);

  while (attemptedCommentItemOrder.length > MAX_ATTEMPTED_COMMENT_ITEMS) {
    const oldestItemId = attemptedCommentItemOrder.shift();
    if (oldestItemId) {
      attemptedCommentItemIds.delete(oldestItemId);
    }
  }
}

async function tryOpenCommentPanel(_activeItem: HTMLElement, itemId: string): Promise<{ triggered: boolean; attempts: number }> {
  if (attemptedCommentItemIds.has(itemId)) {
    return { triggered: false, attempts: 0 };
  }

  rememberCommentAttempt(itemId);

  const svgs = [...document.querySelectorAll<HTMLElement>('svg[aria-label="Comment" i], svg[aria-label="댓글" i], svg[aria-label="Comments" i]')];
  if (!svgs.length) {
    return { triggered: false, attempts: 0 };
  }

  const viewportCenter = window.innerHeight / 2;
  const activeSvg = svgs.reduce((prev, curr) => {
    const pRect = prev.getBoundingClientRect();
    const cRect = curr.getBoundingClientRect();
    const pDist = Math.abs((pRect.top + pRect.bottom) / 2 - viewportCenter);
    const cDist = Math.abs((cRect.top + cRect.bottom) / 2 - viewportCenter);
    return cDist < pDist ? curr : prev;
  });

  const btn = activeSvg.closest<HTMLElement>('div[role="button"], button') || activeSvg;
  btn.click();
  await wait(800);

  return { triggered: true, attempts: 1 };
}

async function expandCaption(activeItem: HTMLElement): Promise<void> {
  const state = await getStorageState();
  if (!state.settings.reelsAutoExpandCaption) {
    return;
  }

  const nodes = [...activeItem.querySelectorAll<HTMLElement>("span, div")];
  const moreSpan = nodes.find((node) => {
    if (node.childElementCount > 0 && node.tagName.toLowerCase() !== "span") return false;
    const text = normalizeText(node.textContent).toLowerCase();
    return text === "더 보기" || text === "… 더 보기" || text === "more" || text === "… more";
  });

  if (moreSpan) {
    const clickable = moreSpan.closest<HTMLElement>('div[role="button"], button') || moreSpan;
    clickable.click();
    await wait(30);
  }
}

function fireKeyboardNavigation(key: "ArrowDown" | "PageDown" | " "): void {
  const targets = [
    document.activeElement,
    document.body,
    document.documentElement,
    window
  ].filter(Boolean) as Array<Element | Window>;

  for (const type of ["keydown", "keyup"] as const) {
    for (const target of targets) {
      target.dispatchEvent(createKeyboardEvent(type, key));
    }
  }
}

function createKeyboardEvent(type: "keydown" | "keyup", key: "ArrowDown" | "PageDown" | " "): KeyboardEvent {
  const keyCode = key === "ArrowDown" ? 40 : key === "PageDown" ? 34 : 32;
  const code = key === " " ? "Space" : key;
  return new KeyboardEvent(type, {
    key,
    code,
    keyCode,
    bubbles: true,
    cancelable: true
  });
}

function fireWheelNavigation(): void {
  const targets = [
    document.activeElement,
    document.querySelector("main"),
    document.scrollingElement,
    document.body,
    window
  ].filter(Boolean) as Array<Element | Window>;

  for (const target of targets) {
    target.dispatchEvent(new WheelEvent("wheel", {
      deltaY: window.innerHeight,
      bubbles: true,
      cancelable: true
    }));
  }
}

function scrollNextReelIntoView(activeItem: HTMLElement): boolean {
  const nextReel = findNextReelAfter(activeItem);
  if (!nextReel) return false;

  nextReel.scrollIntoView({ block: "center", inline: "nearest", behavior: "auto" });
  return true;
}

function clickNextArrowButton(): boolean {
  const candidates = [...document.querySelectorAll<HTMLElement>('*[aria-label]')]
    .filter((el) => {
      const label = (el.getAttribute("aria-label") || "").toLowerCase();
      if (!label.includes("next") && !label.includes("다음")) return false;
      const tag = el.tagName.toLowerCase();
      if (tag !== "button" && tag !== "svg" && tag !== "div" && el.getAttribute("role") !== "button") return false;

      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.left < window.innerWidth / 2) return false;
      return true;
    });

  if (!candidates.length) return false;

  const btn = candidates[candidates.length - 1];
  const clickable = btn.closest<HTMLElement>('button, [role="button"]') || btn;
  clickable.click();
  return true;
}

async function closeOverlays(): Promise<void> {
  const closeBtns = [...document.querySelectorAll<HTMLElement>('svg[aria-label="Close" i], svg[aria-label="닫기" i]')];
  for (const svg of closeBtns) {
    const btn = svg.closest<HTMLElement>('button, [role="button"]') || svg;
    btn.click();
  }
  await wait(300);
}

export class ReelsProbeAdapter implements PlatformAdapter {
  platform = "instagram-reels" as const;
  _skipInProgress = false;

  detect(): boolean {
    return window.location.hostname.includes("instagram.com") && window.location.pathname.startsWith("/reels/");
  }

  findActiveItem(): HTMLElement | null {
    return findActiveReel();
  }

  getCreatorIdentity(activeItem: HTMLElement, signals?: ExtractedSignals | null): CreatorIdentity | undefined {
    return signals?.creator ?? extractCreator(activeItem);
  }

  async extractSignals(activeItem: HTMLElement): Promise<ExtractedSignals | null> {
    const commentAlreadyOpen = isCommentPanelOpen();
    if (!commentAlreadyOpen) {
      await expandCaption(activeItem);
    }

    const captionBlocks = extractCaptionTexts(activeItem);
    const localTexts = collectVisibleText(activeItem);
    const creator = extractCreator(activeItem);
    const caption = normalizeText(captionBlocks.join(" ") || localTexts.join(" "));
    const identity = getStableItemIdentity(activeItem, caption, creator);

    const commentPanel = commentAlreadyOpen
      ? { triggered: false, attempts: 0 }
      : await tryOpenCommentPanel(activeItem, identity.itemId);
    const commentTexts = extractCommentTexts(activeItem);

    const hashtags = uniqStrings(caption.match(/#[\p{L}\p{N}_]+/gu) ?? []);
    const officialAiTexts = uniqStrings(localTexts.filter((text) => REELS_DISCLOSURE_RE.test(text))).slice(0, 12);
    const aiDisclosureTexts = uniqStrings(localTexts.filter((text) => REELS_AI_TEXT_RE.test(text))).slice(0, 16);

    return {
      itemId: identity.itemId,
      platform: this.platform,
      creator,
      caption,
      hashtags,
      comments: commentTexts.map((text) => ({
        text,
        locale: detectLocaleBucket(text)
      })),
      officialAiLabel: officialAiTexts.length > 0,
      officialAiTexts,
      visibleTexts: localTexts,
      aiDisclosureTexts,
      raw: {
        containerCandidateCount: findReelContainers().length,
        activeSelection: getActiveSelectionDiagnostics(activeItem),
        identity: {
          source: identity.source,
          elementId: identity.elementId,
          hashInputLength: identity.hashInputLength,
          hasVideoKey: identity.hasVideoKey,
          hasPermalink: identity.hasPermalink
        },
        commentPanelTriggered: commentPanel.triggered,
        commentPanelAttempts: commentPanel.attempts,
        commentPanelOpen: isCommentPanelOpen()
      }
    };
  }

  async skipToNext(activeItem: HTMLElement): Promise<boolean> {
    this._skipInProgress = true;
    try {
      await closeOverlays();

      const tactics: Array<{ name: string; run: () => void | Promise<void>; waitMs?: number }> = [
        {
          name: "next-button",
          run: () => {
            if (!clickNextArrowButton()) {
              recordSkipTactic("next-button-missing", false);
            }
          }
        },
        {
          name: "arrow-down",
          run: () => fireKeyboardNavigation("ArrowDown")
        },
        {
          name: "page-down",
          run: () => fireKeyboardNavigation("PageDown")
        },
        {
          name: "wheel",
          run: fireWheelNavigation
        },
        {
          name: "scroll-next-reel",
          run: () => {
            if (!scrollNextReelIntoView(activeItem)) {
              recordSkipTactic("scroll-next-reel-missing", false);
            }
          }
        },
        {
          name: "window-scroll",
          run: () => window.scrollBy({ top: window.innerHeight, behavior: "auto" })
        }
      ];

      for (const tactic of tactics) {
        if (await runSkipTactic(tactic.name, activeItem, tactic.run, tactic.waitMs)) {
          return true;
        }
      }

      return false;
    } finally {
      this._skipInProgress = false;
    }
  }

  async getDebugSnapshot(activeItem: HTMLElement | null, signals: ExtractedSignals | null): Promise<DebugSnapshot> {
    return {
      timestamp: new Date().toISOString(),
      platform: this.platform,
      locationHref: window.location.href,
      activeItemId: signals?.itemId ?? activeItem?.tagName,
      creatorKey: signals?.creator?.key,
      creatorHandle: signals?.creator?.handle,
      captionLength: signals?.caption.length ?? 0,
      hashtagCount: signals?.hashtags.length ?? 0,
      commentCount: signals?.comments.length ?? 0,
      locales: signals ? detectLocaleBuckets([signals.caption, ...signals.comments.map((c) => c.text)]) : [],
      extractionNotes: [
        "Active reel = highest score from visibility, center distance, and playing video state",
        "itemId = video src hash + creator",
        "caption/comments = extracted from active item and comment dialog",
        "skip = next button, keyboard, wheel, direct next reel, then window scroll fallback"
      ],
      probe: {
        aiVisibleTexts: signals?.officialAiTexts ?? [],
        activeSelection: getActiveSelectionDiagnostics(activeItem),
        raw: signals?.raw
      }
    };
  }
}
