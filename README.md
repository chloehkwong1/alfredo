<p align="center">
  <img src="src-tauri/icons/icon.png" alt="Alfredo" width="128" />
</p>

<h1 align="center">Alfredo</h1>

<p align="center">
  A desktop app for managing AI coding agents.<br/>
  Run sessions in parallel, review diffs, manage PRs, and control terminals — all from one window.
</p>

<p align="center">
  <a href="../../releases/latest"><img src="https://img.shields.io/github/v/release/chloehkwong1/alfredo?style=flat-square" alt="Latest Release" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/chloehkwong1/alfredo?style=flat-square" alt="License" /></a>
  <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Linux-blue?style=flat-square" alt="Platform" />
</p>

---

<!-- TODO: Replace with real screenshot from seeded fake repos -->
<p align="center">
  <em>Screenshot coming soon</em>
</p>

## Why Alfredo?

Most AI coding tools either wrap agents in a chat UI or leave you juggling terminal tabs. Alfredo gives you the real CLI experience — full PTY terminals per agent — while adding the workspace management, diff review, and PR workflow you'd otherwise be switching between 4 apps to get.

- **Terminal-first** — No chat wrappers. You get the real agent CLI with slash commands, plan mode, and everything else.
- **Multi-agent** — Run Claude Code, Codex CLI, and Gemini CLI side by side in isolated worktrees or branches.
- **One window** — Diffs, PRs, terminals, and a kanban board in a single app instead of VS Code + GitHub + terminal + Linear.

## Supported Agents

| Agent | Status |
|-------|--------|
| [Claude Code](https://docs.anthropic.com/en/docs/claude-code) | Full support — hooks-based state detection |
| [Codex CLI](https://github.com/openai/codex) | Supported — PTY-based state detection |
| [Gemini CLI](https://github.com/google-gemini/gemini-cli) | Supported — PTY-based state detection |

## Features

- **Multi-agent sessions** — Run and monitor multiple AI coding agents side by side
- **Diff review** — Split or unified diffs with Shiki syntax highlighting, annotations, and context expansion
- **PR workflow** — View PR descriptions, check run status, and manage GitHub pull requests
- **Integrated terminal** — Full PTY terminals per session via xterm.js with branded loading screens
- **Git-aware** — Worktree and branch mode support, with background GitHub sync
- **Multi-repo** — Work across multiple repositories in one workspace
- **Command palette** — ⌘+Shift+P to search commands, sessions, and actions
- **Kanban board** — Visual session management synced with GitHub PR state
- **Linear integration** — Link sessions to Linear tickets
- **Keyboard-first** — ⌘+N, ⌘+1-9, arrow navigation, and configurable shortcuts
- **Remote control** — Monitor and manage sessions from your phone via QR code
- **Notifications** — Configurable sound alerts when agents need attention or finish work
- **Ask Alfredo** — Built-in help search over the feature docs, one keystroke from the sidebar

## Status

Alpha — actively developed, expect breaking changes. macOS is the primary target; Linux builds are available but less tested.

## Install

Download the latest release for your platform from [Releases](../../releases/latest):

| Platform | Filename |
|----------|----------|
| **macOS** (Apple Silicon) | `Alfredo_x.x.x_aarch64.dmg` |
| **macOS** (Intel) | `Alfredo_x.x.x_x64.dmg` |
| **Linux** | `Alfredo_x.x.x_amd64.AppImage` or `.deb` |

On first launch Alfredo will ask you to point it at a Git repository and pick an agent — after that, create a worktree from the sidebar and you're running.

## Getting help

- **In the app:** click **Ask Alfredo** in the sidebar toolbar to search the built-in feature docs.
- **Docs:** browse [`docs/features/`](docs/features) — one file per feature, same content that powers Ask Alfredo.
- **Keyboard shortcuts:** `⌘ ⇧ ?` opens the shortcuts overlay.
- **Bugs & feature requests:** open a [GitHub issue](../../issues). If Ask Alfredo couldn't answer something, tag the issue `ask-alfredo-miss` so the gap gets tracked.

## Development

### Prerequisites

- [Node.js](https://nodejs.org/) 20+
- [Rust](https://www.rust-lang.org/tools/install) (stable toolchain)
- [Tauri v2 prerequisites](https://v2.tauri.app/start/prerequisites/) for your platform

### Setup

```bash
git clone https://github.com/chloehkwong1/alfredo.git
cd alfredo
npm install
npm run tauri dev
```

### Build

```bash
npm run tauri build
```

Output lands in `src-tauri/target/release/bundle/`.

### Testing

```bash
npx vitest run
```

## Tech Stack

| Layer | Tech |
|-------|------|
| Shell | Tauri v2 |
| Frontend | React 19, TypeScript, Tailwind CSS 4, Zustand |
| Backend | Rust, Tokio, Axum |
| Terminal | xterm.js, portable-pty |
| Git | git2, Octocrab (GitHub API) |
| UI | Radix UI, Framer Motion, Lucide icons |

## Contributing

Issues and pull requests are welcome. If you're not sure where to start, check the open issues.

## License

This project is licensed under the [MIT License](LICENSE).
