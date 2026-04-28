function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export interface ItemChangeResult {
  changed: boolean;
  currentId?: string;
  elapsedMs: number;
}

export async function waitForItemChange(
  getCurrentId: () => string | undefined,
  previousId: string | undefined,
  timeoutMs = 1600,
  stableMs = 180
): Promise<ItemChangeResult> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const current = getCurrentId();
    if (current && current !== previousId) {
      await wait(stableMs);
      const settled = getCurrentId();
      if (settled && settled === current) {
        return {
          changed: true,
          currentId: settled,
          elapsedMs: Date.now() - started
        };
      }
    }
    await wait(120);
  }

  return {
    changed: false,
    currentId: getCurrentId(),
    elapsedMs: Date.now() - started
  };
}
