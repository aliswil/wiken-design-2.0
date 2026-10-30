'use client';

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import styles from './avis.module.css';
import Cutting from './Cutting';
import { STRIP_QUERY } from './stripQuery';
import type { AvisEdition, CreatePress, Press, PressMode } from './types';

interface AvisReaderProps {
  edition: AvisEdition;
}

interface Gesture {
  id: number;
  x: number;
  y: number;
  dragging: boolean;
  lastX: number;
  lastTime: number;
  velocity: number;
}

const REDUCED_QUERY = '(prefers-reduced-motion: reduce)';
const COARSE_QUERY = '(pointer: coarse)';
const TOO_SLOW_KEY = 'avis-press-too-slow';
const GRAB_THRESHOLD_PX = 8;
const WHEEL_TURN_PX = 40;
const WHEEL_QUIET_MS = 180;
const CANVAS_FADE_MS = 160;
const RESIZE_DEBOUNCE_MS = 200;
const SMOOTH_SETTLE_MS = 150;
const STAGE_SELECTOR = '[data-avis-stage]';
const SHEETS_SELECTOR = '[data-avis-sheets]';

function useMediaQuery(query: string): boolean | null {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = window.matchMedia(query);
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => null,
  );
}

function stopElements(sheets: HTMLElement, mode: PressMode): HTMLElement[] {
  return Array.from(sheets.querySelectorAll<HTMLElement>(`[data-stop="${mode}"]`));
}

function stopOf(element: Element, sheets: HTMLElement, mode: PressMode): number {
  const stop = element.closest<HTMLElement>(`[data-stop="${mode}"]`);
  return stop ? stopElements(sheets, mode).indexOf(stop) : -1;
}

/** The scrollLeft that puts the stop in the middle of the scroller. */
function centredLeft(sheets: HTMLElement, stop: HTMLElement): number {
  const outer = sheets.getBoundingClientRect();
  const inner = stop.getBoundingClientRect();
  const left = sheets.scrollLeft + inner.left + inner.width / 2 - outer.left - outer.width / 2;
  return Math.max(0, Math.min(sheets.scrollWidth - sheets.clientWidth, left));
}

function nearestStop(sheets: HTMLElement, mode: PressMode): number {
  const outer = sheets.getBoundingClientRect();
  const middle = outer.left + outer.width / 2;
  let best = 0;
  let bestDistance = Infinity;
  stopElements(sheets, mode).forEach((stop, index) => {
    const rect = stop.getBoundingClientRect();
    const distance = Math.abs(rect.left + rect.width / 2 - middle);
    if (distance < bestDistance) {
      best = index;
      bestDistance = distance;
    }
  });
  return best;
}

/** The stop in the new mode that shows what the old mode's stop was showing. */
function matchingStop(sheets: HTMLElement, from: PressMode, stop: number, to: PressMode): number {
  const old = stopElements(sheets, from)[stop];
  const targets = stopElements(sheets, to);
  if (!old) return 0;
  const enclosing = old.closest<HTMLElement>(`[data-stop="${to}"]`);
  if (enclosing) return targets.indexOf(enclosing);
  const following = targets.findIndex(
    (target) => old.compareDocumentPosition(target) & Node.DOCUMENT_POSITION_FOLLOWING,
  );
  return following === -1 ? targets.length - 1 : following;
}

function pressAllowed(): boolean {
  const hints = navigator as Navigator & {
    deviceMemory?: number;
    connection?: { saveData?: boolean };
  };
  if (hints.connection?.saveData) return false;
  if (hints.deviceMemory !== undefined && hints.deviceMemory <= 2) return false;
  if (hints.hardwareConcurrency !== undefined && hints.hardwareConcurrency <= 2) return false;
  try {
    return window.sessionStorage.getItem(TOO_SLOW_KEY) === null;
  } catch {
    return true;
  }
}

function rememberTooSlow(): void {
  try {
    window.sessionStorage.setItem(TOO_SLOW_KEY, '1');
  } catch {
    // Without storage the next visit simply tries again.
  }
}

function stopCount(edition: AvisEdition, mode: PressMode | null): number {
  return mode === 'strip' ? edition.drawings.length + 1 : edition.spreads.length;
}

