import SanityImage from './SanityImage';
import type { Painting } from './types';

export function paintingLabel(painting: Painting, total: number) {
  return `Måleri ${painting.number} av ${total}${painting.title ? `: ${painting.title}` : ', utan tittel'}`;
}

interface PaintingListProps {
  paintings: Painting[];
}

/** The whole collection as plain links. It works without JavaScript and without WebGL. */
export default function PaintingList({ paintings }: PaintingListProps) {
  return (
    <section aria-labelledby="alle-maleria" className="mx-auto max-w-[1200px] scroll-mt-28 px-6 py-16 md:px-16 md:py-24">
      <h2 id="alle-maleria" className="scroll-mt-28 text-sm font-light tracking-wide text-gray-600">
        Alle måleria
      </h2>
      <ul className="mt-8 columns-2 gap-6 md:columns-3 md:gap-10">
        {paintings.map((painting) => (
          <li key={painting.id} className="mb-6 break-inside-avoid md:mb-10">
            <a
              href={`${painting.url}?w=1800&fit=max&auto=format`}
              data-painting-index={painting.number - 1}
              aria-label={`${paintingLabel(painting, paintings.length)}. Opne stort.`}
              className="group block focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-gray-900"
            >
              <SanityImage
                src={painting.url}
                alt=""
                width={painting.width}
                height={painting.height}
                sizes="(min-width: 768px) 30vw, 45vw"
                loading="lazy"
                quality={68}
                placeholder={painting.lqip ? 'blur' : 'empty'}
                blurDataURL={painting.lqip ?? undefined}
                className="h-auto w-full transition-opacity duration-300 group-hover:opacity-90"
              />
              <span aria-hidden="true" className="mt-2 block text-xs font-light tracking-wide text-gray-600">
                {painting.number}
                {painting.title ? ` · ${painting.title}` : ''}
              </span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
