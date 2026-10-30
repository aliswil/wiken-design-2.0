import Link from 'next/link';
import { getGalleryItems } from '@/lib/sanity.queries';
import GalleryGrid from '@/components/GalleryGrid';

export const revalidate = 60; // Revalidate every 60 seconds

export default async function MaleriarPage() {
  const items = await getGalleryItems('maleriar');

  return (
    <>
      <div className="mx-auto flex max-w-[1200px] justify-end px-8 pt-6 md:pt-10">
        <Link
          href="/maleriar/galleri"
          className="group inline-flex min-h-11 items-center gap-2 text-sm font-light tracking-wide text-gray-700 hover:text-black"
        >
          <span className="border-b border-gray-400 pb-0.5 transition-colors group-hover:border-gray-900">
            Gå inn i galleriet
          </span>
          <span aria-hidden="true">→</span>
        </Link>
      </div>
      <GalleryGrid items={items} />
    </>
  );
}
