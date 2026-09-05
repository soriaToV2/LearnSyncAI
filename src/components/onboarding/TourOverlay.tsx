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
 *
 * ══ ⚠️ AND ON A PHONE A STEP MAY ASK FOR THE MENU (`needsNav`) ══
 * The four sidebar steps have no target on a phone, because the drawer holding
 * them is slid off screen. Rather than skip them — which would leave a phone
 * student never told the app HAS a menu, and would drop the Study Spaces
 * explanation — such a step reports upward through `onNavChange` and the layout
 * slides the drawer open for the duration. See `isReachable` below for the
 * defect that made this look like it already worked.
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

/**
 * The grace a `needsNav` step gets instead of `FAST_SKIP_MS`.
 *
 * ⚠️ 150ms IS SHORTER THAN THE DRAWER'S OWN ANIMATION, so without this every
 * sidebar step on a phone would give up mid-slide and skip itself — turning the
 * fix into the very outcome it replaced. `StudentLayout`'s drawer is
 * `transition-transform duration-300`; this is that plus room for the request to
 * round-trip through React. It is never consumed on a desktop, where the sidebar
 * copy resolves on the first attempt.
 */
const NAV_GRACE_MS = 600;

/** Breathing room between the spotlight and the card, and from the viewport. */
const GAP = 12;
const MARGIN = 16;
const CARD_WIDTH = 320;

/** Padding around the highlighted element, so the ring is not flush to it. */
const HALO = 6;

/**
 * How small the card may be squeezed rather than sit on top of its own target.
 *
 * ⚠️ THESE EXIST BECAUSE "IT FITS AT 320×natural, OR IT OVERLAPS" WAS TOO COARSE.
 * The mobile ☰ drawer is a 288px full-height column, so a sidebar step leaves
 * free space in exactly two shapes — a narrow strip to its right on a wide
 * window, or a short band under the nav list on a phone — and the old search
 * rejected both for being the wrong size, then fell through to the overlap
 * fallback and covered the very buttons the step was explaining.
 *
 * Below these floors the card would be unreadable and the overlap really is the
 * better answer, so the fallback stays.
 */
const MIN_CARD_WIDTH = 260;
const MIN_CARD_HEIGHT = 220;

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

/**
 * Is any ancestor `position: fixed`? Walks `parentElement`, deliberately NOT
 * `offsetParent`, which is itself null on a fixed element and would end the walk
 * at the very node it is looking for.
 */
function inFixedSubtree(el: HTMLElement): boolean {
  let node: HTMLElement | null = el;
  while (node && node !== document.body) {
    if (getComputedStyle(node).position === 'fixed') return true;
    node = node.parentElement;
  }
  return false;
}

