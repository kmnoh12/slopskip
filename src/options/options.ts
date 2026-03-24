import { applyI18n } from "../shared/i18n";
import { getStorageState, setStorageState } from "../shared/storage";

async function render(): Promise<void> {
  applyI18n();
  const state = await getStorageState();
  (document.getElementById("thresholdConservative") as HTMLInputElement).value = String(state.settings.thresholdOverrides.conservative ?? 80);
  (document.getElementById("thresholdBalanced") as HTMLInputElement).value = String(state.settings.thresholdOverrides.balanced ?? 60);
  (document.getElementById("thresholdAggressive") as HTMLInputElement).value = String(state.settings.thresholdOverrides.aggressive ?? 45);
  (document.getElementById("overrideEn") as HTMLTextAreaElement).value = state.ruleOverrides.en.join("\n");
  (document.getElementById("overrideKo") as HTMLTextAreaElement).value = state.ruleOverrides.ko.join("\n");
  (document.getElementById("overrideDefault") as HTMLTextAreaElement).value = state.ruleOverrides.default.join("\n");
}

async function save(): Promise<void> {
  const state = await getStorageState();
  state.settings.thresholdOverrides = {
    conservative: Number((document.getElementById("thresholdConservative") as HTMLInputElement).value || 80),
    balanced: Number((document.getElementById("thresholdBalanced") as HTMLInputElement).value || 60),
    aggressive: Number((document.getElementById("thresholdAggressive") as HTMLInputElement).value || 45)
  };
  state.ruleOverrides = {
    en: (document.getElementById("overrideEn") as HTMLTextAreaElement).value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean),
    ko: (document.getElementById("overrideKo") as HTMLTextAreaElement).value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean),
    default: (document.getElementById("overrideDefault") as HTMLTextAreaElement).value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  };
  await setStorageState(state);
}

function wireEvents(): void {
  for (const id of ["thresholdConservative", "thresholdBalanced", "thresholdAggressive", "overrideEn", "overrideKo", "overrideDefault"]) {
    document.getElementById(id)?.addEventListener("change", () => {
      void save();
    });
  }

  document.getElementById("exportState")?.addEventListener("click", async () => {
    const state = await getStorageState();
    (document.getElementById("exportOutput") as HTMLElement).textContent = JSON.stringify(state, null, 2);
  });
}

void render().then(wireEvents);
