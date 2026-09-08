import { RefObject, useEffect, useRef, useState } from "react";
import { Diff, ImagePlay, Smile } from "lucide-react";
import { insertAtCursor, buildSuggestionBlock } from "../../../lib/composerText";
import { gifsAvailable } from "../../../api";
import { GifPickerPopover } from "./GifPickerPopover";
import { EmojiPickerPopover } from "./EmojiPickerPopover";

interface ComposerToolbarProps {
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  value: string;
  onChange: (next: string) => void;
  /** When set, show the suggestion button; inserts a ```suggestion fence with this text. */
  suggestionText?: string | null;
}

const TOOLBAR_BUTTON_CLASS =
  "inline-flex items-center justify-center w-[22px] h-[22px] rounded-md bg-transparent border border-transparent text-text-tertiary hover:text-text-primary hover:bg-bg-hover cursor-pointer";

function ComposerToolbar({ textareaRef, value, onChange, suggestionText }: ComposerToolbarProps) {
  const [gifAvailable, setGifAvailable] = useState(false);
  const [openPopover, setOpenPopover] = useState<"gif" | "emoji" | null>(null);
  const gifButtonRef = useRef<HTMLButtonElement>(null);
  const emojiButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let cancelled = false;
    gifsAvailable()
      .then((available) => {
        if (!cancelled) setGifAvailable(available);
      })
      .catch(() => {
        if (!cancelled) setGifAvailable(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function insert(snippet: string) {
    const el = textareaRef.current;
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? value.length;
    const { next, caret } = insertAtCursor(value, start, end, snippet);
    onChange(next);
    requestAnimationFrame(() => {
      const el2 = textareaRef.current;
      if (!el2) return;
      el2.focus();
      el2.setSelectionRange(caret, caret);
    });
  }

  return (
    <div className="flex items-center gap-1">
      {gifAvailable && (
        <button
          ref={gifButtonRef}
          type="button"
          onClick={() => setOpenPopover((p) => (p === "gif" ? null : "gif"))}
          title="Insert GIF"
          className={TOOLBAR_BUTTON_CLASS}
        >
          <ImagePlay size={13} />
        </button>
      )}
      <button
        ref={emojiButtonRef}
        type="button"
        onClick={() => setOpenPopover((p) => (p === "emoji" ? null : "emoji"))}
        title="Insert emoji"
        className={TOOLBAR_BUTTON_CLASS}
      >
        <Smile size={13} />
      </button>
      {suggestionText != null && (
        <button
          type="button"
          onClick={() => insert(buildSuggestionBlock(suggestionText))}
          title="Insert suggestion — author can apply it one-click on GitHub"
          className={TOOLBAR_BUTTON_CLASS}
        >
          <Diff size={13} />
        </button>
      )}
      {openPopover === "gif" && (
        <GifPickerPopover
          anchorRef={gifButtonRef}
          onPick={(gif) => insert(`![gif](${gif.url})\n`)}
          onClose={() => setOpenPopover(null)}
        />
      )}
      {openPopover === "emoji" && (
        <EmojiPickerPopover
          anchorRef={emojiButtonRef}
          onPick={(native) => insert(native)}
          onClose={() => setOpenPopover(null)}
        />
      )}
    </div>
  );
}

export { ComposerToolbar };
export type { ComposerToolbarProps };
