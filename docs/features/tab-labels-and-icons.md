---
title: Tab labels and agent brand icons
keywords: [tab label, dynamic label, osc title, terminal title, process name, cwd, brand icons, claude icon, codex icon, gemini icon, simple-icons, rename tab, custom label]
ui_path: Pane tab bar at the top of each worktree pane
---

Tabs in the pane tab bar show a **dynamic label** that reflects what's
actually running inside the tab's PTY, not just the static tab type.
For agent tabs (Claude Code / Codex / Gemini) this is the OSC title
the agent emits, so the label follows whatever the agent is doing —
for example, Claude Code prefixes its title with a brand glyph
(e.g. ✱) and updates it as the session progresses. For shell tabs
Alfredo polls the foreground process and current working directory
and renders those in the label, so a `cd` or a long-running command
is visible at a glance.

New and resumed Codex terminals use the **conversation name** as their
dynamic label. Run **`/rename <task name>`** inside Codex to change it;
Alfredo follows the title immediately. Before a conversation has a name,
Codex may display its thread identifier. Existing terminals pick up this
default when restarted.

Alfredo supplies Codex's `tui.terminal_title=["thread"]` launch default.
An explicit title setting in your Codex launch arguments takes precedence.
Use Codex's **`/title`** picker to change title fields in the current
terminal; Alfredo reapplies its launch default next time. See the
[Codex command documentation](https://learn.chatgpt.com/docs/developer-commands?surface=cli)
for `/title` and `/rename`.

A renamed tab (see *Renaming tabs*) overrides the dynamic label. While
a custom name is set, Alfredo ignores OSC title updates and process/cwd
changes — the tab holds its name until you clear it. Clearing it
(committing an empty rename field) hands control back to the dynamic
label. The full label priority is: **custom name** → **dynamic label**
(OSC title / process / cwd) → **static label** (tab type, shown when
the PTY hasn't emitted anything yet).

Tabs are widened to 240px to give the dynamic label room to breathe,
and long labels truncate with an ellipsis.

Agent tabs intentionally omit a type icon next to the dynamic label.
Some agents, such as Claude Code, include a brand glyph in their title;
Codex's conversation-name title is plain text. The brand
icons (monochrome Claude / Codex / Gemini marks, sourced from
simple-icons.org) still appear in the "+" new-tab menu, where no
dynamic label sits beside them, and in anywhere else tabs are
referenced without their live title (e.g. cross-pane drag previews).

You don't need to configure any of this — it's always on. To reorder
tabs, see *Reordering tabs*.
