import { RefObject, useEffect, useRef, useState } from "react";
import { Diff, ImagePlay, Smile } from "lucide-react";
import { insertAtCursor, insertBlockAtCursor, buildSuggestionBlock } from "../../../lib/composerText";
import { gifsAvailable } from "../../../api";
import { IconButton } from "../../ui/IconButton";
import { GifPickerPopover } from "./GifPickerPopover";
import { EmojiPickerPopover } from "./EmojiPickerPopover";

interface ComposerToolbarProps {
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  value: string;
  onChange: (next: string) => void;
  /** When set, show the suggestion button; inserts a ```suggestion fence with this text. */
  suggestionText?: string | null;
}

function toolbarButtonClass(active: boolean) {
  // Active colours live on IconButton's `active` prop (className overrides
  // lose to the base classes at equal specificity); only the inactive
  // tertiary tint and the compact sizing belong here.
  return `h-auto w-auto p-1 ${active ? "" : "text-text-tertiary hover:text-text-primary"}`;
}

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

  function insert(snippet: string, { block = false } = {}) {
    const el = textareaRef.current;
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? value.length;
    const insertFn = block ? insertBlockAtCursor : insertAtCursor;
    const { next, caret } = insertFn(value, start, end, snippet);
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
      <IconButton
        ref={emojiButtonRef}
        size="sm"
        label="Insert emoji"
        title="Insert emoji"
        active={openPopover === "emoji"}
        onClick={() => setOpenPopover((p) => (p === "emoji" ? null : "emoji"))}
        className={toolbarButtonClass(openPopover === "emoji")}
      >
        <Smile size={13} />
      </IconButton>
      {suggestionText != null && (
        <IconButton
          size="sm"
          label="Insert suggestion"
          title="Insert suggestion — author can apply it one-click on GitHub"
          onClick={() => insert(buildSuggestionBlock(suggestionText), { block: true })}
          className={toolbarButtonClass(false)}
        >
          <Diff size={13} />
        </IconButton>
      )}
      {/* GIF button renders last: it appears only after the async gifs_available
          answer, and appending keeps the other buttons from shifting under a
          click aimed mid-flight. */}
      {gifAvailable && (
        <IconButton
          ref={gifButtonRef}
          size="sm"
          label="Insert GIF"
          title="Insert GIF"
          active={openPopover === "gif"}
          onClick={() => setOpenPopover((p) => (p === "gif" ? null : "gif"))}
          className={toolbarButtonClass(openPopover === "gif")}
        >
          <ImagePlay size={13} />
        </IconButton>
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
