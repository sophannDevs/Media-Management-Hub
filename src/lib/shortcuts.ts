// Keyboard shortcuts of the app shell (UX-06). Pure, so the rules can be tested
// without a browser; the listener is src/components/app/shell/keyboard-shortcuts.tsx.

/** Pages reached with `g` followed by a letter. */
export const GO_TO: { key: string; href: string; label: string }[] = [
  { key: "d", href: "/", label: "Dashboard" },
  { key: "c", href: "/content", label: "Content" },
  { key: "l", href: "/calendar", label: "Content Calendar" },
  { key: "s", href: "/schedule", label: "Schedule" },
  { key: "m", href: "/media", label: "Media Library" },
  { key: "a", href: "/accounts", label: "Social Accounts" },
  { key: "n", href: "/analytics", label: "Analytics" },
  { key: "p", href: "/prompts", label: "AI Prompts" },
  { key: ",", href: "/settings", label: "Settings" },
];

/** Event the Create Content dialog listens for: the shell can't reach into its state. */
export const CREATE_CONTENT_EVENT = "mediaflow:create-content";

/** After `g`, the second key has this long to arrive. */
export const CHORD_TIMEOUT_MS = 1500;

export type ShortcutAction = { type: "search" } | { type: "create" } | { type: "help" } | { type: "chord" } | { type: "go"; href: string; label: string };

/**
 * What a bare key press means. `key` is KeyboardEvent.key as typed (so a capital
 * letter is not "c"); `chordPending` is true right after `g`, when only a
 * destination letter means anything and every other key cancels.
 */
export function interpretKey(key: string, chordPending: boolean): ShortcutAction | null {
  if (chordPending) {
    const to = GO_TO.find((g) => g.key === key);
    return to ? { type: "go", href: to.href, label: to.label } : null;
  }
  switch (key) {
    case "/":
      return { type: "search" };
    case "c":
      return { type: "create" };
    case "?":
      return { type: "help" };
    case "g":
      return { type: "chord" };
    default:
      return null;
  }
}

const TYPING_ROLES = new Set(["textbox", "searchbox", "combobox", "listbox", "spinbutton", "slider"]);

/** True when a key press is going into something you type or pick in, so it is never a shortcut. */
export function isTypingTarget(el: Element | null): boolean {
  if (!el) return false;
  if ((el as HTMLElement).isContentEditable) return true;
  const tag = el.tagName;
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag === "INPUT") return !["button", "checkbox", "radio", "submit", "reset", "image", "file", "range", "color"].includes((el as HTMLInputElement).type);
  const role = el.getAttribute("role");
  return !!role && TYPING_ROLES.has(role);
}

/** Open dialogs, menus and pickers own the keyboard: shortcuts wait until they close (one that is still fading out no longer counts). */
export const OVERLAY_SELECTOR = ["dialog", "alertdialog", "menu", "listbox"].map((r) => `[role="${r}"]:not([data-state="closed"])`).join(", ");

/** The person can turn single-key shortcuts off (WCAG 2.1.4): voice control and screen readers can trigger them by accident. */
export const SHORTCUTS_OFF_KEY = "mediaflow:shortcuts-off";
