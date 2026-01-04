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

  return <GalleryGrid items={items} />;
}
