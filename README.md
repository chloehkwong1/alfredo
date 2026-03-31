# Alfredo

A desktop app for managing AI coding agents. Run multiple agents side by side, review diffs, manage PRs, and control terminals — all from one window.

Built with Tauri v2, React 19, and Rust.

## Features

- **Multi-agent sessions** — Run and monitor multiple AI coding agents (Claude Code, Codex, Aider) in parallel, each in its own PTY terminal
- **Agent state detection** — Automatically detects agent status (idle, busy, waiting for input) from terminal output
- **Kanban board** — Organize worktrees into columns (To Do, In Progress, Blocked, Draft PR, Open PR, Needs Review, Done) with automatic PR-based progression
- **Diff review** — Unified and split diff viewer with syntax highlighting (Shiki), inline annotations, expandable context, and search
- **PR management** — Create, review, and merge GitHub pull requests with real-time status sync, check runs, and review comments
- **Integrated terminal** — Full PTY terminals per session via xterm.js with session persistence across app restarts
- **Git-aware** — Worktree support, branch management, commit history, and GitHub sync
- **Multi-repo** — Work across multiple repositories in one workspace
- **Linear integration** — Search issues, create worktrees from Linear tickets
- **Command palette** — Quick access to actions and navigation via keyboard
- **Customizable** — Themes, notification preferences, per-repo agent defaults, and configurable pane layouts

## Install

Download the latest release for your platform from [Releases](../../releases):

- **macOS** — `.dmg` (Apple Silicon & Intel)
- **Linux** — `.AppImage` or `.deb`

## Development

### Prerequisites

- [Node.js](https://nodejs.org/) 20+
- [Rust](https://www.rust-lang.org/tools/install) (stable toolchain)
- [Tauri v2 prerequisites](https://v2.tauri.app/start/prerequisites/) for your platform

### Setup

```bash
git clone git@github.com:chloehkwong1/alfredo.git
cd alfredo
npm install
npm run tauri dev
```

### Scripts

| Command | Description |
|---------|-------------|
| `npm run tauri dev` | Start the app in development mode (Vite + Tauri) |
| `npm run tauri build` | Build distributable for your platform |
| `npm run dev` | Start the Vite dev server only (no Tauri window) |
| `npm run build` | Build the frontend |
| `npm run test` | Run tests (Vitest) |
| `npm run test:watch` | Run tests in watch mode |

Build output lands in `src-tauri/target/release/bundle/`.

### Project Structure

```
src/                    Frontend (React, TypeScript, Tailwind CSS)
├── components/         UI organized by feature area
│   ├── changes/        Diff viewer, PR panel, annotations
│   ├── commandPalette/ Command palette
│   ├── kanban/         Worktree management, kanban board
│   ├── layout/         App shell, pane system
│   ├── onboarding/     First-run setup
│   ├── settings/       Global and per-repo settings
│   ├── sidebar/        Repo selector, agent items
│   ├── terminal/       Terminal view, session resumption
│   └── ui/             Shared UI primitives (Button, Dialog, etc.)
├── hooks/              Custom React hooks
├── stores/             Zustand state stores
├── services/           Session management, syntax highlighting, PR actions
└── types.ts            Shared TypeScript interfaces

src-tauri/              Backend (Rust)
├── src/
│   ├── lib.rs          Tauri setup, plugin init, command registration
│   ├── pty_manager.rs  PTY/terminal lifecycle
│   ├── agent_detector.rs  Agent type & state detection
│   ├── git_manager.rs  Git worktree operations
│   ├── github_manager.rs  GitHub API (PRs, checks, reviews)
│   ├── github_sync.rs  Background PR sync loop
│   ├── state_server.rs HTTP server for agent state callbacks
│   └── commands/       Tauri IPC command handlers
└── tauri.conf.json     Tauri configuration
```

### Configuration

- **Global config** — `~/.alfredo.json` (managed repos, global settings)
- **Per-repo config** — `<repo>/.alfredo.json` (agent defaults, setup scripts)
- **Session data** — `<worktree>/.alfredo/sessions/` (terminal buffers, tab state)

## Git Excludes

The `.gitignore` covers standard project artifacts. If you use Claude Code (or similar AI tools) with git worktrees, add these to `.git/info/exclude` so they're ignored across all worktrees without polluting `.gitignore`:

```
context.md
settings.local.json
```

These files are generated per-worktree and shouldn't be committed.

## Tech Stack

| Layer | Tech |
|-------|------|
| Shell | Tauri v2 |
| Frontend | React 19, TypeScript, Tailwind CSS 4, Zustand |
| Backend | Rust, Tokio, Axum |
| Terminal | xterm.js, portable-pty |
| Git | git2, Octocrab (GitHub API) |
| UI | Radix UI, Framer Motion, Lucide icons, Shiki |
| Testing | Vitest, jsdom |
