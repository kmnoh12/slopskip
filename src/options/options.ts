import { SENSITIVITY_THRESHOLDS } from "../shared/constants";
import { wireHelpPopovers } from "../shared/helpPopover";
import { applyI18n, t } from "../shared/i18n";
import { createDefaultStorageState, getStorageState, migrateStorageState, setStorageState } from "../shared/storage";
import type { Sensitivity, StorageState } from "../shared/types";

const sensitivityIds: Record<Sensitivity, { number: string; range: string }> = {
  conservative: { number: "thresholdConservative", range: "thresholdConservativeRange" },
  balanced: { number: "thresholdBalanced", range: "thresholdBalancedRange" },
  aggressive: { number: "thresholdAggressive", range: "thresholdAggressiveRange" }
};

const thresholdFallbacks: Record<Sensitivity, number> = {
  conservative: SENSITIVITY_THRESHOLDS.conservative,
  balanced: SENSITIVITY_THRESHOLDS.balanced,
  aggressive: SENSITIVITY_THRESHOLDS.aggressive
};
const MAX_VISIBLE_RULES_PER_LOCALE = 2000;
const MAX_RULE_LENGTH = 160;
const MIN_RULE_LENGTH = 2;

let latestState: StorageState | null = null;
let undoState: StorageState | null = null;
let saveTimer: number | undefined;

interface RuleQualitySummary {
  kept: number;
  duplicate: number;
  tooShort: number;
  truncated: number;
}

function byId<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

function setSaveStatus(status: "loading" | "saved" | "saving" | "error", message?: string): void {
  const labels = {
    loading: t("optionsStatusLoading"),
    saved: t("optionsStatusSaved"),
    saving: t("optionsStatusSaving"),
    error: t("optionsStatusError")
  };
  const node = byId<HTMLElement>("saveStatus");
  node.textContent = message ?? labels[status];
  node.dataset.status = status;
}

function clampThreshold(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(200, Math.round(value)));
}

function getThreshold(sensitivity: Sensitivity): number {
  const input = byId<HTMLInputElement>(sensitivityIds[sensitivity].number);
  return clampThreshold(Number(input.value), thresholdFallbacks[sensitivity]);
}

function setThreshold(sensitivity: Sensitivity, value: number): void {
  const nextValue = String(clampThreshold(value, thresholdFallbacks[sensitivity]));
  byId<HTMLInputElement>(sensitivityIds[sensitivity].number).value = nextValue;
  byId<HTMLInputElement>(sensitivityIds[sensitivity].range).value = nextValue;
}

function analyzeRuleTextarea(id: string): RuleQualitySummary {
  const seen = new Set<string>();
  const summary: RuleQualitySummary = {
    kept: 0,
    duplicate: 0,
    tooShort: 0,
    truncated: 0
  };

  for (const rawLine of byId<HTMLTextAreaElement>(id).value.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;
    if (trimmed.length < MIN_RULE_LENGTH) {
      summary.tooShort += 1;
      continue;
    }

    const phrase = trimmed.slice(0, MAX_RULE_LENGTH);
    if (trimmed.length > MAX_RULE_LENGTH) {
      summary.truncated += 1;
    }
    if (seen.has(phrase)) {
      summary.duplicate += 1;
      continue;
    }

    seen.add(phrase);
    summary.kept += 1;
  }

  return summary;
}

function combineRuleQuality(summaries: RuleQualitySummary[]): RuleQualitySummary {
  return summaries.reduce<RuleQualitySummary>((total, summary) => ({
    kept: total.kept + summary.kept,
    duplicate: total.duplicate + summary.duplicate,
    tooShort: total.tooShort + summary.tooShort,
    truncated: total.truncated + summary.truncated
  }), { kept: 0, duplicate: 0, tooShort: 0, truncated: 0 });
}

function updateRuleQuality(): void {
  const summary = combineRuleQuality([
    analyzeRuleTextarea("overrideEn"),
    analyzeRuleTextarea("overrideKo"),
    analyzeRuleTextarea("overrideDefault")
  ]);
  const warnings = [
    summary.duplicate > 0 ? `중복 ${summary.duplicate}개 정리` : "",
    summary.tooShort > 0 ? `너무 짧은 항목 ${summary.tooShort}개 제외` : "",
    summary.truncated > 0 ? `긴 항목 ${summary.truncated}개 축약` : ""
  ].filter(Boolean);

  const node = byId<HTMLElement>("rulesQuality");
  node.textContent = warnings.length
    ? `저장 시 ${summary.kept}개 규칙 적용 · ${warnings.join(" · ")}`
    : `${summary.kept}개 직접 키워드가 실제 필터 점수에 반영됩니다.`;
  node.dataset.tone = warnings.length ? "warn" : "ok";
}

