import { useEffect, useRef, useState } from "react";

interface AnnotationInputProps {
  onSubmit: (text: string) => void;
  onCancel: () => void;
}

function AnnotationInput({ onSubmit, onCancel }: AnnotationInputProps) {
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && text.trim()) {
      e.preventDefault();
      onSubmit(text.trim());
    } else if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    }
  }

  return (
    <div className="ml-24 mr-4 my-1">
      <input
        ref={inputRef}
        type="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={onCancel}
        placeholder="Add a comment..."
        className="w-full px-3 py-1.5 rounded-md text-xs bg-accent-primary/8 border border-accent-primary/20 text-text-primary placeholder:text-text-tertiary outline-none focus:border-accent-primary/40 focus:ring-1 focus:ring-accent-primary/20"
      />
    </div>
  );
}

export { AnnotationInput };
export type { AnnotationInputProps };
