import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Plus, X } from "lucide-react";
import { useAppConfig } from "../../hooks/useAppConfig";

const inputClass = [
  "h-8 w-full px-3 text-[13px]",
  "bg-bg-primary text-text-primary",
  "border border-border-default rounded-[var(--radius-md)]",
  "placeholder:text-text-tertiary",
  "hover:border-border-hover",
  "focus:border-border-focus focus:outline-none focus:ring-1 focus:ring-accent-primary/50",
  "transition-all duration-[var(--transition-fast)]",
].join(" ");

function SectionTitle({ children, first }: { children: React.ReactNode; first?: boolean }) {
  return (
    <div
      className={[
        "text-[11px] font-semibold uppercase tracking-[0.06em] text-text-tertiary mb-3.5",
        first ? "" : "mt-8",
      ].join(" ")}
    >
      {children}
    </div>
  );
}

interface ChipRowProps {
  id: string;
  value: string;
  index: number;
  onCommit: (index: number, value: string) => void;
  onDelete: (index: number) => void;
  registerInput: (index: number, el: HTMLInputElement | null) => void;
}

function ChipRow({ id, value, index, onCommit, onDelete, registerInput }: ChipRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
  });
  const [buffer, setBuffer] = useState(value);

  // Sync buffer if the underlying value changes externally
  useEffect(() => {
    setBuffer(value);
  }, [value]);

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-2 mb-1.5 group"
    >
      <button
        type="button"
        className="flex-shrink-0 h-8 w-6 flex items-center justify-center text-text-tertiary hover:text-text-secondary cursor-grab active:cursor-grabbing touch-none"
        {...attributes}
        {...listeners}
        aria-label="Drag to reorder"
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <input
        ref={(el) => registerInput(index, el)}
        type="text"
        className={inputClass}
        value={buffer}
        placeholder="Chip text"
        onChange={(e) => setBuffer(e.target.value)}
        onBlur={() => {
          if (buffer !== value) onCommit(index, buffer);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            (e.currentTarget as HTMLInputElement).blur();
          } else if (e.key === "Escape") {
            e.preventDefault();
            setBuffer(value);
            (e.currentTarget as HTMLInputElement).blur();
          }
        }}
      />
      <button
        type="button"
        onClick={() => onDelete(index)}
        className="flex-shrink-0 h-8 w-8 flex items-center justify-center text-text-tertiary hover:text-text-primary hover:bg-bg-hover rounded-[var(--radius-md)] transition-colors cursor-pointer"
        aria-label="Delete chip"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

interface CommentChipsSettingsProps {
  focusIndex?: number | null;
  onFocusConsumed?: () => void;
}

function CommentChipsSettings({ focusIndex, onFocusConsumed }: CommentChipsSettingsProps) {
  const { config, setCommentChips } = useAppConfig();
  const chips = useMemo(() => config?.commentChips ?? [], [config?.commentChips]);

  const inputRefs = useRef<Map<number, HTMLInputElement | null>>(new Map());
  const idCounterRef = useRef(0);
  const idsRef = useRef<string[]>([]);

  // Maintain stable ids matching chips length
  if (idsRef.current.length !== chips.length) {
    const next = idsRef.current.slice(0, chips.length);
    while (next.length < chips.length) {
      idCounterRef.current += 1;
      next.push(`chip-${idCounterRef.current}`);
    }
    idsRef.current = next;
  }
  const ids = idsRef.current;

  const registerInput = useCallback((index: number, el: HTMLInputElement | null) => {
    if (el) inputRefs.current.set(index, el);
    else inputRefs.current.delete(index);
  }, []);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const handleCommit = useCallback(
    (index: number, value: string) => {
      const next = [...chips];
      next[index] = value;
      void setCommentChips(next);
    },
    [chips, setCommentChips],
  );

  const handleDelete = useCallback(
    (index: number) => {
      const next = chips.filter((_, i) => i !== index);
      // Drop id at same index to keep alignment
      idsRef.current = idsRef.current.filter((_, i) => i !== index);
      void setCommentChips(next);
    },
    [chips, setCommentChips],
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const oldIndex = ids.indexOf(active.id as string);
      const newIndex = ids.indexOf(over.id as string);
      if (oldIndex < 0 || newIndex < 0) return;
      idsRef.current = arrayMove(ids, oldIndex, newIndex);
      void setCommentChips(arrayMove(chips, oldIndex, newIndex));
    },
    [chips, ids, setCommentChips],
  );

  const handleAdd = useCallback(() => {
    const next = [...chips, ""];
    idCounterRef.current += 1;
    idsRef.current = [...idsRef.current, `chip-${idCounterRef.current}`];
    void setCommentChips(next);
    // Focus new row after render
    requestAnimationFrame(() => {
      const el = inputRefs.current.get(next.length - 1);
      el?.focus();
    });
  }, [chips, setCommentChips]);

  // Deep-link focus
  useEffect(() => {
    if (focusIndex == null) return;
    const raf = requestAnimationFrame(() => {
      const el = inputRefs.current.get(focusIndex);
      if (el) {
        el.focus();
        el.select();
      }
      onFocusConsumed?.();
    });
    return () => cancelAnimationFrame(raf);
  }, [focusIndex, onFocusConsumed]);

  return (
    <div>
      <SectionTitle first>Comment Chips</SectionTitle>
      <p className="text-xs text-text-tertiary mb-3 -mt-2">
        Quick phrases you can drop into agent annotations. Drag to reorder.
      </p>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          {chips.map((chip, i) => (
            <ChipRow
              key={ids[i]}
              id={ids[i]}
              value={chip}
              index={i}
              onCommit={handleCommit}
              onDelete={handleDelete}
              registerInput={registerInput}
            />
          ))}
        </SortableContext>
      </DndContext>
      <button
        type="button"
        onClick={handleAdd}
        className="mt-2 inline-flex items-center gap-1.5 h-8 px-3 text-[13px] text-text-secondary hover:text-text-primary hover:bg-bg-hover rounded-[var(--radius-md)] transition-colors cursor-pointer"
      >
        <Plus className="h-4 w-4" />
        Add chip
      </button>
    </div>
  );
}

export { CommentChipsSettings };
