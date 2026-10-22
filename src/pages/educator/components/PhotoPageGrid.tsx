import {
  Fragment,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type TouchEvent as ReactTouchEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { SortableContext, arrayMove, rectSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

/** One photographed page. `url` is made once when the photo is added and revoked when it leaves. */
export interface PhotoPage {
  id: string;
  file: File;
  url: string;
}

interface PhotoPageGridProps {
  pages: PhotoPage[];
  disabled: boolean;
  onReorder: (next: PhotoPage[]) => void;
  onOpen: (index: number) => void;
  onRemove: (index: number) => void;
}

/*
 * Mouse drags after 8 px; touch drags after a 250 ms hold, so a swipe still scrolls the form and a
 * tap still opens the viewer. No KeyboardSensor: its Esc-to-cancel would also reach Modal's document
 * listener and close the whole upload window. Keyboard users reorder from the viewer instead.
 */
const MOUSE_DISTANCE_PX = 8;
const TOUCH_HOLD_MS = 250;
const TOUCH_TOLERANCE_PX = 8;

/** The click that follows a drop lands on the dropped tile; it must not open the viewer. */
const CLICK_AFTER_DRAG_MS = 300;

const SCREEN_READER_INSTRUCTIONS =
  'Press Enter to view this page full size. Drag it to change its position, or use Move earlier and Move later in the viewer.';

export default function PhotoPageGrid({ pages, disabled, onReorder, onOpen, onRemove }: PhotoPageGridProps) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const lastDropAt = useRef(0);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: MOUSE_DISTANCE_PX } }),
    useSensor(TouchSensor, { activationConstraint: { delay: TOUCH_HOLD_MS, tolerance: TOUCH_TOLERANCE_PX } }),
  );

  const finishDrag = () => {
    setActiveId(null);
    lastDropAt.current = performance.now();
  };

  const handleDragStart = ({ active }: DragStartEvent) => setActiveId(String(active.id));

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    finishDrag();
    if (!over || active.id === over.id) return;
    const from = pages.findIndex((p) => p.id === active.id);
    const to = pages.findIndex((p) => p.id === over.id);
    if (from !== -1 && to !== -1) onReorder(arrayMove(pages, from, to));
  };

  const open = (index: number) => {
    if (disabled || performance.now() - lastDropAt.current < CLICK_AFTER_DRAG_MS) return;
    onOpen(index);
  };

  const activeIndex = activeId ? pages.findIndex((p) => p.id === activeId) : -1;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={finishDrag}
      accessibility={{ screenReaderInstructions: { draggable: SCREEN_READER_INSTRUCTIONS } }}
    >
      <SortableContext items={pages.map((p) => p.id)} strategy={rectSortingStrategy}>
        <div className="grid grid-cols-4 sm:grid-cols-5 gap-2">
          {/* Keyed by the page's own id, never its index, so a reorder moves tiles instead of remounting them. */}
          {pages.map((page, i) => (
            <Fragment key={page.id}>
              <SortableTile
                page={page}
                index={i}
                disabled={disabled}
                onOpen={() => open(i)}
                onRemove={() => onRemove(i)}
              />
            </Fragment>
          ))}
        </div>
      </SortableContext>

      {/* Portalled: the Modal panel is overflow-hidden and animated with a transform, which would clip or offset it. */}
      {createPortal(
        <DragOverlay>
          {activeIndex !== -1 ? <TileFace page={pages[activeIndex]} index={activeIndex} lifted /> : null}
        </DragOverlay>,
        document.body,
      )}
    </DndContext>
  );
}

interface SortableTileProps {
  page: PhotoPage;
  index: number;
  disabled: boolean;
  onOpen: () => void;
  onRemove: () => void;
}

function SortableTile({ page, index, disabled, onOpen, onRemove }: SortableTileProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: page.id,
    disabled,
  });

  const style: CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition,
  };

  // Only the tile itself: Enter on the ✕ inside it must press the ✕.
  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onOpen();
    }
  };

  // The ✕ must neither start a drag nor open the viewer.
  const stop = (e: MouseEvent | ReactTouchEvent) => e.stopPropagation();

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={onOpen}
      onKeyDown={handleKeyDown}
      onContextMenu={(e) => e.preventDefault()}
      aria-label={`Page ${index + 1}: ${page.file.name}. Tap to view, drag to move.`}
      className={`relative touch-manipulation select-none rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-fixed-dim/70 ${
        disabled ? 'cursor-default' : 'cursor-grab active:cursor-grabbing'
      } ${isDragging ? 'opacity-30' : ''}`}
    >
      <TileFace page={page} index={index} />
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
        onMouseDown={stop}
        onTouchStart={stop}
        disabled={disabled}
        className="absolute top-1 right-1 p-1 rounded-md bg-black/70 text-slate-200 hover:text-white hover:bg-black/90 transition-colors disabled:opacity-40"
        aria-label={`Remove page ${index + 1}`}
      >
        <X className="w-3 h-3" />
      </button>
    </div>
  );
}

/** The photo and its page number; shared by the tile in the grid and the copy that follows the pointer. */
function TileFace({ page, index, lifted = false }: { page: PhotoPage; index: number; lifted?: boolean }) {
  return (
    <div
      className={`relative aspect-[3/4] rounded-lg overflow-hidden bg-black/30 border ${
        lifted ? 'border-primary-fixed-dim/70 shadow-2xl scale-105 cursor-grabbing' : 'border-white/10'
      }`}
    >
      <img
        src={page.url}
        alt={`Page ${index + 1}`}
        draggable={false}
        className="w-full h-full object-cover pointer-events-none"
        style={{ WebkitTouchCallout: 'none' }}
      />
      <span className="absolute bottom-1 left-1 px-1.5 py-0.5 rounded bg-black/70 text-white font-sans text-[10px] font-bold">
        {index + 1}
      </span>
    </div>
  );
}