function parseRuleTextarea(id: string): string[] {
  const phrases = byId<HTMLTextAreaElement>(id).value
    .split(/\r?\n/)
    .map((line) => line.trim().slice(0, MAX_RULE_LENGTH))
    .filter((line) => line.length >= MIN_RULE_LENGTH);
  return [...new Set(phrases)].slice(0, MAX_VISIBLE_RULES_PER_LOCALE);
}

function syncRuleTextareas(state: StorageState): void {
  byId<HTMLTextAreaElement>("overrideEn").value = state.ruleOverrides.en.join("\n");
  byId<HTMLTextAreaElement>("overrideKo").value = state.ruleOverrides.ko.join("\n");
  byId<HTMLTextAreaElement>("overrideDefault").value = state.ruleOverrides.default.join("\n");
  updateRuleQuality();
}

function updateSummary(state: StorageState): void {
  const keywordCount = state.ruleOverrides.en.length + state.ruleOverrides.ko.length + state.ruleOverrides.default.length;
  byId<HTMLElement>("enabledSummary").textContent = state.settings.enabled ? t("commonOn") : t("commonOff");
  byId<HTMLElement>("sensitivitySummary").textContent = t(`sensitivityValue${state.settings.sensitivity[0].toUpperCase()}${state.settings.sensitivity.slice(1)}`);
  byId<HTMLElement>("keywordSummary").textContent = String(keywordCount);
  byId<HTMLElement>("voteSummary").textContent = String(Object.keys(state.creatorVotes).length);
}

function getThresholdValidationMessage(): string | null {
  const conservative = getThreshold("conservative");
  const balanced = getThreshold("balanced");
  const aggressive = getThreshold("aggressive");

  if (conservative <= balanced) {
    return t("optionsThresholdOrderErrorLight");
  }
  if (balanced <= aggressive) {
    return t("optionsThresholdOrderErrorStrong");
  }
  return null;
}

function updateThresholdValidation(): boolean {
  const message = getThresholdValidationMessage();
  const node = byId<HTMLElement>("thresholdError");
  node.textContent = message ?? "";
  node.hidden = message === null;
  return message === null;
}

async function render(): Promise<void> {
  setSaveStatus("loading");
  applyI18n();
  const state = await getStorageState();
  latestState = state;
  setThreshold("conservative", state.settings.thresholdOverrides.conservative ?? thresholdFallbacks.conservative);
  setThreshold("balanced", state.settings.thresholdOverrides.balanced ?? thresholdFallbacks.balanced);
  setThreshold("aggressive", state.settings.thresholdOverrides.aggressive ?? thresholdFallbacks.aggressive);
  syncRuleTextareas(state);
  updateSummary(state);
  updateThresholdValidation();
  setSaveStatus("saved");
}

async function save(): Promise<void> {
  if (!updateThresholdValidation()) {
    setSaveStatus("error", t("optionsStatusThresholdInvalid"));
    return;
  }
  setSaveStatus("saving");
  const state = await getStorageState();
  state.settings.thresholdOverrides = {
    conservative: getThreshold("conservative"),
    balanced: getThreshold("balanced"),
    aggressive: getThreshold("aggressive")
  };
  state.ruleOverrides = {
    en: parseRuleTextarea("overrideEn"),
    ko: parseRuleTextarea("overrideKo"),
    default: parseRuleTextarea("overrideDefault")
  };
  const next = migrateStorageState(state);
  await setStorageState(next);
  latestState = next;
  syncRuleTextareas(next);
  updateSummary(next);
  setSaveStatus("saved");
}

function scheduleSave(): void {
  window.clearTimeout(saveTimer);
  if (!updateThresholdValidation()) {
    setSaveStatus("error", t("optionsStatusThresholdInvalid"));
    return;
  }
  saveTimer = window.setTimeout(() => {
    void save().catch(() => setSaveStatus("error"));
  }, 250);
}

function renderExport(state: StorageState): void {
  byId<HTMLElement>("exportOutput").textContent = JSON.stringify(state, null, 2);
}

function setUndoState(previousState: StorageState | null, message = ""): void {
  undoState = previousState;
  byId<HTMLElement>("undoMessage").textContent = message;
  byId<HTMLElement>("undoBanner").hidden = previousState === null;
}

