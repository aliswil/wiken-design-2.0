import { client } from '@/lib/sanity.client';

export const revalidate = 0; // Don't cache this page

export default async function DebugPage() {
  let allData: any[] = [];
  let error: string | null = null;

  let drafts: any[] = [];

  try {
    // Fetch ALL gallery items to see what's in Sanity (including drafts)
    allData = await client.fetch(
      `*[_type == "gallery" && !(_id in path("drafts.**"))] {
        _id,
        title,
        name,
        category,
        "imageUrl": drawing.asset->url,
        description,
        order,
        _createdAt
      }`
    );

    // Also check for drafts
    drafts = await client.fetch(
      `*[_type == "gallery" && _id in path("drafts.**")] {
        _id,
        title,
        category,
        "imageUrl": drawing.asset->url,
        _createdAt
      }`
    );
  } catch (e: any) {
    error = e.message;
  }

  return (
    <div className="min-h-screen p-12">
      <div className="container mx-auto max-w-4xl">
        <h1 className="text-3xl font-bold mb-8">Sanity Debug Page</h1>

        <div className="mb-8 p-4 bg-gray-100 rounded">
          <h2 className="text-xl font-semibold mb-2">Connection Info:</h2>
          <p><strong>Project ID:</strong> {process.env.NEXT_PUBLIC_SANITY_PROJECT_ID}</p>
          <p><strong>Dataset:</strong> {process.env.NEXT_PUBLIC_SANITY_DATASET}</p>
        </div>

        {error && (
          <div className="mb-8 p-4 bg-red-100 rounded text-red-800">
            <h2 className="text-xl font-semibold mb-2">Error:</h2>
            <p>{error}</p>
          </div>
        )}

        {drafts.length > 0 && (
          <div className="mb-8 p-4 bg-yellow-100 rounded text-yellow-800">
            <h2 className="text-xl font-semibold mb-2">⚠️ Found {drafts.length} Draft Document(s):</h2>
            <p className="mb-2">These are saved but NOT published. You need to publish them!</p>
            <ul className="list-disc ml-6">
              {drafts.map((draft) => (
                <li key={draft._id}>
                  <strong>{draft.title || 'Untitled'}</strong> - Category: {draft.category || 'NOT SET'}
                </li>
              ))}
            </ul>
            <p className="mt-3 font-bold">
              👉 Go to http://localhost:3000/studio → Click on the document → Click "Publish"
            </p>
          </div>
        )}

        <div className="mb-8">
          <h2 className="text-xl font-semibold mb-4">
            ✅ Published Gallery Items: {allData.length}
          </h2>

          {allData.length === 0 && drafts.length === 0 && !error && (
            <p className="text-yellow-700 bg-yellow-100 p-4 rounded">
              No items found in Sanity at all. Make sure you:
              <br />1. Created a document in Sanity Studio
              <br />2. Published the document (not just saved as draft)
              <br />3. Selected a category (avisteikningar, maleriar, or barnebokar)
              <br />4. Added an image
            </p>
          )}

          {allData.map((item) => (
            <div key={item._id} className="mb-6 p-4 border rounded bg-white">
              <h3 className="font-bold text-lg">{item.title}</h3>
              <p><strong>Category:</strong> {item.category || 'NO CATEGORY SET'}</p>
              <p><strong>Name:</strong> {item.name || 'N/A'}</p>
              <p><strong>Order:</strong> {item.order || 'N/A'}</p>
              <p><strong>Created:</strong> {new Date(item._createdAt).toLocaleString()}</p>
              <p><strong>Image URL:</strong> {item.imageUrl ? '✅ Has image' : '❌ No image'}</p>
              {item.imageUrl && (
                <img src={item.imageUrl} alt={item.title} className="mt-2 max-w-xs" />
              )}
              {item.description && <p className="mt-2 text-gray-600">{item.description}</p>}

              <details className="mt-2">
                <summary className="cursor-pointer text-blue-600">View raw data</summary>
                <pre className="mt-2 p-2 bg-gray-50 text-xs overflow-auto">
                  {JSON.stringify(item, null, 2)}
                </pre>
              </details>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
