import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Terminal } from "@xterm/xterm";
import { registerSelectToCopy } from "./terminalFactory";

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
  let writeText: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    writeText = vi.fn(() => Promise.resolve());
    Object.assign(navigator, {
      clipboard: { writeText },
    });
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
