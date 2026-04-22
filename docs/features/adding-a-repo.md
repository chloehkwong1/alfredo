---
title: Adding a repository
keywords: [add repo, new repo, import repo, onboarding, plus icon]
ui_path: Sidebar → + icon next to the repo selector (or ⌘⇧R)
---

To add a git repository to Alfredo, click the **+** icon just to the
right of the repo selector at the top of the sidebar, or press
⌘⇧R. The Add Repository dialog opens with two ways to point Alfredo
at the repo: drag a folder onto the dialog window, or click the folder
picker to browse for one. Either way, Alfredo expects a local git
repository — it will surface an error in the dialog if the path is not
a valid repo.

On first launch, before any repos exist, Alfredo shows a welcome
screen with the same picker, so new users land straight in the flow.
After the repo is added it shows up in the sidebar's repo selector and
you can immediately create worktrees from it. The list of repos lives
in your global Alfredo config, so it persists across restarts. To
remove a repo later, use Repository Settings in the sidebar footer.
