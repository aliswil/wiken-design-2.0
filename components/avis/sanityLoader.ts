import type { ImageLoader } from 'next/image';

/** Sanity CDN image URLs that never ask for more than the original's width. */
export function sanityLoader(originalWidth: number): ImageLoader {
  return ({ src, width }) => `${src}?w=${Math.min(width, originalWidth)}&q=85&auto=format`;
}
