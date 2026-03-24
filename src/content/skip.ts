export async function waitForItemChange(getCurrentId: () => string | undefined, previousId: string | undefined, timeoutMs = 1600): Promise<boolean> {
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
