---
title: Comment chips — reusable diff comment snippets
keywords: [comment chips, snippets, quick insert, prompts, diff comments, annotations, chips]
ui_path: Sidebar → ⚙ Settings → Comment Chips tab
---

**Comment Chips** are short, reusable phrases you find yourself
typing again and again when reviewing a diff — saved as one-click
buttons so you don't have to retype them. They live on the **Comment
Chips** tab of the global Settings dialog.

### When you'd use one

You're scanning a diff, you spot a line that looks off, and you want
to leave a note for the agent (or future-you) to act on. Instead of
typing "can you add a test for this?" for the hundredth time, you
click a chip and the text drops into the comment box.

### Examples of chips people set up

- `Why is this needed?` — flag code that looks unmotivated.
- `Add a test for this.` — ask the agent to write a missing test.
- `Extract this into a helper.` — push back on duplicated logic.
- `Rename this to be clearer.`
- `Is there a simpler way?`
- `Confirm this won't regress {feature}.`

Chips are just plain text — write them in whatever tone and length
matches how you talk to your agent.

### What the tab does

- **Add** a new chip — type the prompt text and hit enter.
- **Edit** any chip inline.
- **Delete** chips you no longer use.
- **Reorder** by dragging — the order here is the order they appear
  in the strip above the diff comment input.

The list starts empty; nothing is pre-filled. Add chips as you
notice yourself repeating the same review note.

### Using a chip

Open any file in the changes panel, click a diff line to start an
annotation, and pick the chip you want from the strip above the
input. The chip's text is inserted as the comment — you can edit it
before submitting, or send as-is.
