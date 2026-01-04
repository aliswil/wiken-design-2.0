import { client } from './sanity.client';

export interface GalleryItem {
  _id: string;
  title: string;
  name?: string;
  category: 'avisteikningar' | 'maleriar' | 'barnebokar';
  drawing: {
    asset: {
      _id: string;
      url: string;
      metadata?: {
        dimensions: {
          width: number;
          height: number;
        };
      };
    };
  };
  description?: string;
  order?: number;
}

export async function getGalleryItems(category: string): Promise<GalleryItem[]> {
  return client.fetch(
    `*[_type == "gallery" && category == $category] | order(order asc, _createdAt desc) {
      _id,
      title,
      name,
      category,
      drawing {
        asset -> {
          _id,
          url,
          metadata {
            dimensions {
              width,
              height
            }
          }
        }
      },
      description,
      order
    }`,
    { category }
  );
}

export async function getAllGalleryItems(): Promise<GalleryItem[]> {
  return client.fetch(
    `*[_type == "gallery"] | order(category asc, order asc, _createdAt desc) {
      _id,
      title,
      name,
      category,
      drawing {
        asset -> {
          _id,
          url,
          metadata {
            dimensions {
              width,
              height
            }
          }
        }
      },
      description,
      order
    }`
  );
}
