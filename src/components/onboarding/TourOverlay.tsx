import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import type { TourStep } from '../../lib/onboarding';

/**
 * The guided tour and tool walkthroughs: a spotlight (getBoundingClientRect + box-shadow) with an
 * explanatory card. No library.
 * - A step whose anchor isn't in the DOM is skipped, so one step list survives every layout.
 * - It resolves the first visible match (nav anchors exist twice: sidebar and mobile drawer).
 * - On a phone, `needsNav` steps ask the layout to open the drawer (see isReachable).
 */

/**
 * Anchor hunting budgets. The settle budget runs from when the tour opened (the page may still be
 * loading); each step also gets a short grace, so a run of missing anchors doesn't stall.
 */
const SETTLE_MS = 700;
const FAST_SKIP_MS = 150;

/** Grace for a `needsNav` step: longer than the drawer's 300ms slide, or sidebar steps would skip mid-slide. */
const NAV_GRACE_MS = 600;

/** Breathing room between the spotlight and the card, and from the viewport. */
const GAP = 12;
const MARGIN = 16;
const CARD_WIDTH = 320;

/** Padding around the highlighted element, so the ring is not flush to it. */
const HALO = 6;

/** How far the card may shrink to avoid covering its target (e.g. beside the mobile drawer). Below this, overlap wins. */
const MIN_CARD_WIDTH = 260;
const MIN_CARD_HEIGHT = 220;

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

/** Whether any ancestor is position: fixed. Walks parentElement (offsetParent is null on fixed elements). */
function inFixedSubtree(el: HTMLElement): boolean {
  let node: HTMLElement | null = el;
  while (node && node !== document.body) {
    if (getComputedStyle(node).position === 'fixed') return true;
    node = node.parentElement;
  }
  return false;
}

/**
 * Whether the student could actually look at this element. offsetParent alone isn't enough: the
 * closed drawer hides by transform, so its links keep a box off-screen. An off-viewport rect only
 * fails when it's inside a fixed element (scrolling can't reach it).
 */
function isReachable(el: HTMLElement): boolean {
  if (el.offsetParent === null) return false;
  const r = el.getBoundingClientRect();
  if (r.width === 0 || r.height === 0) return false;
  const onScreen =
    r.right > 0 && r.left < window.innerWidth && r.bottom > 0 && r.top < window.innerHeight;
  // The expensive walk runs only on the rare off-screen branch.
  return onScreen || !inFixedSubtree(el);
}

/** Fully on screen horizontally; used for needsNav steps to wait until the drawer has finished sliding. */
function isSettledHorizontally(el: HTMLElement): boolean {
  const r = el.getBoundingClientRect();
  return r.left >= 0 && r.right <= window.innerWidth;
}

/** The first match that is actually rendered and actually reachable. */
function findAnchor(name: string, settled = false): HTMLElement | null {
  const nodes = document.querySelectorAll<HTMLElement>(`[data-tour="${name}"]`);
  for (const node of nodes) {
    if (!isReachable(node)) continue;
    if (settled && !isSettledHorizontally(node)) continue;
    return node;
  }
  return null;
}

function measure(el: HTMLElement): Rect {
  const r = el.getBoundingClientRect();
  return {
    top: r.top - HALO,
    left: r.left - HALO,
    width: r.width + HALO * 2,
    height: r.height + HALO * 2,
  };
}

interface TourOverlayProps {
  isOpen: boolean;
/** The steps to run, chosen from TOURS by OnboardingProvider. */
  steps: readonly TourStep[];
  /** Fired by Skip, by the X, by Escape and by Done — all the same action. */
  onClose: () => void;
  /** Reports the anchor that should show example content, or null. Must be called on every step, not just on close. */
  onDemoChange: (anchor: string | null) => void;
  /** Reports whether the step needs the mobile menu open. Same contract as onDemoChange. */
  onNavChange: (needed: boolean) => void;
}

