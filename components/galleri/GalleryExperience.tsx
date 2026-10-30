'use client';

import { useCallback, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import GalleryStage from './GalleryStage';
import PaintingDialog from './PaintingDialog';
import type { GalleryScene } from './scene/createGalleryScene';
import type { Painting, ScreenRect } from './types';

interface GalleryExperienceProps {
  paintings: Painting[];
  /** The server-rendered list of all paintings. */
  children: ReactNode;
}

interface Selection {
  index: number;
  source: 'room' | 'list';
  /** The list entry that opened the dialog. */
  element: HTMLElement | null;
}

function rectOf(element: HTMLElement | null): ScreenRect | null {
  const image = element?.querySelector('img') ?? element;
  if (!image) return null;
  const rect = image.getBoundingClientRect();
  return { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
}

export default function GalleryExperience({ paintings, children }: GalleryExperienceProps) {
  const sceneRef = useRef<GalleryScene | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const openingFrom = useRef<ScreenRect | null>(null);

  const open = useCallback((index: number, source: 'room' | 'list', element: HTMLElement | null = null) => {
    openingFrom.current = source === 'room' ? (sceneRef.current?.paintingRect(index) ?? null) : rectOf(element);
    sceneRef.current?.setCovered(true);
    sceneRef.current?.placeAt(index);
    setSelection({ index, source, element });
  }, []);

  const openFromRoom = useCallback((index: number) => open(index, 'room'), [open]);

  function onListClick(event: MouseEvent<HTMLDivElement>) {
    if (event.metaKey || event.ctrlKey || event.shiftKey) return;
    const link = (event.target as HTMLElement).closest<HTMLElement>('[data-painting-index]');
    if (!link) return;
    event.preventDefault();
    open(Number(link.dataset.paintingIndex), 'list', link);
  }

  const originRect = useCallback(() => openingFrom.current, []);

  const returnRect = useCallback(() => {
    if (!selection) return null;
    if (selection.source === 'list') return rectOf(selection.element);
    sceneRef.current?.setCovered(false);
    return sceneRef.current?.paintingRect(selection.index) ?? null;
  }, [selection]);

  const onClosed = useCallback(() => {
    sceneRef.current?.setCovered(false);
    setSelection(null);
  }, []);

  function navigate(direction: 1 | -1) {
    if (!selection) return;
    const index = (selection.index + direction + paintings.length) % paintings.length;
    sceneRef.current?.placeAt(index);
    setSelection({ index, source: 'room', element: null });
  }

  return (
    <>
      <GalleryStage paintings={paintings} sceneRef={sceneRef} onOpen={openFromRoom} />
      <div onClick={onListClick}>{children}</div>
      <PaintingDialog
        painting={selection ? paintings[selection.index] : null}
        total={paintings.length}
        originRect={originRect}
        returnRect={returnRect}
        onNavigate={navigate}
        onClosed={onClosed}
      />
    </>
  );
}
