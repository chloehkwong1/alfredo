import { RefObject } from "react";

interface CommentChipStripProps {
  chips: string[];
  onInsert: (text: string) => void;
  onAdd: () => void;
  onEditChip: (index: number, e: React.MouseEvent) => void;
  addButtonRef?: RefObject<HTMLButtonElement | null>;
}

const EMPTY_COPY =
  'Save prompts you reuse often — like "check this logic" — and insert them with one click. Right-click a chip later to edit it.';

function CommentChipStrip({
  chips,
  onInsert,
  onAdd,
  onEditChip,
  addButtonRef,
}: CommentChipStripProps) {
  const isEmpty = chips.length === 0;

  if (isEmpty) {
    return (
      <div className="flex-1 min-w-0 flex items-center gap-2">
        <button
          ref={addButtonRef}
          type="button"
          onClick={onAdd}
          title="Add chip"
          className="flex-shrink-0 inline-flex items-center justify-center w-[22px] h-[22px] rounded-full bg-transparent border border-dashed border-border-default text-text-tertiary text-[13px] leading-none cursor-pointer hover:text-text-primary hover:border-border-hover hover:bg-bg-hover"
        >
          ＋
        </button>
        <span className="text-[11px] text-text-tertiary truncate">{EMPTY_COPY}</span>
      </div>
    );
  }

  return (
    <div
      className="relative flex-1 min-w-0 pr-[34px] before:content-[''] before:absolute before:top-0 before:right-[34px] before:bottom-0 before:w-6 before:pointer-events-none before:z-[1] before:bg-gradient-to-r before:from-transparent before:to-bg-elevated"
    >
      <div
        className="flex items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {chips.map((chip, i) => (
          <button
            key={i}
            type="button"
            title={chip}
            onClick={() => onInsert(chip)}
            onContextMenu={(e) => {
              e.preventDefault();
              onEditChip(i, e);
            }}
            className="flex-shrink-0 inline-flex items-center max-w-[180px] px-2.5 py-1 rounded-full bg-bg-primary border border-border-default text-text-secondary text-[11px] leading-none cursor-pointer whitespace-nowrap overflow-hidden text-ellipsis hover:bg-bg-hover hover:border-border-hover hover:text-text-primary transition-colors"
          >
            <span className="overflow-hidden text-ellipsis">{chip}</span>
          </button>
        ))}
      </div>
      <button
        ref={addButtonRef}
        type="button"
        onClick={onAdd}
        title="Add chip"
        className="absolute top-1/2 right-1 -translate-y-1/2 z-[2] flex-shrink-0 inline-flex items-center justify-center w-[22px] h-[22px] rounded-full bg-transparent border border-dashed border-border-default text-text-tertiary text-[13px] leading-none cursor-pointer hover:text-text-primary hover:border-border-hover hover:bg-bg-hover"
      >
        ＋
      </button>
    </div>
  );
}

export { CommentChipStrip };
export type { CommentChipStripProps };
