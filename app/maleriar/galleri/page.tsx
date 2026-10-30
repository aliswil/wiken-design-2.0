import type { Metadata } from 'next';
import Link from 'next/link';
import GalleryExperience from '@/components/galleri/GalleryExperience';
import PaintingList from '@/components/galleri/PaintingList';
import { toPaintings } from '@/components/galleri/paintings';
import { getGalleryItems, getPaintingTones } from '@/lib/sanity.queries';

export const revalidate = 60;

export const metadata: Metadata = {
  title: 'Stille vatn – galleri | Wiken Design',
  description:
    'Rom fylte med stille vatn. Gå på ein sti frå rom til rom, sjå måleria spegle seg i vatnet, og trykk på eit bilete for å sjå det stort.',
};

export default async function GalleriPage() {
  const [items, tones] = await Promise.all([getGalleryItems('maleriar'), getPaintingTones('maleriar')]);
  const paintings = toPaintings(items, tones);

  if (paintings.length === 0) {
    return (
      <div className="mx-auto max-w-[1200px] px-6 py-16 md:px-16">
        <Link href="/maleriar" className="inline-flex min-h-11 items-center text-sm font-light tracking-wide text-gray-600 hover:text-gray-900">
          ← Maleriar
        </Link>
        <h1 className="mt-4 text-3xl font-light tracking-wide text-gray-900">Stille vatn</h1>
        <p className="mt-3 font-light text-gray-600">Bilete kjem seinare.</p>
      </div>
    );
  }

  return (
    <GalleryExperience paintings={paintings}>
      <PaintingList paintings={paintings} />
    </GalleryExperience>
  );
}
