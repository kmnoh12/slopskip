export function t(key: string, substitutions?: string | string[]): string {
  const translated = chrome.i18n.getMessage(key, substitutions);
  return translated || key;
}

export function applyI18n(root: ParentNode = document): void {
  const nodes = root.querySelectorAll<HTMLElement>("[data-i18n]");
  nodes.forEach((node) => {
    const key = node.dataset.i18n;
    if (!key) return;
    node.textContent = t(key);
  });

  const titleNodes = root.querySelectorAll<HTMLElement>("[data-i18n-title]");
  titleNodes.forEach((node) => {
    const key = node.dataset.i18nTitle;
    if (!key) return;
    node.title = t(key);
  });

  const placeholderNodes = root.querySelectorAll<HTMLElement>("[data-i18n-placeholder]");
  placeholderNodes.forEach((node) => {
    const key = node.dataset.i18nPlaceholder;
    if (!key || !("placeholder" in node)) return;
    (node as HTMLInputElement | HTMLTextAreaElement).placeholder = t(key);
  });
}
