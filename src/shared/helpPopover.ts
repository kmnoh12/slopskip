interface HelpPopoverOptions {
  selector?: string;
  maxWidth?: number;
}

let activePopover: HTMLElement | null = null;

function hideHelpPopover(): void {
  document.querySelectorAll("[aria-describedby='helpPopover']").forEach((node) => node.removeAttribute("aria-describedby"));
  activePopover?.remove();
  activePopover = null;
}

function showHelpPopover(anchor: HTMLElement, maxWidth: number): void {
  const text = anchor.title;
  if (!text) return;

  hideHelpPopover();

  const popover = document.createElement("div");
  popover.className = "help-popover";
  popover.id = "helpPopover";
  popover.role = "tooltip";
  popover.textContent = text;
  document.body.append(popover);

  const rect = anchor.getBoundingClientRect();
  const width = Math.min(maxWidth, window.innerWidth - 24);
  popover.style.maxWidth = `${width}px`;
  popover.style.left = `${Math.min(window.innerWidth - width - 12, Math.max(12, rect.left + rect.width / 2 - width / 2))}px`;
  popover.style.top = `${rect.bottom + 8}px`;
  anchor.setAttribute("aria-describedby", popover.id);
  activePopover = popover;
}

export function wireHelpPopovers(options: HelpPopoverOptions = {}): void {
  const selector = options.selector ?? ".help";
  const maxWidth = options.maxWidth ?? 300;

  document.querySelectorAll<HTMLElement>(selector).forEach((helpButton) => {
    helpButton.addEventListener("click", (event) => {
      event.stopPropagation();
      if (activePopover) {
        hideHelpPopover();
        return;
      }
      showHelpPopover(helpButton, maxWidth);
    });
    helpButton.addEventListener("focus", () => showHelpPopover(helpButton, maxWidth));
    helpButton.addEventListener("blur", hideHelpPopover);
    helpButton.addEventListener("mouseenter", () => showHelpPopover(helpButton, maxWidth));
    helpButton.addEventListener("mouseleave", hideHelpPopover);
  });

  document.addEventListener("click", hideHelpPopover);
  window.addEventListener("resize", hideHelpPopover);
  window.addEventListener("scroll", hideHelpPopover, true);
}
