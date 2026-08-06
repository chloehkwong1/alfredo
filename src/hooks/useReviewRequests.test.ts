import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { listen } from "@tauri-apps/api/event";
import type { PrStatusWithColumn } from "../types";

vi.mock("../services/reviewRequestFlow", () => ({
  handleReviewRequests: vi.fn(),
  pasteReviewPromptOnActivation: vi.fn(),
}));
vi.mock("./useAppConfig", () => ({
  useAppConfig: vi.fn(),
}));

import { useReviewRequests } from "./useReviewRequests";
import { handleReviewRequests } from "../services/reviewRequestFlow";
import { useAppConfig } from "./useAppConfig";

function Harness() {
  useReviewRequests();
  return null;
}

// Mounts the hook inside a real React tree — there's no @testing-library/react
// in this repo, so this drives react-dom/client + act directly (mirrors what
// renderHook does under the hood).
async function mount(config: Record<string, unknown> | undefined): Promise<Root> {
  vi.mocked(useAppConfig).mockReturnValue({ config } as never);
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(React.createElement(Harness));
  });
  return root;
}

// Captures the listener passed to the mocked `listen("github:pr-update", ...)`
// call and invokes it with a delivered event, as Tauri would.
async function deliverPrUpdate(prs: PrStatusWithColumn[]): Promise<void> {
  const call = vi.mocked(listen).mock.calls[0];
  const callback = call[1] as (event: { payload: { prs: PrStatusWithColumn[] } }) => void;
  await act(async () => {
    callback({ payload: { prs } });
  });
}

describe("useReviewRequests config gate", () => {
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listen).mockResolvedValue(() => {});
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
  });

  it("does not call handleReviewRequests when autoPullReviewRequests is false", async () => {
    root = await mount({ autoPullReviewRequests: false });
    await deliverPrUpdate([]);
    expect(handleReviewRequests).not.toHaveBeenCalled();
  });

  it("calls handleReviewRequests when autoPullReviewRequests is true", async () => {
    root = await mount({ autoPullReviewRequests: true });
    await deliverPrUpdate([]);
    expect(handleReviewRequests).toHaveBeenCalledWith([]);
  });

  it("calls handleReviewRequests when autoPullReviewRequests is undefined (enabled by default)", async () => {
    root = await mount({});
    await deliverPrUpdate([]);
    expect(handleReviewRequests).toHaveBeenCalledWith([]);
  });
});