/**
 * Is this element somewhere the student could actually look?
 *
 * ⚠️ `offsetParent` ALONE IS NOT ENOUGH, AND THE MOBILE DRAWER IS WHY. It is
 * null only inside a `display: none` subtree — which is how the desktop sidebar
 * and the mobile drawer hide from *each other*, and that half works. But the
 * CLOSED drawer hides with `-translate-x-full`, so on a phone its nav links keep
 * a layout box and `offsetParent` returns the fixed `<aside>`. Every sidebar
 * step therefore "found" a rectangle at `left ≈ -264`: the ring painted off the
 * left edge while its box-shadow still dimmed the whole screen, so four of the
 * ten first-run steps read as a dark screen and a card about invisible buttons.
 *
 * A rect off the viewport is only a problem when SCROLLING CANNOT FIX IT, which
 * is exactly the `position: fixed` case. Everything else keeps today's
 * behaviour, because the `scrollIntoView` below can reach it — that is what
 * stops this from rejecting a dashboard card below the fold.
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

/**
 * Fully on screen HORIZONTALLY. Used only for a `needsNav` step, and only the X
 * axis because the drawer slides on it: every frame of the 300ms slide leaves
 * the links partly off the left edge, so this is false throughout the animation
 * and true the moment it settles. It saves a timer and, more importantly, saves
 * duplicating Tailwind's `md` breakpoint into TypeScript to ask "are we on a
 * phone?" — the desktop sidebar copy satisfies it immediately.
 */
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
  /**
   * Reports whether the current step needs the mobile ☰ menu held open.
   *
   * ⚠️ Same contract as `onDemoChange`, and for the same reason: it must be
   * called with `false` on every step that does NOT set `needsNav`, not only on
   * close, or the drawer would stay open for the rest of the tour.
   */
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
   * Ask for the mobile ☰ menu on behalf of the current step.
   *
   * ⚠️ DECLARED BEFORE THE HUNT BELOW so the request is made in the same commit
   * the hunt starts in — the drawer is already sliding by the time the second
   * attempt runs. The hunt polls on a frame timer, so this ordering is a
   * courtesy rather than a correctness requirement, but reversing it costs a
   * frame on every sidebar step for nothing.
   *
   * ⚠️ THE CLEANUP IS LOAD-BEARING, exactly as it is for the example content
   * below: it is what guarantees an overlay that unmounts mid-step — Escape, a
   * route change, the tour finishing on the last sidebar step — cannot leave the
   * drawer stranded open over the page.
   */
  useEffect(() => {
    if (!isOpen || !step) {
      onNavChange(false);
      return;
    }
    onNavChange(step.needsNav === true);
    return () => onNavChange(false);
  }, [isOpen, step, onNavChange]);

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
    const grace = step.needsNav ? NAV_GRACE_MS : FAST_SKIP_MS;
    const deadline = Math.max(openedAt.current + SETTLE_MS, Date.now() + grace);

    const attempt = () => {
      if (cancelled) return;

      /*
       * A `needsNav` step additionally waits for its target to stop moving. The
       * effect above has already asked for the drawer, which slides in over
       * 300ms; measuring during that would leave the spotlight beside the button
       * rather than on it.
       */
      const el = findAnchor(step.anchor!, step.needsNav === true);
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
  let cardW = Math.min(CARD_WIDTH, viewportW - MARGIN * 2);
  let cardMaxH = viewportH - MARGIN * 2;

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
    const rightLeft = rect.left + rect.width + GAP;

    /*
     * Free space on each side of the spotlight. Expressed this way rather than
     * as four corner coordinates because the second pass below needs to know HOW
     * MUCH room a side has, not merely whether the card fits in it.
     */
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

    /*
     * ⚠️ TWO PASSES, AND THE SECOND ONE SHRINKS THE CARD RATHER THAN GIVING UP.
     *
     * Pass one is the original search and is unchanged: below, above, right,
     * left, taking the first side the card fits in at its natural size. That is
     * what every desktop step still takes, so nothing about them moves.
     *
     * Pass two exists for the mobile ☰ drawer, which is a 288px full-height
     * column and therefore fails all four: too short underneath on a phone, too
     * narrow beside it on a small window. Measured on a 676×832 window, the
     * `nav` step had 292px free to the right of the drawer against a 320px card
     * and 324px free below against a 640px one — so it fell through to the
     * overlap fallback and covered the five buttons it was describing.
     *
     * ⚠️ RIGHT AND LEFT COME FIRST HERE, WHICH IS THE REVERSE OF PASS ONE. The
     * thing being pointed at is a full-height column, so the free space is
     * beside it, not under it — and a narrowed card reads better than a scrolled
     * one, since only the second hides text behind a gesture.
     *
     * ⚠️ THE `cardMaxH` ASSIGNMENTS IN PASS ONE LOOK REDUNDANT AND ARE NOT. If
     * only pass two capped the height, the cap would shrink the card, the
     * smaller card would then satisfy pass one, pass one would restore the full
     * cap, and it would grow again — a placement that oscillates every frame.
     * Assigning the same cap in both passes makes the two branches produce
     * identical output, so there is nothing to flip between. Where the card
     * already fits, the cap is above its natural height and binds nothing.
     */
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
      /*
       * Nothing fits anywhere, even squeezed — a short landscape phone against a
       * target that fills the screen. Sit under the target and let the clamp
       * pull it back on screen; some overlap is unavoidable here, and covering
       * the bottom of a target is far better than covering its middle.
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
        options viable, and the placement search above catches the rest.

        ⚠️ THE CAP IS `cardMaxH`, THE FREE SPACE ON THE SIDE THAT WAS CHOSEN —
        not a flat fraction of the viewport. It was `viewportH - 32`, which is
        the whole screen and therefore capped nothing; that is why a 640px card
        could be handed to a 324px gap and end up over its own target.

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
