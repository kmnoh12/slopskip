export const STORAGE_SCHEMA_VERSION = 1;

export const SENSITIVITY_THRESHOLDS = {
  conservative: 80,
  balanced: 60,
  aggressive: 45
} as const;

export const DEFAULT_SETTINGS = {
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
} as const;

export const PLATFORM_FLAGS_DEFAULT = {
  tiktok: { enabled: true },
  reelsProbe: { enabled: true }
} as const;

export const COMMENT_SCORE_CAP = {
  en: 60,
  ko: 60,
  default: 45
} as const;

export const SKIP_COOLDOWN_MS = 1200;
export const REEVALUATE_DEBOUNCE_MS = 250;
export const LOOP_INTERVAL_MS = 1200;
export const MANUAL_REVISIT_WINDOW_MS = 4000;

export const TOAST_ID = "slopskip-toast-root";
export const DEBUG_PANEL_ID = "slopskip-debug-panel";

export const TT_SELECTORS = {
  item: [
    'article[id^="one-column-item-"]',
    '[data-e2e="recommend-list-item-container"]',
    'section[id^="media-card-"]',
    '[data-e2e="feed-video"]'
  ],
  creatorLinks: [
    'a[href^="/@"]',
    'a[href*="/@"]'
  ],
  commentItems: [
    '[data-e2e="comment-item"]',
    '[data-e2e="comment-level-1"]',
    '[data-e2e="comment-level-2"]'
  ]
} as const;

export const IG_SELECTORS = {
  reelRoot: [
    "article",
    "section",
    "div[role='presentation']"
  ],
  creatorLinks: [
    'a[href^="/"][role="link"]',
    'a[href^="/"]'
  ],
  commentItems: [
    "div[role='dialog'] ul li",
    "div[role='dialog'] div[role='button'] ~ div li",
    "div[scrollable='true'] span", // 사이드바 댓글 구조용
    "div[scrollable='true'] div[role='presentation']"
  ]
} as const;
