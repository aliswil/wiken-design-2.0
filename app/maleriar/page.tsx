import { getGalleryItems } from '@/lib/sanity.queries';
import GalleryGrid from '@/components/GalleryGrid';

export const revalidate = 60; // Revalidate every 60 seconds

export default async function MaleriarPage() {
  const items = await getGalleryItems('maleriar');

  return <GalleryGrid items={items} />;
}
