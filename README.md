# Alfredo

A desktop app for managing AI coding agents. Monitor sessions, review diffs, manage PRs, and control terminals — all from one window.

Built with Tauri v2, React 19, and Rust.

## Features

- **Multi-agent sessions** — Run and monitor multiple AI coding agents side by side
- **Diff review** — Inline diff viewer with syntax highlighting, annotations, and search
- **PR management** — Create, review, and manage GitHub pull requests
- **Integrated terminal** — Full PTY terminals per session via xterm.js
- **Git-aware** — Worktree support, branch management, and GitHub sync
- **Multi-repo** — Work across multiple repositories in one workspace

## Install

Download the latest release for your platform from [Releases](../../releases):

- **macOS** — `.dmg` (Apple Silicon & Intel)
- **Linux** — `.AppImage` or `.deb`

## Development

If you want to build from source or contribute:

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

### Build

```bash
npm run tauri build
```

Output lands in `src-tauri/target/release/bundle/`.

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
| UI | Radix UI, Framer Motion, Lucide icons |
