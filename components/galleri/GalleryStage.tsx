'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type RefObject } from 'react';
import { detectRoomSupport, type RoomSupport } from './capability';
import type { GalleryScene } from './scene/createGalleryScene';
import type { Painting } from './types';

type Mode = 'pending' | 'room' | 'list';

interface GalleryStageProps {
  paintings: Painting[];
  sceneRef: RefObject<GalleryScene | null>;
  onOpen(index: number, source: 'room'): void;
}

const CONTROL =
  'inline-flex min-h-11 min-w-11 items-center justify-center bg-background text-gray-800 transition-colors hover:text-black focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-900';

export default function GalleryStage({ paintings, sceneRef, onOpen }: GalleryStageProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<Mode>('pending');
  const [support, setSupport] = useState<RoomSupport>('ok');
  const [ready, setReady] = useState(false);
  const [hasMoved, setHasMoved] = useState(false);
  const [current, setCurrent] = useState(0);
  const onOpenRef = useRef(onOpen);

  useEffect(() => {
    onOpenRef.current = onOpen;
  });

  useEffect(() => {
    const detected = detectRoomSupport();
    // Whether WebGL exists can only be known in the browser, after hydration.
    setSupport(detected);
    setMode(detected === 'ok' ? 'room' : 'list');
  }, []);

  useEffect(() => {
    if (mode !== 'room' || !hostRef.current) return;
    const host = hostRef.current;
    let scene: GalleryScene | null = null;
    let cancelled = false;

    import('./scene/createGalleryScene')
      .then(({ createGalleryScene }) => {
        if (cancelled) return;
        scene = createGalleryScene({
          host,
          paintings,
          reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
          onCurrentChange: setCurrent,
          onOpen: (index) => onOpenRef.current(index, 'room'),
          onFirstMove: () => setHasMoved(true),
          onReady: () => setReady(true),
          onFailure: () => {
            setSupport('none');
            setMode('list');
          },
        });
        sceneRef.current = scene;
      })
      .catch(() => {
        setSupport('none');
        setMode('list');
      });

    return () => {
      cancelled = true;
      scene?.dispose();
      sceneRef.current = null;
      setReady(false);
    };
  }, [mode, paintings, sceneRef]);

  if (mode === 'list') {
    return (
      <section className="mx-auto max-w-[1200px] px-6 pt-8 md:px-16 md:pt-12">
        <Link href="/maleriar" className="inline-flex min-h-11 items-center text-sm font-light tracking-wide text-gray-600 hover:text-gray-900">
          ← Måleri
        </Link>
        <h1 className="mt-4 text-3xl font-light tracking-wide text-gray-900">Stille vatn</h1>
        <p className="mt-3 max-w-xl font-light text-gray-600">
          {support === 'none'
            ? 'Dette galleriet er eigentleg ei rekkje rom fylte med stille vatn, men nettlesaren din kan ikkje vise det. Her heng alle måleria i staden.'
            : 'Dette galleriet er eigentleg ei rekkje rom fylte med stille vatn. For å spare data og straum på denne eininga viser vi måleria som ei liste først.'}
        </p>
        {support === 'weak' && (
          <button
            type="button"
            onClick={() => setMode('room')}
            className="mt-4 inline-flex min-h-11 items-center border-b border-gray-400 font-light tracking-wide text-gray-800 hover:border-gray-900 hover:text-black"
          >
            Opne rommet likevel
          </button>
        )}
      </section>
    );
  }

  const painting = paintings[current];

  return (
    <section
      aria-label="Rommet"
      className="relative h-[calc(100svh-81px)] min-h-[440px] overflow-hidden md:h-[calc(100svh-113px)]"
    >
      <div
        ref={hostRef}
        tabIndex={0}
        role="application"
        aria-label="Tredimensjonalt rom med måleri. Piltastane styrer, Enter opnar det nærmaste måleriet. Alle måleria finst òg som liste lenger nede på sida."
        className={`absolute inset-0 transition-opacity duration-1000 motion-reduce:transition-none focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-gray-900 ${ready ? 'opacity-100' : 'opacity-0'}`}
      />

      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-4 p-3 md:p-5">
        <div className="pointer-events-auto bg-background px-3 py-1">
          <Link href="/maleriar" className="inline-flex min-h-11 items-center text-sm font-light tracking-wide text-gray-700 hover:text-black">
            ← Måleri
          </Link>
          <h1 className="pb-2 text-xl font-light tracking-wide text-gray-900 md:text-2xl">Stille vatn</h1>
        </div>
      </div>

      {mode === 'pending' || !ready ? (
        <p role="status" className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm font-light tracking-wide text-gray-500">
          Vatnet legg seg …
        </p>
      ) : null}

      {ready && !hasMoved && (
        <p className="pointer-events-none absolute inset-x-4 bottom-20 mx-auto w-fit max-w-md bg-background px-4 py-2 text-center text-sm font-light tracking-wide text-gray-700">
          Trykk på stien eller vatnet for å gå dit, også inn i neste rom. Dra for å sjå deg rundt. Trykk på eit måleri for å sjå det stort.
          <span className="hidden md:inline"> Piltastane styrer òg.</span>
        </p>
      )}

      <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 p-3 md:p-5">
        <div className="flex items-center" role="group" aria-label="Gå mellom måleria">
          <button
            type="button"
            aria-label="Førre måleri"
            disabled={!ready}
            onClick={() => sceneRef.current?.walkToPainting((current - 1 + paintings.length) % paintings.length)}
            className={CONTROL}
          >
            <span aria-hidden="true">←</span>
          </button>
          <button
            type="button"
            disabled={!ready}
            onClick={() => onOpen(current, 'room')}
            className={`${CONTROL} px-3 text-sm font-light tracking-wide`}
          >
            <span aria-live="polite">
              {painting ? `Måleri ${painting.number} av ${paintings.length}` : ''}
            </span>
            <span className="sr-only">, sjå stort</span>
          </button>
          <button
            type="button"
            aria-label="Neste måleri"
            disabled={!ready}
            onClick={() => sceneRef.current?.walkToPainting((current + 1) % paintings.length)}
            className={CONTROL}
          >
            <span aria-hidden="true">→</span>
          </button>
        </div>
        <a href="#alle-maleria" className={`${CONTROL} px-3 text-sm font-light tracking-wide`}>
          Alle måleria
        </a>
      </div>
    </section>
  );
}
