import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../api", () => ({
  setPrFileViewed: vi.fn(),
}));

import { togglePrFileViewed } from "./prFileViewed";
import { setPrFileViewed } from "../api";
import { usePrStore } from "../stores/prStore";
import { useToastStore } from "../stores/toastStore";

const WT_ID = "/repo::feature-1";
const REPO_PATH = "/repo";
const NODE_ID = "PR_kwHO";
const PATH = "src/a.ts";

beforeEach(() => {
  vi.mocked(setPrFileViewed).mockReset();
  usePrStore.setState({ reviewedFiles: {} });
  useToastStore.setState({ toasts: [] });
});

describe("togglePrFileViewed", () => {
  it("marks the file reviewed locally once GitHub confirms the mutation", async () => {
    vi.mocked(setPrFileViewed).mockResolvedValue(undefined);

    await togglePrFileViewed(REPO_PATH, NODE_ID, WT_ID, PATH, false);

    expect(setPrFileViewed).toHaveBeenCalledWith(REPO_PATH, NODE_ID, PATH, true);
    expect(usePrStore.getState().reviewedFiles[WT_ID]?.has(PATH)).toBe(true);
  });

  it("unmarks the file when it was already reviewed", async () => {
    usePrStore.setState({ reviewedFiles: { [WT_ID]: new Set([PATH]) } });
    vi.mocked(setPrFileViewed).mockResolvedValue(undefined);

    await togglePrFileViewed(REPO_PATH, NODE_ID, WT_ID, PATH, true);

    expect(setPrFileViewed).toHaveBeenCalledWith(REPO_PATH, NODE_ID, PATH, false);
    expect(usePrStore.getState().reviewedFiles[WT_ID]?.has(PATH)).toBe(false);
  });

  it("leaves local state untouched and shows a toast when the mutation fails", async () => {
    vi.mocked(setPrFileViewed).mockRejectedValue(new Error("network down"));

    await togglePrFileViewed(REPO_PATH, NODE_ID, WT_ID, PATH, false);

    expect(usePrStore.getState().reviewedFiles[WT_ID]?.has(PATH)).toBeFalsy();
    expect(useToastStore.getState().toasts).toHaveLength(1);
    expect(useToastStore.getState().toasts[0].message).toContain("network down");
  });
});
