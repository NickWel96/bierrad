import { useEffect, useState } from "react";
import {
  applyScheme,
  loadScheme,
  saveScheme,
  schemeForKey,
  systemScheme,
  type ColorScheme,
} from "../services/ThemePreference";

/** Follows the system until D or L picks a scheme for this device. */
export function useColorScheme(): [ColorScheme, (scheme: ColorScheme) => void] {
  const [chosen, setChosen] = useState(loadScheme);
  const [system, setSystem] = useState(systemScheme);
  const scheme = chosen ?? system;
  useEffect(() => applyScheme(scheme), [scheme]);
  useEffect(() => {
    if (typeof matchMedia !== "function") return;
    const query = matchMedia("(prefers-color-scheme: dark)");
    const change = () => setSystem(query.matches ? "dark" : "light");
    query.addEventListener("change", change);
    return () => query.removeEventListener("change", change);
  }, []);
  const choose = (next: ColorScheme) => {
    saveScheme(next);
    setChosen(next);
  };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const next = schemeForKey(event);
      if (next) choose(next);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return [scheme, choose];
}

export function ShortcutHint() {
  const [scheme, choose] = useColorScheme();
  return (
    <nav className="shortcut-hint" aria-label="Sneltoetsen">
      <button
        type="button"
        aria-pressed={scheme === "dark"}
        aria-keyshortcuts="D"
        onClick={() => choose("dark")}
      >
        <kbd>D</kbd> donker
      </button>
      <span aria-hidden="true">·</span>
      <button
        type="button"
        aria-pressed={scheme === "light"}
        aria-keyshortcuts="L"
        onClick={() => choose("light")}
      >
        <kbd>L</kbd> licht
      </button>
    </nav>
  );
}
