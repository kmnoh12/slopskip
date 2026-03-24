// src/shared/constants.ts
var STORAGE_SCHEMA_VERSION = 1;
var SENSITIVITY_THRESHOLDS = {
  conservative: 80,
  balanced: 60,
  aggressive: 45
};
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
var SKIP_COOLDOWN_MS = 1200;
var LOOP_INTERVAL_MS = 1200;
var MANUAL_REVISIT_WINDOW_MS = 4e3;
var TOAST_ID = "slopskip-toast-root";
var DEBUG_PANEL_ID = "slopskip-debug-panel";
var TT_SELECTORS = {
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
};
var IG_SELECTORS = {
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
    "div[scrollable='true'] span",
    // 사이드바 댓글 구조용
    "div[scrollable='true'] div[role='presentation']"
  ]
};

// src/shared/messages.ts
var MESSAGE_TYPES = {
  GET_STATUS: "GET_STATUS",
  SET_SETTINGS: "SET_SETTINGS",
  MARK_CREATOR_SLOP: "MARK_CREATOR_SLOP",
  MARK_CREATOR_ALLOW: "MARK_CREATOR_ALLOW",
  CLEAR_CREATOR_VOTE: "CLEAR_CREATOR_VOTE",
  REQUEST_DEBUG_SNAPSHOT: "REQUEST_DEBUG_SNAPSHOT"
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
async function patchSettings(settingsPatch) {
  const state = await getStorageState();
  const next = {
    ...state,
    settings: {
      ...state.settings,
      ...settingsPatch
    }
  };
  await setStorageState(next);
  return next;
}
async function setCreatorVote(key, vote) {
  const state = await getStorageState();
  const creatorVotes = {
    ...state.creatorVotes,
    [key]: vote
  };
  const next = { ...state, creatorVotes };
  await setStorageState(next);
  return next;
}
async function clearCreatorVote(key) {
  const state = await getStorageState();
  const creatorVotes = { ...state.creatorVotes };
  delete creatorVotes[key];
  const next = { ...state, creatorVotes };
  await setStorageState(next);
  return next;
}
function normalizeLearningText(text) {
  return text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
}
function extractLearnablePhrases(signals) {
  const seedTexts = [
    signals.caption,
    ...signals.hashtags,
    ...signals.comments.map((comment) => comment.text),
    ...signals.officialAiTexts
  ];
  const phrases = /* @__PURE__ */ new Set();
  for (const raw of seedTexts) {
    const normalized = normalizeLearningText(raw);
    if (!normalized) continue;
    const tokens = normalized.split(" ").filter(Boolean);
    for (let size = 1; size <= 3; size += 1) {
      for (let index = 0; index <= tokens.length - size; index += 1) {
        const phrase = tokens.slice(index, index + size).join(" ");
        if (phrase.length < 3) continue;
        if (!/(ai|fake|real|generated|render|cgi|slop|aigc|prompt)/i.test(phrase)) continue;
        phrases.add(phrase);
      }
    }
  }
  return [...phrases].slice(0, 80);
}
async function learnPhraseScores(signals, vote) {
  const state = await getStorageState();
  const delta = vote === "slop" ? 2 : -2;
  const nextScores = { ...state.learnedPhraseScores };
  for (const phrase of extractLearnablePhrases(signals)) {
    const nextValue = (nextScores[phrase] ?? 0) + delta;
    if (nextValue === 0) {
      delete nextScores[phrase];
      continue;
    }
    nextScores[phrase] = Math.max(-6, Math.min(6, nextValue));
  }
  const next = { ...state, learnedPhraseScores: nextScores };
  await setStorageState(next);
  return next;
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

// src/content/debugPanel.ts
function escapeHtml(text) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function getScoreTone(total, threshold) {
  if (total >= threshold * 1.5) {
    return { color: "#b42318", bg: "#fee4e2", label: "\uC704\uD5D8 \uB9E4\uC6B0 \uB192\uC74C" };
  }
  if (total >= threshold) {
    return { color: "#dc6803", bg: "#fef0c7", label: "\uCC28\uB2E8 \uB300\uC0C1" };
  }
  return { color: "#067647", bg: "#d1fadf", label: "\uAE30\uC900 \uBBF8\uB9CC" };
}
function aggregateMatches(matches) {
  const buckets = {
    official: 0,
    caption: 0,
    hashtags: 0,
    comments: 0,
    vote: 0,
    contradiction: 0
  };
  for (const match of matches) {
    buckets[match.source] = (buckets[match.source] ?? 0) + match.weight;
  }
  return [
    { label: "\uACF5\uC2DD AI \uD45C\uC2DC", value: buckets.official },
    { label: "\uCEA1\uC158", value: buckets.caption },
    { label: "\uD574\uC2DC\uD0DC\uADF8", value: buckets.hashtags },
    { label: "\uB313\uAE00", value: buckets.comments },
    { label: "\uB0B4 \uD310\uB2E8", value: buckets.vote },
    { label: "\uBC18\uB300 \uC2E0\uD638", value: buckets.contradiction }
  ];
}
function summarizeCommentMatches(matches) {
  const commentMatches = matches.filter((match) => match.source === "comments");
  const grouped = /* @__PURE__ */ new Map();
  for (const match of commentMatches) {
    const key = (match.excerpt || match.reasonKey || "comment").trim();
    grouped.set(key, (grouped.get(key) ?? 0) + match.weight);
  }
  return [...grouped.entries()].map(([excerpt, score]) => ({ excerpt, score })).sort((a, b) => Math.abs(b.score) - Math.abs(a.score)).slice(0, 10);
}
function renderBars(groups) {
  const max = Math.max(10, ...groups.map((group) => Math.abs(group.value)));
  return groups.map((group) => {
    const width = Math.max(4, Math.round(Math.abs(group.value) / max * 100));
    const positive = group.value >= 0;
    return `
      <div class="slopskip-row">
        <div class="slopskip-row-head">
          <span>${escapeHtml(group.label)}</span>
          <strong>${group.value > 0 ? "+" : ""}${group.value}</strong>
        </div>
        <div class="slopskip-bar-track">
          <div class="slopskip-bar-fill ${positive ? "positive" : "negative"}" style="width:${width}%"></div>
        </div>
      </div>
    `;
  }).join("");
}
function renderCommentCards(items) {
  if (!items.length) {
    return `<div class="slopskip-empty">\uC544\uC9C1 \uC810\uC218\uC5D0 \uBC18\uC601\uB41C \uB313\uAE00 \uADFC\uAC70\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4.</div>`;
  }
  return items.map((item) => `
    <div class="slopskip-comment-card">
      <div class="slopskip-comment-score">${item.score > 0 ? "+" : ""}${item.score}</div>
      <div class="slopskip-comment-text">${escapeHtml(item.excerpt)}</div>
    </div>
  `).join("");
}
function ensureStyles(root) {
  if (root.querySelector("style")) return;
  const style = document.createElement("style");
  style.textContent = `
    #${DEBUG_PANEL_ID} * { box-sizing: border-box; }
    #${DEBUG_PANEL_ID} .slopskip-shell {
      display: grid;
      gap: 12px;
      font-family: "Segoe UI", "Apple SD Gothic Neo", system-ui, sans-serif;
      white-space: normal;
    }
    #${DEBUG_PANEL_ID} .slopskip-topbar {
      display: flex;
      justify-content: flex-end;
      margin-bottom: -4px;
      cursor: grab;
    }
    #${DEBUG_PANEL_ID} .slopskip-topbar:active {
      cursor: grabbing;
    }
    #${DEBUG_PANEL_ID} .slopskip-close {
      border: 0;
      background: rgba(60, 40, 20, 0.08);
      color: #4d3d2e;
      width: 32px;
      height: 32px;
      border-radius: 999px;
      font-size: 18px;
      line-height: 1;
      cursor: pointer;
    }
    #${DEBUG_PANEL_ID} .slopskip-close:hover {
      background: rgba(60, 40, 20, 0.16);
    }
    #${DEBUG_PANEL_ID} .slopskip-card {
      background: rgba(255,255,255,0.78);
      border: 1px solid rgba(92, 69, 42, 0.12);
      border-radius: 16px;
      padding: 12px;
    }
    #${DEBUG_PANEL_ID} .slopskip-hero {
      display: grid;
      grid-template-columns: 96px 1fr;
      gap: 12px;
      align-items: center;
    }
    #${DEBUG_PANEL_ID} .slopskip-ring {
      width: 96px;
      height: 96px;
      border-radius: 999px;
      display: grid;
      place-items: center;
      position: relative;
      background: conic-gradient(var(--ring-color) calc(var(--ring-progress) * 1%), rgba(0,0,0,0.08) 0);
    }
    #${DEBUG_PANEL_ID} .slopskip-ring::after {
      content: "";
      position: absolute;
      inset: 10px;
      background: #fffaf2;
      border-radius: 999px;
    }
    #${DEBUG_PANEL_ID} .slopskip-ring-content {
      position: relative;
      z-index: 1;
      text-align: center;
    }
    #${DEBUG_PANEL_ID} .slopskip-ring-score {
      font-size: 24px;
      font-weight: 800;
      line-height: 1;
    }
    #${DEBUG_PANEL_ID} .slopskip-ring-threshold {
      font-size: 11px;
      color: #6b5a4a;
      margin-top: 4px;
    }
    #${DEBUG_PANEL_ID} .slopskip-title {
      margin: 0;
      font-size: 18px;
      font-weight: 800;
      color: #1f170f;
    }
    #${DEBUG_PANEL_ID} .slopskip-subtitle {
      margin: 4px 0 8px;
      font-size: 12px;
      color: #6b5a4a;
    }
    #${DEBUG_PANEL_ID} .slopskip-badge {
      display: inline-flex;
      align-items: center;
      padding: 6px 10px;
      border-radius: 999px;
      font-size: 11px;
      font-weight: 700;
      background: var(--badge-bg);
      color: var(--badge-color);
    }
    #${DEBUG_PANEL_ID} .slopskip-meta {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 8px;
    }
    #${DEBUG_PANEL_ID} .slopskip-stat {
      padding: 10px;
      border-radius: 12px;
      background: #fbf7ef;
    }
    #${DEBUG_PANEL_ID} .slopskip-stat-label {
      font-size: 11px;
      color: #7b6755;
      margin-bottom: 4px;
    }
    #${DEBUG_PANEL_ID} .slopskip-stat-value {
      font-size: 16px;
      font-weight: 700;
      color: #241a11;
    }
    #${DEBUG_PANEL_ID} .slopskip-section-title {
      margin: 0 0 10px;
      font-size: 13px;
      font-weight: 800;
      color: #2c1d11;
    }
    #${DEBUG_PANEL_ID} .slopskip-row { margin-bottom: 10px; }
    #${DEBUG_PANEL_ID} .slopskip-row-head {
      display: flex;
      justify-content: space-between;
      gap: 8px;
      font-size: 12px;
      margin-bottom: 4px;
      color: #4d3d2e;
    }
    #${DEBUG_PANEL_ID} .slopskip-bar-track {
      height: 8px;
      border-radius: 999px;
      background: rgba(60,40,20,0.08);
      overflow: hidden;
    }
    #${DEBUG_PANEL_ID} .slopskip-bar-fill {
      height: 100%;
      border-radius: 999px;
    }
    #${DEBUG_PANEL_ID} .slopskip-bar-fill.positive { background: linear-gradient(90deg, #ff8a65, #d92d20); }
    #${DEBUG_PANEL_ID} .slopskip-bar-fill.negative { background: linear-gradient(90deg, #12b76a, #039855); }
    #${DEBUG_PANEL_ID} .slopskip-chip-wrap {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }
    #${DEBUG_PANEL_ID} .slopskip-chip {
      background: #fbf7ef;
      border: 1px solid rgba(92, 69, 42, 0.14);
      border-radius: 999px;
      padding: 6px 9px;
      font-size: 11px;
      color: #4b3b2e;
    }
    #${DEBUG_PANEL_ID} .slopskip-comment-list {
      display: grid;
      gap: 8px;
    }
    #${DEBUG_PANEL_ID} .slopskip-comment-card {
      display: grid;
      grid-template-columns: 56px 1fr;
      gap: 10px;
      align-items: start;
      padding: 10px;
      border-radius: 12px;
      background: #fbf7ef;
      border: 1px solid rgba(92, 69, 42, 0.1);
    }
    #${DEBUG_PANEL_ID} .slopskip-comment-score {
      font-size: 18px;
      font-weight: 800;
      color: #b42318;
    }
    #${DEBUG_PANEL_ID} .slopskip-comment-text {
      font-size: 12px;
      line-height: 1.45;
      color: #2c1d11;
      word-break: break-word;
    }
    #${DEBUG_PANEL_ID} .slopskip-empty {
      font-size: 12px;
      color: #7b6755;
      background: #fbf7ef;
      padding: 10px;
      border-radius: 12px;
    }
  `;
  root.appendChild(style);
}
function bindCloseButton(root) {
  root.querySelector(".slopskip-close")?.addEventListener("click", () => {
    root.style.display = "none";
    void chrome.runtime.sendMessage({
      type: MESSAGE_TYPES.SET_SETTINGS,
      payload: { debugMode: false }
    });
  });
}
function initDraggable(root) {
  let isDragging = false;
  let startX = 0, startY = 0;
  let initialLeft = 0, initialTop = 0;
  root.addEventListener("mousedown", (e) => {
    const target = e.target;
    if (!target.closest(".slopskip-topbar") && !target.classList.contains("slopskip-shell")) return;
    if (target.closest("button, a")) return;
    isDragging = true;
    startX = e.clientX;
    startY = e.clientY;
    const rect = root.getBoundingClientRect();
    initialLeft = rect.left;
    initialTop = rect.top;
    e.preventDefault();
  });
  document.addEventListener("mousemove", (e) => {
    if (!isDragging) return;
    const deltaX = e.clientX - startX;
    const deltaY = e.clientY - startY;
    root.style.left = `${initialLeft + deltaX}px`;
    root.style.top = `${initialTop + deltaY}px`;
    root.style.right = "auto";
    root.style.bottom = "auto";
    root.style.transform = "none";
  });
  document.addEventListener("mouseup", () => {
    isDragging = false;
  });
}
function renderDebugPanel(snapshot, visible) {
  let root = document.getElementById(DEBUG_PANEL_ID);
  if (!visible) {
    root?.remove();
    return;
  }
  if (!root) {
    root = document.createElement("aside");
    root.id = DEBUG_PANEL_ID;
    Object.assign(root.style, {
      position: "fixed",
      top: "12px",
      left: "12px",
      zIndex: "2147483647",
      width: "360px",
      maxHeight: "78vh",
      overflow: "auto",
      background: "rgba(247,241,227,0.96)",
      color: "#181818",
      border: "1px solid rgba(0,0,0,0.12)",
      borderRadius: "18px",
      padding: "12px",
      boxShadow: "0 18px 40px rgba(0,0,0,0.18)",
      backdropFilter: "blur(10px)"
    });
    document.documentElement.appendChild(root);
    initDraggable(root);
  }
  if (visible) {
    root.style.display = "block";
  }
  ensureStyles(root);
  if (!snapshot?.score) {
    root.innerHTML = `
      <div class="slopskip-shell">
        <div class="slopskip-topbar">
          <button type="button" class="slopskip-close" aria-label="\uC0C1\uC138 \uC774\uC720 \uB2EB\uAE30">\xD7</button>
        </div>
        <div class="slopskip-card slopskip-empty">\uC544\uC9C1 \uB514\uBC84\uADF8 \uB370\uC774\uD130\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4.</div>
      </div>
    `;
    ensureStyles(root);
    bindCloseButton(root);
    return;
  }
  const { score } = snapshot;
  const tone = getScoreTone(score.total, score.threshold);
  const progress = Math.max(0, Math.min(100, Math.round(score.total / Math.max(score.threshold * 2, 1) * 100)));
  const sourceGroups = aggregateMatches(score.matches);
  const commentCards = summarizeCommentMatches(score.matches);
  const tags = [
    `\uD50C\uB7AB\uD3FC: ${snapshot.platform}`,
    `\uD06C\uB9AC\uC5D0\uC774\uD130: ${snapshot.creatorHandle || snapshot.creatorKey || "\uCC3E\uC9C0 \uBABB\uD568"}`,
    `\uB313\uAE00 \uC218: ${snapshot.commentCount ?? 0}`,
    `\uD0DC\uADF8 \uC218: ${snapshot.hashtagCount ?? 0}`,
    `\uCC28\uB2E8 \uAC15\uB3C4: ${score.sensitivity}`
  ];
  root.innerHTML = `
    <div class="slopskip-shell">
      <div class="slopskip-topbar">
        <button type="button" class="slopskip-close" aria-label="\uC0C1\uC138 \uC774\uC720 \uB2EB\uAE30">\xD7</button>
      </div>

      <div class="slopskip-card slopskip-hero" style="--ring-color:${tone.color};--ring-progress:${progress};--badge-bg:${tone.bg};--badge-color:${tone.color};">
        <div class="slopskip-ring">
          <div class="slopskip-ring-content">
            <div class="slopskip-ring-score">${score.total}</div>
            <div class="slopskip-ring-threshold">/ ${score.threshold}</div>
          </div>
        </div>
        <div>
          <h2 class="slopskip-title">\uC2AC\uB86D \uC704\uD5D8 \uB300\uC2DC\uBCF4\uB4DC</h2>
          <p class="slopskip-subtitle">\uC774 \uAC8C\uC2DC\uBB3C\uC774 \uC9C0\uAE08 \uC5BC\uB9C8\uB098 AI \uC2AC\uB86D\uCC98\uB7FC \uBCF4\uC774\uB294\uC9C0 \uBCF4\uC5EC\uC90D\uB2C8\uB2E4.</p>
          <span class="slopskip-badge">${score.shouldSkip ? "\uCC28\uB2E8 \uC2E4\uD589 \uC0C1\uD0DC" : tone.label}</span>
        </div>
      </div>

      <div class="slopskip-card">
        <h3 class="slopskip-section-title">\uBE60\uB978 \uC694\uC57D</h3>
        <div class="slopskip-meta">
          <div class="slopskip-stat">
            <div class="slopskip-stat-label">\uC77D\uC740 \uB313\uAE00 \uC218</div>
            <div class="slopskip-stat-value">${snapshot.commentCount ?? 0}</div>
          </div>
          <div class="slopskip-stat">
            <div class="slopskip-stat-label">\uD574\uC2DC\uD0DC\uADF8 \uC218</div>
            <div class="slopskip-stat-value">${snapshot.hashtagCount ?? 0}</div>
          </div>
          <div class="slopskip-stat">
            <div class="slopskip-stat-label">\uCEA1\uC158 \uAE38\uC774</div>
            <div class="slopskip-stat-value">${snapshot.captionLength ?? 0}</div>
          </div>
        </div>
      </div>

      <div class="slopskip-card">
        <h3 class="slopskip-section-title">\uC810\uC218 \uBD84\uD574</h3>
        ${renderBars(sourceGroups)}
      </div>

      <div class="slopskip-card">
        <h3 class="slopskip-section-title">\uB313\uAE00 \uC810\uC218 \uADFC\uAC70</h3>
        <div class="slopskip-comment-list">
          ${renderCommentCards(commentCards)}
        </div>
      </div>

      <div class="slopskip-card">
        <h3 class="slopskip-section-title">\uC0C1\uD669 \uD0DC\uADF8</h3>
        <div class="slopskip-chip-wrap">
          ${tags.map((tag) => `<span class="slopskip-chip">${escapeHtml(tag)}</span>`).join("")}
        </div>
      </div>
    </div>
  `;
  ensureStyles(root);
  bindCloseButton(root);
}

// src/content/dom.ts
function collectVisibleText(root) {
  const texts = /* @__PURE__ */ new Set();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let current = walker.nextNode();
  while (current) {
    const text = current.textContent?.replace(/\s+/g, " ").trim();
    const parent = current.parentElement;
    if (text && parent && isElementVisible(parent)) {
      texts.add(text);
    }
    current = walker.nextNode();
  }
  return [...texts];
}
function isElementVisible(node) {
  const style = window.getComputedStyle(node);
  if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
    return false;
  }
  const rect = node.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}
function getViewportScore(node) {
  const rect = node.getBoundingClientRect();
  const width = Math.max(0, Math.min(rect.right, window.innerWidth) - Math.max(rect.left, 0));
  const height = Math.max(0, Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0));
  return width * height;
}
function normalizeText(text) {
  return (text ?? "").replace(/\s+/g, " ").trim();
}
function uniqStrings(values) {
  return [...new Set(values.map((value) => normalizeText(value)).filter(Boolean))];
}

