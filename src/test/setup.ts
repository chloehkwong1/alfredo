import { vi } from "vitest";

// Mock @tauri-apps/api modules that get imported transitively.
// Tests only exercise pure logic functions, but imports may pull in Tauri IPC.
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  Channel: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(),
  emit: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-store", () => ({
  LazyStore: vi.fn(() => ({
    get: vi.fn(),
    set: vi.fn(),
    save: vi.fn(),
  })),
}));
