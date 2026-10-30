import Link from 'next/link';
import { getGalleryItems, GalleryItem } from '@/lib/sanity.queries';
import GalleryGrid from '@/components/GalleryGrid';

export const revalidate = 0; // Don't cache during development

export default async function AvistegningarPage() {
  let items: GalleryItem[] = [];
  let error: string | null = null;

  try {
    items = await getGalleryItems('avisteikningar');
    console.log('Avisteikningar items:', items.length); // Debug log
  } catch (e: any) {
    error = e.message;
    console.error('Error fetching avisteikningar:', e);
  }

  if (error) {
    return (
      <div className="min-h-screen p-12">
        <div className="container mx-auto">
          <div className="bg-red-100 text-red-800 p-4 rounded">
            <p className="font-bold">Error loading images:</p>
            <p>{error}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="mx-auto flex max-w-[1200px] justify-end px-8 pt-6 md:pt-10">
        <Link
          href="/avisteikningar/avis"
          prefetch={false}
          className="group inline-flex min-h-11 items-center gap-2 text-sm font-light tracking-wide text-gray-700 hover:text-black"
        >
          <span className="border-b border-gray-400 pb-0.5 transition-colors group-hover:border-gray-900">
            Bla i avisa
          </span>
          <span aria-hidden="true">→</span>
        </Link>
      </div>
      <GalleryGrid items={items} />
    </>
  );
}
