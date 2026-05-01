import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({
    setZoom: vi.fn().mockResolvedValue(undefined),
  }),
}));

import { loadUiZoom, setUiZoom, zoomIn, zoomOut, zoomReset } from "./uiZoom";

beforeEach(() => {
  localStorage.clear();
});

describe("uiZoom", () => {
  it("defaults to 1.0 when nothing is stored", () => {
    expect(loadUiZoom()).toBe(1.0);
  });

  it("ignores out-of-range stored values and falls back to default", () => {
    localStorage.setItem("alfredo:ui-zoom", "5.0");
    expect(loadUiZoom()).toBe(1.0);
    localStorage.setItem("alfredo:ui-zoom", "-1");
    expect(loadUiZoom()).toBe(1.0);
    localStorage.setItem("alfredo:ui-zoom", "not-a-number");
    expect(loadUiZoom()).toBe(1.0);
  });

  it("clamps zoom-in at 2.0", async () => {
    await setUiZoom(1.95);
    await zoomIn();
    expect(loadUiZoom()).toBe(2.0);
    await zoomIn();
    expect(loadUiZoom()).toBe(2.0);
  });

  it("clamps zoom-out at 0.5", async () => {
    await setUiZoom(0.55);
    await zoomOut();
    expect(loadUiZoom()).toBe(0.5);
    await zoomOut();
    expect(loadUiZoom()).toBe(0.5);
  });

  it("rounds to 0.1 to avoid floating-point drift across many keypresses", async () => {
    await setUiZoom(1.0);
    for (let i = 0; i < 5; i++) await zoomOut();
    expect(loadUiZoom()).toBe(0.5);
    for (let i = 0; i < 10; i++) await zoomIn();
    expect(loadUiZoom()).toBe(1.5);
  });

  it("zoomReset returns to 1.0", async () => {
    await setUiZoom(1.6);
    await zoomReset();
    expect(loadUiZoom()).toBe(1.0);
  });
});
