# Update Alfredo Docs

Sync `docs/features/` with recent changes — propose a `whats-new.md` entry and flag any user-facing surfaces missing a feature doc. Run mid-cycle when shipping a feature, or as part of the release flow.

`docs/features/*.md` ships in the app bundle and feeds in-app Ask Alfredo search, so out-of-date docs immediately mislead users.

## Arguments

- `$ARGUMENTS` — optional version to draft for (e.g. `v0.11.0`). If empty, target the next unreleased version: bump from the latest tag using the heuristic in the `release-alfredo` skill (any `feat:` since last tag → minor; otherwise patch).

## Workflow

### Step 1 — Establish the diff

```bash
# Latest stable tag
LAST_TAG=$(git describe --tags --abbrev=0 --match 'v[0-9]*' --exclude '*-beta*')

# Has whats-new advanced past the last tag?
grep -n "^\*\*v" docs/features/whats-new.md | head -3

# Commits since last tag, split by surface
git log $LAST_TAG..HEAD --no-merges --pretty='%h %s' -- src/ src-tauri/src/commands/
git log $LAST_TAG..HEAD --no-merges --pretty='%h %s' -- docs/features/
```

If the top entry in `whats-new.md` already matches the target version, ask Chloe whether she wants to extend the existing entry or stop.

### Step 2 — Classify commits

For each commit since `$LAST_TAG`, decide:

- **`feat:`** → needs a `whats-new.md` bullet AND a `docs/features/<topic>.md` (new file if the surface is new, edit if the surface evolved).
- **`fix:` / `refactor:` that changes user-visible flow** → needs a doc edit if behaviour drifted; usually a `whats-new.md` bullet under "fixes".
- **`chore:` / `ci:` / `style:` / dep bumps** → skip.

When unsure whether a `fix:` is user-visible, read the diff — anything that touches `src/components/`, sidebar interactions, settings UI, keyboard shortcuts, or default values almost always is.

### Step 3 — Check for missing feature docs

For every new user-facing surface introduced by a `feat:` commit, confirm a matching `docs/features/<topic>.md` exists. If not, propose the file path and a one-paragraph summary based on the diff. Do not write the new doc yet — list it in the proposal so Chloe can adjust the topic split.

### Step 3.5 — Audit pass: keep docs from growing unwieldy

Run a quick health check on `docs/features/` and surface findings inline with the proposal. Don't act unilaterally — list anything actionable so Chloe can decide.

```bash
wc -l docs/features/*.md | sort -n | tail -10
```

Flag for Chloe in the proposal:

- **`whats-new.md` cap: keep last 5 versions only.** When prepending a new entry, drop the oldest version block at the bottom (anything older lives at github.com/chloehkwong1/alfredo/releases). The file should not exceed ~120 lines.
- **Per-doc soft budget: 80 lines.** Any non-`whats-new` doc over 80 lines is a split candidate — propose a topic split, don't auto-rewrite.
- **Overlap candidates.** If two docs cover near-identical ground (e.g. tutorial + reference for the same surface), flag as a possible merge — but defer to Chloe; the Ask Alfredo search benefits from multiple entry points.

### Step 4 — Draft the `whats-new.md` entry

Read the top of `docs/features/whats-new.md` to match the existing format exactly:
- Header: `**vX.Y.Z — YYYY-MM-DD**` (use today's date).
- Bold the headline items (major features), plain bullets for the rest.
- Group by importance, not commit type — lead with what users will notice most.
- Skip chore/dep bumps. Collapse related fixes into a single bullet ("Various fixes: ...").
- Match the tone of recent entries (terse, user-facing, no implementation jargon).

### Step 5 — Present the proposal

Show Chloe in this shape, then wait for confirmation:

```
Target version: v0.11.0
Commits since v0.10.0: <N>

Proposed whats-new.md entry:
---
**v0.11.0 — 2026-04-28**
- ...
---

Existing feature docs needing edits:
- docs/features/<topic>.md — <one-line reason>

Missing feature docs (propose to create):
- docs/features/<new-topic>.md — <one-line summary>

Skipped commits (chore/dep/internal):
- <hash> <subject>

Proceed with edits? (or tell me to adjust)
```

### Step 6 — Apply on confirmation

After Chloe confirms:
1. Prepend the new entry to `docs/features/whats-new.md`. **If the file already has 5 version entries, drop the oldest one in the same edit** so it stays capped.
2. Edit any existing feature docs that drifted.
3. Create new feature docs for any approved missing surfaces, matching the format/frontmatter of sibling files (`title`, `keywords`, `ui_path`).
4. Stage all doc changes:
   ```bash
   git add docs/features/
   git status -- docs/features/
   ```
5. Stop. Let Chloe review the diff and commit — don't commit automatically.

## Notes

- Don't invent features. Every bullet must be backed by a commit in the range.
- Don't restate fixes that have no user-visible effect (logger refactors, internal renames).
- For betas, skip the `whats-new.md` entry — it lands when promoting to stable. Still flag missing feature docs.
