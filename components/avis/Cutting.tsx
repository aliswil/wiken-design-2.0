'use client';

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import Image, { getImageProps } from 'next/image';
import styles from './avis.module.css';
import { sanityLoader } from './sanityLoader';
import type { AvisDrawing } from './types';

interface CuttingProps {
  drawings: AvisDrawing[];
  /** The drawing to open on. */
  initial: number;
  /** Where the drawing sits in the newspaper; the cutting flies out from there. */
  origin: DOMRect | null;
  /** The dialog has closed with this drawing showing. Must be stable. */
  onClose: (index: number) => void;
}

const FLY_MS = 250;
const SWIPE_PX = 48;
const CLICK_SLOP_PX = 8;

function seededRandom(seed: string): () => number {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    hash = Math.imul(hash ^ seed.charCodeAt(i), 16777619);
  }
  return () => {
    hash = (hash + 0x6d2b79f5) | 0;
    let t = Math.imul(hash ^ (hash >>> 15), 1 | hash);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The same drawing is always cut the same way. */
function scissorCut(id: string): { clipPath: string; transform: string } {
  const random = seededRandom(id);
  const depth = 0.6;
  const cuts = 5;
  const edge = (point: (along: number, inset: number) => string): string[] => {
    const points = [point(random() * depth, random() * depth)];
    for (let i = 0; i < cuts; i++) {
      points.push(point(((i + 0.2 + random() * 0.6) / cuts) * 100, random() * depth));
    }
    return points;
  };
  const polygon = [
    ...edge((a, d) => `${a.toFixed(2)}% ${d.toFixed(2)}%`),
    ...edge((a, d) => `${(100 - d).toFixed(2)}% ${a.toFixed(2)}%`),
    ...edge((a, d) => `${(100 - a).toFixed(2)}% ${(100 - d).toFixed(2)}%`),
    ...edge((a, d) => `${d.toFixed(2)}% ${(100 - a).toFixed(2)}%`),
  ];
  return {
    clipPath: `polygon(${polygon.join(',')})`,
    transform: `rotate(${((random() - 0.5) * 0.9).toFixed(3)}deg)`,
  };
}

function imageSizes(drawing: AvisDrawing): string {
  const ratio = (drawing.width / drawing.height).toFixed(3);
  return `min(calc((100vh - 64px) * ${ratio}), calc(100vw - 32px))`;
}

function preload(drawing: AvisDrawing): void {
  const { props } = getImageProps({
    src: drawing.url,
    alt: '',
    width: drawing.width,
    height: drawing.height,
    sizes: imageSizes(drawing),
    loader: sanityLoader(drawing.width),
  });
  const image = new window.Image();
  if (props.sizes) image.sizes = props.sizes;
  if (props.srcSet) image.srcset = props.srcSet;
  image.src = props.src;
}

/** Flies the paper from the drawing's place in the newspaper to where it ends up. */
function flyIn(origin: DOMRect, dialog: HTMLDialogElement, paper: HTMLElement): Animation[] {
  const image = paper.querySelector('img');
  if (!image) return [];
  const to = paper.getBoundingClientRect();
  const from = image.getBoundingClientRect();
  if (from.width === 0 || origin.width === 0) return [];
  const scale = origin.width / from.width;
  const paperX = to.left + to.width / 2;
  const paperY = to.top + to.height / 2;
  const imageX = from.left + from.width / 2 - paperX;
  const imageY = from.top + from.height / 2 - paperY;
  const x = origin.left + origin.width / 2 - paperX - scale * imageX;
  const y = origin.top + origin.height / 2 - paperY - scale * imageY;
  const rest = paper.style.transform;
  const timing = { duration: FLY_MS, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' };
  return [
    paper.animate(
      [{ transform: `translate(${x}px, ${y}px) scale(${scale}) ${rest}` }, { transform: rest }],
      timing,
    ),
    dialog.animate({ opacity: [0, 1] }, { ...timing, pseudoElement: '::backdrop' }),
  ];
}

export default function Cutting({ drawings, initial, origin, onClose }: CuttingProps) {
  const [index, setIndex] = useState(initial);
  const indexRef = useRef(initial);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const paperRef = useRef<HTMLDivElement>(null);
  const prevRef = useRef<HTMLButtonElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const focusHeir = useRef<HTMLButtonElement | null>(null);
  const pressStart = useRef<{ x: number; y: number; onBackdrop: boolean } | null>(null);
  const headingId = useId();

  const drawing = drawings[index];
  const count = drawings.length;
  const cut = useMemo(() => scissorCut(drawing.id), [drawing.id]);

  useEffect(() => {
    const dialog = dialogRef.current;
    const paper = paperRef.current;
    if (!dialog || !paper) return;

    // StrictMode closes and reopens at once, and the close event of the first run
    // arrives while the dialog is open again.
    const handleClose = () => {
      if (!dialog.open) onClose(indexRef.current);
    };
    dialog.addEventListener('close', handleClose);
    if (!dialog.open) dialog.showModal();

    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const flight = origin && !still ? flyIn(origin, dialog, paper) : [];

    return () => {
      flight.forEach((animation) => animation.cancel());
      dialog.removeEventListener('close', handleClose);
      dialog.close();
    };
  }, [origin, onClose]);

  const step = useCallback(
    (delta: number) => {
      const target = indexRef.current + delta;
      if (target < 0 || target >= count) return;
      // A button that becomes disabled would drop the focus out of the dialog.
      const active = document.activeElement;
      if (target === 0 && active === prevRef.current) focusHeir.current = nextRef.current;
      if (target === count - 1 && active === nextRef.current) focusHeir.current = prevRef.current;
      indexRef.current = target;
      setIndex(target);
    },
    [count],
  );

  // After the commit, because with two drawings the heir was disabled until now.
  useLayoutEffect(() => {
    focusHeir.current?.focus();
    focusHeir.current = null;
  }, [index]);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        step(event.key === 'ArrowLeft' ? -1 : 1);
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [step]);

  useEffect(() => {
    [drawings[index - 1], drawings[index + 1]].forEach((neighbour) => {
      if (neighbour) preload(neighbour);
    });
  }, [drawings, index]);

  const handlePointerDown = (event: ReactPointerEvent<HTMLDialogElement>) => {
    pressStart.current = {
      x: event.clientX,
      y: event.clientY,
      onBackdrop: event.target === event.currentTarget,
    };
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLDialogElement>) => {
    const start = pressStart.current;
    if (!start || event.pointerType === 'mouse') return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (Math.abs(dx) > SWIPE_PX && Math.abs(dx) > Math.abs(dy) * 1.5) step(dx < 0 ? 1 : -1);
  };

  const handleClick = (event: ReactMouseEvent<HTMLDialogElement>) => {
    const start = pressStart.current;
    if (event.target !== event.currentTarget || !start?.onBackdrop) return;
    const moved = Math.hypot(event.clientX - start.x, event.clientY - start.y);
    if (moved < CLICK_SLOP_PX) event.currentTarget.close();
  };

  const position = `Teikning ${index + 1} av ${count}`;

  return (
    <dialog
      ref={dialogRef}
      className={styles.cutting}
      aria-labelledby={drawing.title ? headingId : undefined}
      aria-label={drawing.title ? undefined : position}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onClick={handleClick}
    >
      <button
        type="button"
        className={styles.cuttingClose}
        aria-label="Lukk"
        onClick={() => dialogRef.current?.close()}
      >
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>

      <div ref={paperRef} className={styles.cuttingPaper} style={cut}>
        <Image
          key={drawing.id}
          className={styles.cuttingImage}
          style={{ '--r': drawing.width / drawing.height } as CSSProperties}
          src={drawing.url}
          loader={sanityLoader(drawing.width)}
          alt={drawing.alt}
          width={drawing.width}
          height={drawing.height}
          sizes={imageSizes(drawing)}
          loading="eager"
          draggable={false}
        />
        <div className={styles.cuttingText} aria-live="polite" aria-atomic="true">
          {drawing.title && <h2 id={headingId}>{drawing.title}</h2>}
          {drawing.description && <p>{drawing.description}</p>}
          <p className={styles.cuttingMeta}>{position}</p>
        </div>
      </div>

      {count > 1 && (
        <>
          <button
            ref={prevRef}
            type="button"
            className={styles.cuttingPrev}
            aria-label="Førre teikning"
            disabled={index === 0}
            onClick={() => step(-1)}
          >
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
              <path d="M15 5l-7 7 7 7" />
            </svg>
          </button>
          <button
            ref={nextRef}
            type="button"
            className={styles.cuttingNext}
            aria-label="Neste teikning"
            disabled={index === count - 1}
            onClick={() => step(1)}
          >
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
              <path d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </>
      )}
    </dialog>
  );
}
