import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import type { TourStep } from '../../lib/onboarding';

/**
 * The first-run guided tour: a spotlight that dims the page around one element
 * at a time, with a card explaining it.
 *
 * ══ WHY THERE IS NO LIBRARY ══
 * driver.js, react-joyride and shepherd all do this, and all of them are a
 * dependency plus a styling system to fight. The whole mechanism is one
 * `getBoundingClientRect` and one `box-shadow`, so it is written here instead.
 * `motion` is in `package.json` with zero imports anywhere — every animation in
 * this app is hand-written CSS in `index.css`, and this follows that.
 *
 * Used by the dashboard tour and by all six tool walkthroughs — the step list
 * arrives as a prop, so there is one spotlight and one keyboard model.
 *
 * ══ ⚠️ A STEP WHOSE ANCHOR IS NOT IN THE DOM IS SKIPPED ══
 * That single rule is what makes one step list survive every layout this portal
 * has. On a phone the sidebar lives inside a closed drawer, so several dashboard
 * anchors do not exist. In a study space with no lessons yet — the normal
 * day-one state — `NoMaterialsNotice` replaces the whole composer, so every
 * cognitive anchor is gone. Neither case needs its own script, and a future
 * layout change degrades to a shorter walkthrough rather than to a spotlight on
 * nothing.
 *
 * ══ ⚠️ IT RESOLVES THE FIRST *VISIBLE* MATCH ══
 * `renderNavLinks()` in `StudentLayout` is called twice — once for the desktop
 * sidebar and once for the mobile drawer — so every nav anchor exists twice in
 * the DOM at all times. A plain `querySelector` would return whichever came
 * first in source order, which on a wide screen is the hidden drawer copy, and
 * the spotlight would land on a zero-sized rect in the corner.
 */

/**
 * How long to keep hunting for an anchor before giving up on a step.
 *
 * ⚠️ TWO BUDGETS, AND THE DIFFERENCE IS WHAT STOPS A RUN OF SKIPS FROM STALLING.
 *
 * The generous one exists for a single reason: the tour can open while the page
 * is still fetching, so an anchor may be seconds away from existing. But that is
 * a property of the MOMENT THE TOUR OPENED, not of every step, and applying it
 * per step made a run of missing anchors take `700ms × n` with a blank screen
 * throughout. Replaying the dashboard tour from anywhere else cost ~3.5 seconds
 * of nothing; on a phone, where the four sidebar anchors sit inside a closed
 * drawer, it cost ~2.8.
 *
 * So the settle budget is measured from when the tour opened, and every step
 * additionally gets a short grace period of its own. Early steps still wait out
 * a slow page; later ones give up almost immediately, which is correct because
 * by then the page has demonstrably rendered.
 */
const SETTLE_MS = 700;
const FAST_SKIP_MS = 150;

/** Breathing room between the spotlight and the card, and from the viewport. */
const GAP = 12;
const MARGIN = 16;
const CARD_WIDTH = 320;

/** Padding around the highlighted element, so the ring is not flush to it. */
const HALO = 6;

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

/**
 * The first match that is actually rendered. `offsetParent` is null for anything
 * inside a `display: none` subtree, which is exactly how the mobile drawer and
 * the desktop sidebar hide from each other.
 */
