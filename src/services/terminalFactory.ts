import { Terminal } from "@xterm/xterm";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { SearchAddon } from "@xterm/addon-search";
import { openUrl } from "@tauri-apps/plugin-opener";
import { writePty } from "../api";
import { loadTerminalPreferences } from "./terminalPreferences";

/**
 * Strip ESC[3J (clear scrollback buffer) sequences from PTY output.
 * Claude Code sends these during TUI re-renders, which wipes xterm's
 * scrollback and makes it impossible to scroll up to earlier output.
 * ESC[2J (clear visible screen) is left intact — the TUI needs it.
 */
export function stripClearScrollback(bytes: Uint8Array): Uint8Array {
  // ESC[3J = 0x1b 0x5b 0x33 0x4a
  const indices: number[] = [];
  for (let i = 0; i <= bytes.length - 4; i++) {
    if (bytes[i] === 0x1b && bytes[i + 1] === 0x5b && bytes[i + 2] === 0x33 && bytes[i + 3] === 0x4a) {
      indices.push(i);
    }
  }
  if (indices.length === 0) return bytes;

  const result = new Uint8Array(bytes.length - indices.length * 4);
  let src = 0;
  let dst = 0;
  for (const idx of indices) {
    const chunk = bytes.subarray(src, idx);
    result.set(chunk, dst);
    dst += chunk.length;
    src = idx + 4;
  }
  if (src < bytes.length) {
    result.set(bytes.subarray(src), dst);
  }
  return result;
}

/**
 * Create a Terminal instance with:
 * - Kitty keyboard protocol support (Shift+Enter for newline in Claude Code)
 * - Clickable links via WebLinksAddon (Cmd+Click to open URLs and file paths)
 *
 * Kitty protocol: xterm.js doesn't natively support the kitty keyboard
 * protocol. Claude Code queries for support via `CSI ? u` — we intercept
 * this in the parser and respond affirmatively so Claude Code enables the
 * protocol. Then our custom key handler sends `CSI 13;2 u` for Shift+Enter,
 * which Claude Code interprets as "insert newline".
 */
export function createTerminal(): { terminal: Terminal; searchAddon: SearchAddon } {
  const prefs = loadTerminalPreferences();
  const terminal = new Terminal({
    allowProposedApi: true,
    scrollback: 10_000,
    fontFamily: `"${prefs.fontFamily}", monospace`,
    fontSize: prefs.fontSize,
    lineHeight: prefs.lineHeight,
    letterSpacing: prefs.letterSpacing,
    cursorStyle: prefs.cursorStyle,
    cursorBlink: prefs.cursorBlink,
    linkHandler: {
      activate(_event: MouseEvent, uri: string) {
        // Only open http(s) links to prevent javascript: or other dangerous URIs
        if (/^https?:\/\//i.test(uri)) {
          openUrl(uri).catch(console.error);
        }
      },
    },
  });

  // Suppress terminal bell sound (BEL character from agent output)
  terminal.onBell(() => { /* noop — suppress system notification */ });

  const unicodeAddon = new Unicode11Addon();
  terminal.loadAddon(unicodeAddon);
  terminal.unicode.activeVersion = "11";

  // ── Clickable links ────────────────────────────────────────────
  const webLinksAddon = new WebLinksAddon((_event, uri) => {
    openUrl(uri).catch(console.error);
  });
  terminal.loadAddon(webLinksAddon);

  // ── Search ─────────────────────────────────────────────────────
  const searchAddon = new SearchAddon();
  terminal.loadAddon(searchAddon);

  // ── Shift+Enter → newline ──────────────────────────────────────
  // Block ALL event types (keydown, keypress, keyup) for Shift+Enter.
  // Only send the kitty sequence on keydown to avoid duplicates.
  terminal.attachCustomKeyEventHandler((event: KeyboardEvent) => {
    // Shift+Enter → send kitty protocol sequence for newline
    if (event.key === "Enter" && event.shiftKey) {
      if (event.type === "keydown") {
        terminal.input("\x1b[13;2u", false);
      }
      return false;
    }
    // Let all Cmd+ shortcuts bubble to app-level handlers
    if (event.metaKey) {
      return false;
    }
    return true;
  });

  return { terminal, searchAddon };
}

/**
 * Select-to-copy: copy the current selection to the clipboard on mouseup,
 * matching iTerm2's "Copy on Select" behaviour. Fires once per drag (on
 * release) instead of continuously during the drag, so clipboard-history
 * tools don't see intermediate states. Keyboard-driven selections (Shift+
 * arrow, Cmd+A) intentionally don't auto-copy — also matches iTerm2.
 *
 * Must be called after `terminal.open()` — `terminal.element` is undefined
 * before then.
 */
export function registerSelectToCopy(terminal: Terminal): void {
  const el = terminal.element;
  if (!el) return;
  el.addEventListener("mouseup", () => {
    const sel = terminal.getSelection();
    if (sel) navigator.clipboard.writeText(sel).catch(console.error);
  });
}

/**
 * Register kitty keyboard protocol handlers on the terminal parser.
 * Must be called after the PTY session is spawned so we have a session ID
 * to send responses back to the PTY.
 *
 * Claude Code sends `CSI ? u` to query keyboard protocol support.
 * We respond with `CSI ? 1 u` (flags=1: disambiguate escape codes).
 * Claude Code then sends `CSI > flags u` to enable — we swallow that.
 */
export function registerKittyProtocol(terminal: Terminal, sessionId: string): void {
  // Query: CSI ? u → respond with current flags
  terminal.parser.registerCsiHandler({ prefix: "?", final: "u" }, () => {
    const response = "\x1b[?1u";
    const bytes = Array.from(new TextEncoder().encode(response));
    writePty(sessionId, bytes).catch(console.error);
    return true;
  });

  // Push (enable): CSI > flags u → swallow (we handle keys in attachCustomKeyEventHandler)
  terminal.parser.registerCsiHandler({ prefix: ">", final: "u" }, () => true);

  // Pop (disable): CSI < flags u → swallow
  terminal.parser.registerCsiHandler({ prefix: "<", final: "u" }, () => true);
}
