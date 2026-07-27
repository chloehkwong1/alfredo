import { debugLog, setClipboardText } from "../api";

/**
 * Copy text to the system clipboard via the native pasteboard.
 *
 * `navigator.clipboard.writeText` corrupts non-ASCII text (é → √©) when the
 * app is Dock-launched: with no locale in the environment, the WKWebView write
 * path re-decodes the UTF-8 payload as MacRoman. The Rust command writes an
 * explicit NSString instead. Falls back to `navigator.clipboard` where the
 * native command is unavailable (non-macOS builds, tests).
 */
export async function copyText(text: string): Promise<void> {
  try {
    await setClipboardText(text);
  } catch (e) {
    // The webview path corrupts non-ASCII on Dock-launched macOS builds, so a
    // fallback here is worth flagging in alfredo.log.
    debugLog(`copyText: native clipboard write failed, falling back to navigator.clipboard: ${e}`).catch(() => {});
    await navigator.clipboard.writeText(text);
  }
}
