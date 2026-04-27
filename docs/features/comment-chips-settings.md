---
title: Comment chips — reusable diff comment snippets
keywords: [comment chips, snippets, quick insert, prompts, diff comments, annotations, chips]
ui_path: Sidebar → ⚙ Settings → Comment Chips tab
---

**Comment Chips** are reusable prompt snippets you can insert into a
diff comment with one click. Instead of typing the same review note
over and over, you save it once as a chip and click it whenever you
need it.

They live on the **Comment Chips** tab of the global Settings dialog.

On this tab you can:

- **Add** a new chip with its own label and prompt text.
- **Edit** any existing chip's label or text inline.
- **Delete** a chip you no longer use.
- **Reorder** chips by dragging — the order is how they appear in the
  diff comment strip.

To use a chip, open any file in the changes panel, click on a diff
line to start an annotation, and pick the chip you want from the
strip above the input. The chip's text is inserted as the comment.

**Example chips you might create:**

| Label | Text inserted when clicked |
|---|---|
| Add test | Please add a unit test covering this case. |
| Why? | Why is this approach taken here? A brief comment would help. |
| Nitpick | Nitpick (non-blocking): |
| LGTM | Looks good to me — no changes needed. |
| Move to util | This could be extracted into a shared utility. |

You're not limited to these — the label is just what appears on the
chip button, and the text is whatever you want pasted into the
comment box.
