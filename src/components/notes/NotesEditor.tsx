import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { Markdown } from "tiptap-markdown";
import { useEffect } from "react";
import { NotesToolbar } from "./NotesToolbar";

interface NotesEditorProps {
  initialMarkdown: string;
  /** Called with markdown source on each user-driven change. NOT called for programmatic setContent. */
  onMarkdownChange: (markdown: string) => void;
  /** Called once with the editor instance so the container can flush on blur/unmount. */
  onEditorReady?: (editor: Editor) => void;
}

export function NotesEditor({ initialMarkdown, onMarkdownChange, onEditorReady }: NotesEditorProps) {
  const editor = useEditor({
    extensions: [
      StarterKit,
      Underline,
      TaskList,
      TaskItem.configure({ nested: true }),
      Markdown.configure({ html: true, tightLists: true, transformPastedText: true }),
    ],
    content: initialMarkdown,
    editorProps: {
      attributes: {
        class: "tiptap-notes prose prose-invert max-w-none px-6 py-4 min-h-full focus:outline-none",
        "data-placeholder": "Start typing your notes…",
      },
    },
    onUpdate: ({ editor }) => {
      // tiptap-markdown exposes storage.markdown.getMarkdown()
      const md = editor.storage.markdown.getMarkdown();
      onMarkdownChange(md);
    },
  });

  useEffect(() => {
    if (editor && onEditorReady) {
      onEditorReady(editor);
    }
  }, [editor, onEditorReady]);

  return (
    <div className="flex flex-col h-full min-h-0 bg-bg-primary">
      <NotesToolbar editor={editor} />
      <div className="flex-1 min-h-0 overflow-y-auto">
        <EditorContent editor={editor} className="h-full" />
      </div>
    </div>
  );
}
