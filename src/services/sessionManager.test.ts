import { describe, it, expect } from "vitest";
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
  matchRegistryEntry,
  REGISTRY_TRUST_HOOK_SILENCE_MS,
} from "./sessionChannel";
import type { ClaudeRegistryEntry } from "../types";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { useTabStore } from "../stores/tabStore";
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
