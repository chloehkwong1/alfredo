---
title: First-run setup — your first five minutes in Alfredo
keywords: [first run, setup, onboarding, getting started, new user, welcome, install]
ui_path: Welcome screen on first launch
---

On first launch Alfredo shows a welcome screen with no repos yet.
The fastest path to something useful:

1. **Add a repo.** Drag a local git folder onto the welcome screen,
   or use the folder picker. Alfredo validates it's a git repo and
   saves it to your global config.
2. **Pick your default agent.** Open Global Settings → Agents and
   choose Claude Code, Codex, or Gemini CLI. Only providers Alfredo
   detected on your `PATH` appear. Set model / permission mode
   defaults while you're there.
3. **Create your first worktree.** Sidebar → **+** button (or ⌘N).
   Start with **New Branch** for a blank-slate experiment, or
   **Branches** to check out something you already have.
4. **Send a prompt.** The worktree tab opens with your chosen agent
   already running. Type a message and hit enter.
5. **Turn on notifications** (optional). Settings → Notifications →
   enable, pick a sound, hit **Test notification** to confirm.

Everything else — stacks, PRs, Linear integration, split view — is
layered on top of this loop. Explore from here.
