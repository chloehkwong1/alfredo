---
title: Additional Claude launch flags — global and per-repo
keywords: [flags, additional flags, extra flags, launch, cli, arguments, mcp-config, claude command, per-repo, override, settings]
ui_path: Sidebar → ⚙ Settings → Agent tab → Additional flags
---

You can append arbitrary CLI flags to the `claude` command Alfredo
runs when opening a new agent tab — for example `--mcp-config
./mcp.json` or `--dangerously-skip-permissions`.

Two levels:

- **Global** — Settings → **Agent** tab → *Additional flags*. Applies
  to every new Claude tab in every repo.
- **Per-repo** — Repository Settings → **Agent** tab → *Additional
  flags*. When non-blank it **replaces** the global value for that
  repo entirely (it does not append). Leave it blank to fall through
  to the global default.

## Behaviour

- Flags are appended after Alfredo's structured settings (model,
  permission mode, effort, output style), so a flag like `--model`
  in the extra-flags box overrides the structured picker.
- Quoting works like a shell: `--append-system-prompt "be brief"`
  passes one argument. Unbalanced quotes show an inline error and
  block Save until fixed.
- Applies to **new sessions only** — existing tabs keep the flags
  they launched with. Restart a tab to pick up changes.
- A restored tab resumes its own previous conversation even if you
  put `--resume` or `--continue` in the flags — the tab's own session
  takes precedence, so flags can't cross-wire restored tabs.
