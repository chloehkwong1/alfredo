import { debugLog, setClipboardText } from "../api";

/**
 * Copy text to the system clipboard via the native pasteboard.
 *
 * On Dock-launched (locale-less) builds, WKWebView re-decodes UTF-8 as
 * MacRoman for both `navigator.clipboard.writeText` and string `invoke` args
 * (é → √©), so the text travels to the Rust command as a byte array — see
 * setClipboardText in api.ts. Falls back to `navigator.clipboard` where the
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