function clearPendingSave(): void {
  window.clearTimeout(saveTimer);
  saveTimer = undefined;
}

function wireEvents(): void {
  for (const sensitivity of Object.keys(sensitivityIds) as Sensitivity[]) {
    const ids = sensitivityIds[sensitivity];
    byId<HTMLInputElement>(ids.range).addEventListener("input", (event) => {
      setThreshold(sensitivity, Number((event.currentTarget as HTMLInputElement).value));
      updateThresholdValidation();
      scheduleSave();
    });
    byId<HTMLInputElement>(ids.number).addEventListener("input", (event) => {
      setThreshold(sensitivity, Number((event.currentTarget as HTMLInputElement).value));
      updateThresholdValidation();
      scheduleSave();
    });
  }

  for (const id of ["overrideEn", "overrideKo", "overrideDefault"]) {
    byId<HTMLTextAreaElement>(id).addEventListener("input", () => {
      updateRuleQuality();
      scheduleSave();
    });
    byId<HTMLTextAreaElement>(id).addEventListener("blur", () => {
      void save().catch(() => setSaveStatus("error"));
    });
  }

  byId<HTMLButtonElement>("exportState").addEventListener("click", async () => {
    const state = await getStorageState();
    latestState = state;
    renderExport(state);
  });

  byId<HTMLButtonElement>("copyState").addEventListener("click", async () => {
    try {
      const state = latestState ?? await getStorageState();
      const text = JSON.stringify(state, null, 2);
      renderExport(state);
      await navigator.clipboard.writeText(text);
      setSaveStatus("saved", t("optionsStatusCopied"));
    } catch {
      setSaveStatus("error", t("optionsStatusCopyFailed"));
    }
  });

  byId<HTMLButtonElement>("downloadState").addEventListener("click", async () => {
    const state = latestState ?? await getStorageState();
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `slopskip-local-data-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    setSaveStatus("saved", t("optionsStatusDownloaded"));
  });

  byId<HTMLButtonElement>("importState").addEventListener("click", () => {
    byId<HTMLInputElement>("importFile").click();
  });

  byId<HTMLInputElement>("importFile").addEventListener("change", async (event) => {
    const file = (event.currentTarget as HTMLInputElement).files?.[0];
    if (!file) return;
    if (!window.confirm(t("optionsImportConfirm"))) {
      byId<HTMLInputElement>("importFile").value = "";
      return;
    }
    try {
      clearPendingSave();
      const previous = await getStorageState();
      const imported = JSON.parse(await file.text()) as Partial<StorageState>;
      const next = migrateStorageState(imported);
      await setStorageState(next);
      renderExport(next);
      await render();
      setUndoState(previous, t("optionsUndoImport"));
      setSaveStatus("saved", t("optionsStatusImported"));
    } catch {
      setSaveStatus("error", t("optionsStatusImportFailed"));
    } finally {
      byId<HTMLInputElement>("importFile").value = "";
    }
  });

  byId<HTMLButtonElement>("clearCreators").addEventListener("click", async () => {
    if (!window.confirm(t("optionsClearCreatorsConfirm"))) return;
    clearPendingSave();
    const state = await getStorageState();
    const previous = migrateStorageState(state);
    state.creatorVotes = {};
    await setStorageState(state);
    latestState = state;
    updateSummary(state);
    renderExport(state);
    setUndoState(previous, t("optionsUndoClearCreators"));
    setSaveStatus("saved", t("optionsStatusCreatorsCleared"));
  });

  byId<HTMLButtonElement>("resetState").addEventListener("click", async () => {
    if (!window.confirm(t("optionsResetDataConfirm"))) return;
    clearPendingSave();
    const previous = await getStorageState();
    const next = createDefaultStorageState();
    await setStorageState(next);
    renderExport(next);
    await render();
    setUndoState(previous, t("optionsUndoReset"));
    setSaveStatus("saved", t("optionsStatusReset"));
  });

  byId<HTMLButtonElement>("undoState").addEventListener("click", async () => {
    if (!undoState) return;
    clearPendingSave();
    const next = undoState;
    await setStorageState(next);
    renderExport(next);
    await render();
    setUndoState(null);
    setSaveStatus("saved", t("optionsStatusUndone"));
  });

  wireHelpPopovers({ maxWidth: 300 });
}

void render().then(wireEvents).catch(() => setSaveStatus("error"));
