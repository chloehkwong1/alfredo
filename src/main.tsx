import React from "react";
import ReactDOM from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import App from "./App";
import { startStatusMirror } from "./services/statusMirror";
import { startDockBadgeMirror } from "./services/dockBadge";
import { startHibernateConfigMirror } from "./services/hibernateConfigMirror";
import { preloadTerminalFonts } from "./services/fontPreload";
import { sessionManager } from "./services/sessionManager";
import { isLightTheme } from "./lib/themeMeta";
import "./styles/globals.css";

// Fast theme apply from cache (avoids flash)
const cachedTheme = localStorage.getItem("alfredo-theme");
if (cachedTheme && cachedTheme !== "warm-dark") {
  document.documentElement.setAttribute("data-theme", cachedTheme);
}
// Match native window chrome (macOS titlebar) to the selected theme.
getCurrentWindow()
  .setTheme(isLightTheme(cachedTheme) ? "light" : "dark")
  .catch(() => {});

// Start the single writer for worktree.agentStatus. Must run before any
// session channel fires its first status event.
startStatusMirror();

// Mirror "needs attention" count to the OS dock/taskbar badge.
startDockBadgeMirror();
startHibernateConfigMirror();

// Native backing-scale event: xterm's own matchMedia watch missed a monitor
// plug-in (2026-11-06). Compare on the next frame in case the webview's
// devicePixelRatio lags this event (ordering not verified; the attach
// backstop in usePty covers a miss).
getCurrentWindow()
  .onScaleChanged(() => requestAnimationFrame(() => sessionManager.reloadStaleRenderers("scale-change")))
  .catch(() => {});

// Block React mount on bundled terminal fonts so xterm WebGL atlases never
// bake against the fallback font (GH#19).
preloadTerminalFonts().finally(() => {
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
});
