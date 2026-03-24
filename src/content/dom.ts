export function collectVisibleText(root: ParentNode): string[] {
  const texts = new Set<string>();
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

export function isElementVisible(node: Element): boolean {
  const style = window.getComputedStyle(node as HTMLElement);
  if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
    return false;
  }
  const rect = (node as HTMLElement).getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

export function getViewportScore(node: Element): number {
  const rect = (node as HTMLElement).getBoundingClientRect();
  const width = Math.max(0, Math.min(rect.right, window.innerWidth) - Math.max(rect.left, 0));
  const height = Math.max(0, Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0));
  return width * height;
}

export function normalizeText(text: string | null | undefined): string {
  return (text ?? "").replace(/\s+/g, " ").trim();
}

export function uniqStrings(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.map((value) => normalizeText(value)).filter(Boolean))];
}
