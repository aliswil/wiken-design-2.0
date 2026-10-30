export type PressMode = 'spread' | 'strip';

export interface AvisDrawing {
  id: string;
  title?: string;
  description?: string;
  /** Sanity CDN URL of the original, without parameters. */
  url: string;
  width: number;
  height: number;
  /** Always set: the title, or a numbered fallback. */
  alt: string;
}

export type AvisPageLayout = 'front' | 'duo' | 'lead' | 'solo' | 'wide' | 'blank' | 'back';

export interface AvisPage {
  layout: AvisPageLayout;
  /** 1-based page number, shown as the folio. */
  number: number;
  /** Indexes into the edition's drawings. */
  drawings: number[];
}

export interface AvisEdition {
  drawings: AvisDrawing[];
  /** Always an even number of pages, so that every leaf has two sides. */
  pages: AvisPage[];
  /** Openings: the front page alone, then pairs, then the back page alone. */
  spreads: number[][];
}

export interface PressOptions {
  canvas: HTMLCanvasElement;
  /** The element carrying data-avis-sheets. */
  sheets: HTMLElement;
  mode: PressMode;
  stop: number;
  /** Skips the software-renderer refusal and the frame-rate watchdog, for testing. */
  force: boolean;
  /** The first frame is on the canvas and lines up with the DOM below it. */
  onReady: () => void;
  /** A drag finished by landing on another stop. */
  onStop: (stop: number) => void;
  /** Context lost or too slow: the reader must dispose the press and show the DOM. */
  onFail: (reason: 'context-lost' | 'too-slow') => void;
}

export interface Press {
  /** Animates to the stop. Far jumps turn at most three leaves and skip the rest. */
  turnTo(stop: number): void;
  /** Coordinates are client pixels. Returns false when there is no leaf to grab there. */
  grab(clientX: number, clientY: number): boolean;
  drag(clientX: number, clientY: number): void;
  /** velocityX is in client pixels per second. */
  release(velocityX: number): void;
  /** Lifts the nearest outer corner slightly, or lets it down when null. */
  hover(clientX: number | null, clientY: number | null): void;
  /** One small lift of the page, to show it can be turned. */
  hint(): void;
  /** Re-measures the DOM and re-rasterizes. Call after the layout changed. */
  resize(): void;
  dispose(): void;
}

export type CreatePress = (options: PressOptions) => Press | null;