function findAnchor(name: string): HTMLElement | null {
  const nodes = document.querySelectorAll<HTMLElement>(`[data-tour="${name}"]`);
  for (const node of nodes) {
    if (node.offsetParent !== null) return node;
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
  /**
   * The steps to run. Supplied by `OnboardingProvider`, which picks the list out
   * of `TOURS` — the dashboard tour and all six tool walkthroughs share this one
   * component, so there is one spotlight, one keyboard model and one skip rule.
   */
  steps: readonly TourStep[];
  /** Fired by Skip, by the X, by Escape and by Done — all the same action. */
  onClose: () => void;
  /**
   * Reports which anchor, if any, should be showing example content — the
   * current step's anchor when it sets `demo`, otherwise null.
   *
   * ⚠️ It must be called with null on every step that does NOT set `demo`, not
   * only on close. Reporting only the demo steps would leave the previous card's
   * example on screen for the rest of the tour.
   */
  onDemoChange: (anchor: string | null) => void;
}

export default function TourOverlay({ isOpen, steps, onClose, onDemoChange }: TourOverlayProps) {
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const [cardHeight, setCardHeight] = useState(190);
  /**
   * False while the current step's anchor is being hunted for. The card is not
   * rendered until this flips, so a step that turns out to be missing is skipped
   * silently instead of flashing its text over the wrong element.
   */
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

  /*
   * Acquire the current step's anchor, then hold on to it.
   *
   * The retry loop exists because the tour opens while the dashboard is still
   * resolving its own fetch — the empty-state card step 4 points at is not in
   * the DOM yet. Polling on a frame timer for a beat is what turns "the network
   * was slow" into "the tour waited" rather than "the tour skipped a step".
   */
  useEffect(() => {
    if (!isOpen || !step) return;

    /*
     * ⚠️ CLEAR BOTH BEFORE HUNTING, NOT ONLY ON SUCCESS.
     *
     * `setRect` used to be called only when an anchor was found, so a step whose
     * anchor was missing inherited the PREVIOUS step's rectangle — the spotlight
     * sat on the wrong element while the card described a different one. Seen in
     * the wild: a flashcards walkthrough opening over a still-loading page with
     * the highlight stuck on the sidebar.
     *
     * `resolved` gates the card itself, so a step that is about to be skipped
     * never flashes its text on screen first.
     */
    setResolved(false);
    setRect(null);

    if (step.anchor === null) {
      targetRef.current = null;
      setResolved(true);
      return;
    }

    let cancelled = false;
    let frame = 0;
    // Whichever is later: the tour's own settle window, or this step's grace.
    const deadline = Math.max(openedAt.current + SETTLE_MS, Date.now() + FAST_SKIP_MS);

    const attempt = () => {
      if (cancelled) return;

      const el = findAnchor(step.anchor!);
      if (el) {
        targetRef.current = el;
        el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
        // One frame for the scroll to have started before the first measure;
        // the scroll listener below keeps it correct for the rest of it.
        frame = requestAnimationFrame(() => {
          if (cancelled) return;
          setRect(measure(el));
          setResolved(true);
        });
        return;
      }

      if (Date.now() >= deadline) {
        // Give up on this step rather than dim the screen around nothing.
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

  /*
   * Keep the spotlight on the element while the page moves under it.
   *
   * `capture: true` on scroll is load-bearing: scroll events do not bubble, and
   * the thing that actually scrolls in this portal is a `<main>` with
   * `overflow-y-auto`, not the window. Without capture the spotlight would stay
   * put while the content slid out from under it.
   */
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

  // Keyboard. Escape ends the tour, exactly as it dismisses a Modal.
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
      /*
       * A minimal focus trap. There is none anywhere else in this codebase, and
       * for a Modal that is merely untidy — but here the page behind is dimmed
       * and unclickable, so tabbing into it would strand a keyboard user on
       * controls they can neither see nor use.
       */
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

  // Move focus in on open and hand it back on close.
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

  /*
   * Publish the example-content request for the current step.
   *
   * ⚠️ THE CLEANUP IS LOAD-BEARING, not tidiness. It clears the flag when the
   * overlay unmounts, which is what guarantees no student is ever left looking
   * at example badges on their own dashboard — the single rule the demo design
   * exists to keep.
   */
  useEffect(() => {
    if (!isOpen || !step) {
      onDemoChange(null);
      return;
    }
    onDemoChange(step.demo ? step.anchor : null);
    return () => onDemoChange(null);
  }, [isOpen, step, onDemoChange]);

  if (!isOpen || !step) return null;

  // ── Card placement ────────────────────────────────────────────────────────
  const viewportW = window.innerWidth;
  const viewportH = window.innerHeight;
  const cardW = Math.min(CARD_WIDTH, viewportW - MARGIN * 2);

  let cardTop: number;
  let cardLeft: number;

  if (rect) {
    /*
     * ⚠️ FOUR SIDES ARE TRIED, NOT TWO — AND THE SIDES ARE WHY.
     *
     * This used to try below, then above, then give up and centre the card
     * vertically. Centring puts it ON TOP of the very thing it is describing,
     * and that is exactly what happened on the dashboard mastery card: a tall
     * target plus a card too tall to sit under it, so the explanation covered
     * the number it was explaining.
     *
     * A tall target almost always has room beside it — the mastery card is
     * ~950px wide in a ~1900px viewport — so falling back to right, then left,
     * fixes the whole class of problem rather than that one card. The card also
     * caps its own height now (see the render below), which keeps the vertical
     * options viable more often.
     */
    const belowTop = rect.top + rect.height + GAP;
    const aboveTop = rect.top - cardHeight - GAP;
    const rightLeft = rect.left + rect.width + GAP;
    const leftLeft = rect.left - cardW - GAP;

    const clampX = (x: number) =>
      Math.min(Math.max(MARGIN, x), Math.max(MARGIN, viewportW - cardW - MARGIN));
    const clampY = (y: number) =>
      Math.min(Math.max(MARGIN, y), Math.max(MARGIN, viewportH - cardHeight - MARGIN));

    const centredX = clampX(rect.left + rect.width / 2 - cardW / 2);
    const centredY = clampY(rect.top + rect.height / 2 - cardHeight / 2);

    if (belowTop + cardHeight <= viewportH - MARGIN) {
      cardTop = belowTop;
      cardLeft = centredX;
    } else if (aboveTop >= MARGIN) {
      cardTop = aboveTop;
      cardLeft = centredX;
    } else if (rightLeft + cardW <= viewportW - MARGIN) {
      cardLeft = rightLeft;
      cardTop = centredY;
    } else if (leftLeft >= MARGIN) {
      cardLeft = leftLeft;
      cardTop = centredY;
    } else {
      /*
       * Nothing fits anywhere — a small phone against a target that fills the
       * screen. Sit under the target and let the clamp pull it back on screen;
       * some overlap is unavoidable here, and covering the bottom of a target is
       * far better than covering its middle.
       */
      cardTop = clampY(belowTop);
      cardLeft = centredX;
    }
  } else {
    cardTop = Math.max(MARGIN, (viewportH - cardHeight) / 2);
    cardLeft = (viewportW - cardW) / 2;
  }

  return createPortal(
    /*
     * The outer layer is the click blocker. The dimming itself comes from the
     * spotlight's `box-shadow`, which paints but does not capture pointer
     * events — so without this element every dimmed control would still be
     * clickable, and a student could navigate away mid-step.
     *
     * ⚠️ NO ANIMATION CLASS ON THIS ELEMENT. `index.css` records the measured
     * bug: a transform animation forms a stacking context that traps the
     * z-index of anything positioned inside it. Only the card animates.
     */
    /*
     * While a step is still being resolved the layer stays transparent and holds
     * no card — it only blocks clicks. Dimming first would flash the screen dark
     * for a step that may be about to be skipped entirely.
     */
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

      {/*
        ⚠️ THE CARD CAPS ITS OWN HEIGHT AND SCROLLS ITS TEXT, and that is a
        placement guard rather than styling. A card taller than the gap under its
        target has nowhere to go, which is how the explanation ended up sitting
        on top of the thing it was explaining. Capping it keeps the below/above
        options viable, and the four-way placement above catches the rest.

        Same shape the modals in this codebase use for the same reason: the text
        is the scroll box, and the footer is its SIBLING so the buttons stay
        pinned and reachable however long the copy runs.
      */}
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
          maxHeight: `${viewportH - MARGIN * 2}px`,
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
          {/* Dots rather than "step N of M": steps are skipped when their anchor
              is absent, so a total counted up front would be wrong on a phone. */}
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
