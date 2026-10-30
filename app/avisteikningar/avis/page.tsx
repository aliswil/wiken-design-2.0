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
const description = 'Avisteikningar av Wiken Design, sette opp som ei avis du kan bla i. Akvarell og tusj.';

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

async function loadDrawings(): Promise<AvisDrawing[] | null> {
  try {
    const items = await getGalleryItems('avisteikningar');
    return items.filter((item) => item.drawing?.asset?.url).map(toDrawing);
  } catch {
    return null;
  }
}

function Notice({ children }: { children: string }) {
  return (
    <div className={styles.notice}>
      <h1>Avisteikningar</h1>
      <p>{children}</p>
    </div>
  );
}

export default async function AvisPage() {
  const drawings = await loadDrawings();
  const edition = drawings && buildEdition(drawings);

  return (
    <div lang="nn" className={oldStandard.variable}>
      {!edition && <Notice>Avisa er ikkje tilgjengeleg akkurat no. Prøv igjen litt seinare.</Notice>}
      {edition?.pages.length === 0 && <Notice>Bilete kjem seinare.</Notice>}
      {edition && edition.pages.length > 0 && (
        <AvisReader edition={edition}>
          <AvisEdition edition={edition} />
        </AvisReader>
      )}
    </div>
  );
}
