import { IG_SELECTORS } from "../../shared/constants";
import type { CreatorIdentity, DebugSnapshot, ExtractedSignals, PlatformAdapter } from "../../shared/types";
import { getStorageState } from "../../shared/storage";
import { collectVisibleText, normalizeText, uniqStrings } from "../dom";
import { detectLocaleBucket, detectLocaleBuckets } from "../language";

const REELS_DISCLOSURE_RE = /\b(aigc|ai generated|generated with ai|made with ai|created with ai|artificial intelligence|inteligencia artificial)\b/i;
const REELS_AI_TEXT_RE = /\b(ai|ia|aigc|artificial intelligence|inteligencia artificial|generated|generated with ai|made with ai|ai generated)\b/i;

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

function findActiveReel(): HTMLElement | null {
  const containers = findReelContainers();
  if (!containers.length) return null;
  if (containers.length === 1) return containers[0];

  const viewportCenterY = window.innerHeight / 2;
  let best: HTMLElement | null = null;
  let bestDist = Infinity;

  for (const container of containers) {
    const rect = container.getBoundingClientRect();
    const centerY = rect.top + rect.height / 2;
    const dist = Math.abs(centerY - viewportCenterY);
    if (dist < bestDist) {
      bestDist = dist;
      best = container;
    }
  }

  return best;
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

function getStableItemId(activeItem: HTMLElement, caption: string, creator?: CreatorIdentity): string {
  const video = activeItem.querySelector("video");
  const videoKey = video?.src || video?.currentSrc || video?.poster || "";
  const creatorKey = creator?.handle ?? "unknown";
  const captionKey = caption.slice(0, 80);

  if (videoKey) {
    return `ig::${creatorKey}::${simpleHash(videoKey)}`;
  }

  return `ig::${creatorKey}::${simpleHash(window.location.pathname + captionKey)}`;
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

async function tryOpenCommentPanel(_activeItem: HTMLElement, itemId: string): Promise<{ triggered: boolean; attempts: number }> {
  if (attemptedCommentItemIds.has(itemId)) {
    return { triggered: false, attempts: 0 };
  }

  attemptedCommentItemIds.add(itemId);

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

function fireArrowDown(): void {
  const target = document.body || document.documentElement;
  for (const type of ["keydown", "keyup"] as const) {
    target.dispatchEvent(
      new KeyboardEvent(type, {
        key: "ArrowDown",
        code: "ArrowDown",
        keyCode: 40,
        bubbles: true,
        cancelable: true
      })
    );
  }
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
    const itemId = getStableItemId(activeItem, caption, creator);

    const commentPanel = commentAlreadyOpen
      ? { triggered: false, attempts: 0 }
      : await tryOpenCommentPanel(activeItem, itemId);
    const commentTexts = extractCommentTexts(activeItem);

    const hashtags = uniqStrings(caption.match(/#[\p{L}\p{N}_]+/gu) ?? []);
    const officialAiTexts = uniqStrings(localTexts.filter((text) => REELS_DISCLOSURE_RE.test(text))).slice(0, 12);
    const aiDisclosureTexts = uniqStrings(localTexts.filter((text) => REELS_AI_TEXT_RE.test(text))).slice(0, 16);

    return {
      itemId,
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

      if (clickNextArrowButton()) {
        await wait(400);
      }

      const currentActive1 = findActiveReel();
      if (currentActive1 !== activeItem) return true;

      fireArrowDown();
      await wait(400);

      const currentActive2 = findActiveReel();
      if (currentActive2 === activeItem) {
        window.scrollBy({ top: window.innerHeight, behavior: "auto" });
        await wait(400);
      }

      return true;
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
        "Active reel = viewport center nearest video container",
        "itemId = video src hash + creator",
        "caption/comments = extracted from active item and comment dialog",
        "skip = next button or ArrowDown fallback"
      ],
      probe: {
        aiVisibleTexts: signals?.officialAiTexts ?? [],
        raw: signals?.raw
      }
    };
  }
}
