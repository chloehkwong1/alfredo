import React from "react";
import ReactDOM from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import App from "./App";
import { startStatusMirror } from "./services/statusMirror";
import { preloadTerminalFonts } from "./services/fontPreload";
import "./styles/globals.css";

// Fast theme apply from cache (avoids flash)
const cachedTheme = localStorage.getItem("alfredo-theme");
if (cachedTheme && cachedTheme !== "warm-dark") {
  document.documentElement.setAttribute("data-theme", cachedTheme);
}
// Match native window chrome (macOS titlebar) to the selected theme.
getCurrentWindow()
  .setTheme(cachedTheme === "light" ? "light" : "dark")
  .catch(() => {});

// Start the single writer for worktree.agentStatus. Must run before any
// session channel fires its first status event.
startStatusMirror();

// Block React mount on bundled terminal fonts so xterm WebGL atlases never
// bake against the fallback font (GH#19).
preloadTerminalFonts().finally(() => {
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
});
