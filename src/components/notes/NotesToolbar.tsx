import { Bold, Italic, Underline, Strikethrough, List, ListOrdered, ListChecks } from "lucide-react";
import { useEditorState, type Editor } from "@tiptap/react";

interface NotesToolbarProps {
  editor: Editor | null;
}

interface ToolbarButtonProps {
  active: boolean;
  onClick: () => void;
  ariaLabel: string;
  children: React.ReactNode;
}

function ToolbarButton({ active, onClick, ariaLabel, children }: ToolbarButtonProps) {
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      aria-label={ariaLabel}
      aria-pressed={active}
      className={[
        "h-7 w-7 flex items-center justify-center rounded text-text-secondary hover:text-text-primary hover:bg-bg-elevated transition-colors cursor-pointer",
        active ? "bg-bg-elevated text-text-primary" : "",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

export function NotesToolbar({ editor }: NotesToolbarProps) {
  // Tiptap v3's useEditor doesn't re-render on transactions, so reading
  // editor.isActive() in render gives stale toolbar state. useEditorState
  // subscribes to the editor and re-renders when the active marks change.
  const active = useEditorState({
    editor,
    selector: ({ editor }) => ({
      bold: editor?.isActive("bold") ?? false,
      italic: editor?.isActive("italic") ?? false,
      underline: editor?.isActive("underline") ?? false,
      strike: editor?.isActive("strike") ?? false,
      bulletList: editor?.isActive("bulletList") ?? false,
      orderedList: editor?.isActive("orderedList") ?? false,
      taskList: editor?.isActive("taskList") ?? false,
    }),
  });

  if (!editor || !active) return null;
  const chain = () => editor.chain().focus();
  return (
    <div className="flex items-center gap-0.5 h-9 px-2 border-b border-border-subtle bg-bg-bar flex-shrink-0">
      <ToolbarButton active={active.bold} onClick={() => chain().toggleBold().run()} ariaLabel="Bold">
        <Bold size={14} />
      </ToolbarButton>
      <ToolbarButton active={active.italic} onClick={() => chain().toggleItalic().run()} ariaLabel="Italic">
        <Italic size={14} />
      </ToolbarButton>
      <ToolbarButton active={active.underline} onClick={() => chain().toggleUnderline().run()} ariaLabel="Underline">
        <Underline size={14} />
      </ToolbarButton>
      <ToolbarButton active={active.strike} onClick={() => chain().toggleStrike().run()} ariaLabel="Strikethrough">
        <Strikethrough size={14} />
      </ToolbarButton>
      <div className="w-px h-4 bg-border-subtle mx-1" />
      <ToolbarButton active={active.bulletList} onClick={() => chain().toggleBulletList().run()} ariaLabel="Bulleted list">
        <List size={14} />
      </ToolbarButton>
      <ToolbarButton active={active.orderedList} onClick={() => chain().toggleOrderedList().run()} ariaLabel="Numbered list">
        <ListOrdered size={14} />
      </ToolbarButton>
      <ToolbarButton active={active.taskList} onClick={() => chain().toggleTaskList().run()} ariaLabel="Task list">
        <ListChecks size={14} />
      </ToolbarButton>
    </div>
  );
}
