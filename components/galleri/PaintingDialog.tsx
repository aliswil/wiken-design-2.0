'use client';

import { useCallback, useEffect, useRef } from 'react';
import SanityImage from './SanityImage';
import type { Painting, ScreenRect } from './types';

const OPEN_MS = 560;
const CLOSE_MS = 340;
const EASING = 'cubic-bezier(0.22, 0.8, 0.2, 1)';

interface PaintingDialogProps {
  painting: Painting | null;
  total: number;
  /** Where the painting is on the page, so the picture can grow out of it and return to it. */
  originRect(): ScreenRect | null;
  returnRect(): ScreenRect | null;
  onNavigate(direction: 1 | -1): void;
  onClosed(): void;
}

function transformFrom(rect: ScreenRect, image: DOMRect) {
  const scale = Math.max(rect.width / image.width, rect.height / image.height);
  const x = rect.x + rect.width / 2 - (image.left + image.width / 2);
  const y = rect.y + rect.height / 2 - (image.top + image.height / 2);
  return `translate(${x}px, ${y}px) scale(${scale})`;
}

export default function PaintingDialog({ painting, total, originRect, returnRect, onNavigate, onClosed }: PaintingDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const pictureRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const closing = useRef(false);
  const isOpen = painting !== null;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || !isOpen || dialog.open) return;

    closing.current = false;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const rect = reduced ? null : originRect();
    document.documentElement.style.overflow = 'hidden';
    dialog.showModal();
    closeButtonRef.current?.focus();

    if (!reduced) {
      backdropRef.current?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: OPEN_MS * 0.7, easing: 'ease-out' });
      const picture = pictureRef.current;
      if (picture && rect) {
        const from = transformFrom(rect, picture.getBoundingClientRect());
        picture.animate([{ transform: from }, { transform: 'none' }], { duration: OPEN_MS, easing: EASING });
      }
    }
  }, [isOpen, originRect]);

  const finishClose = useCallback(() => {
    const dialog = dialogRef.current;
    document.documentElement.style.overflow = '';
    if (dialog?.open) dialog.close();
    onClosed();
  }, [onClosed]);

  const close = useCallback(() => {
    if (closing.current) return;
    closing.current = true;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const picture = pictureRef.current;
    const backdrop = backdropRef.current;
    if (reduced || !picture || !backdrop) {
      finishClose();
      return;
    }
    const rect = returnRect();
    const options = { duration: CLOSE_MS, easing: 'ease-in-out', fill: 'forwards' as const };
    const animations = [backdrop.animate([{ opacity: 1 }, { opacity: 0 }], options)];
    animations.push(
      rect
        ? picture.animate([{ transform: 'none' }, { transform: transformFrom(rect, picture.getBoundingClientRect()) }], options)
        : picture.animate([{ opacity: 1 }, { opacity: 0 }], options),
    );
    void Promise.all(animations.map((animation) => animation.finished)).then(finishClose, finishClose);
  }, [finishClose, returnRect]);

  useEffect(() => {
    return () => {
      document.documentElement.style.overflow = '';
    };
  }, []);

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === 'ArrowRight') onNavigate(1);
    if (event.key === 'ArrowLeft') onNavigate(-1);
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={painting?.title ? 'maleri-tittel' : 'maleri-nummer'}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onKeyDown={onKeyDown}
      className="fixed inset-0 m-0 h-svh max-h-none w-full max-w-none overflow-y-auto bg-transparent p-0 text-gray-900 backdrop:bg-transparent"
    >
      <div ref={backdropRef} onClick={close} aria-hidden="true" className="fixed inset-0 bg-background" />
      {painting && (
        <div className="pointer-events-none relative flex min-h-full flex-col md:flex-row md:items-stretch">
          <div className="flex flex-1 items-center justify-center p-3 pt-16 md:min-w-0 md:p-8">
            <div
              ref={pictureRef}
              className="pointer-events-auto origin-center"
              style={{ aspectRatio: `${painting.width} / ${painting.height}`, width: `min(100%, calc((100svh - 13rem) * ${painting.width / painting.height}))` }}
            >
              <SanityImage
                key={painting.id}
                src={painting.url}
                alt={painting.title ? `${painting.title}, måleri ${painting.number} av ${total}` : `Måleri ${painting.number} av ${total}`}
                width={painting.width}
                height={painting.height}
                sizes="(min-width: 768px) 75vw, 100vw"
                quality={85}
                loading="eager"
                placeholder={painting.lqip ? 'blur' : 'empty'}
                blurDataURL={painting.lqip ?? undefined}
                className="h-auto w-full shadow-[0_18px_50px_-22px_rgba(30,40,30,0.55)]"
              />
            </div>
          </div>

          <div className="flex flex-col justify-end gap-3 px-5 pb-5 md:w-72 md:shrink-0 md:px-8 md:pb-8 *:pointer-events-auto">
            <p id="maleri-nummer" className="text-xs font-light tracking-wide text-gray-600">
              Måleri {painting.number} av {total}
            </p>
            {painting.title && (
              <h2 id="maleri-tittel" className="text-xl font-light tracking-wide text-gray-900">
                {painting.title}
              </h2>
            )}
            {painting.description && <p className="font-light leading-relaxed text-gray-700">{painting.description}</p>}
            <div className="mt-2 flex items-center gap-1">
              <button
                type="button"
                aria-label="Førre måleri"
                onClick={() => onNavigate(-1)}
                className="inline-flex min-h-11 min-w-11 items-center justify-center text-gray-700 hover:text-black"
              >
                <span aria-hidden="true">←</span>
              </button>
              <button
                type="button"
                aria-label="Neste måleri"
                onClick={() => onNavigate(1)}
                className="inline-flex min-h-11 min-w-11 items-center justify-center text-gray-700 hover:text-black"
              >
                <span aria-hidden="true">→</span>
              </button>
            </div>
          </div>

          <button
            ref={closeButtonRef}
            type="button"
            onClick={close}
            className="pointer-events-auto absolute right-2 top-2 inline-flex min-h-11 min-w-11 items-center justify-center px-3 text-sm font-light tracking-wide text-gray-700 hover:text-black md:right-5 md:top-4"
          >
            Lukk
          </button>
        </div>
      )}
    </dialog>
  );
}
