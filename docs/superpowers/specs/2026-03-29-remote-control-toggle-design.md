# Remote Control Toggle — Design Spec

**Date:** 2026-03-29
**Status:** Approved

## Overview

Add a per-worktree toggle to enable Claude Code's built-in `/remote-control` feature from the Alfredo UI, allowing full two-way mobile companion access to active agent sessions.

## User Flow

1. User sees a remote-control icon on each worktree row in the sidebar
2. Clicking the icon on a worktree with an active Claude session sends `/remote-control` to that session's PTY
3. A contextual bottom bar appears when viewing the RC-active worktree, showing QR code, session URL, and connection status
4. User scans QR / opens URL on phone to continue the session
5. Clicking the icon again (with confirmation) disconnects remote control

## Sidebar Row — Inline Icon

- **Position:** On the worktree row's first line, next to the existing server indicator (equalizer bars icon)
- **Icon:** Phone or broadcast/antenna icon
- **Always visible** on every worktree row
- **Off state:** `text-fg-tertiary` — muted, no effects
- **On state:** `text-accent-primary` (blue accent) with subtle glow effect matching attention-state status dots
- **Disabled state:** `opacity-50 cursor-not-allowed` when no Claude session is running in the worktree. Tooltip: "No active session"
- **Hover tooltip:** "Remote Control: Off" / "Remote Control: On"
- **Click (to enable):** Sends `/remote-control\n` to the PTY, parses output for session URL
- **Click (to disable):** Confirmation prompt, then sends disconnect command

## Contextual Bottom Bar

- **Visibility:** Only shown when the currently-viewed worktree has remote-control active. Slides up with 150-200ms ease-out animation.
- **Height:** 56-64px, compact
- **Background:** `bg-bg-secondary` with top border, consistent with existing panel styling
- **Layout (left to right):**
  - **QR code** — ~64px, generated client-side from session URL
  - **Session URL** — truncated, with copy-to-clipboard button
  - **Status indicator** — "Connected" (green) / "Waiting" (amber) based on whether a device is actively connected
  - **Disconnect button** — secondary/danger style, right-aligned

## Backend Integration

- **No new Rust backend work required** — uses existing PTY write capability
- **Enable:** `write_pty(sessionId, "/remote-control\n")` sends the slash command to the active Claude Code session
- **URL capture:** Parse PTY output stream for the session URL pattern that Claude Code prints after enabling remote-control
- **QR generation:** Client-side from parsed URL (e.g., `qrcode.react` or similar lightweight library)
- **Disable:** Send appropriate disconnect command via PTY, or kill the remote-control sub-process

## State Management

- **Worktree state extension:**
  ```typescript
  remoteControl: {
    active: boolean;
    sessionUrl: string | null;
  }
  ```
- **Frontend-only state** — not persisted across app restarts. Remote-control sessions are transient.
- **Edge cases:**
  - If the Claude session exits while RC is active, clean up RC state
  - If no Claude session is running, icon is disabled

## Out of Scope

- Spawning new Claude Code sessions for remote control
- Persisting RC state across app restarts
- Auto-enabling RC on session start
- Multiple phone connections to the same session (handled by Claude Code itself)
