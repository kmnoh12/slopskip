import { TOAST_ID } from "../shared/constants";

let timeoutHandle: number | undefined;

export function showToast(message: string): void {
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
    } satisfies Partial<CSSStyleDeclaration>);
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