// src/content/language.ts
var HANGUL_RE = /[\u3131-\u318E\uAC00-\uD7A3]/g;
var LATIN_RE = /[A-Za-z]/g;
function detectLocaleBucket(text) {
  const normalized = text.trim();
  if (!normalized) {
    return "default";
  }
  const hangul = normalized.match(HANGUL_RE)?.length ?? 0;
  const latin = normalized.match(LATIN_RE)?.length ?? 0;
  if (hangul > latin && hangul >= 2) {
    return "ko";
  }
  if (latin >= hangul && latin >= 2) {
    return "en";
  }
  return "default";
}
function detectLocaleBuckets(texts) {
  return [...new Set(texts.map(detectLocaleBucket))];
}

// src/content/platforms/reelsProbeAdapter.ts
var REELS_DISCLOSURE_RE = /\b(aigc|ai generated|generated with ai|made with ai|created with ai|artificial intelligence|inteligencia artificial)\b/i;
var REELS_AI_TEXT_RE = /\b(ai|ia|aigc|artificial intelligence|inteligencia artificial|generated|generated with ai|made with ai|ai generated)\b/i;
function wait(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
function simpleHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i) | 0;
  }
  return hash.toString(36);
}
function findMeaningfulAncestor(video) {
  let current = video.parentElement;
  let bestCandidate = null;
  while (current) {
    const tag = current.tagName.toLowerCase();
    if (tag === "main" || tag === "body" || tag === "html") break;
    const rect = current.getBoundingClientRect();
    if (rect.width < 200 || rect.height < 200) {
      current = current.parentElement;
      continue;
    }
    if (tag === "article" || tag === "section" || current.getAttribute("role") === "presentation" || current.getAttribute("style")?.includes("transform")) {
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
function findReelContainers() {
  const videos = [...document.querySelectorAll("main video, article video")];
  const containers = /* @__PURE__ */ new Set();
  for (const video of videos) {
    const container = findMeaningfulAncestor(video);
    if (container) {
      containers.add(container);
    }
  }
  return [...containers];
}
function findActiveReel() {
  const containers = findReelContainers();
  if (!containers.length) return null;
  if (containers.length === 1) return containers[0];
  const viewportCenterY = window.innerHeight / 2;
  let best = null;
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
function extractCreator(activeItem) {
  const links = [
    ...activeItem.querySelectorAll("a[href]"),
    ...document.querySelectorAll('header a[href], div[role="dialog"] a[href], div[scrollable="true"] a[href]')
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
  if (!chosen) return void 0;
  try {
    const href = chosen.getAttribute("href") || "";
    const urlObj = new URL(href, window.location.origin);
    const username = urlObj.pathname.split("/").filter(Boolean)[0];
    if (!username) return void 0;
    return {
      key: `instagram:/${username}/`,
      handle: username,
      profileUrl: `https://www.instagram.com/${username}/`
    };
  } catch {
    return void 0;
  }
}
function getStableItemId(activeItem, caption, creator) {
  const video = activeItem.querySelector("video");
  const videoKey = video?.src || video?.currentSrc || video?.poster || "";
  const creatorKey = creator?.handle ?? "unknown";
  const captionKey = caption.slice(0, 80);
  if (videoKey) {
    return `ig::${creatorKey}::${simpleHash(videoKey)}`;
  }
  return `ig::${creatorKey}::${simpleHash(window.location.pathname + captionKey)}`;
}
function extractCaptionTexts(activeItem) {
  const texts = collectVisibleText(activeItem);
  const innerTexts = [...activeItem.querySelectorAll("h1")].map((node) => normalizeText(node.textContent));
  const scripts = [...document.querySelectorAll('script[type="application/ld+json"], script[type="application/json"]')];
  const joinedScripts = scripts.map((script) => script.textContent ?? "").join("\n");
  const captionMatch = joinedScripts.match(/"caption":\{"text":"([^"]+)/);
  const jsonCaption = captionMatch ? normalizeText(captionMatch[1].replace(/\\"/g, '"')) : "";
  const metaDesc = document.querySelector('meta[name="description"]')?.content ?? "";
  return uniqStrings([jsonCaption, metaDesc, ...innerTexts, ...texts]).filter((text) => text.length >= 8).slice(0, 30);
}
function extractCommentTexts(activeItem) {
  const commentNodes = [];
  for (const selector of IG_SELECTORS.commentItems) {
    commentNodes.push(...activeItem.querySelectorAll(selector));
  }
  const dialog = document.querySelector('div[role="dialog"]') || document.querySelector('div[scrollable="true"]');
  if (dialog) {
    for (const selector of IG_SELECTORS.commentItems) {
      commentNodes.push(...dialog.querySelectorAll(selector));
    }
    commentNodes.push(...dialog.querySelectorAll('span[dir="auto"]'));
  }
  return uniqStrings(commentNodes.map((node) => normalizeText(node.textContent))).filter((text) => text.length >= 2).slice(0, 30);
}
function isCommentPanelOpen() {
  if (document.querySelector('div[role="dialog"]')) return true;
  if (document.querySelector('div[scrollable="true"]')) return true;
  if (document.querySelector("form textarea")) return true;
  if (document.querySelector('textarea[placeholder*="comment" i]')) return true;
  if (document.querySelector('textarea[placeholder*="\uB313\uAE00" i]')) return true;
  return false;
}
var attemptedCommentItemIds = /* @__PURE__ */ new Set();
async function tryOpenCommentPanel(_activeItem, itemId) {
  if (attemptedCommentItemIds.has(itemId)) {
    return { triggered: false, attempts: 0 };
  }
  attemptedCommentItemIds.add(itemId);
  const svgs = [...document.querySelectorAll('svg[aria-label="Comment" i], svg[aria-label="\uB313\uAE00" i], svg[aria-label="Comments" i]')];
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
  const btn = activeSvg.closest('div[role="button"], button') || activeSvg;
  btn.click();
  await wait(800);
  return { triggered: true, attempts: 1 };
}
async function expandCaption(activeItem) {
  const state = await getStorageState();
  if (!state.settings.reelsAutoExpandCaption) {
    return;
  }
  const nodes = [...activeItem.querySelectorAll("span, div")];
  const moreSpan = nodes.find((node) => {
    if (node.childElementCount > 0 && node.tagName.toLowerCase() !== "span") return false;
    const text = normalizeText(node.textContent).toLowerCase();
    return text === "\uB354 \uBCF4\uAE30" || text === "\u2026 \uB354 \uBCF4\uAE30" || text === "more" || text === "\u2026 more";
  });
  if (moreSpan) {
    const clickable = moreSpan.closest('div[role="button"], button') || moreSpan;
    clickable.click();
    await wait(30);
  }
}
function fireArrowDown() {
  const target = document.body || document.documentElement;
  for (const type of ["keydown", "keyup"]) {
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
function clickNextArrowButton() {
  const candidates = [...document.querySelectorAll("*[aria-label]")].filter((el) => {
    const label = (el.getAttribute("aria-label") || "").toLowerCase();
    if (!label.includes("next") && !label.includes("\uB2E4\uC74C")) return false;
    const tag = el.tagName.toLowerCase();
    if (tag !== "button" && tag !== "svg" && tag !== "div" && el.getAttribute("role") !== "button") return false;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.left < window.innerWidth / 2) return false;
    return true;
  });
  if (!candidates.length) return false;
  const btn = candidates[candidates.length - 1];
  const clickable = btn.closest('button, [role="button"]') || btn;
  clickable.click();
  return true;
}
async function closeOverlays() {
  const closeBtns = [...document.querySelectorAll('svg[aria-label="Close" i], svg[aria-label="\uB2EB\uAE30" i]')];
  for (const svg of closeBtns) {
    const btn = svg.closest('button, [role="button"]') || svg;
    btn.click();
  }
  await wait(300);
}
var ReelsProbeAdapter = class {
  platform = "instagram-reels";
  _skipInProgress = false;
  detect() {
    return window.location.hostname.includes("instagram.com") && window.location.pathname.startsWith("/reels/");
  }
  findActiveItem() {
    return findActiveReel();
  }
  getCreatorIdentity(activeItem, signals) {
    return signals?.creator ?? extractCreator(activeItem);
  }
  async extractSignals(activeItem) {
    const commentAlreadyOpen = isCommentPanelOpen();
    if (!commentAlreadyOpen) {
      await expandCaption(activeItem);
    }
    const captionBlocks = extractCaptionTexts(activeItem);
    const localTexts = collectVisibleText(activeItem);
    const creator = extractCreator(activeItem);
    const caption = normalizeText(captionBlocks.join(" ") || localTexts.join(" "));
    const itemId = getStableItemId(activeItem, caption, creator);
    const commentPanel = commentAlreadyOpen ? { triggered: false, attempts: 0 } : await tryOpenCommentPanel(activeItem, itemId);
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
  async skipToNext(activeItem) {
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
        window.scrollBy({ top: window.innerHeight, behavior: "smooth" });
        await wait(400);
      }
      return true;
    } finally {
      this._skipInProgress = false;
    }
  }
  async getDebugSnapshot(activeItem, signals) {
    return {
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
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
};

// src/content/platforms/tiktokAdapter.ts
var TIKTOK_OFFICIAL_AI_LABEL_RE = /\b(ai|aigc)\b|generated|synthetic|ai ?생성|생성 미디어|ai ?미디어|미디어 포함|ai로 만든/i;
var AI_DISCLOSURE_RE = /\b(ai[- ]?generated|made with ai|generated with ai)\b|ai ?생성|ai로 만든/i;
function parseRehydration() {
  const script = document.getElementById("__UNIVERSAL_DATA_FOR_REHYDRATION__");
  if (!script?.textContent) return null;
  try {
    return JSON.parse(script.textContent);
  } catch {
    return null;
  }
}
function findBestItem(nodes) {
  if (!nodes.length) return null;
  return [...nodes].sort((a, b) => getViewportScore(b) - getViewportScore(a))[0] ?? null;
}
function findScrollableParent(node) {
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
function fireNavigationKey(key) {
  const target = document.activeElement instanceof HTMLElement ? document.activeElement : document.body;
  for (const type of ["keydown", "keypress", "keyup"]) {
    const event = new KeyboardEvent(type, { key, bubbles: true, cancelable: true });
    target.dispatchEvent(event);
    document.dispatchEvent(event);
    window.dispatchEvent(event);
  }
}
function extractCommentsFromDom() {
  const texts = TT_SELECTORS.commentItems.flatMap(
    (selector) => [...document.querySelectorAll(selector)].map((node) => normalizeText(node.textContent))
  );
  return uniqStrings(texts).slice(0, 12).map((text) => ({
    text,
    locale: detectLocaleBucket(text)
  }));
}
function extractCreatorFromDom(activeItem, json) {
  const link = TT_SELECTORS.creatorLinks.flatMap((selector) => [...activeItem.querySelectorAll(selector)]).find((anchor) => /\/@/.test(anchor.getAttribute("href") ?? ""));
  const href = link?.getAttribute("href") ?? "";
  const handle = href.match(/\/(@[^/?]+)/)?.[1] ?? json?.itemInfo?.itemStruct?.author?.uniqueId ?? "";
  if (!handle) {
    return void 0;
  }
  const normalizedHandle = handle.startsWith("@") ? handle : `@${handle}`;
  return {
    key: `tiktok:/${normalizedHandle}`,
    handle: normalizedHandle,
    profileUrl: href ? `https://www.tiktok.com${href}` : void 0,
    rawId: json?.itemInfo?.itemStruct?.author?.id
  };
}
var TikTokAdapter = class {
  platform = "tiktok";
  detect() {
    return window.location.hostname.includes("tiktok.com");
  }
  findActiveItem() {
    const candidates = TT_SELECTORS.item.flatMap((selector) => [...document.querySelectorAll(selector)]);
    return findBestItem(candidates);
  }
  getCreatorIdentity(activeItem, signals) {
    return signals?.creator ?? extractCreatorFromDom(activeItem, parseRehydration());
  }
  async extractSignals(activeItem) {
    const json = parseRehydration();
    const itemStruct = json?.itemInfo?.itemStruct;
    const visibleTexts = collectVisibleText(activeItem);
    const officialAiVisibleTexts = uniqStrings(
      visibleTexts.filter((text) => TIKTOK_OFFICIAL_AI_LABEL_RE.test(text))
    );
    const caption = normalizeText(
      itemStruct?.desc ?? itemStruct?.contents?.map((entry) => entry.desc ?? "").join(" ") ?? activeItem.getAttribute("aria-label") ?? activeItem.textContent
    );
    const hashtags = uniqStrings([
      ...itemStruct?.textExtra?.map((entry) => entry.hashtagName ? `#${entry.hashtagName}` : "") ?? [],
      ...caption.match(/#[\p{L}\p{N}_]+/gu) ?? []
    ]);
    const officialAiTexts = uniqStrings([
      itemStruct?.AIGCDescription,
      ...officialAiVisibleTexts
    ]);
    const commentsFromJson = (itemStruct?.comments ?? []).map((comment) => ({
      text: normalizeText(comment.text),
      authorHint: comment.user?.uid ?? comment.user?.nickname,
      locale: detectLocaleBucket(normalizeText(comment.text))
    })).filter((comment) => comment.text);
    const comments = [...extractCommentsFromDom(), ...commentsFromJson].slice(0, 16);
    const itemId = activeItem.id || activeItem.getAttribute("data-scroll-index") || itemStruct?.id || window.location.pathname;
    const creator = extractCreatorFromDom(activeItem, json);
    return {
      itemId,
      platform: this.platform,
      creator,
      caption,
      hashtags,
      comments,
      officialAiLabel: Boolean(
        itemStruct?.IsAigc || itemStruct?.aigcLabelType && itemStruct.aigcLabelType !== "0" || itemStruct?.AIGCDescription || itemStruct?.creatorAIComment?.hasAITopic || officialAiVisibleTexts.length
      ),
      officialAiTexts,
      visibleTexts,
      aiDisclosureTexts: visibleTexts.filter((text) => TIKTOK_OFFICIAL_AI_LABEL_RE.test(text) || AI_DISCLOSURE_RE.test(text)),
      raw: {
        jsonPresent: Boolean(json),
        locales: detectLocaleBuckets([caption, ...comments.map((comment) => comment.text)]),
        officialAiVisibleTexts
      }
    };
  }
  async skipToNext(activeItem) {
    const currentIndex = Number(activeItem.getAttribute("data-scroll-index") ?? "0");
    const candidates = [...document.querySelectorAll('article[id^="one-column-item-"], [data-e2e="recommend-list-item-container"]')];
    const nextItem = candidates.map((node) => ({ node, index: Number(node.getAttribute("data-scroll-index") ?? "-1") })).filter((entry) => entry.index > currentIndex).sort((a, b) => a.index - b.index)[0]?.node;
    if (nextItem) {
      nextItem.scrollIntoView({ behavior: "smooth", block: "center" });
      return true;
    }
    const scrollParent = findScrollableParent(activeItem);
    const delta = Math.max(window.innerHeight * 0.9, 640);
    if (scrollParent) {
      scrollParent.scrollBy({ top: delta, behavior: "smooth" });
    } else {
      window.scrollBy({ top: delta, behavior: "smooth" });
      document.documentElement.scrollTop += delta;
      document.body.scrollTop += delta;
    }
    fireNavigationKey("ArrowDown");
    fireNavigationKey("PageDown");
    fireNavigationKey(" ");
    return true;
  }
  async getDebugSnapshot(activeItem, signals) {
    return {
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      platform: this.platform,
      locationHref: window.location.href,
      activeItemId: activeItem?.id || activeItem?.getAttribute("data-scroll-index") || void 0,
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
};

// src/content/platformRouter.ts
function resolvePlatformAdapter() {
  const hostname = window.location.hostname;
  if (hostname.includes("tiktok.com")) {
    return new TikTokAdapter();
  }
  if (hostname.includes("instagram.com")) {
    return new ReelsProbeAdapter();
  }
  return null;
}

// src/content/scoring.ts
var captionDisclosureRules = [
  { pattern: /\b(ai[- ]?generated|generated with ai|made with ai|created with ai|ai assisted)\b/i, weight: 55, reasonKey: "reasonCaptionDisclosure" },
  { pattern: /\b(prompt(ed)? with ai|midjourney|chatgpt art|stable diffusion)\b/i, weight: 40, reasonKey: "reasonCaptionAiPhrase" },
  { pattern: /\b(ai로 만든|ai ?생성|ai ?영상|ai ?작품)\b/i, weight: 40, reasonKey: "reasonCaptionAiPhrase" },
  { pattern: /\b(ai 슬롭|ai slop|prompt slop|dead internet)\b/i, weight: 18, reasonKey: "reasonCaptionSlopPhrase" }
];
var hashtagStrongRules = [
  { pattern: /^#?(aigenerated|aiart|aimade|madewithai|generatedwithai)$/i, weight: 25, reasonKey: "reasonHashtagStrong" },
  { pattern: /^#?(ai영상|ai그림|ai생성|ai콘텐츠)$/i, weight: 25, reasonKey: "reasonHashtagStrong" }
];
var hashtagWeakRules = [
  { pattern: /^#?ai$/i, weight: 10, reasonKey: "reasonHashtagWeak" },
  { pattern: /^#?chatgpt$/i, weight: 10, reasonKey: "reasonHashtagWeak" }
];
var contradictionRules = [
  { pattern: /\bnot ai\b/i, weight: -25, reasonKey: "reasonContradictionNotAi" },
  { pattern: /\bthis is(n't| not) ai\b/i, weight: -25, reasonKey: "reasonContradictionNotAi" },
  { pattern: /\bai 아니\b/i, weight: -25, reasonKey: "reasonContradictionNotAi" },
  { pattern: /\b진짜 사람\b/i, weight: -25, reasonKey: "reasonContradictionNotAi" }
];
var commentStrongRulesEn = [
  { pattern: /\bstop ai\b/i, weight: 24, reasonKey: "reasonCommentStrongEn" },
  { pattern: /\b(real|fake) or ai\b/i, weight: 22, reasonKey: "reasonCommentStrongEn" },
  { pattern: /\breal or fake\b/i, weight: 18, reasonKey: "reasonCommentStrongEn" },
  { pattern: /\bfake or fake\b/i, weight: 22, reasonKey: "reasonCommentStrongEn" },
  { pattern: /\bis( (it|this|that))? real/i, weight: 16, reasonKey: "reasonCommentStrongEn" },
  { pattern: /\bis( (it|this|that))? fake/i, weight: 18, reasonKey: "reasonCommentStrongEn" },
  { pattern: /^\s*ai\s*[?!]*\s*$/i, weight: 16, reasonKey: "reasonCommentStrongEn" },
  { pattern: /\b(its|it's|it is|this is|that is) ai\b/i, weight: 18, reasonKey: "reasonCommentStrongEn" },
  { pattern: /\b(this|that|it)( is| looks| s)? ai\b/i, weight: 18, reasonKey: "reasonCommentStrongEn" },
  { pattern: /\bbro( this| s| is)? ai\b/i, weight: 18, reasonKey: "reasonCommentStrongEn" },
  { pattern: /\bdef(initely)? ai\b/i, weight: 18, reasonKey: "reasonCommentStrongEn" },
  { pattern: /\bso obviously ai\b/i, weight: 20, reasonKey: "reasonCommentStrongEn" },
  { pattern: /\blooks( like)? ai\b/i, weight: 17, reasonKey: "reasonCommentStrongEn" },
  { pattern: /\bai asf\b/i, weight: 18, reasonKey: "reasonCommentStrongEn" },
  { pattern: /\btoo ai\b/i, weight: 16, reasonKey: "reasonCommentStrongEn" },
  { pattern: /\bthis screams ai\b/i, weight: 22, reasonKey: "reasonCommentStrongEn" },
  { pattern: /\bmade by ai\b/i, weight: 18, reasonKey: "reasonCommentStrongEn" },
  { pattern: /\bwas this made with ai\b/i, weight: 18, reasonKey: "reasonCommentStrongEn" },
  { pattern: /\bai slop\b/i, weight: 15, reasonKey: "reasonCommentStrongEn" },
  { pattern: /\byour ai slop bores me\b/i, weight: 20, reasonKey: "reasonCommentStrongEn" },
  { pattern: /\bprompt slop\b/i, weight: 15, reasonKey: "reasonCommentStrongEn" },
  { pattern: /\bmade with ai again\b/i, weight: 15, reasonKey: "reasonCommentStrongEn" },
  { pattern: /\bgenerated garbage\b/i, weight: 15, reasonKey: "reasonCommentStrongEn" },
  { pattern: /\bdead internet\b/i, weight: 15, reasonKey: "reasonCommentStrongEn" },
  { pattern: /\blooks fake\b/i, weight: 18, reasonKey: "reasonCommentStrongEn" },
  { pattern: /\bso fake\b/i, weight: 17, reasonKey: "reasonCommentStrongEn" },
  { pattern: /\bdef(initely)? fake\b/i, weight: 18, reasonKey: "reasonCommentStrongEn" },
  { pattern: /\bnot real\b/i, weight: 16, reasonKey: "reasonCommentStrongEn" },
  { pattern: /\bthis aint real\b/i, weight: 18, reasonKey: "reasonCommentStrongEn" }
];
var commentStrongRulesKo = [
  { pattern: /\b이거 ai\b/i, weight: 20, reasonKey: "reasonCommentStrongKo" },
  { pattern: /\bai 같음\b/i, weight: 20, reasonKey: "reasonCommentStrongKo" },
  { pattern: /\bai 티남\b/i, weight: 20, reasonKey: "reasonCommentStrongKo" },
  { pattern: /\bai 합성\b/i, weight: 20, reasonKey: "reasonCommentStrongKo" },
  { pattern: /\bai 영상이네\b/i, weight: 20, reasonKey: "reasonCommentStrongKo" },
  { pattern: /\bai로 만든 거\b/i, weight: 20, reasonKey: "reasonCommentStrongKo" },
  { pattern: /\bai충\b/i, weight: 20, reasonKey: "reasonCommentStrongKo" }
];
var commentStrongRulesDefault = [
  { pattern: /\b(esto|это)? ?(es )?(ai|ии)\b/i, weight: 20, reasonKey: "reasonCommentStrongEn" },
  { pattern: /\bai gk sih\b/i, weight: 18, reasonKey: "reasonCommentStrongEn" },
  { pattern: /\bai nya\b/i, weight: 16, reasonKey: "reasonCommentStrongEn" },
  { pattern: /\b(isso|esse v(í|i)deo) [ée] real\b/i, weight: 16, reasonKey: "reasonCommentStrongEn" },
  { pattern: /\b[ée] ia\b/i, weight: 20, reasonKey: "reasonCommentStrongEn" },
  { pattern: /\bia me assusta\b/i, weight: 22, reasonKey: "reasonCommentStrongEn" },
  // "IA scares me"
  { pattern: /\b(el|este) video es real\b/i, weight: 15, reasonKey: "reasonCommentStrongEn" },
  // AI meme "the video is real"
  { pattern: /\bthe video is real\b/i, weight: 15, reasonKey: "reasonCommentStrongEn" }
  // AI meme English version
];
var AI_LIKE_FRAGMENT_RE = /\b(ai|ia|aigc|artificial intelligence|generated|gen ai|fake|cgi|render|rendered|prompt|slop|ии)\b/i;
function pushMatch(matches, match) {
  matches.push(match);
}
function applyRules(text, rules, source, locale, matches) {
  let total = 0;
  for (const rule of rules) {
    if (rule.pattern.test(text)) {
      total += rule.weight;
      pushMatch(matches, {
        reasonKey: rule.reasonKey,
        weight: rule.weight,
        source,
        locale,
        excerpt: text.slice(0, 140)
      });
    }
  }
  return total;
}
function normalizeCommentText(text) {
  return text.toLowerCase().replace(/[？]/g, "?").replace(/[！]/g, "!").replace(/\ba\s+i\b/gi, "ai").replace(/\ba\s*\.\s*i\b/gi, "ai").replace(/a[\s._-]*1/g, "ai").replace(/[\u2019']/g, "").replace(/[^\p{L}\p{N}\s?!]/gu, " ").replace(/\s+/g, " ").trim();
}
function commentLocaleFromComments(comments) {
  return comments.some((comment) => comment.locale === "ko") ? "ko" : comments.some((comment) => comment.locale === "en") ? "en" : "default";
}
function extractSuspicionFeatures(text) {
  const features = /* @__PURE__ */ new Set();
  if (/\breal or ai\b/i.test(text)) features.add("real_or_ai");
  if (/\breal or fake\b/i.test(text)) features.add("real_or_fake");
  if (/\bfake or fake\b/i.test(text)) features.add("fake_or_fake");
  if (/\bis( (it|this|that))? real/i.test(text)) features.add("is_it_real");
  if (/\bis( (it|this|that))? fake/i.test(text)) features.add("is_it_fake");
  if (/\bits ai\b/i.test(text)) features.add("its_ai");
  if (/\b(fake|not real|looks fake|cgi|render)\b/i.test(text)) features.add("fake_cluster");
  if (/\b(ai|ia|ии|aigc|generated|prompt|slop)\b/i.test(text)) features.add("ai_cluster");
  return [...features];
}
function scoreSuspicionFeatures(text, locale, matches) {
  const features = extractSuspicionFeatures(text);
  if (!features.length) return 0;
  let total = 0;
  for (const feature of features) {
    const weight = feature.includes("cluster") ? 8 : 14;
    total += weight;
    pushMatch(matches, {
      reasonKey: "reasonCommentStrongEn",
      weight,
      source: "comments",
      locale,
      excerpt: feature
    });
  }
  return total;
}
function scoreLearnedPhrases(text, locale, matches, learnedPhraseScores) {
  let total = 0;
  for (const [phrase, rawScore] of Object.entries(learnedPhraseScores)) {
    if (!phrase || rawScore === 0) continue;
    if (!text.includes(phrase)) continue;
    const weight = rawScore > 0 ? rawScore * 4 : rawScore * 3;
    total += weight;
    pushMatch(matches, {
      reasonKey: rawScore > 0 ? "reasonCommentStrongEn" : "reasonContradictionNotAi",
      weight,
      source: "comments",
      locale,
      excerpt: phrase
    });
  }
  return Math.max(-24, Math.min(24, total));
}
function computeScore(signals, sensitivity, creatorVote, thresholdOverride, learnedPhraseScores = {}) {
  const matches = [];
  let total = 0;
  if (creatorVote === "allow") {
    pushMatch(matches, { reasonKey: "reasonVoteAllow", weight: -100, source: "vote", locale: "default" });
    return {
      total: -100,
      threshold: thresholdOverride ?? SENSITIVITY_THRESHOLDS[sensitivity],
      sensitivity,
      shouldSkip: false,
      hardBlock: false,
      protectedByAllow: true,
      matches
    };
  }
  if (creatorVote === "slop") {
    total += 100;
    pushMatch(matches, { reasonKey: "reasonVoteSlop", weight: 100, source: "vote", locale: "default" });
  }
  if (signals.officialAiLabel) {
    total += 90;
    pushMatch(matches, {
      reasonKey: "reasonOfficialAi",
      weight: 90,
      source: "official",
      locale: "default",
      excerpt: signals.officialAiTexts[0]
    });
  }
  const captionLocale = detectLocaleBucket(signals.caption);
  total += applyRules(signals.caption, captionDisclosureRules, "caption", captionLocale, matches);
  total += applyRules(signals.caption, contradictionRules, "contradiction", captionLocale, matches);
  for (const tag of signals.hashtags) {
    total += applyRules(tag, hashtagStrongRules, "hashtags", captionLocale, matches);
    total += applyRules(tag, hashtagWeakRules, "hashtags", captionLocale, matches);
  }
  const seenComments = /* @__PURE__ */ new Set();
  let commentTotal = 0;
  let aiMentionCount = 0;
  let strongCommentSignalCount = 0;
  for (const comment of signals.comments) {
    const normalized = normalizeCommentText(comment.text);
    const key = `${comment.authorHint ?? ""}:${normalized}`;
    if (!normalized || seenComments.has(key)) continue;
    seenComments.add(key);
    commentTotal += applyRules(normalized, contradictionRules, "contradiction", comment.locale, matches);
    const defaultStrongScore = applyRules(normalized, commentStrongRulesDefault, "comments", comment.locale, matches);
    commentTotal += defaultStrongScore;
    if (defaultStrongScore > 0) strongCommentSignalCount += 1;
    const suspicionFeatureScore = scoreSuspicionFeatures(normalized, comment.locale, matches);
    commentTotal += suspicionFeatureScore;
    if (suspicionFeatureScore >= 14) strongCommentSignalCount += 1;
    const learnedScore = scoreLearnedPhrases(normalized, comment.locale, matches, learnedPhraseScores);
    commentTotal += learnedScore;
    if (learnedScore >= 8) strongCommentSignalCount += 1;
    if (comment.locale === "ko") {
      const strongScore = applyRules(normalized, commentStrongRulesKo, "comments", comment.locale, matches);
      commentTotal += strongScore;
      if (strongScore > 0) strongCommentSignalCount += 1;
      if (AI_LIKE_FRAGMENT_RE.test(normalized)) {
        aiMentionCount += 1;
        commentTotal += 8;
        pushMatch(matches, {
          reasonKey: "reasonCommentWeakKo",
          weight: 8,
          source: "comments",
          locale: comment.locale,
          excerpt: normalized.slice(0, 140)
        });
      }
    } else {
      const strongScore = applyRules(normalized, commentStrongRulesEn, "comments", comment.locale, matches);
      commentTotal += strongScore;
      if (strongScore > 0) strongCommentSignalCount += 1;
      if (AI_LIKE_FRAGMENT_RE.test(normalized)) {
        aiMentionCount += 1;
        commentTotal += 6;
        pushMatch(matches, {
          reasonKey: "reasonCommentWeakEn",
          weight: 6,
          source: "comments",
          locale: comment.locale,
          excerpt: normalized.slice(0, 140)
        });
      }
    }
  }
  const commentLocale = commentLocaleFromComments(signals.comments);
  if (strongCommentSignalCount >= 2) {
    commentTotal += 28;
    pushMatch(matches, {
      reasonKey: "reasonCommentStrongEn",
      weight: 28,
      source: "comments",
      locale: commentLocale,
      excerpt: `${strongCommentSignalCount} comments`
    });
  } else if (aiMentionCount >= 2) {
    commentTotal += 20;
    pushMatch(matches, {
      reasonKey: "reasonCommentWeakEn",
      weight: 20,
      source: "comments",
      locale: commentLocale,
      excerpt: `${aiMentionCount} comments`
    });
  }
  if (strongCommentSignalCount >= 3) {
    commentTotal += 18;
    pushMatch(matches, {
      reasonKey: "reasonCommentStrongEn",
      weight: 18,
      source: "comments",
      locale: commentLocale,
      excerpt: `pile-on ${strongCommentSignalCount}`
    });
  }
  if (strongCommentSignalCount >= 5) {
    commentTotal += 18;
    pushMatch(matches, {
      reasonKey: "reasonCommentStrongEn",
      weight: 18,
      source: "comments",
      locale: commentLocale,
      excerpt: `heavy pile-on ${strongCommentSignalCount}`
    });
  }
  total += commentTotal;
  const threshold = thresholdOverride ?? SENSITIVITY_THRESHOLDS[sensitivity];
  const hardBlock = signals.officialAiLabel || creatorVote === "slop";
  const hasMediumSignal = matches.some((match) => match.weight >= 15);
  const shouldSkip = hardBlock || total >= threshold && hasMediumSignal;
  return {
    total,
    threshold,
    sensitivity,
    shouldSkip,
    hardBlock,
    protectedByAllow: false,
    matches
  };
}

// src/content/skip.ts
async function waitForItemChange(getCurrentId, previousId, timeoutMs = 1600) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const current = getCurrentId();
    if (current && current !== previousId) {
      return true;
    }
    await new Promise((resolve) => window.setTimeout(resolve, 120));
  }
  return false;
}

// src/content/toast.ts
var timeoutHandle;
function showToast(message) {
  let root = document.getElementById(TOAST_ID);
  if (!root) {
    root = document.createElement("div");
    root.id = TOAST_ID;
    Object.assign(root.style, {
      position: "fixed",
      right: "20px",
      bottom: "20px",
      zIndex: "2147483647",
      background: "rgba(16,16,16,0.92)",
      color: "#fff",
      padding: "10px 14px",
      borderRadius: "10px",
      fontSize: "13px",
      fontFamily: "Segoe UI, sans-serif",
      boxShadow: "0 10px 25px rgba(0,0,0,0.25)",
      maxWidth: "320px",
      lineHeight: "1.4"
    });
    document.documentElement.appendChild(root);
  }
  root.textContent = message;
  root.style.opacity = "1";
  if (timeoutHandle) {
    window.clearTimeout(timeoutHandle);
  }
  timeoutHandle = window.setTimeout(() => {
    root?.style.setProperty("opacity", "0");
  }, 2400);
}

// src/content/index.ts
var adapter = resolvePlatformAdapter();
var EVAL_DEBOUNCE_MS = adapter?.platform === "instagram-reels" ? 500 : 250;
var storageState = null;
var currentSignals = null;
var currentSnapshot = null;
var currentStatus = {
  platform: adapter?.platform ?? "unsupported",
  supported: Boolean(adapter)
};
var pendingTimer;
var lastProcessedItemId;
var skipCooldownUntil = 0;
var manualRevisitIntentUntil = 0;
var lastLocationKey = `${window.location.pathname}${window.location.search}`;
var skipInFlight = false;
var isExtracting = false;
var evaluationSequence = 0;
var commentPanelGraceItemId;
var commentPanelGraceUntil = 0;
var skippedItemIds = /* @__PURE__ */ new Set();
var autoSkippedItemIds = /* @__PURE__ */ new Set();
var manuallyReviewedItemIds = /* @__PURE__ */ new Set();
function isContextInvalidatedError(error) {
  return error instanceof Error && /Extension context invalidated/i.test(error.message);
}
function runSafely(task) {
  void task().catch((error) => {
    if (isContextInvalidatedError(error)) {
      return;
    }
    console.error("[SlopSkip]", error);
  });
}
async function refreshStorageState() {
  storageState = await getStorageState();
  return storageState;
}
function getCurrentVote() {
  const key = currentSignals?.creator?.key;
  if (!key || !storageState) return void 0;
  return storageState.creatorVotes[key];
}
function noteManualRevisitIntent() {
  manualRevisitIntentUntil = Date.now() + MANUAL_REVISIT_WINDOW_MS;
}
function shouldPauseForManualRevisit(itemId, state) {
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
function clearTransientState() {
  currentSignals = null;
  currentSnapshot = null;
  currentStatus = {
    platform: adapter?.platform ?? "unsupported",
    supported: Boolean(adapter)
  };
  lastProcessedItemId = void 0;
  skipCooldownUntil = 0;
  skipInFlight = false;
  commentPanelGraceItemId = void 0;
  commentPanelGraceUntil = 0;
  skippedItemIds.clear();
}
async function evaluateCurrentItem(reason = "loop") {
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
async function performEvaluation(reason) {
  if (!adapter) return;
  const locationKey = `${window.location.pathname}${window.location.search}`;
  if (locationKey !== lastLocationKey) {
    lastLocationKey = locationKey;
    clearTransientState();
  }
  if (!storageState) {
    await refreshStorageState();
  }
  const state = storageState;
  const supported = adapter.platform === "tiktok" ? state.platformFlags.tiktok.enabled : state.platformFlags.reelsProbe.enabled && state.settings.reelsProbeEnabled;
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
    console.info("[SlopSkip Reels]", { itemId: signals.itemId, score: score.total, shouldSkip: score.shouldSkip, creator: signals.creator?.handle });
  }
  if (adapter.platform === "instagram-reels" && signals.raw?.commentPanelTriggered) {
    commentPanelGraceItemId = signals.itemId;
    commentPanelGraceUntil = Date.now() + 1800;
  }
  if (signals.itemId === lastProcessedItemId && reason !== "force") {
    return;
  }
  lastProcessedItemId = signals.itemId;
  if (Date.now() < skipCooldownUntil) {
    return;
  }
  if (skippedItemIds.has(signals.itemId)) {
    return;
  }
  if (shouldPauseForManualRevisit(signals.itemId, state)) {
    return;
  }
  if (adapter.platform === "instagram-reels" && signals.raw?.commentPanelOpen && commentPanelGraceItemId === signals.itemId && Date.now() < commentPanelGraceUntil) {
    return;
  }
  if (!score.shouldSkip) {
    return;
  }
  const primaryReason = score.matches[0]?.reasonKey ?? "reasonWouldSkip";
  const localizedReason = chrome.i18n.getMessage(primaryReason) || primaryReason;
  const toastMessage = state.settings.dryRun ? chrome.i18n.getMessage("toastWouldSkip", [localizedReason, String(score.total)]) : chrome.i18n.getMessage("toastSkipped", [localizedReason, String(score.total)]);
  if (state.settings.showToast) {
    showToast(toastMessage);
  }
  if (state.settings.dryRun) {
    return;
  }
  const previousId = signals.itemId;
  skippedItemIds.add(previousId);
  autoSkippedItemIds.add(previousId);
  skipInFlight = true;
  try {
    const didRequestSkip = await adapter.skipToNext(activeItem);
    if (!didRequestSkip) {
      return;
    }
    const changed = await waitForItemChange(() => {
      const newActive = adapter.findActiveItem();
      if (!newActive) return currentSignals?.itemId;
      const video = newActive.querySelector("video");
      const src = video?.src || video?.currentSrc || video?.poster || "";
      return src ? `quick::${src}` : currentSignals?.itemId;
    }, `quick::${_getVideoSrc(activeItem)}`, 2e3);
    skipCooldownUntil = Date.now() + SKIP_COOLDOWN_MS;
    if (!changed) {
      skipCooldownUntil = Date.now() + 3e3;
      if (state.settings.showToast) {
        showToast(chrome.i18n.getMessage("toastSkipTransitionUnconfirmed"));
      }
    }
  } finally {
    skipInFlight = false;
    lastProcessedItemId = void 0;
  }
}
function _getVideoSrc(el) {
  const v = el.querySelector("video");
  return v?.src || v?.currentSrc || v?.poster || "";
}
function scheduleEvaluation(reason = "mutation") {
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
    if (message.type === MESSAGE_TYPES.MARK_CREATOR_SLOP || message.type === MESSAGE_TYPES.MARK_CREATOR_ALLOW || message.type === MESSAGE_TYPES.CLEAR_CREATOR_VOTE) {
      const creatorKey = currentSignals?.creator?.key;
      if (!creatorKey) {
        sendResponse({ ok: false });
        return true;
      }
      runSafely(async () => {
        if (message.type === MESSAGE_TYPES.MARK_CREATOR_SLOP) {
          await setCreatorVote(creatorKey, "slop");
          await learnPhraseScores(currentSignals, "slop");
        } else if (message.type === MESSAGE_TYPES.MARK_CREATOR_ALLOW) {
          await setCreatorVote(creatorKey, "allow");
          await learnPhraseScores(currentSignals, "allow");
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
//# sourceMappingURL=index.js.map
