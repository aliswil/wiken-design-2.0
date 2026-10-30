import type { Metadata } from 'next';
import { Old_Standard_TT } from 'next/font/google';
import { urlFor } from '@/lib/sanity.client';
import { getGalleryItems, type GalleryItem } from '@/lib/sanity.queries';
import AvisEdition from '@/components/avis/AvisEdition';
import AvisReader from '@/components/avis/AvisReader';
import { buildEdition } from '@/components/avis/edition';
import type { AvisDrawing } from '@/components/avis/types';
import styles from '@/components/avis/avis.module.css';

export const revalidate = 600;

const title = 'Avis – Avisteikningar | Wiken Design';
const description = 'Avisteikningar av Wiken Design, samla i ei avis du kan bla i. Akvarell og tusj.';

export const metadata: Metadata = {
  title,
  description,
  openGraph: { title, description, type: 'website' },
};

const oldStandard = Old_Standard_TT({
  weight: ['400', '700'],
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-avis',
});

const FALLBACK_SIZE = { width: 510, height: 913 };

function toDrawing(item: GalleryItem, index: number): AvisDrawing {
  const title = (item.title || item.name)?.trim() || undefined;
  const size = item.drawing.asset.metadata?.dimensions ?? FALLBACK_SIZE;
  return {
    id: item._id,
    title,
    description: item.description?.trim() || undefined,
    url: urlFor(item.drawing).url(),
    width: size.width,
    height: size.height,
    alt: title ?? `Avisteikning ${index + 1}`,
  };
}

async function loadDrawings(): Promise<AvisDrawing[]> {
  // A failure must throw: error.tsx shows the notice, and ISR keeps the last good page.
  const items = await getGalleryItems('avisteikningar');
  return items.filter((item) => item.drawing?.asset?.url).map(toDrawing);
}

export default async function AvisPage() {
  const edition = buildEdition(await loadDrawings());

  return (
    <div lang="nn" className={oldStandard.variable}>
      {edition.pages.length === 0 ? (
        <div className={styles.notice}>
          <h1>Avisteikningar</h1>
          <p>Bilete kjem seinare.</p>
        </div>
      ) : (
        <div className={styles.reader}>
          <div className={styles.stage} data-avis-stage>
            <AvisEdition edition={edition} />
          </div>
          <AvisReader edition={edition} />
        </div>
      )}
    </div>
  );
}
