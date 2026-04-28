import { DEBUG_PANEL_ID } from "../shared/constants";
import { MESSAGE_TYPES } from "../shared/messages";
import type { DebugSnapshot, SignalMatch } from "../shared/types";

let dragAbortController: AbortController | undefined;

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function isContextInvalidatedError(error: unknown): boolean {
  return /Extension context invalidated/i.test(error instanceof Error ? error.message : String(error));
}

function getScoreTone(total: number, threshold: number): { color: string; bg: string; label: string } {
  if (total >= threshold * 1.5) {
    return { color: "#b42318", bg: "#fee4e2", label: "Very high risk" };
  }
  if (total >= threshold) {
    return { color: "#dc6803", bg: "#fef0c7", label: "Filter candidate" };
  }
  return { color: "#067647", bg: "#d1fadf", label: "Below threshold" };
}

function aggregateMatches(matches: SignalMatch[]): Array<{ label: string; value: number }> {
  const buckets: Record<string, number> = {
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
    { label: "Official labels", value: buckets.official },
    { label: "Caption", value: buckets.caption },
    { label: "Hashtags", value: buckets.hashtags },
    { label: "Comments", value: buckets.comments },
    { label: "Your choice", value: buckets.vote },
    { label: "Contradictions", value: buckets.contradiction }
  ];
}

function summarizeCommentMatches(matches: SignalMatch[]): Array<{ excerpt: string; score: number }> {
  const grouped = new Map<string, number>();

  for (const match of matches.filter((item) => item.source === "comments")) {
    const key = (match.excerpt || match.reasonKey || "comment").trim();
    grouped.set(key, (grouped.get(key) ?? 0) + match.weight);
  }

  return [...grouped.entries()]
    .map(([excerpt, score]) => ({ excerpt, score }))
    .sort((left, right) => Math.abs(right.score) - Math.abs(left.score))
    .slice(0, 10);
}

