import { Bold, Italic, Underline, Strikethrough, List, ListOrdered, ListChecks } from "lucide-react";
import type { Editor } from "@tiptap/react";

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
  if (!editor) return null;
  const chain = () => editor.chain().focus();
  return (
    <div className="flex items-center gap-0.5 h-9 px-2 border-b border-border-subtle bg-bg-bar flex-shrink-0">
      <ToolbarButton active={editor.isActive("bold")} onClick={() => chain().toggleBold().run()} ariaLabel="Bold">
        <Bold size={14} />
      </ToolbarButton>
      <ToolbarButton active={editor.isActive("italic")} onClick={() => chain().toggleItalic().run()} ariaLabel="Italic">
        <Italic size={14} />
      </ToolbarButton>
      <ToolbarButton active={editor.isActive("underline")} onClick={() => chain().toggleUnderline().run()} ariaLabel="Underline">
        <Underline size={14} />
      </ToolbarButton>
      <ToolbarButton active={editor.isActive("strike")} onClick={() => chain().toggleStrike().run()} ariaLabel="Strikethrough">
        <Strikethrough size={14} />
      </ToolbarButton>
      <div className="w-px h-4 bg-border-subtle mx-1" />
      <ToolbarButton active={editor.isActive("bulletList")} onClick={() => chain().toggleBulletList().run()} ariaLabel="Bulleted list">
        <List size={14} />
      </ToolbarButton>
      <ToolbarButton active={editor.isActive("orderedList")} onClick={() => chain().toggleOrderedList().run()} ariaLabel="Numbered list">
        <ListOrdered size={14} />
      </ToolbarButton>
      <ToolbarButton active={editor.isActive("taskList")} onClick={() => chain().toggleTaskList().run()} ariaLabel="Task list">
        <ListChecks size={14} />
      </ToolbarButton>
    </div>
  );
}
