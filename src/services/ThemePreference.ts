export type ColorScheme = "light" | "dark";
const key = "bierrad.colorScheme.v1";
const lightThemeColor = "#f8b928";
const darkThemeColor = "#1b1813";

/** The scheme chosen on this device, or undefined to follow the system. */
export function loadScheme(): ColorScheme | undefined {
  try {
    const value = localStorage.getItem(key);
    return value === "light" || value === "dark" ? value : undefined;
  } catch {
    return undefined;
  }
}
export function saveScheme(scheme: ColorScheme): void {
  try {
    localStorage.setItem(key, scheme);
  } catch {
    /* Storage is optional; the choice then lasts for this window only. */
  }
}
export function systemScheme(): ColorScheme {
  return typeof matchMedia === "function" &&
    matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}
export function applyScheme(scheme: ColorScheme): void {
  document.documentElement.dataset.theme = scheme;
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute(
      "content",
      scheme === "dark" ? darkThemeColor : lightThemeColor,
    );
}

interface ShortcutEvent {
  key: string;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  repeat: boolean;
  target: EventTarget | null;
}
/** D picks dark and L picks light, except while typing or with a modifier. */
export function schemeForKey(event: ShortcutEvent): ColorScheme | undefined {
  if (event.ctrlKey || event.altKey || event.metaKey || event.repeat) return;
  if (isTypingTarget(event.target)) return;
  const key = event.key.toLowerCase();
  return key === "d" ? "dark" : key === "l" ? "light" : undefined;
}
function isTypingTarget(target: EventTarget | null): boolean {
  if (!target || typeof target !== "object") return false;
  const element = target as { tagName?: string; isContentEditable?: boolean };
  return (
    element.isContentEditable === true ||
    ["INPUT", "TEXTAREA", "SELECT"].includes(element.tagName ?? "")
  );
}