function renderBars(groups: Array<{ label: string; value: number }>): string {
  const max = Math.max(10, ...groups.map((group) => Math.abs(group.value)));
  return groups.map((group) => {
    const width = Math.max(4, Math.round((Math.abs(group.value) / max) * 100));
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

function renderCommentCards(items: Array<{ excerpt: string; score: number }>): string {
  if (!items.length) {
    return `<div class="slopskip-empty">No scored comment evidence yet.</div>`;
  }

  return items.map((item) => `
    <div class="slopskip-comment-card">
      <div class="slopskip-comment-score">${item.score > 0 ? "+" : ""}${item.score}</div>
      <div class="slopskip-comment-text">${escapeHtml(item.excerpt)}</div>
    </div>
  `).join("");
}

function renderSkipBreadcrumbs(probe?: Record<string, unknown>): string {
  const breadcrumbs = Array.isArray(probe?.skipBreadcrumbs) ? probe.skipBreadcrumbs : [];
  if (!breadcrumbs.length) {
    return `<div class="slopskip-empty">No skip breadcrumbs yet.</div>`;
  }

  return breadcrumbs.map((breadcrumb) => {
    const text = typeof breadcrumb === "object" && breadcrumb
      ? JSON.stringify(breadcrumb)
      : String(breadcrumb);
    return `<span class="slopskip-chip">${escapeHtml(text)}</span>`;
  }).join("");
}

function ensureStyles(root: HTMLElement): void {
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
    #${DEBUG_PANEL_ID} .slopskip-topbar:active { cursor: grabbing; }
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
    #${DEBUG_PANEL_ID} .slopskip-close:hover { background: rgba(60, 40, 20, 0.16); }
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
      min-width: 0;
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
      max-width: 100%;
      overflow-wrap: anywhere;
    }
    #${DEBUG_PANEL_ID} .slopskip-comment-list {
      display: grid;
      gap: 8px;
    }
    #${DEBUG_PANEL_ID} .slopskip-comment-card {
      display: grid;
      grid-template-columns: 56px minmax(0, 1fr);
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
      overflow-wrap: anywhere;
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

function bindCloseButton(root: HTMLElement): void {
  root.querySelector<HTMLButtonElement>(".slopskip-close")?.addEventListener("click", () => {
    root.style.display = "none";
    void chrome.runtime.sendMessage({
      type: MESSAGE_TYPES.SET_SETTINGS,
      payload: { debugMode: false }
    }).catch((error) => {
      if (isContextInvalidatedError(error)) {
        return;
      }
      console.error("[SlopSkip]", error);
    });
  });
}

function initDraggable(root: HTMLElement): void {
  dragAbortController?.abort();
  dragAbortController = new AbortController();
  const { signal } = dragAbortController;
  let isDragging = false;
  let startX = 0;
  let startY = 0;
  let initialLeft = 0;
  let initialTop = 0;

  root.addEventListener("mousedown", (event) => {
    const target = event.target as HTMLElement;
    if (!target.closest(".slopskip-topbar") && !target.classList.contains("slopskip-shell")) return;
    if (target.closest("button, a")) return;

    isDragging = true;
    startX = event.clientX;
    startY = event.clientY;
    const rect = root.getBoundingClientRect();
    initialLeft = rect.left;
    initialTop = rect.top;
    event.preventDefault();
  }, { signal });

  document.addEventListener("mousemove", (event) => {
    if (!isDragging) return;
    const nextLeft = Math.max(8, Math.min(window.innerWidth - 80, initialLeft + event.clientX - startX));
    const nextTop = Math.max(8, Math.min(window.innerHeight - 80, initialTop + event.clientY - startY));
    root.style.left = `${nextLeft}px`;
    root.style.top = `${nextTop}px`;
    root.style.right = "auto";
    root.style.bottom = "auto";
    root.style.transform = "none";
  }, { signal });

  document.addEventListener("mouseup", () => {
    isDragging = false;
  }, { signal });
}

export function renderDebugPanel(snapshot: DebugSnapshot | null, visible: boolean): void {
  let root = document.getElementById(DEBUG_PANEL_ID);
  if (!visible) {
    dragAbortController?.abort();
    dragAbortController = undefined;
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
      maxWidth: "calc(100vw - 24px)",
      maxHeight: "78vh",
      overflow: "auto",
      background: "rgba(247,241,227,0.96)",
      color: "#181818",
      border: "1px solid rgba(0,0,0,0.12)",
      borderRadius: "18px",
      padding: "12px",
      boxShadow: "0 18px 40px rgba(0,0,0,0.18)",
      backdropFilter: "blur(10px)"
    } satisfies Partial<CSSStyleDeclaration>);
    document.documentElement.appendChild(root);
    initDraggable(root);
  }

  root.style.display = "block";
  ensureStyles(root);

  if (!snapshot?.score) {
    root.innerHTML = `
      <div class="slopskip-shell">
        <div class="slopskip-topbar">
          <button type="button" class="slopskip-close" aria-label="Close debug panel">&times;</button>
        </div>
        <div class="slopskip-card slopskip-empty">No debug data yet.</div>
      </div>
    `;
    ensureStyles(root);
    bindCloseButton(root);
    return;
  }

  const { score } = snapshot;
  const tone = getScoreTone(score.total, score.threshold);
  const progress = Math.max(0, Math.min(100, Math.round((score.total / Math.max(score.threshold * 2, 1)) * 100)));
  const sourceGroups = aggregateMatches(score.matches);
  const commentCards = summarizeCommentMatches(score.matches);
  const skipBreadcrumbs = renderSkipBreadcrumbs(snapshot.probe);
  const tags = [
    `Platform: ${snapshot.platform}`,
    `Creator: ${snapshot.creatorHandle || snapshot.creatorKey || "unknown"}`,
    `Comments: ${snapshot.commentCount ?? 0}`,
    `Hashtags: ${snapshot.hashtagCount ?? 0}`,
    `Sensitivity: ${score.sensitivity}`
  ];

  root.innerHTML = `
    <div class="slopskip-shell">
      <div class="slopskip-topbar">
        <button type="button" class="slopskip-close" aria-label="Close debug panel">&times;</button>
      </div>

      <div class="slopskip-card slopskip-hero" style="--ring-color:${tone.color};--ring-progress:${progress};--badge-bg:${tone.bg};--badge-color:${tone.color};">
        <div class="slopskip-ring">
          <div class="slopskip-ring-content">
            <div class="slopskip-ring-score">${score.total}</div>
            <div class="slopskip-ring-threshold">/ ${score.threshold}</div>
          </div>
        </div>
        <div>
          <h2 class="slopskip-title">Slop risk readout</h2>
          <p class="slopskip-subtitle">Shows why the current post does or does not look like AI slop.</p>
          <span class="slopskip-badge">${score.shouldSkip ? "Filtering state" : tone.label}</span>
        </div>
      </div>

      <div class="slopskip-card">
        <h3 class="slopskip-section-title">Quick summary</h3>
        <div class="slopskip-meta">
          <div class="slopskip-stat">
            <div class="slopskip-stat-label">Read comments</div>
            <div class="slopskip-stat-value">${snapshot.commentCount ?? 0}</div>
          </div>
          <div class="slopskip-stat">
            <div class="slopskip-stat-label">Hashtags</div>
            <div class="slopskip-stat-value">${snapshot.hashtagCount ?? 0}</div>
          </div>
          <div class="slopskip-stat">
            <div class="slopskip-stat-label">Caption length</div>
            <div class="slopskip-stat-value">${snapshot.captionLength ?? 0}</div>
          </div>
        </div>
      </div>

      <div class="slopskip-card">
        <h3 class="slopskip-section-title">Score breakdown</h3>
        ${renderBars(sourceGroups)}
      </div>

      <div class="slopskip-card">
        <h3 class="slopskip-section-title">Comment evidence</h3>
        <div class="slopskip-comment-list">
          ${renderCommentCards(commentCards)}
        </div>
      </div>

      <div class="slopskip-card">
        <h3 class="slopskip-section-title">Context tags</h3>
        <div class="slopskip-chip-wrap">
          ${tags.map((tag) => `<span class="slopskip-chip">${escapeHtml(tag)}</span>`).join("")}
        </div>
      </div>

      <div class="slopskip-card">
        <h3 class="slopskip-section-title">Skip breadcrumbs</h3>
        <div class="slopskip-chip-wrap">
          ${skipBreadcrumbs}
        </div>
      </div>
    </div>
  `;

  ensureStyles(root);
  bindCloseButton(root);
}
