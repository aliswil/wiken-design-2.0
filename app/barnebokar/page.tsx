import { getGalleryItems } from '@/lib/sanity.queries';
import GalleryGrid from '@/components/GalleryGrid';

export const revalidate = 60; // Revalidate every 60 seconds

export default async function BarnebokarPage() {
  const items = await getGalleryItems('barnebokar');

  return <GalleryGrid items={items} />;
}
