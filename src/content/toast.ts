import { TOAST_ID } from "../shared/constants";

let timeoutHandle: number | undefined;
let countdownIntervalHandle: number | undefined;
let countdownTimeoutHandle: number | undefined;
let cleanupInteractiveToast: (() => void) | undefined;

interface CountdownToastOptions {
  getMessage: (secondsLeft: number) => string;
  seconds: number;
  cancelLabel: string;
  onCancel: () => void;
  onExpire: () => void;
}

function ensureToastRoot(): HTMLDivElement {
  let root = document.getElementById(TOAST_ID) as HTMLDivElement | null;
  if (root) {
    return root;
  }

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
    lineHeight: "1.4",
    opacity: "0",
    transition: "opacity 0.18s ease"
  } satisfies Partial<CSSStyleDeclaration>);
  document.documentElement.appendChild(root);
  return root;
}

function clearToastTimers(): void {
  if (timeoutHandle) {
    window.clearTimeout(timeoutHandle);
    timeoutHandle = undefined;
  }
  if (countdownIntervalHandle) {
    window.clearInterval(countdownIntervalHandle);
    countdownIntervalHandle = undefined;
  }
  if (countdownTimeoutHandle) {
    window.clearTimeout(countdownTimeoutHandle);
    countdownTimeoutHandle = undefined;
  }
}

function clearInteractiveToast(): void {
  clearToastTimers();
  cleanupInteractiveToast?.();
  cleanupInteractiveToast = undefined;
}

export function hideToast(): void {
  const root = document.getElementById(TOAST_ID) as HTMLDivElement | null;
  clearInteractiveToast();
  if (root) {
    root.style.opacity = "0";
  }
}

export function showToast(message: string): void {
  const root = ensureToastRoot();
  clearInteractiveToast();

  root.replaceChildren();
  root.textContent = message;
  root.style.opacity = "1";

  timeoutHandle = window.setTimeout(() => {
    root.style.opacity = "0";
  }, 2400);
}

export function showCancelableCountdownToast(options: CountdownToastOptions): void {
  const root = ensureToastRoot();
  clearInteractiveToast();

  const messageEl = document.createElement("div");
  const actionsEl = document.createElement("div");
  const cancelButton = document.createElement("button");

  Object.assign(actionsEl.style, {
    display: "flex",
    justifyContent: "flex-end",
    marginTop: "8px"
  } satisfies Partial<CSSStyleDeclaration>);

  cancelButton.type = "button";
  cancelButton.textContent = options.cancelLabel;
  Object.assign(cancelButton.style, {
    border: "none",
    background: "transparent",
    color: "#fff",
    fontSize: "13px",
    fontWeight: "700",
    cursor: "pointer",
    padding: "0",
    opacity: "0.9"
  } satisfies Partial<CSSStyleDeclaration>);

  const render = (secondsLeft: number) => {
    messageEl.textContent = options.getMessage(secondsLeft);
  };

  let canceled = false;
  render(options.seconds);

  cancelButton.addEventListener("click", () => {
    if (canceled) {
      return;
    }
    canceled = true;
    clearInteractiveToast();
    root.style.opacity = "0";
    options.onCancel();
  });

  actionsEl.appendChild(cancelButton);
  root.replaceChildren(messageEl, actionsEl);
  root.style.opacity = "1";

  let secondsLeft = options.seconds;
  countdownIntervalHandle = window.setInterval(() => {
    secondsLeft -= 1;
    if (secondsLeft > 0) {
      render(secondsLeft);
    }
  }, 1000);

  countdownTimeoutHandle = window.setTimeout(() => {
    if (canceled) {
      return;
    }
    clearInteractiveToast();
    root.style.opacity = "0";
    options.onExpire();
  }, options.seconds * 1000);

  cleanupInteractiveToast = () => {
    root.replaceChildren();
  };
}
