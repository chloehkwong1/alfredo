<p align="center">
  <img src="src-tauri/icons/icon.png" alt="Alfredo" width="128" />
</p>

<h1 align="center">Alfredo</h1>

<p align="center">
  A desktop app for managing AI coding agents.<br/>
  Monitor sessions, review diffs, manage PRs, and control terminals — all from one window.
</p>

<p align="center">
  <a href="../../releases/latest"><img src="https://img.shields.io/github/v/release/chloehkwong1/alfredo?style=flat-square" alt="Latest Release" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/chloehkwong1/alfredo?style=flat-square" alt="License" /></a>
  <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Linux-blue?style=flat-square" alt="Platform" />
</p>

---

<!-- TODO: Replace with actual screenshot -->
<p align="center">
  <em>Screenshot coming soon</em>
</p>

## Features

- **Multi-agent sessions** — Run and monitor multiple AI coding agents side by side
- **Diff review** — Inline diff viewer with syntax highlighting, annotations, and search
- **PR management** — Create, review, and manage GitHub pull requests
- **Integrated terminal** — Full PTY terminals per session via xterm.js
- **Git-aware** — Worktree support, branch management, and GitHub sync
- **Multi-repo** — Work across multiple repositories in one workspace

## Install

Download the latest release for your platform from [Releases](../../releases/latest):

| Platform | Format |
|----------|--------|
| **macOS** (Apple Silicon) | `.dmg` |
| **macOS** (Intel) | `.dmg` |
| **Linux** | `.AppImage` or `.deb` |

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
npm test
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

## License

This project is licensed under the [MIT License](LICENSE).
