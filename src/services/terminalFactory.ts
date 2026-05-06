import { Terminal, ILinkProvider, ILink } from "@xterm/xterm";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { SearchAddon } from "@xterm/addon-search";
import { openUrl, openPath } from "@tauri-apps/plugin-opener";
import { homeDir } from "@tauri-apps/api/path";
import { writePty } from "../api";
import { loadTerminalPreferences } from "./terminalPreferences";

// Resolved lazily on first `~/...` click and cached. Avoids an IPC call at
// module load (which fires in test environments where Tauri isn't running).
let cachedHomeDir: string | null = null;
function ensureHomeDir(): Promise<string> {
  if (cachedHomeDir !== null) return Promise.resolve(cachedHomeDir);
  return homeDir().then((h) => {
    cachedHomeDir = h.replace(/\/$/, "");
    return cachedHomeDir;
  });
}

const TRAILING_PUNCT = /[.,;!?)\]}]$/;

// ── Clickable-text matchers ────────────────────────────────────
// Each pattern is run independently; overlapping matches are resolved by
// preferring the earliest start, then the longest match.
type LinkKind = "url" | "email" | "localhost" | "path";
const LINK_PATTERNS: Array<{ kind: LinkKind; re: RegExp }> = [
  { kind: "url",       re: /(?:https?|ssh|ftp|file|mailto):[^\s"'<>`{}|\\^[\]]+/g },
  { kind: "email",     re: /\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b/g },
  { kind: "localhost", re: /\blocalhost(?::\d+)?(?:\/[^\s"'<>`{}|\\^[\]]*)?/g },
  // Path: leading boundary so we don't match the `/` inside random words;
  // trailing optional `:line[:col]` is handled by stripping in activate.
  { kind: "path",      re: /(?<=^|[\s=(),'"])(?:~|\/)[^\s"'<>`{}|()[\]]+/g },
];

interface RawMatch { start: number; end: number; text: string; kind: LinkKind; }

function findLinks(text: string): RawMatch[] {
  const all: RawMatch[] = [];
  for (const { kind, re } of LINK_PATTERNS) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      let matched = m[0];
      const start = m.index;
      while (matched.length > 0 && TRAILING_PUNCT.test(matched)) {
        matched = matched.slice(0, -1);
      }
      if (matched.length === 0) continue;
      all.push({ start, end: start + matched.length, text: matched, kind });
    }
  }
  all.sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start));
  const dedup: RawMatch[] = [];
  let lastEnd = -1;
  for (const m of all) {
    if (m.start >= lastEnd) {
      dedup.push(m);
      lastEnd = m.end;
    }
  }
  return dedup;
}

async function activateLink(uri: string, kind: LinkKind): Promise<void> {
  try {
    if (kind === "url") {
      await openUrl(uri);
    } else if (kind === "email") {
      await openUrl(`mailto:${uri}`);
    } else if (kind === "localhost") {
      await openUrl(/^https?:\/\//i.test(uri) ? uri : `http://${uri}`);
    } else {
      const cleaned = uri.replace(/:\d+(?::\d+)?$/, "");
      let path = cleaned;
      if (path.startsWith("~/")) {
        const home = await ensureHomeDir();
        path = home + cleaned.slice(1);
      }
      await openPath(path);
    }
  } catch (err) {
    console.error("activateLink failed", { uri, kind }, err);
  }
}

/**
 * Concatenate a logical line across wrapped continuation rows so that links
 * spanning multiple rows (long URLs, long paths) are matched as one unit.
 * Reads each row with translateToString(false) and right-pads to terminal.cols
 * so string-index ↔ (row, col) is plain arithmetic. Wide chars (emoji) shift
 * the mapping by their width-vs-string-length delta — acceptable for v1
 * since URLs / paths / emails are ASCII.
 */
function getLogicalLine(
  terminal: Terminal,
  hoveredRow0: number,
): { topRow: number; text: string; cols: number } | null {
  const buf = terminal.buffer.active;
  let topRow = hoveredRow0;
  while (topRow > 0) {
    const line = buf.getLine(topRow);
    if (!line || !line.isWrapped) break;
    topRow--;
  }
  const startLine = buf.getLine(topRow);
  if (!startLine) return null;
  const cols = terminal.cols;
  const pad = (s: string) => (s.length >= cols ? s.slice(0, cols) : s.padEnd(cols, " "));
  let text = pad(startLine.translateToString(false));
  let row = topRow + 1;
  while (true) {
    const line = buf.getLine(row);
    if (!line || !line.isWrapped) break;
    text += pad(line.translateToString(false));
    row++;
  }
  return { topRow, text, cols };
}

function createTerminalLinkProvider(terminal: Terminal): ILinkProvider {
  return {
    provideLinks(bufferLineNumber: number, callback: (links: ILink[] | undefined) => void) {
      const hoveredRow0 = bufferLineNumber - 1;
      const logical = getLogicalLine(terminal, hoveredRow0);
      if (!logical) { callback(undefined); return; }
      const { topRow, text, cols } = logical;
      const matches = findLinks(text);
      if (matches.length === 0) { callback(undefined); return; }

      const links: ILink[] = [];
      for (const m of matches) {
        const startRow = topRow + Math.floor(m.start / cols);
        const lastIdx = m.end - 1;
        const endRow = topRow + Math.floor(lastIdx / cols);
        if (hoveredRow0 < startRow || hoveredRow0 > endRow) continue;
        const startCol = m.start % cols;
        const endCol = lastIdx % cols;
        const captured = m;
        links.push({
          range: {
            start: { x: startCol + 1, y: startRow + 1 },
            end:   { x: endCol + 1,   y: endRow + 1 },
          },
          text: captured.text,
          activate: (_event, t) => { void activateLink(t, captured.kind); },
        });
      }
      callback(links.length > 0 ? links : undefined);
    },
  };
}

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
 * - Cmd+Click activation for URLs, emails, localhost, and absolute / `~/`
 *   file paths via a custom link provider that joins wrapped continuation
 *   rows so long links spanning multiple rows resolve as one match.
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
  terminal.registerLinkProvider(createTerminalLinkProvider(terminal));

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
 * Select-to-copy: copy the current selection to the clipboard once xterm
 * finalises a mouse-driven selection, matching iTerm2's "Copy on Select".
 * Keyboard-driven selections (Shift+arrow, Cmd+A) intentionally don't
 * auto-copy — also matches iTerm2.
 *
 * Implementation: listen for mousedown on `terminal.element`, and on each
 * one register a one-shot document-level mouseup listener. Listening on
 * `document` (rather than the element) catches releases that happen
 * outside the terminal — common when a drag auto-scrolls the viewport and
 * the cursor ends up over the scrollbar, the next pane, or off the window
 * edge. Gating registration on the element's mousedown keeps us scoped to
 * mouse-initiated selections and avoids reacting to keyboard selections.
 *
 * The mouseup callback queues a microtask before reading the selection;
 * the microtask drains *after* the current task completes, by which point
 * xterm's own document-level mouseup handler has finalised the selection
 * model (xterm registers that via `_addMouseDownListeners` on selection
 * start).
 *
 * Cleanup: each document listener is `{ once: true }`, so it self-removes
 * after firing. After `terminal.dispose()` the element's mousedown
 * listener can no longer fire, so no further document listeners get
 * attached. A listener already in flight from a mousedown that preceded
 * dispose may still fire on the next document mouseup; the try/catch
 * around `getSelection()` keeps that benign — xterm throws on most
 * public methods after disposal.
 *
 * Must be called after `terminal.open()` — `terminal.element` is undefined
 * before then.
 */
export function registerSelectToCopy(terminal: Terminal): void {
  const el = terminal.element;
  if (!el) return;

  el.addEventListener("mousedown", () => {
    document.addEventListener(
      "mouseup",
      () => {
        queueMicrotask(() => {
          let sel: string;
          try {
            sel = terminal.getSelection();
          } catch {
            return;
          }
          if (sel) navigator.clipboard.writeText(sel).catch(console.error);
        });
      },
      { once: true },
    );
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
