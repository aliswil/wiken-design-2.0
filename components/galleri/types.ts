export interface Painting {
  id: string;
  /** 1-based position in the room, used for captions when the painting has no title. */
  number: number;
  title: string | null;
  description: string | null;
  width: number;
  height: number;
  /** Original image on the Sanity CDN, resized by SanityImage. */
  url: string;
  lqip: string | null;
  /** Colours sampled from the painting, the dominant one first. */
  palette: string[];
  texture: {
    /** Loaded when the painting comes into view. */
    medium: string;
    /** Loaded when the visitor stops close to it. */
    large: string;
    /** Smaller variant of `large` for touch devices. */
    largeTouch: string;
  };
}

export interface ScreenRect {
  x: number;
  y: number;
  width: number;
  height: number;
}
