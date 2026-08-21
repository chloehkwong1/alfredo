import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Terminal } from "@xterm/xterm";
import { registerSelectToCopy, handleTerminalKeyEvent, splitLineSuffix, opensInOsDefaultApp, createTerminal, ACTIVE_SCROLLBACK, BACKGROUND_SCROLLBACK } from "./terminalFactory";
import { copyText } from "../lib/clipboard";

// Copy goes through the native-pasteboard helper (not navigator.clipboard),
// so tests assert against the mocked module.
vi.mock("../lib/clipboard", () => ({
  copyText: vi.fn(() => Promise.resolve()),
}));

interface FakeTerminal {
  element: HTMLElement;
  selection: string;
  disposed: boolean;
  getSelection(): string;
  dispose(): void;
}

function makeFakeTerminal(): FakeTerminal {
  const element = document.createElement("div");
  document.body.appendChild(element);
  const t: FakeTerminal = {
    element,
    selection: "",
    disposed: false,
    getSelection() {
      // Mirror xterm: most public methods throw after dispose().
      if (this.disposed) throw new Error("Terminal has been disposed");
      return this.selection;
    },
    dispose() {
      this.disposed = true;
    },
  };
  return t;
}

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}

describe("registerSelectToCopy", () => {
  const writeText = vi.mocked(copyText);

  beforeEach(() => {
    writeText.mockClear();
    document.body.innerHTML = "";
  });

  it("copies the final selection on mouseup after a drag", async () => {
    const t = makeFakeTerminal();
    registerSelectToCopy(t as unknown as Terminal);

    t.element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    t.selection = "hello world";
    t.element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));

    await flushMicrotasks();

    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith("hello world");
  });

  it("does not copy when mouseup fires without a preceding mousedown (keyboard selection)", async () => {
    const t = makeFakeTerminal();
    registerSelectToCopy(t as unknown as Terminal);

    t.selection = "shouldn't matter";
    t.element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));

    await flushMicrotasks();
    expect(writeText).not.toHaveBeenCalled();
  });

  it("does not copy when the selection is empty after a click (no drag)", async () => {
    const t = makeFakeTerminal();
    registerSelectToCopy(t as unknown as Terminal);

    t.element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    t.selection = "";
    t.element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));

    await flushMicrotasks();
    expect(writeText).not.toHaveBeenCalled();
  });

  it("only copies once per mousedown→mouseup cycle", async () => {
    const t = makeFakeTerminal();
    registerSelectToCopy(t as unknown as Terminal);

    t.element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    t.selection = "first";
    t.element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    await flushMicrotasks();

    // Spurious mouseup with no preceding mousedown should be ignored.
    t.selection = "stale";
    t.element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    await flushMicrotasks();

    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith("first");
  });

  it("reads the selection inside a microtask, not synchronously, so xterm's own mouseup handler runs first", async () => {
    const t = makeFakeTerminal();
    registerSelectToCopy(t as unknown as Terminal);

    t.element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    t.element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));

    // Stand in for xterm's document-level mouseup handler that finalises
    // selection state synchronously after the bubble. Our microtask should
    // observe whatever state is set by the time the event task completes.
    t.selection = "finalised";

    await flushMicrotasks();
    expect(writeText).toHaveBeenCalledWith("finalised");
  });

  it("does not copy if the terminal is disposed mid-drag, before the mouseup fires", async () => {
    const t = makeFakeTerminal();
    registerSelectToCopy(t as unknown as Terminal);

    t.element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    // Session closes mid-drag (e.g. user kills the agent while selecting).
    t.dispose();
    t.selection = "stale after dispose";
    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));

    await flushMicrotasks();
    expect(writeText).not.toHaveBeenCalled();
  });

  it("copies even when the drag ends outside the terminal element (mouseup on document)", async () => {
    const t = makeFakeTerminal();
    registerSelectToCopy(t as unknown as Terminal);

    t.element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    t.selection = "off-edge selection";
    // Drag continues past the terminal's bounds; release happens on a
    // sibling element (e.g. the Changes panel) rather than on `t.element`.
    const outside = document.createElement("div");
    document.body.appendChild(outside);
    outside.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));

    await flushMicrotasks();
    expect(writeText).toHaveBeenCalledWith("off-edge selection");
  });
});

