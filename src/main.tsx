import React from "react";
import ReactDOM from "react-dom/client";
import { SessionRoot } from "./SessionRoot";
import { ShortcutHint } from "./components/ShortcutHint";
import {
  applyScheme,
  loadScheme,
  systemScheme,
} from "./services/ThemePreference";
import "./styles.css";
// Before the first render, so the page never flashes the wrong scheme.
applyScheme(loadScheme() ?? systemScheme());
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <SessionRoot />
    <ShortcutHint />
  </React.StrictMode>,
);
