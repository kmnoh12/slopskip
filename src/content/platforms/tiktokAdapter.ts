import { TT_SELECTORS } from "../../shared/constants";
import type { CreatorIdentity, DebugSnapshot, ExtractedComment, ExtractedSignals, PlatformAdapter } from "../../shared/types";
import { collectVisibleText, getViewportScore, normalizeText, uniqStrings } from "../dom";
import { detectLocaleBucket, detectLocaleBuckets } from "../language";

interface TikTokRehydration {
  itemInfo?: {
    itemStruct?: {
      id?: string;
      desc?: string;
      textExtra?: Array<{ hashtagName?: string }>;
      author?: { uniqueId?: string; id?: string };
      comments?: Array<{ text?: string; user?: { uid?: string; nickname?: string } }>;
      IsAigc?: boolean;
      aigcLabelType?: string;
      AIGCDescription?: string;
      creatorAIComment?: { hasAITopic?: boolean };
      contents?: Array<{ desc?: string }>;
    };
  };
}

const TIKTOK_OFFICIAL_AI_LABEL_RE = /\b(ai|aigc)\b|generated|synthetic|ai ?생성|생성 미디어|ai ?미디어|미디어 포함|ai로 만든/i;
const AI_DISCLOSURE_RE = /\b(ai[- ]?generated|made with ai|generated with ai)\b|ai ?생성|ai로 만든/i;
const TIKTOK_AD_RE = /\b(sponsored|advertisement|paid partnership|promoted)\b|광고|스폰서|유료 프로모션/i;

function parseRehydration(): TikTokRehydration | null {
  const script = document.getElementById("__UNIVERSAL_DATA_FOR_REHYDRATION__");
  if (!script?.textContent) return null;
  try {
    return JSON.parse(script.textContent) as TikTokRehydration;
  } catch {
    return null;
  }
}

function findBestItem(nodes: HTMLElement[]): HTMLElement | null {
  if (!nodes.length) return null;
  return [...nodes].sort((a, b) => getViewportScore(b) - getViewportScore(a))[0] ?? null;
}

function findScrollableParent(node: HTMLElement | null): HTMLElement | null {
  let current = node?.parentElement ?? null;
  while (current) {
    const style = window.getComputedStyle(current);
    const canScroll = /(auto|scroll|overlay)/.test(style.overflowY);
    if (canScroll && current.scrollHeight > current.clientHeight + 24) {
      return current;
    }
    current = current.parentElement;
  }
  return null;
}

function fireNavigationKey(key: string): void {
  const target = document.activeElement instanceof HTMLElement ? document.activeElement : document.body;
  for (const type of ["keydown", "keypress", "keyup"] as const) {
    const event = new KeyboardEvent(type, { key, bubbles: true, cancelable: true });
    target.dispatchEvent(event);
    document.dispatchEvent(event);
    window.dispatchEvent(event);
  }
}

function extractCommentsFromDom(): ExtractedComment[] {
  const texts = TT_SELECTORS.commentItems.flatMap((selector) =>
    [...document.querySelectorAll<HTMLElement>(selector)].map((node) => normalizeText(node.textContent))
  );

  return uniqStrings(texts)
    .slice(0, 12)
    .map((text) => ({
      text,
      locale: detectLocaleBucket(text)
    }));
}

function extractCreatorFromDom(activeItem: HTMLElement, json: TikTokRehydration | null): CreatorIdentity | undefined {
  const link = TT_SELECTORS.creatorLinks
    .flatMap((selector) => [...activeItem.querySelectorAll<HTMLAnchorElement>(selector)])
    .find((anchor) => /\/@/.test(anchor.getAttribute("href") ?? ""));

  const href = link?.getAttribute("href") ?? "";
  const handle = href.match(/\/(@[^/?]+)/)?.[1]
    ?? json?.itemInfo?.itemStruct?.author?.uniqueId
    ?? "";
  if (!handle) {
    return undefined;
  }

  const normalizedHandle = handle.startsWith("@") ? handle : `@${handle}`;
  return {
    key: `tiktok:/${normalizedHandle}`,
    handle: normalizedHandle,
    profileUrl: href ? `https://www.tiktok.com${href}` : undefined,
    rawId: json?.itemInfo?.itemStruct?.author?.id
  };
}

export class TikTokAdapter implements PlatformAdapter {
  platform = "tiktok" as const;

  detect(): boolean {
    return window.location.hostname.includes("tiktok.com");
  }

  findActiveItem(): HTMLElement | null {
    const candidates = TT_SELECTORS.item.flatMap((selector) => [...document.querySelectorAll<HTMLElement>(selector)]);
    return findBestItem(candidates);
  }

  getCreatorIdentity(activeItem: HTMLElement, signals?: ExtractedSignals | null): CreatorIdentity | undefined {
    return signals?.creator ?? extractCreatorFromDom(activeItem, parseRehydration());
  }