describe("handleTerminalKeyEvent", () => {
  const writeText = vi.mocked(copyText);
  let input: ReturnType<typeof vi.fn>;

  function fakeTerminal(selection = "") {
    input = vi.fn();
    return { getSelection: () => selection, input } as unknown as Terminal;
  }

  function key(
    type: "keydown" | "keyup",
    init: KeyboardEventInit,
  ): { event: KeyboardEvent; preventDefault: ReturnType<typeof vi.fn> } {
    const event = new KeyboardEvent(type, init);
    const preventDefault = vi.fn();
    event.preventDefault = preventDefault;
    return { event, preventDefault };
  }

  beforeEach(() => {
    writeText.mockClear();
  });

  it("copies the selection and suppresses the default on Cmd+C keydown", () => {
    const term = fakeTerminal("copied text");
    const { event, preventDefault } = key("keydown", { metaKey: true, key: "c" });

    const result = handleTerminalKeyEvent(term, event);

    expect(result).toBe(false);
    expect(writeText).toHaveBeenCalledWith("copied text");
    expect(preventDefault).toHaveBeenCalledTimes(1);
  });

  it("still suppresses the beep on Cmd+C with no selection", () => {
    const term = fakeTerminal("");
    const { event, preventDefault } = key("keydown", { metaKey: true, key: "c" });

    const result = handleTerminalKeyEvent(term, event);

    expect(result).toBe(false);
    expect(writeText).not.toHaveBeenCalled();
    expect(preventDefault).toHaveBeenCalledTimes(1);
  });

  it("does not intercept Cmd+Shift+C (changes-panel shortcut) — lets it bubble", () => {
    const term = fakeTerminal("ignored");
    const { event, preventDefault } = key("keydown", { metaKey: true, shiftKey: true, key: "C" });

    const result = handleTerminalKeyEvent(term, event);

    // Returns false so it bubbles, but must NOT copy or preventDefault.
    expect(result).toBe(false);
    expect(writeText).not.toHaveBeenCalled();
    expect(preventDefault).not.toHaveBeenCalled();
  });

  it("only acts on Cmd+C keydown, not keyup", () => {
    const term = fakeTerminal("text");
    const { event, preventDefault } = key("keyup", { metaKey: true, key: "c" });

    const result = handleTerminalKeyEvent(term, event);

    expect(result).toBe(false);
    expect(writeText).not.toHaveBeenCalled();
    expect(preventDefault).not.toHaveBeenCalled();
  });

  it("sends the kitty newline sequence on Shift+Enter keydown", () => {
    const term = fakeTerminal();
    const { event } = key("keydown", { key: "Enter", shiftKey: true });

    const result = handleTerminalKeyEvent(term, event);

    expect(result).toBe(false);
    expect(input).toHaveBeenCalledWith("\x1b[13;2u", false);
  });

  it("passes plain keys through to xterm", () => {
    const term = fakeTerminal();
    const { event } = key("keydown", { key: "a" });

    expect(handleTerminalKeyEvent(term, event)).toBe(true);
  });
});

describe("splitLineSuffix", () => {
  it("splits a :line suffix off a path", () => {
    expect(splitLineSuffix("app/services/foo.rb:162")).toEqual({
      path: "app/services/foo.rb",
      line: 162,
      col: undefined,
    });
  });

  it("splits a :line:col suffix off a path", () => {
    expect(splitLineSuffix("/abs/path/foo.ts:12:34")).toEqual({
      path: "/abs/path/foo.ts",
      line: 12,
      col: 34,
    });
  });

  it("returns the path unchanged when there is no suffix", () => {
    expect(splitLineSuffix("app/services/foo.rb")).toEqual({ path: "app/services/foo.rb" });
  });
});

describe("tiered scrollback", () => {
  it("creates terminals at the background cap (raised only while attached)", () => {
    const { terminal } = createTerminal();
    expect(BACKGROUND_SCROLLBACK).toBeLessThan(ACTIVE_SCROLLBACK);
    expect(terminal.options.scrollback).toBe(BACKGROUND_SCROLLBACK);
    terminal.dispose();
  });

  it("trims the buffer live when scrollback is lowered", async () => {
    const { terminal } = createTerminal();
    terminal.options.scrollback = ACTIVE_SCROLLBACK;

    const lines = BACKGROUND_SCROLLBACK + 500;
    await new Promise<void>((resolve) => {
      terminal.write("x\r\n".repeat(lines), resolve);
    });
    expect(terminal.buffer.active.length).toBeGreaterThan(BACKGROUND_SCROLLBACK + terminal.rows);

    terminal.options.scrollback = BACKGROUND_SCROLLBACK;
    expect(terminal.buffer.active.length).toBeLessThanOrEqual(BACKGROUND_SCROLLBACK + terminal.rows);
    terminal.dispose();
  });
});

describe("opensInOsDefaultApp", () => {
  it("routes data/preview files to the OS default app", () => {
    expect(opensInOsDefaultApp("reports/export.csv")).toBe(true);
    expect(opensInOsDefaultApp("/abs/diagram.PNG")).toBe(true);
    expect(opensInOsDefaultApp("docs/spec.pdf")).toBe(true);
  });

  it("keeps code and unknown extensions in the editor", () => {
    expect(opensInOsDefaultApp("app/services/foo.rb")).toBe(false);
    expect(opensInOsDefaultApp("schema.prisma")).toBe(false);
    expect(opensInOsDefaultApp("no_extension")).toBe(false);
  });
});