export default function TourOverlay({
  isOpen,
  steps,
  onClose,
  onDemoChange,
  onNavChange,
}: TourOverlayProps) {
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const [cardHeight, setCardHeight] = useState(190);
  /** False while hunting for the anchor; the card renders only after, so skipped steps never flash. */
  const [resolved, setResolved] = useState(false);

  const targetRef = useRef<HTMLElement | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const restoreFocus = useRef<HTMLElement | null>(null);
  /** When this run of the tour opened, for the settle budget above. */
  const openedAt = useRef(0);

  const step = steps[index];
  const isLast = index === steps.length - 1;

  // Reset to the beginning every time it opens, including on a Help replay.
  useEffect(() => {
    if (isOpen) {
      setIndex(0);
      setRect(null);
      setResolved(false);
      openedAt.current = Date.now();
    }
  }, [isOpen]);

  const goNext = useCallback(() => {
    setIndex((i) => {
      if (i >= steps.length - 1) return i;
      return i + 1;
    });
  }, [steps]);

  const goBack = useCallback(() => setIndex((i) => Math.max(0, i - 1)), []);

  // Request the mobile menu for this step. The cleanup ensures an unmount mid-step can't leave the
  // drawer open.
  useEffect(() => {
    if (!isOpen || !step) {
      onNavChange(false);
      return;
    }
    onNavChange(step.needsNav === true);
    return () => onNavChange(false);
  }, [isOpen, step, onNavChange]);

  // Acquire the step's anchor, retrying briefly because the page may still be loading.
  useEffect(() => {
    if (!isOpen || !step) return;

    // Clear the rect before hunting, so a missing anchor never inherits the previous step's spotlight.
    // `resolved` gates the card.
    setResolved(false);
    setRect(null);

    if (step.anchor === null) {
      targetRef.current = null;
      setResolved(true);
      return;
    }

    let cancelled = false;
    let frame = 0;
    // The later of the tour's settle window and this step's grace.
    const grace = step.needsNav ? NAV_GRACE_MS : FAST_SKIP_MS;
    const deadline = Math.max(openedAt.current + SETTLE_MS, Date.now() + grace);

    const attempt = () => {
      if (cancelled) return;

      // needsNav steps also wait for the target to stop moving (the drawer slides in).
      const el = findAnchor(step.anchor!, step.needsNav === true);
      if (el) {
        targetRef.current = el;
        el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
        // One frame for the scroll to start; the scroll listener keeps it correct after.
        frame = requestAnimationFrame(() => {
          if (cancelled) return;
          setRect(measure(el));
          setResolved(true);
        });
        return;
      }

      if (Date.now() >= deadline) {
        // Give up on this step rather than dim around nothing.
        targetRef.current = null;
        if (index >= steps.length - 1) onClose();
        else setIndex((i) => i + 1);
        return;
      }

      frame = requestAnimationFrame(attempt);
    };

    attempt();

    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  }, [isOpen, index, step, steps.length, onClose]);

  // Keep the spotlight on the element as the page moves. `capture: true` is needed: scroll doesn't
  // bubble and the scrolling element is <main>, not the window.
  useEffect(() => {
    if (!isOpen || !targetRef.current) return;

    const el = targetRef.current;
    const sync = () => setRect(measure(el));

    window.addEventListener('scroll', sync, true);
    window.addEventListener('resize', sync);
    const ro = new ResizeObserver(sync);
    ro.observe(el);

    return () => {
      window.removeEventListener('scroll', sync, true);
      window.removeEventListener('resize', sync);
      ro.disconnect();
    };
  }, [isOpen, index]);

  // Escape ends the tour.
  useEffect(() => {
    if (!isOpen) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        if (isLast) onClose();
        else goNext();
        return;
      }
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        goBack();
        return;
      }
      // Minimal focus trap: the page behind is dimmed and unclickable.
      if (e.key === 'Tab' && cardRef.current) {
        const focusable = cardRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [isOpen, isLast, goNext, goBack, onClose]);

  // Move focus in on open, back on close.
  useEffect(() => {
    if (isOpen) {
      restoreFocus.current = document.activeElement as HTMLElement | null;
      // After the card has mounted.
      const t = setTimeout(() => cardRef.current?.focus(), 0);
      return () => clearTimeout(t);
    }
    restoreFocus.current?.focus?.();
  }, [isOpen]);

  useLayoutEffect(() => {
    if (cardRef.current) setCardHeight(cardRef.current.offsetHeight);
  }, [index, rect, isOpen]);

  // Publish this step's example-content request. The cleanup ensures example data never outlives the tour.
  useEffect(() => {
    if (!isOpen || !step) {
      onDemoChange(null);
      return;
    }
    onDemoChange(step.demo ? step.anchor : null);
    return () => onDemoChange(null);
  }, [isOpen, step, onDemoChange]);

  if (!isOpen || !step) return null;

  // Card placement
  const viewportW = window.innerWidth;
  const viewportH = window.innerHeight;
  let cardW = Math.min(CARD_WIDTH, viewportW - MARGIN * 2);
  let cardMaxH = viewportH - MARGIN * 2;

  let cardTop: number;
  let cardLeft: number;

  if (rect) {
    // Try below, above, right, then left; centring would cover the target.
    const belowTop = rect.top + rect.height + GAP;
    const rightLeft = rect.left + rect.width + GAP;

    // Free space on each side (pass two needs the amounts).
    const spaceBelow = viewportH - belowTop - MARGIN;
    const spaceAbove = rect.top - GAP - MARGIN;
    const spaceRight = viewportW - rightLeft - MARGIN;
    const spaceLeft = rect.left - GAP - MARGIN;

    const clampX = (x: number) =>
      Math.min(Math.max(MARGIN, x), Math.max(MARGIN, viewportW - cardW - MARGIN));
    const clampY = (y: number) =>
      Math.min(Math.max(MARGIN, y), Math.max(MARGIN, viewportH - cardHeight - MARGIN));

    const centredX = clampX(rect.left + rect.width / 2 - cardW / 2);
    const centredY = clampY(rect.top + rect.height / 2 - cardHeight / 2);

    // Pass two shrinks the card instead of overlapping (mainly for the mobile drawer), trying right/left
    // first. Pass one assigns the same cardMaxH so the two passes can't oscillate.
    if (spaceBelow >= cardHeight) {
      cardTop = belowTop;
      cardLeft = centredX;
      cardMaxH = spaceBelow;
    } else if (spaceAbove >= cardHeight) {
      cardTop = rect.top - GAP - cardHeight;
      cardLeft = centredX;
      cardMaxH = spaceAbove;
    } else if (spaceRight >= cardW) {
      cardLeft = rightLeft;
      cardTop = centredY;
    } else if (spaceLeft >= cardW) {
      cardLeft = rect.left - GAP - cardW;
      cardTop = centredY;
    } else if (spaceRight >= MIN_CARD_WIDTH) {
      cardW = spaceRight;
      cardLeft = rightLeft;
      cardTop = clampY(rect.top + rect.height / 2 - cardHeight / 2);
    } else if (spaceLeft >= MIN_CARD_WIDTH) {
      cardW = spaceLeft;
      cardLeft = MARGIN;
      cardTop = clampY(rect.top + rect.height / 2 - cardHeight / 2);
    } else if (spaceBelow >= MIN_CARD_HEIGHT) {
      cardTop = belowTop;
      cardLeft = centredX;
      cardMaxH = spaceBelow;
    } else if (spaceAbove >= MIN_CARD_HEIGHT) {
      cardTop = MARGIN;
      cardLeft = centredX;
      cardMaxH = spaceAbove;
    } else {
      // Nothing fits even squeezed: sit under the target and let the clamp pull it on screen.
      cardTop = clampY(belowTop);
      cardLeft = centredX;
    }
  } else {
    cardTop = Math.max(MARGIN, (viewportH - cardHeight) / 2);
    cardLeft = (viewportW - cardW) / 2;
  }

  return createPortal(
    // The outer layer blocks clicks (the box-shadow dims but doesn't capture). No animation class here:
    // a transform would trap z-index.
    // While resolving, the layer is transparent and holds no card.
    <div
      className={`fixed inset-0 z-[100] ${resolved && !rect ? 'bg-black/70' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-labelledby="tour-title"
    >
      {rect && (
        <div
          className="tour-spotlight absolute rounded-xl pointer-events-none"
          style={{
            top: rect.top,
            left: rect.left,
            width: rect.width,
            height: rect.height,
            boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.72)',
            outline: '2px solid var(--theme-accent)',
            outlineOffset: '2px',
          }}
        />
      )}

      {/* The card caps its height at cardMaxH (the free space on the chosen side) and scrolls its text,
          with the footer as a sibling so the buttons stay reachable. */}
      <div
        ref={cardRef}
        tabIndex={-1}
        className={`animate-tour-card absolute flex flex-col rounded-2xl border border-white/10 bg-surface-container-lowest shadow-2xl p-5 focus:outline-none ${
          resolved ? '' : 'invisible'
        }`}
        style={{
          top: cardTop,
          left: cardLeft,
          width: cardW,
          maxHeight: `${cardMaxH}px`,
        }}
      >
        <button
          onClick={onClose}
          aria-label="Skip the tour"
          className="absolute top-3 right-3 p-1 rounded-lg text-slate-500 hover:text-slate-200 hover:bg-white/5 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="min-h-0 overflow-y-auto no-scrollbar -mx-1 px-1">
          <h2
            id="tour-title"
            className="font-display text-base font-bold text-white pr-7"
          >
            {step.title}
          </h2>
          <p className="font-sans text-sm leading-relaxed text-slate-300 mt-2 whitespace-pre-line">
            {step.body}
          </p>
        </div>

        <div className="flex items-center justify-between gap-3 mt-5 shrink-0">
          {/* Dots, not "N of M": skipped steps would make a total wrong. */}
          <div className="flex items-center gap-1.5" aria-hidden="true">
            {steps.map((s, i) => (
              <span
                key={s.title}
                className={`h-1.5 rounded-full transition-all duration-300 ${
                  i === index ? 'w-4 bg-primary-fixed-dim' : 'w-1.5 bg-white/20'
                }`}
              />
            ))}
          </div>

          <div className="flex items-center gap-2">
            {index > 0 && (
              <button
                onClick={goBack}
                className="px-3 py-1.5 rounded-lg font-sans text-xs font-semibold text-slate-400 hover:text-slate-200 hover:bg-white/5 transition-colors"
              >
                Back
              </button>
            )}
            <button
              onClick={isLast ? onClose : goNext}
              className="px-4 py-1.5 rounded-lg bg-primary-fixed-dim/15 border border-primary-fixed-dim/30 font-sans text-xs font-semibold text-primary-fixed-dim hover:bg-primary-fixed-dim/25 transition-colors"
            >
              {isLast ? 'Got it' : 'Next'}
            </button>
          </div>
        </div>

        {!isLast && (
          <button
            onClick={onClose}
            className="mt-3 w-full shrink-0 text-center font-sans text-[11px] text-slate-500 hover:text-slate-300 transition-colors"
          >
            Skip the tour
          </button>
        )}
      </div>
    </div>,
    document.body
  );
}