  async extractSignals(activeItem: HTMLElement): Promise<ExtractedSignals | null> {
    const json = parseRehydration();
    const itemStruct = json?.itemInfo?.itemStruct;
    const visibleTexts = collectVisibleText(activeItem);
    const officialAiVisibleTexts = uniqStrings(
      visibleTexts.filter((text) => TIKTOK_OFFICIAL_AI_LABEL_RE.test(text))
    );
    const adVisibleTexts = uniqStrings(
      visibleTexts.filter((text) => TIKTOK_AD_RE.test(text))
    );
    const caption = normalizeText(
      itemStruct?.desc
      ?? itemStruct?.contents?.map((entry) => entry.desc ?? "").join(" ")
      ?? activeItem.getAttribute("aria-label")
      ?? activeItem.textContent
    );
    const hashtags = uniqStrings([
      ...(itemStruct?.textExtra?.map((entry) => entry.hashtagName ? `#${entry.hashtagName}` : "") ?? []),
      ...(caption.match(/#[\p{L}\p{N}_]+/gu) ?? [])
    ]);
    const officialAiTexts = uniqStrings([
      itemStruct?.AIGCDescription,
      ...officialAiVisibleTexts
    ]);
    const commentsFromJson = (itemStruct?.comments ?? [])
      .map((comment) => ({
        text: normalizeText(comment.text),
        authorHint: comment.user?.uid ?? comment.user?.nickname,
        locale: detectLocaleBucket(normalizeText(comment.text))
      }))
      .filter((comment) => comment.text) as ExtractedComment[];
    const comments = [...extractCommentsFromDom(), ...commentsFromJson].slice(0, 16);
    const itemId = activeItem.id
      || activeItem.getAttribute("data-scroll-index")
      || itemStruct?.id
      || window.location.pathname;
    const creator = extractCreatorFromDom(activeItem, json);

    return {
      itemId,
      platform: this.platform,
      creator,
      caption,
      hashtags,
      comments,
      isAdvertisement: adVisibleTexts.length > 0,
      officialAiLabel: Boolean(
        itemStruct?.IsAigc
        || (itemStruct?.aigcLabelType && itemStruct.aigcLabelType !== "0")
        || itemStruct?.AIGCDescription
        || itemStruct?.creatorAIComment?.hasAITopic
        || officialAiVisibleTexts.length
      ),
      officialAiTexts,
      visibleTexts,
      aiDisclosureTexts: visibleTexts.filter((text) => (
        TIKTOK_OFFICIAL_AI_LABEL_RE.test(text) || AI_DISCLOSURE_RE.test(text)
      )),
      raw: {
        jsonPresent: Boolean(json),
        locales: detectLocaleBuckets([caption, ...comments.map((comment) => comment.text)]),
        officialAiVisibleTexts,
        adVisibleTexts
      }
    };
  }

  async skipToNext(activeItem: HTMLElement): Promise<boolean> {
    const currentIndex = Number(activeItem.getAttribute("data-scroll-index") ?? "0");
    const candidates = [...document.querySelectorAll<HTMLElement>('article[id^="one-column-item-"], [data-e2e="recommend-list-item-container"]')];
    const nextItem = candidates
      .map((node) => ({ node, index: Number(node.getAttribute("data-scroll-index") ?? "-1") }))
      .filter((entry) => entry.index > currentIndex)
      .sort((a, b) => a.index - b.index)[0]?.node;

    if (nextItem) {
      nextItem.scrollIntoView({ behavior: "auto", block: "center" });
      return true;
    }

    const scrollParent = findScrollableParent(activeItem);
    const delta = Math.max(window.innerHeight * 0.9, 640);
    if (scrollParent) {
      scrollParent.scrollBy({ top: delta, behavior: "auto" });
    } else {
      window.scrollBy({ top: delta, behavior: "auto" });
      document.documentElement.scrollTop += delta;
      document.body.scrollTop += delta;
    }

    fireNavigationKey("ArrowDown");
    fireNavigationKey("PageDown");
    fireNavigationKey(" ");
    return true;
  }

  async getDebugSnapshot(activeItem: HTMLElement | null, signals: ExtractedSignals | null): Promise<DebugSnapshot> {
    return {
      timestamp: new Date().toISOString(),
      platform: this.platform,
      locationHref: window.location.href,
      activeItemId: activeItem?.id || activeItem?.getAttribute("data-scroll-index") || undefined,
      creatorKey: signals?.creator?.key,
      creatorHandle: signals?.creator?.handle,
      captionLength: signals?.caption.length ?? 0,
      hashtagCount: signals?.hashtags.length ?? 0,
      commentCount: signals?.comments.length ?? 0,
      locales: signals ? detectLocaleBuckets([signals.caption, ...signals.comments.map((comment) => comment.text)]) : [],
      extractionNotes: [
        "Active item chosen by viewport intersection.",
        "Caption and hashtags fall back to rehydration JSON when available.",
        "Comments are limited to rendered DOM plus embedded data."
      ],
      probe: signals?.raw
    };
  }
}
