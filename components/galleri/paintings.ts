import { urlFor } from '@/lib/sanity.client';
import type { GalleryItem, PaintingTone } from '@/lib/sanity.queries';
import type { Painting } from './types';

const FALLBACK_TONE = '#a9b89f';

export function toPaintings(items: GalleryItem[], tones: PaintingTone[]): Painting[] {
  const toneById = new Map(tones.map((tone) => [tone._id, tone]));

  return items
    .filter((item) => item.drawing?.asset)
    .map((item, index) => {
      const tone = toneById.get(item._id);
      const palette = [...new Set(tone?.palette ?? [])].filter((color): color is string => Boolean(color));
      // WebGL needs CORS-clean images, and the Sanity CDN rejects other origins, so textures
      // go through the image optimizer on this site. `width` must be one of its allowed sizes.
      const textureUrl = (width: number) => {
        const source = urlFor(item.drawing).width(width).fit('max').url();
        return `/_next/image?url=${encodeURIComponent(source)}&w=${width}&q=75`;
      };

      return {
        id: item._id,
        number: index + 1,
        title: item.title || item.name || null,
        description: item.description || null,
        width: item.drawing.asset.metadata?.dimensions.width ?? 1000,
        height: item.drawing.asset.metadata?.dimensions.height ?? 1000,
        url: item.drawing.asset.url,
        lqip: tone?.lqip ?? null,
        palette: palette.length > 0 ? palette : [FALLBACK_TONE],
        texture: {
          medium: textureUrl(384),
          large: textureUrl(1200),
          largeTouch: textureUrl(1080),
        },
      };
    });
}