function stopLabel(edition: AvisEdition, mode: PressMode, stop: number): string {
  if (mode === 'strip') {
    const total = edition.drawings.length;
    return stop < total ? `Teikning ${stop + 1} av ${total}` : 'Baksida';
  }
  if (stop === 0) return 'Framsida';
  if (stop >= edition.spreads.length - 1) return 'Baksida';
  const numbers = edition.spreads[stop].map((page) => edition.pages[page].number);
  const range = numbers.length > 1 ? `${numbers[0]}–${numbers[numbers.length - 1]}` : `${numbers[0]}`;
  return `Side ${range} av ${edition.pages.length}`;
}

/**
 * The root, the stage and the sheets are server markup in page.tsx, beside this component.
 * As its children they failed to hydrate on about one load in four, depending on when their
 * RSC chunk arrived, and a Suspense boundary around them hides the paper from no-JS visitors.
 */
export default function AvisReader({ edition }: AvisReaderProps) {
  const isStrip = useMediaQuery(STRIP_QUERY);
  const reduced = useMediaQuery(REDUCED_QUERY);
  const coarse = useMediaQuery(COARSE_QUERY);
  const mode: PressMode | null = isStrip === null ? null : isStrip ? 'strip' : 'spread';

  const [stop, setStop] = useState(0);
  const [webgl, setWebgl] = useState(false);
  const [turned, setTurned] = useState(false);
  const [cutting, setCutting] = useState<{ index: number; origin: DOMRect | null } | null>(null);

  const rootRef = useRef<HTMLElement | null>(null);
  const stageRef = useRef<HTMLElement | null>(null);
  const ringRef = useRef<HTMLDivElement>(null);
  const prevRef = useRef<HTMLButtonElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const scrubRef = useRef<HTMLInputElement>(null);
  const modeRef = useRef<PressMode | null>(null);
  const stopRef = useRef(0);
  const pressRef = useRef<Press | null>(null);
  const pressRefused = useRef(false);
  const hinted = useRef(false);
  const settleTimer = useRef<number | null>(null);
  const gesture = useRef<Gesture | null>(null);
  const suppressClick = useRef(false);
  const focusLink = useRef<HTMLElement | null>(null);
  const openedByPointer = useRef(false);
  const focusHeir = useRef<HTMLButtonElement | null>(null);

  const stops = stopCount(edition, mode);

  const sheetsElement = useCallback(
    () => stageRef.current?.querySelector<HTMLElement>(SHEETS_SELECTOR) ?? null,
    [],
  );

  const placeRing = useCallback(() => {
    const ring = ringRef.current;
    const stage = stageRef.current;
    if (!ring || !stage) return;
    const link = focusLink.current;
    if (!pressRef.current || !link || gesture.current?.dragging) {
      ring.removeAttribute('data-show');
      return;
    }
    const outer = stage.getBoundingClientRect();
    const rect = link.getBoundingClientRect();
    ring.style.transform = `translate(${rect.left - outer.left}px, ${rect.top - outer.top}px)`;
    ring.style.width = `${rect.width}px`;
    ring.style.height = `${rect.height}px`;
    ring.setAttribute('data-show', '');
  }, []);

  const commitStop = useCallback(
    (next: number) => {
      if (next === stopRef.current) return;
      // A button that becomes disabled would drop the focus out of the controls.
      const active = document.activeElement;
      if (next === 0 && active === prevRef.current) focusHeir.current = nextRef.current;
      if (next === Number(scrubRef.current?.max) && active === nextRef.current) focusHeir.current = prevRef.current;
      stopRef.current = next;
      setStop(next);
      setTurned(true);
    },
    [],
  );

  const settleScroll = useCallback(() => {
    settleTimer.current = null;
    const sheets = sheetsElement();
    const currentMode = modeRef.current;
    if (sheets && currentMode && !pressRef.current) commitStop(nearestStop(sheets, currentMode));
  }, [commitStop, sheetsElement]);

  const pinToStop = useCallback(
    (index: number) => {
      const sheets = sheetsElement();
      const currentMode = modeRef.current;
      if (!sheets || !currentMode) return;
      const element = stopElements(sheets, currentMode)[index];
      if (element) sheets.scrollTo({ left: centredLeft(sheets, element), behavior: 'instant' });
    },
    [sheetsElement],
  );

  const goTo = useCallback(
    (requested: number) => {
      const sheets = sheetsElement();
      const currentMode = modeRef.current;
      if (!sheets || !currentMode) return;
      const elements = stopElements(sheets, currentMode);
      if (elements.length === 0) return;
      const next = Math.max(0, Math.min(elements.length - 1, requested));
      const press = pressRef.current;
      const left = centredLeft(sheets, elements[next]);

      if (press || window.matchMedia(REDUCED_QUERY).matches) {
        sheets.scrollTo({ left, behavior: 'instant' });
      } else {
        // While smooth scrolling the scroll listener must not report the stops it passes.
        if (settleTimer.current !== null) window.clearTimeout(settleTimer.current);
        settleTimer.current = window.setTimeout(settleScroll, SMOOTH_SETTLE_MS * 2);
        sheets.scrollTo({ left, behavior: 'smooth' });
      }

      if (press && next !== stopRef.current) press.turnTo(next);
      commitStop(next);
      placeRing();
    },
    [commitStop, placeRing, settleScroll, sheetsElement],
  );

  useLayoutEffect(() => {
    rootRef.current = ringRef.current?.parentElement ?? null;
    stageRef.current = rootRef.current?.querySelector<HTMLElement>(STAGE_SELECTOR) ?? null;
  }, []);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    if (mode) root.dataset.mode = mode;
    root.toggleAttribute('data-webgl', webgl);
  }, [mode, webgl]);

  // After the commit, because when jumping between the ends the heir was disabled until now.
  useLayoutEffect(() => {
    focusHeir.current?.focus();
    focusHeir.current = null;
  }, [stop]);

  // Keeps the same drawing in view when the mode changes, or the focused one if there is one.
  useLayoutEffect(() => {
    if (!mode) return;
    const previous = modeRef.current;
    modeRef.current = mode;
    const sheets = sheetsElement();
    if (!sheets) return;
    if (previous && previous !== mode) {
      const active = document.activeElement;
      const focused = active && sheets.contains(active) ? stopOf(active, sheets, mode) : -1;
      const next = focused !== -1 ? focused : matchingStop(sheets, previous, stopRef.current, mode);
      stopRef.current = next;
      setStop(next);
      pinToStop(next);
    } else if (!previous) {
      const next = nearestStop(sheets, mode);
      stopRef.current = next;
      setStop(next);
    }
  }, [mode, pinToStop, sheetsElement]);

  // DOM mode follows the scroller. With the press on, the scroller is held at the stop.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    let frame = 0;
    const handleScroll = (event: Event) => {
      const sheets = sheetsElement();
      const currentMode = modeRef.current;
      if (!sheets || event.target !== sheets || !currentMode) return;
      if (settleTimer.current !== null) {
        window.clearTimeout(settleTimer.current);
        settleTimer.current = window.setTimeout(settleScroll, SMOOTH_SETTLE_MS);
        return;
      }
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        if (pressRef.current) {
          const element = stopElements(sheets, currentMode)[stopRef.current];
          if (element && Math.abs(sheets.scrollLeft - centredLeft(sheets, element)) > 2) {
            pinToStop(stopRef.current);
            placeRing();
          }
        } else {
          commitStop(nearestStop(sheets, currentMode));
        }
      });
    };
    // Scroll doesn't bubble, but it does capture.
    stage.addEventListener('scroll', handleScroll, { capture: true, passive: true });
    return () => {
      stage.removeEventListener('scroll', handleScroll, { capture: true });
      window.cancelAnimationFrame(frame);
      if (settleTimer.current !== null) {
        window.clearTimeout(settleTimer.current);
        settleTimer.current = null;
      }
    };
  }, [commitStop, pinToStop, placeRing, settleScroll, sheetsElement]);

  useEffect(() => {
    if (cutting) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (event.target instanceof Element && event.target.closest('input, select, textarea, [contenteditable]')) return;
      const current = stopRef.current;
      let next: number;
      if (event.key === 'ArrowLeft') next = current - 1;
      else if (event.key === 'ArrowRight') next = current + 1;
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = Number.MAX_SAFE_INTEGER;
      else return;
      event.preventDefault();
      goTo(next);

      // Otherwise the next Tab would turn the newspaper back to where the focus was left.
      const sheets = sheetsElement();
      const active = document.activeElement;
      const currentMode = modeRef.current;
      if (!sheets || !currentMode || !(active instanceof HTMLElement) || !sheets.contains(active)) return;
      if (stopOf(active, sheets, currentMode) === stopRef.current) return;
      const first = stopElements(sheets, currentMode)[stopRef.current]?.querySelector<HTMLElement>('a[href]');
      if (first) first.focus({ preventScroll: true });
      else active.blur();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [cutting, goTo, sheetsElement]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    let width = stage.clientWidth;
    let height = stage.clientHeight;
    let timer: number | undefined;
    const observer = new ResizeObserver(() => {
      if (stage.clientWidth === width && stage.clientHeight === height) return;
      width = stage.clientWidth;
      height = stage.clientHeight;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        pinToStop(stopRef.current);
        pressRef.current?.resize();
        placeRing();
      }, RESIZE_DEBOUNCE_MS);
    });
    observer.observe(stage);
    return () => {
      observer.disconnect();
      window.clearTimeout(timer);
    };
  }, [pinToStop, placeRing]);

  // The press sits on top of a page that already works. It has one canvas per
  // instance, because disposing loses the context and a canvas can't get a new one.
  useEffect(() => {
    const stage = stageRef.current;
    const sheets = sheetsElement();
    if (!mode || reduced !== false || !stage || !sheets || pressRefused.current) return;

    let cancelled = false;
    let instance: Press | null = null;
    let canvas: HTMLCanvasElement | null = null;
    let fade: Animation | null = null;
    const startWidth = stage.clientWidth;
    const startHeight = stage.clientHeight;

    const teardown = () => {
      cancelled = true;
      fade?.cancel();
      if (pressRef.current === instance) pressRef.current = null;
      instance?.dispose();
      instance = null;
      canvas?.remove();
      canvas = null;
      setWebgl(false);
      placeRing();
    };

    const activate = (press: Press, surface: HTMLCanvasElement, startStop: number) => {
      pressRef.current = press;
      pinToStop(stopRef.current);
      // The debounced resize below can't reach a press that isn't active yet.
      if (stage.clientWidth !== startWidth || stage.clientHeight !== startHeight) press.resize();
      if (stopRef.current !== startStop) press.turnTo(stopRef.current);
      // The canvas comes in over the sheets first, so that hiding them doesn't show.
      fade = surface.animate({ opacity: [0, 1] }, { duration: CANVAS_FADE_MS });
      fade.onfinish = () => {
        surface.style.opacity = '';
        setWebgl(true);
        placeRing();
        if (!hinted.current) {
          hinted.current = true;
          press.hint();
        }
      };
    };

    const start = async () => {
      const force = new URLSearchParams(window.location.search).has('trykk');
      if (!force && !pressAllowed()) return;
      if (typeof WebGL2RenderingContext === 'undefined') return;

      let createPress: CreatePress;
      try {
        ({ default: createPress } = await import('./press'));
      } catch {
        return;
      }
      if (cancelled) return;

      const surface = document.createElement('canvas');
      surface.className = styles.canvas;
      surface.style.opacity = '0';
      surface.setAttribute('aria-hidden', 'true');
      stage.append(surface);
      canvas = surface;

      const startStop = stopRef.current;
      try {
        instance = createPress({
          canvas: surface,
          sheets,
          mode,
          stop: startStop,
          force,
          onReady: () => {
            if (!cancelled && instance) activate(instance, surface, startStop);
          },
          onStop: (next) => {
            if (cancelled) return;
            commitStop(next);
            pinToStop(next);
            const active = document.activeElement;
            if (active instanceof HTMLElement && sheets.contains(active) && stopOf(active, sheets, mode) !== next) {
              active.blur();
            }
            placeRing();
          },
          onFail: (reason) => {
            pressRefused.current = true;
            if (reason === 'too-slow') rememberTooSlow();
            teardown();
          },
        });
      } catch {
        instance = null;
      }

      if (!cancelled && !instance) teardown();
    };

    const useIdle = 'requestIdleCallback' in window;
    const handle = useIdle
      ? window.requestIdleCallback(() => void start(), { timeout: 2000 })
      : window.setTimeout(() => void start(), 200);

    return () => {
      if (useIdle) window.cancelIdleCallback(handle);
      else window.clearTimeout(handle);
      teardown();
    };
  }, [mode, reduced, commitStop, pinToStop, placeRing, sheetsElement]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;

    // A sideways trackpad swipe turns one leaf, however long its inertia keeps sending events.
    let wheelSum = 0;
    let wheelQuietAt = 0;
    const handleWheel = (event: WheelEvent) => {
      if (!pressRef.current || Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return;
      event.preventDefault();
      const waiting = event.timeStamp < wheelQuietAt;
      wheelQuietAt = waiting ? event.timeStamp + WHEEL_QUIET_MS : wheelQuietAt;
      if (waiting) return;
      wheelSum += event.deltaX;
      if (Math.abs(wheelSum) < WHEEL_TURN_PX) return;
      goTo(stopRef.current + Math.sign(wheelSum));
      wheelSum = 0;
      wheelQuietAt = event.timeStamp + WHEEL_QUIET_MS;
    };

    const handlePointerDown = (event: PointerEvent) => {
      suppressClick.current = false;
      if (!pressRef.current || event.button !== 0 || gesture.current) return;
      gesture.current = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        dragging: false,
        lastX: event.clientX,
        lastTime: event.timeStamp,
        velocity: 0,
      };
    };

    const handlePointerMove = (event: PointerEvent) => {
      const press = pressRef.current;
      if (!press) return;
      const active = gesture.current;

      if (!active) {
        if (event.pointerType === 'mouse') {
          press.hover(event.clientX, event.clientY);
        }
        return;
      }
      if (active.id !== event.pointerId) return;

      if (!active.dragging) {
        if (event.buttons === 0) {
          gesture.current = null;
          return;
        }
        const dx = Math.abs(event.clientX - active.x);
        const dy = Math.abs(event.clientY - active.y);
        if (dx <= GRAB_THRESHOLD_PX && dy <= GRAB_THRESHOLD_PX) return;
        suppressClick.current = true;
        if (dy >= dx || !press.grab(active.x, active.y)) {
          gesture.current = null;
          return;
        }
        active.dragging = true;
        setTurned(true);
        stage.setPointerCapture(event.pointerId);
        placeRing();
      }

      const elapsed = event.timeStamp - active.lastTime;
      if (elapsed > 0) {
        const velocity = ((event.clientX - active.lastX) / elapsed) * 1000;
        active.velocity = active.velocity * 0.4 + velocity * 0.6;
        active.lastX = event.clientX;
        active.lastTime = event.timeStamp;
      }
      press.drag(event.clientX, event.clientY);
    };

    const finishGesture = (event: PointerEvent, cancelled: boolean) => {
      const active = gesture.current;
      if (!active || active.id !== event.pointerId) return;
      gesture.current = null;
      if (active.dragging) {
        // A finger that stopped before lifting isn't flicking.
        const stale = event.timeStamp - active.lastTime > 80;
        pressRef.current?.release(cancelled || stale ? 0 : active.velocity);
        placeRing();
      }
    };

    const handlePointerLeave = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse') return;
      if (!gesture.current?.dragging) gesture.current = null;
      pressRef.current?.hover(null, null);
    };

    const handleClickCapture = (event: MouseEvent) => {
      // A drag can end without a click on the stage, and a keyboard click isn't its click.
      const suppress = suppressClick.current && event.detail !== 0;
      suppressClick.current = false;
      if (!suppress) return;
      event.preventDefault();
      event.stopPropagation();
    };

    const handleClick = (event: MouseEvent) => {
      if (event.button !== 0 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (!(event.target instanceof Element)) return;
      const link = event.target.closest<HTMLElement>('a[data-drawing]');
      if (!link) return;
      const index = Number(link.dataset.drawing);
      if (!edition.drawings[index]) return;
      event.preventDefault();
      const image = link.querySelector('img') ?? link;
      openedByPointer.current = event.detail !== 0;
      setCutting({ index, origin: image.getBoundingClientRect() });
    };

    const handleDragStart = (event: DragEvent) => {
      if (pressRef.current) event.preventDefault();
    };

    const handleFocus = (event: FocusEvent) => {
      const sheets = sheetsElement();
      const currentMode = modeRef.current;
      const element = event.target;
      if (!sheets || !currentMode || !(element instanceof HTMLElement) || !sheets.contains(element)) return;
      const target = stopOf(element, sheets, currentMode);
      if (target !== -1 && target !== stopRef.current) goTo(target);
      focusLink.current = element.matches(':focus-visible') ? element : null;
      placeRing();
    };

    const handleBlur = () => {
      focusLink.current = null;
      placeRing();
    };

    const listeners = new AbortController();
    const { signal } = listeners;
    stage.addEventListener('pointerdown', handlePointerDown, { signal });
    stage.addEventListener('pointermove', handlePointerMove, { signal });
    stage.addEventListener('pointerup', (event) => finishGesture(event, false), { signal });
    stage.addEventListener('pointercancel', (event) => finishGesture(event, true), { signal });
    stage.addEventListener('pointerleave', handlePointerLeave, { signal });
    stage.addEventListener('dragstart', handleDragStart, { signal });
    stage.addEventListener('wheel', handleWheel, { signal, passive: false });
    stage.addEventListener('click', handleClickCapture, { signal, capture: true });
    stage.addEventListener('click', handleClick, { signal });
    stage.addEventListener('focusin', handleFocus, { signal });
    stage.addEventListener('focusout', handleBlur, { signal });
    return () => listeners.abort();
  }, [edition.drawings, goTo, placeRing, sheetsElement]);

  const handleCuttingClose = useCallback((index: number) => {
    // The focus handler above turns the newspaper to this link.
    const link = stageRef.current?.querySelector<HTMLElement>(`[data-drawing="${index}"]`);
    link?.focus({ preventScroll: true });
    // Focus still has to come back here for the keyboard, but a mouse user gets no frame for it.
    if (link && openedByPointer.current) {
      focusLink.current = null;
      placeRing();
      link.style.outline = 'none';
      link.addEventListener('blur', () => link.style.removeProperty('outline'), { once: true });
    }
    setCutting(null);
  }, [placeRing]);

  const current = Math.max(0, Math.min(stops - 1, stop));
  const label = mode ? stopLabel(edition, mode, current) : '';
  const showHint = !turned && (webgl || coarse === true);

  return (
    <>
      <div ref={ringRef} className={styles.ring} aria-hidden="true" />

      {mode && stops > 1 ? (
        <nav
          className={styles.controls}
          aria-label="Bla i avisa"
          style={cutting ? { visibility: 'hidden' } : undefined}
        >
          <button
            ref={prevRef}
            type="button"
            className={styles.turn}
            aria-label={mode === 'strip' ? 'Førre teikning' : 'Førre side'}
            disabled={current === 0}
            onClick={() => goTo(current - 1)}
          >
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
              <path d="M15 5l-7 7 7 7" />
            </svg>
          </button>
          <input
            ref={scrubRef}
            type="range"
            className={styles.scrub}
            min={0}
            max={stops - 1}
            step={1}
            value={current}
            aria-label="Bla i avisa"
            aria-valuetext={label}
            aria-keyshortcuts="ArrowLeft ArrowRight Home End"
            onChange={(event) => goTo(Number(event.target.value))}
          />
          <button
            ref={nextRef}
            type="button"
            className={styles.turn}
            aria-label={mode === 'strip' ? 'Neste teikning' : 'Neste side'}
            disabled={current === stops - 1}
            onClick={() => goTo(current + 1)}
          >
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
              <path d="M9 5l7 7-7 7" />
            </svg>
          </button>
          <p className={styles.label} aria-live="polite">
            {label}
          </p>
          {showHint && (
            <p className={styles.hint}>
              {mode === 'strip'
                ? 'Sveip for å bla, trykk på ei teikning for å sjå ho stort'
                : 'Dra i sida for å bla, klikk på ei teikning for å sjå ho stort'}
            </p>
          )}
        </nav>
      ) : (
        <div className={styles.controls} />
      )}

      {cutting && (
        <Cutting
          drawings={edition.drawings}
          initial={cutting.index}
          origin={cutting.origin}
          onClose={handleCuttingClose}
        />
      )}
    </>
  );
}
