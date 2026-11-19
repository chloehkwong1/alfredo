import { afterEach, describe, it, expect, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import {
  shouldAcceptDetectorState,
  SessionManager,
  computeOrphanSweep,
  registryPollDelay,
  REGISTRY_POLL_BACKOFF_MAX_MS,
  type SweepBackendSession,
} from "./sessionManager";
import { REGISTRY_POLL_INTERVAL_MS } from "./sessionChannel";
import {
  applyRegistryCorrection,
  externalWorkFromRegistry,
  matchRegistryEntry,
  REGISTRY_TRUST_HOOK_SILENCE_MS,
} from "./sessionChannel";
import type { ClaudeRegistryEntry } from "../types";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { useTabStore } from "../stores/tabStore";
import { useSessionStatusStore } from "../stores/sessionStatusStore";
import { ACTIVE_SCROLLBACK, BACKGROUND_SCROLLBACK } from "./terminalFactory";

describe("loadScrollbackOnly tiered-scrollback restore", () => {
  it("raises the cap above the background tier before replaying, so restored history isn't trimmed", async () => {
    const manager = new SessionManager();
    const lines = BACKGROUND_SCROLLBACK + 200;
    const scrollback = btoa("x\r\n".repeat(lines));
    const session = manager.loadScrollbackOnly("wt-sb", "wt-sb", scrollback, "/wt/sb");

    expect(session.terminal.options.scrollback).toBe(ACTIVE_SCROLLBACK);

    // Wait for xterm's async write to flush, then confirm nothing was trimmed.
    await new Promise<void>((resolve) => session.terminal.write("", resolve));
    expect(session.terminal.buffer.active.length).toBeGreaterThan(BACKGROUND_SCROLLBACK);

    await manager.closeAll();
  });

  it("does not let the replayed session's mouse tracking reach the restored tab", async () => {
    const manager = new SessionManager();
    const scrollback = btoa("old output\r\n\x1b[?1000h\x1b[?1002h\x1b[?1003h\x1b[?1006h");
    const session = manager.loadScrollbackOnly("wt-mouse", "wt-mouse", scrollback, "/wt/mouse");

    await new Promise<void>((resolve) => session.terminal.write("", resolve));
    expect(session.terminal.modes.mouseTrackingMode).toBe("none");

    await manager.closeAll();
  });
});

describe("open question lifecycle", () => {
  it("is dropped when a session hibernates", async () => {
    const manager = new SessionManager();
    const s = manager.loadScrollbackOnly("wt-h", "wt-h", undefined, "/wt/h");
    s.sessionId = "pty-h";
    useSessionStatusStore.getState().setSessionQuestion("wt-h", { text: "Which copy?" });
    await manager.hibernateSession("wt-h");
    expect(useSessionStatusStore.getState().questions["wt-h"]).toBeUndefined();
    await manager.closeAll();
  });

  it("is dropped when a session respawns", async () => {
    const manager = new SessionManager();
    manager.loadScrollbackOnly("wt-r", "wt-r", undefined, "/wt/r");
    useSessionStatusStore.getState().setSessionQuestion("wt-r", { text: "Which copy?" });
    await manager.spawnForExisting("wt-r", "wt-r", "/wt/r");
    expect(useSessionStatusStore.getState().questions["wt-r"]).toBeUndefined();
    await manager.closeAll();
  });
});

describe("reloadStaleRenderers", () => {
  it("drops a WebGL renderer loaded at another devicePixelRatio and keeps a current one", async () => {
    const manager = new SessionManager();
    const stale = manager.loadScrollbackOnly("wt-stale", "wt-stale", btoa("x"), "/wt/stale");
    const current = manager.loadScrollbackOnly("wt-current", "wt-current", btoa("x"), "/wt/current");
    const staleAddon = { dispose: vi.fn() };
    const currentAddon = { dispose: vi.fn() };
    Object.assign(stale, { webglAddon: staleAddon, webglLoaded: true, webglDpr: window.devicePixelRatio + 1 });
    Object.assign(current, { webglAddon: currentAddon, webglLoaded: true, webglDpr: window.devicePixelRatio });

    manager.reloadStaleRenderers("test");

    expect(staleAddon.dispose).toHaveBeenCalledOnce();
    expect(stale.webglAddon).toBeNull();
    // Detached terminal: no DOM to load into, so the next attach reloads it.
    expect(stale.webglLoaded).toBe(false);
    expect(currentAddon.dispose).not.toHaveBeenCalled();
    expect(current.webglAddon).toBe(currentAddon);

    await manager.closeAll();
  });
});

describe("shouldAcceptDetectorState", () => {
  it("accepts detector events when hooks are not active", () => {
    expect(shouldAcceptDetectorState(false, 0)).toBe(true);
  });

  it("rejects detector events when hooks are active and fresh", () => {
    expect(shouldAcceptDetectorState(true, Date.now())).toBe(false);
  });

  it("falls back to detector when hooks have been silent for > 60s", () => {
    const stale = Date.now() - 61_000;
    expect(shouldAcceptDetectorState(true, stale)).toBe(true);
  });
});

describe("computeOrphanSweep", () => {
  const shell = (id: string, over: Partial<SweepBackendSession> = {}): SweepBackendSession => ({
    id, sessionType: "shell", worktreePath: `/wt/${id}`, command: "/bin/zsh", ...over,
  });
  const agent = (id: string, over: Partial<SweepBackendSession> = {}): SweepBackendSession => ({
    id, sessionType: "agent", worktreePath: `/wt/${id}`, command: "claude", ...over,
  });
  const quiet = new Set<string>(); // registry reachable, nothing busy

  it("does not close an unclaimed session on first sighting (strike one)", () => {
    const { toClose, nextCandidates } = computeOrphanSweep(
      [shell("a"), shell("b")],
      new Set(["b"]),
      new Set(),
      quiet,
    );
    expect(toClose).toEqual([]);
    expect([...nextCandidates]).toEqual(["a"]);
  });

  it("closes a session unclaimed on two consecutive sweeps", () => {
    const { toClose, nextCandidates } = computeOrphanSweep(
      [shell("a"), shell("b")],
      new Set(["b"]),
      new Set(["a"]),
      quiet,
    );
    expect(toClose).toEqual(["a"]);
    // Closed ids leave the candidate set — a failed close re-earns both strikes.
    expect(nextCandidates.size).toBe(0);
  });

  it("clears a candidate that becomes claimed between sweeps (in-flight spawn/reattach)", () => {
    // Strike one saw "srv" unclaimed; useServer reattached it before strike two.
    const { toClose, nextCandidates } = computeOrphanSweep(
      [shell("srv", { sessionType: "server" })],
      new Set(["srv"]),
      new Set(["srv"]),
      quiet,
    );
    expect(toClose).toEqual([]);
    expect(nextCandidates.size).toBe(0);
  });

  it("drops candidates that disappeared from the backend (closed elsewhere)", () => {
    const { toClose, nextCandidates } = computeOrphanSweep(
      [],
      new Set(),
      new Set(["gone"]),
      quiet,
    );
    expect(toClose).toEqual([]);
    expect(nextCandidates.size).toBe(0);
  });

  it("never closes claimed sessions", () => {
    const { toClose } = computeOrphanSweep(
      [shell("a"), agent("b"), shell("c")],
      new Set(["a", "b", "c"]),
      new Set(["a", "b", "c"]),
      quiet,
    );
    expect(toClose).toEqual([]);
  });

  it("defers an agent whose worktree has a busy registry entry, keeping its strike", () => {
    const { toClose, deferred, nextCandidates } = computeOrphanSweep(
      [agent("a")],
      new Set(),
      new Set(["a"]),
      new Set(["/wt/a"]),
    );
    expect(toClose).toEqual([]);
    expect(deferred).toEqual(["a"]);
    // Strike persists: the first quiet sweep closes it without re-earning.
    expect([...nextCandidates]).toEqual(["a"]);
  });

  it("closes a deferred agent once the registry shows its worktree quiet", () => {
    const { toClose } = computeOrphanSweep(
      [agent("a")],
      new Set(),
      new Set(["a"]),
      quiet,
    );
    expect(toClose).toEqual(["a"]);
  });

  it("defers all agent closes when the registry is unavailable, but still closes shells", () => {
    const { toClose, deferred } = computeOrphanSweep(
      [agent("a"), shell("b")],
      new Set(),
      new Set(["a", "b"]),
      null,
    );
    expect(toClose).toEqual(["b"]);
    expect(deferred).toEqual(["a"]);
  });

  it("applies the busy-gate to shell-typed sessions running an agent command", () => {
    // Background-opened claude tabs were historically spawned without an
    // explicit sessionType and land as "shell" backend-side.
    const mislabeled = shell("a", { command: "claude" });
    const { toClose, deferred } = computeOrphanSweep(
      [mislabeled],
      new Set(),
      new Set(["a"]),
      new Set(["/wt/a"]),
    );
    expect(toClose).toEqual([]);
    expect(deferred).toEqual(["a"]);
  });
});

describe("registryPollDelay", () => {
  it("polls at the base interval while healthy", () => {
    expect(registryPollDelay(0)).toBe(REGISTRY_POLL_INTERVAL_MS);
  });

  it("doubles per consecutive failure", () => {
    expect(registryPollDelay(1)).toBe(REGISTRY_POLL_INTERVAL_MS * 2);
    expect(registryPollDelay(2)).toBe(REGISTRY_POLL_INTERVAL_MS * 4);
    expect(registryPollDelay(3)).toBe(REGISTRY_POLL_INTERVAL_MS * 8);
  });

  it("caps at the ceiling and never disables permanently", () => {
    expect(registryPollDelay(6)).toBe(REGISTRY_POLL_BACKOFF_MAX_MS);
    expect(registryPollDelay(100)).toBe(REGISTRY_POLL_BACKOFF_MAX_MS);
    expect(Number.isFinite(registryPollDelay(10_000))).toBe(true);
  });

  it("stretches ×4 while unfocused, still capped at the ceiling", () => {
    expect(registryPollDelay(0, false)).toBe(REGISTRY_POLL_INTERVAL_MS * 4);   // 15 s → 60 s
    expect(registryPollDelay(2, false)).toBe(REGISTRY_POLL_INTERVAL_MS * 16);  // backoff × 4
    expect(registryPollDelay(6, false)).toBe(REGISTRY_POLL_BACKOFF_MAX_MS);
  });

  it("defaults to the focused rate", () => {
    expect(registryPollDelay(0)).toBe(registryPollDelay(0, true));
    expect(registryPollDelay(0)).toBe(REGISTRY_POLL_INTERVAL_MS);
  });
});

describe("matchRegistryEntry", () => {
  const entry = (over: Partial<ClaudeRegistryEntry> = {}): ClaudeRegistryEntry => ({
    pid: 1, sessionId: "s-1", cwd: "/wt/a", kind: "interactive", status: "idle", ...over,
  });

  it("matches by claude session id first, even when cwd differs", () => {
    const entries = [entry({ sessionId: "s-1", cwd: "/moved" }), entry({ sessionId: "s-2" })];
    expect(matchRegistryEntry(entries, "s-1", "/wt/a")?.sessionId).toBe("s-1");
  });

  it("does NOT fall back to cwd when a known session id is absent from the registry", () => {
    // The claude we knew about is gone — a cwd fallback here would adopt a
    // sibling tab's session and mis-correct this one.
    const entries = [entry({ sessionId: "s-other", cwd: "/wt/a" })];
    expect(matchRegistryEntry(entries, "s-dead", "/wt/a")).toBeNull();
  });

  it("falls back to a unique cwd match when no session id is known", () => {
    const entries = [entry({ sessionId: "s-1", cwd: "/wt/a" }), entry({ sessionId: "s-2", cwd: "/wt/b" })];
    expect(matchRegistryEntry(entries, undefined, "/wt/a")?.sessionId).toBe("s-1");
  });

  it("returns null when the cwd match is ambiguous", () => {
    const entries = [entry({ sessionId: "s-1" }), entry({ sessionId: "s-2" })]; // both cwd /wt/a
    expect(matchRegistryEntry(entries, undefined, "/wt/a")).toBeNull();
  });

  it("returns null when nothing matches", () => {
    expect(matchRegistryEntry([entry()], "s-x", "/wt/z")).toBeNull();
  });
});

describe("externalWorkFromRegistry", () => {
  const worktrees = [{ id: "r::a", path: "/wt/a" }, { id: "r::b", path: "/wt/b" }, { id: "r::c", path: "/wt/c" }];
  const owner = new Map([["pty-a", "r::a"]]);
  const entry = (over: Partial<ClaudeRegistryEntry>): ClaudeRegistryEntry =>
    ({ pid: 1, sessionId: "s", cwd: "/wt/b", kind: "interactive", status: "busy", ...over });

  it("links a child session to the worktree of the session that started it", () => {
    expect(externalWorkFromRegistry([entry({ alfredoSessionId: "pty-a" })], worktrees, owner))
      .toEqual({ "r::b": { worktreeId: "r::a", running: true } });
  });
  it("shows a session with no Alfredo ancestor as outside work", () => {
    expect(externalWorkFromRegistry([entry({ cwd: "/wt/c" })], worktrees, owner)).toEqual({ "r::c": { running: true } });
  });
  it("shows a session whose Alfredo ancestor is not a known session as outside work", () => {
    // A shell tab's pid file, or one written by another Alfredo on this machine.
    expect(externalWorkFromRegistry([entry({ alfredoSessionId: "pty-unknown" })], worktrees, owner))
      .toEqual({ "r::b": { running: true } });
  });
  it("skips a worktree's own session, idle sessions and unknown folders", () => {
    expect(externalWorkFromRegistry([
      entry({ cwd: "/wt/a", alfredoSessionId: "pty-a" }),
      entry({ status: "idle" }),
      entry({ cwd: "/somewhere/else" }),
    ], worktrees, owner)).toEqual({});
  });
  it("skips the folder's own session when two cards share its path", () => {
    const shared = [{ id: "r", path: "/repo" }, { id: "r::main", path: "/repo" }];
    expect(externalWorkFromRegistry([entry({ cwd: "/repo", alfredoSessionId: "pty-m" })], shared, new Map([["pty-m", "r::main"]]))).toEqual({});
  });
  it("counts a waiting session as running", () => {
    expect(externalWorkFromRegistry([entry({ status: "waiting", waitingFor: "permission prompt" })], worktrees, owner))
      .toEqual({ "r::b": { running: true } });
  });
  it("prefers the entry that names a worktree when two sessions work in one worktree", () => {
    const linked = entry({ alfredoSessionId: "pty-a" });
    const outside = entry({ pid: 2, sessionId: "s-2" });
    const expected = { "r::b": { worktreeId: "r::a", running: true } };
    expect(externalWorkFromRegistry([linked, outside], worktrees, owner)).toEqual(expected);
    expect(externalWorkFromRegistry([outside, linked], worktrees, owner)).toEqual(expected);
  });
});

describe("external work in the store", () => {
  afterEach(() => {
    useSessionStatusStore.setState({ external: {}, links: {} });
    useWorkspaceStore.setState({ worktrees: [] });
    vi.mocked(invoke).mockReset();
    vi.mocked(invoke).mockImplementation(() => Promise.resolve());
  });

  it("keeps the same object for an equal snapshot", () => {
    useSessionStatusStore.getState().setExternalWork({ "r::b": { worktreeId: "r::a", running: true } });
    const before = useSessionStatusStore.getState().external;
    useSessionStatusStore.getState().setExternalWork({ "r::b": { worktreeId: "r::a", running: true } });
    expect(useSessionStatusStore.getState().external).toBe(before);
  });
  it("does not notify subscribers for an equal snapshot, empty included", () => {
    const listener = vi.fn();
    const unsubscribe = useSessionStatusStore.subscribe(listener);
    const empty = useSessionStatusStore.getState().external;
    useSessionStatusStore.getState().setExternalWork({});
    expect(useSessionStatusStore.getState().external).toBe(empty);
    useSessionStatusStore.getState().setExternalWork({ "r::b": { running: true } });
    useSessionStatusStore.getState().setExternalWork({ "r::b": { running: true } });
    unsubscribe();
    expect(listener).toHaveBeenCalledTimes(1);
  });
  it("replaces the record when an entry changes or leaves", () => {
    useSessionStatusStore.getState().setExternalWork({ "r::b": { running: true }, "r::c": { running: true } });
    useSessionStatusStore.getState().setExternalWork({ "r::b": { worktreeId: "r::a", running: true }, "r::c": { running: true } });
    expect(useSessionStatusStore.getState().external).toEqual({ "r::b": { worktreeId: "r::a", running: true }, "r::c": { running: true } });
    useSessionStatusStore.getState().setExternalWork({ "r::c": { running: true } });
    expect(useSessionStatusStore.getState().external).toEqual({ "r::c": { running: true } });
  });
  it("clears external work when no session is live", () => {
    const manager = new SessionManager();
    useSessionStatusStore.getState().setExternalWork({ "r::b": { running: true } });
    (manager as any).maybePollRegistry(Date.now());
    expect(useSessionStatusStore.getState().external).toEqual({});
  });
  it("stores the external work of each registry snapshot", async () => {
    const manager = new SessionManager();
    const s = manager.loadScrollbackOnly("r::a", "r::a", undefined, "/wt/a");
    s.sessionId = "pty-a";
    useWorkspaceStore.setState({
      worktrees: [
        { id: "r::a", path: "/wt/a", branch: "a", name: "a" } as any,
        { id: "r::b", path: "/wt/b", branch: "b", name: "b" } as any,
        { id: "r::c", path: "/wt/c", branch: "c", name: "c" } as any,
      ],
    });
    manager.applyRegistrySnapshot(
      [
        { pid: 1, sessionId: "s-a", cwd: "/wt/a", kind: "interactive", status: "busy", alfredoSessionId: "pty-a" },
        { pid: 2, sessionId: "s-b", cwd: "/wt/b", kind: "interactive", status: "busy", alfredoSessionId: "pty-a" },
        { pid: 3, sessionId: "s-c", cwd: "/wt/c", kind: "interactive", status: "waiting", waitingFor: "permission prompt" },
      ],
      Date.now(),
    );
    expect(useSessionStatusStore.getState().external).toEqual({
      "r::b": { worktreeId: "r::a", running: true },
      "r::c": { running: true },
    });
    await manager.closeAll();
  });
  it("clears external work when the session list fails three times in a row", async () => {
    const manager = new SessionManager();
    const s = manager.loadScrollbackOnly("r::a", "r::a", undefined, "/wt/a");
    s.hooksActive = true;
    useSessionStatusStore.getState().setExternalWork({ "r::b": { running: true } });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(invoke).mockImplementation((cmd) =>
      cmd === "poll_claude_registry" ? Promise.reject(new Error("no claude")) : Promise.resolve(),
    );
    for (const failures of [1, 2]) {
      (manager as any).registryPollFailures = failures;
      (manager as any).lastRegistryPollAt = 0;
      (manager as any).maybePollRegistry(Date.now());
      await vi.waitFor(() => expect((manager as any).registryPollInFlight).toBe(false));
      if (failures === 1) expect(useSessionStatusStore.getState().external).toEqual({ "r::b": { running: true } });
    }
    expect(useSessionStatusStore.getState().external).toEqual({});
    warn.mockRestore();
    await manager.closeAll();
  });
  it("clears external work when the last session closes", async () => {
    const manager = new SessionManager();
    manager.loadScrollbackOnly("r::a", "r::a", undefined, "/wt/a");
    useSessionStatusStore.getState().setExternalWork({ "r::b": { running: true } });
    await manager.closeSession("r::a");
    expect(useSessionStatusStore.getState().external).toEqual({});
  });
  it("clears external work with no live session even when no poll is due", () => {
    const manager = new SessionManager();
    const now = Date.now();
    (manager as any).lastRegistryPollAt = now;
    useSessionStatusStore.getState().setExternalWork({ "r::b": { running: true } });
    (manager as any).maybePollRegistry(now);
    expect(useSessionStatusStore.getState().external).toEqual({});
  });
  it("starts no poll before one is due while a session is live, and keeps external work", async () => {
    const manager = new SessionManager();
    manager.loadScrollbackOnly("r::a", "r::a", undefined, "/wt/a").hooksActive = true;
    const now = Date.now();
    (manager as any).lastRegistryPollAt = now;
    useSessionStatusStore.getState().setExternalWork({ "r::b": { running: true } });
    (manager as any).maybePollRegistry(now);
    expect(vi.mocked(invoke)).not.toHaveBeenCalledWith("poll_claude_registry");
    expect(useSessionStatusStore.getState().external).toEqual({ "r::b": { running: true } });
    await manager.closeAll();
  });

  it("moves links and external work when a worktree's id changes", async () => {
    const manager = new SessionManager();
    const s = manager.loadScrollbackOnly("tab-a", "r::a", undefined, "/wt/a");
    useSessionStatusStore.getState().setSessionLinks("tab-a", { "r::b": { agentIds: [], mainIn: true } });
    useSessionStatusStore.getState().setExternalWork({ "r::b": { running: true } });

    manager.rekeyWorktree("r::b", "r::b2");

    expect(s.worktreeId).toBe("r::a");
    expect(useSessionStatusStore.getState().links["tab-a"]).toEqual({ "r::b2": { agentIds: [], mainIn: true } });
    expect(useSessionStatusStore.getState().external).toEqual({ "r::b2": { running: true } });

    const before = useSessionStatusStore.getState();
    manager.rekeyWorktree("r::unknown", "r::other");
    expect(useSessionStatusStore.getState()).toBe(before);
    useSessionStatusStore.getState().clearSessionStatus("tab-a");
  });

  describe("a session list that arrives late", () => {
    const worktreeA = { id: "r::a", path: "/wt/a", branch: "a", name: "a" } as any;
    const worktreeB = { id: "r::b", path: "/wt/b", branch: "b", name: "b" } as any;
    const ownEntry: ClaudeRegistryEntry =
      { pid: 1, sessionId: "s-a", cwd: "/wt/a", kind: "interactive", status: "busy", alfredoSessionId: "pty-a" };
    const outsideEntry: ClaudeRegistryEntry =
      { pid: 2, sessionId: "s-b", cwd: "/wt/b", kind: "interactive", status: "busy" };

    /** A manager with one live session in r::a and a poll in flight; `deliver` resolves the poll. */
    const pollInFlight = () => {
      const manager = new SessionManager();
      const live = manager.loadScrollbackOnly("r::a", "r::a", undefined, "/wt/a");
      live.sessionId = "pty-a";
      live.hooksActive = true;
      useWorkspaceStore.setState({ worktrees: [worktreeA, worktreeB] });
      let resolvePoll!: (entries: ClaudeRegistryEntry[]) => void;
      vi.mocked(invoke).mockImplementation((cmd) =>
        cmd === "poll_claude_registry" ? new Promise((resolve) => { resolvePoll = resolve; }) : Promise.resolve(),
      );
      (manager as any).maybePollRegistry(Date.now());
      const deliver = async (entries: ClaudeRegistryEntry[]) => {
        resolvePoll(entries);
        await vi.waitFor(() => expect((manager as any).registryPollInFlight).toBe(false));
      };
      return { manager, deliver };
    };

    it("is stored while a session is live", async () => {
      const { manager, deliver } = pollInFlight();
      await deliver([ownEntry, outsideEntry]);
      expect(useSessionStatusStore.getState().external).toEqual({ "r::b": { running: true } });
      await manager.closeAll();
    });
    it("is dropped when the last session closed meanwhile", async () => {
      const { manager, deliver } = pollInFlight();
      await manager.closeSession("r::a");
      await deliver([ownEntry, outsideEntry]);
      expect(useSessionStatusStore.getState().external).toEqual({});
    });
    it("is dropped when only a session that is not live is left", async () => {
      const { manager, deliver } = pollInFlight();
      manager.loadScrollbackOnly("r::b", "r::b", undefined, "/wt/b");
      await manager.closeSession("r::a");
      await deliver([ownEntry, outsideEntry]);
      expect(useSessionStatusStore.getState().external).toEqual({});
      await manager.closeAll();
    });
  });
});

describe("applyRegistryCorrection", () => {
  const base = {
    agentState: "busy" as const,
    hooksActive: true,
    ptyExited: false,
    lastHookAt: 1_000,
    workDepth: 0,
    subagentDepth: 0,
    monitorPending: false,
    awaitingAnswer: false,
  };
  // Hooks silent just past the trust threshold.
  const now = 1_000 + REGISTRY_TRUST_HOOK_SILENCE_MS + 1;

  it("forces idle when registry says idle and session shows busy", () => {
    expect(applyRegistryCorrection(base, "idle", now)).toBe("forceIdle");
  });

  it("forces idle when counters are stranded on an already-idle session", () => {
    expect(
      applyRegistryCorrection({ ...base, agentState: "idle", subagentDepth: 2 }, "idle", now),
    ).toBe("forceIdle");
  });

  it("forces idle when a session is stuck on waitingForInput the registry says is gone", () => {
    expect(
      applyRegistryCorrection({ ...base, agentState: "waitingForInput", awaitingAnswer: true }, "idle", now),
    ).toBe("forceIdle");
  });

  it("returns null while hooks are recent (never race the hook channel)", () => {
    expect(applyRegistryCorrection(base, "idle", 1_000 + 5_000)).toBeNull();
  });

  it("returns null for sessions without hooks or with an exited pty", () => {
    expect(applyRegistryCorrection({ ...base, hooksActive: false }, "idle", now)).toBeNull();
    expect(applyRegistryCorrection({ ...base, ptyExited: true }, "idle", now)).toBeNull();
  });

  it("forces waiting when registry says waiting and session shows busy or idle", () => {
    expect(applyRegistryCorrection(base, "waiting", now)).toBe("forceWaiting");
    expect(applyRegistryCorrection({ ...base, agentState: "idle" }, "waiting", now)).toBe("forceWaiting");
  });

  it("does not force waiting when already waitingForInput", () => {
    expect(applyRegistryCorrection({ ...base, agentState: "waitingForInput" }, "waiting", now)).toBeNull();
  });

  it("confirms busy regardless of hook recency", () => {
    expect(applyRegistryCorrection(base, "busy", 1_001)).toBe("confirmBusy");
  });

  it("never corrects an in-sync idle session", () => {
    expect(applyRegistryCorrection({ ...base, agentState: "idle" }, "idle", now)).toBeNull();
  });
});

describe("applyRegistrySnapshot", () => {
  it("rescues a stuck-busy session with stranded counters via cwd join", () => {
    const manager = new SessionManager();
    const s = manager.loadScrollbackOnly("wt-1", "wt-1", undefined, "/wt/a");
    s.hooksActive = true;
    s.agentState = "busy";
    s.subagentDepth = 2;
    s.monitorPending = true;
    s.lastHookAt = Date.now() - 30_000;
    useWorkspaceStore.setState({
      worktrees: [{ id: "wt-1", path: "/wt/a", branch: "main", name: "a" } as any],
    });
    manager.applyRegistrySnapshot(
      [{ pid: 9, sessionId: "sess-x", cwd: "/wt/a", kind: "interactive", status: "idle" }],
      Date.now(),
    );
    expect(s.agentState).toBe("idle");
    expect(s.subagentDepth).toBe(0);
    expect(s.monitorPending).toBe(false);
  });

  it("drops the open question when the registry forces idle", () => {
    const manager = new SessionManager();
    const s = manager.loadScrollbackOnly("wt-q", "wt-q", undefined, "/wt/q");
    s.hooksActive = true;
    s.agentState = "waitingForInput";
    s.lastHookAt = Date.now() - 30_000;
    useSessionStatusStore.getState().setSessionQuestion("wt-q", { text: "Which copy?" });
    useWorkspaceStore.setState({
      worktrees: [{ id: "wt-q", path: "/wt/q", branch: "main", name: "q" } as any],
    });
    manager.applyRegistrySnapshot(
      [{ pid: 9, sessionId: "sess-q", cwd: "/wt/q", kind: "interactive", status: "idle" }],
      Date.now(),
    );
    expect(s.agentState).toBe("idle");
    expect(useSessionStatusStore.getState().questions["wt-q"]).toBeUndefined();
  });

  it("restores clobbered waitingForInput when registry says waiting", () => {
    const manager = new SessionManager();
    const s = manager.loadScrollbackOnly("wt-2", "wt-2", undefined, "/wt/b");
    s.hooksActive = true;
    s.agentState = "busy";
    s.lastHookAt = Date.now() - 30_000;
    useWorkspaceStore.setState({
      worktrees: [{ id: "wt-2", path: "/wt/b", branch: "main", name: "b" } as any],
    });
    manager.applyRegistrySnapshot(
      [{ pid: 9, sessionId: "sess-y", cwd: "/wt/b", kind: "interactive", status: "waiting", waitingFor: "permission prompt" }],
      Date.now(),
    );
    expect(s.agentState).toBe("waitingForInput");
    expect(s.awaitingAnswer).toBe(false); // registry-sourced waiting must NOT pin the flag
  });

  it("stamps lastRegistryBusyAt on busy confirmation and touches nothing else", () => {
    const manager = new SessionManager();
    const s = manager.loadScrollbackOnly("wt-3", "wt-3", undefined, "/wt/c");
    s.hooksActive = true;
    s.agentState = "busy";
    s.workDepth = 1;
    s.lastHookAt = Date.now(); // hooks fresh — busy confirm is exempt from the silence gate
    useWorkspaceStore.setState({
      worktrees: [{ id: "wt-3", path: "/wt/c", branch: "main", name: "c" } as any],
    });
    const now = Date.now();
    manager.applyRegistrySnapshot(
      [{ pid: 9, sessionId: "sess-z", cwd: "/wt/c", kind: "interactive", status: "busy" }],
      now,
    );
    expect(s.lastRegistryBusyAt).toBe(now);
    expect(s.agentState).toBe("busy");
    expect(s.workDepth).toBe(1);
  });

  it("never corrects a codex/gemini tab even when the cwd matches", () => {
    const manager = new SessionManager();
    const s = manager.loadScrollbackOnly("tab-codex", "wt-5", undefined, "/wt/e");
    s.hooksActive = true;
    s.agentState = "busy";
    s.lastHookAt = Date.now() - 30_000;
    useWorkspaceStore.setState({
      worktrees: [{ id: "wt-5", path: "/wt/e", branch: "main", name: "e" } as any],
    });
    useTabStore.setState({
      tabs: { "wt-5": [{ id: "tab-codex", type: "codex" } as any] },
    });
    manager.applyRegistrySnapshot(
      [{ pid: 9, sessionId: "sess-c", cwd: "/wt/e", kind: "interactive", status: "idle" }],
      Date.now(),
    );
    expect(s.agentState).toBe("busy"); // claude registry entry must not touch a codex tab
  });

  it("skips sessions the snapshot cannot unambiguously join", () => {
    const manager = new SessionManager();
    const s = manager.loadScrollbackOnly("wt-4", "wt-4", undefined, "/wt/d");
    s.hooksActive = true;
    s.agentState = "busy";
    s.lastHookAt = Date.now() - 30_000;
    useWorkspaceStore.setState({
      worktrees: [{ id: "wt-4", path: "/wt/d", branch: "main", name: "d" } as any],
    });
    manager.applyRegistrySnapshot(
      [
        { pid: 1, sessionId: "s-1", cwd: "/wt/d", kind: "interactive", status: "idle" },
        { pid: 2, sessionId: "s-2", cwd: "/wt/d", kind: "interactive", status: "idle" },
      ],
      Date.now(),
    );
    expect(s.agentState).toBe("busy"); // ambiguous cwd → no correction
  });
});
