import Image from 'next/image';
import { GalleryItem } from '@/lib/sanity.queries';
import { urlFor } from '@/lib/sanity.client';

interface GalleryGridProps {
  items: GalleryItem[];
}

export default function GalleryGrid({ items }: GalleryGridProps) {
  // Beregn bildeorientering
  const getImageOrientation = (width: number, height: number): 'landscape' | 'portrait' | 'square' => {
    const ratio = width / height;
    if (ratio > 1.3) return 'landscape';
    if (ratio < 0.8) return 'portrait';
    return 'square';
  };

  // Generer bildestørrelse basert på orientering og tilfeldig variasjon
  const getImageSize = (id: string, orientation: 'landscape' | 'portrait' | 'square'): 'small' | 'medium' | 'large' => {
    const hash = id.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    
    if (orientation === 'landscape') {
      // Landscape bilder kan være medium eller large
      return hash % 2 === 0 ? 'large' : 'medium';
    } else if (orientation === 'portrait') {
      // Portrait bilder er ofte small eller medium
      return hash % 3 === 0 ? 'medium' : 'small';
    } else {
      // Square bilder varierer
      const sizeIndex = hash % 3;
      return sizeIndex === 0 ? 'small' : sizeIndex === 1 ? 'medium' : 'large';
    }
  };

  const getTextPosition = (id: string, orientation: 'landscape' | 'portrait' | 'square'): 'right-bottom' | 'bottom-left' | 'right-top' | 'top-left' => {
    const hash = id.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    
    // For landscape bilder: kun top-left eller bottom-left
    if (orientation === 'landscape') {
      return hash % 2 === 0 ? 'bottom-left' : 'top-left';
    }
    
    // For portrait og square: alle posisjoner
    const positions: Array<'right-bottom' | 'bottom-left' | 'right-top'> = ['right-bottom', 'bottom-left', 'right-top'];
    return positions[hash % 3];
  };

  // Generer tilfeldig vertikal offset for hvert bilde
  const getVerticalOffset = (id: string): number => {
    const hash = id.split('').reverse().join('').split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    // Returnerer mellom 0 og 120px offset
    return (hash % 120);
  };

  return (
    <div className="min-h-screen p-8 md:p-24 lg:p-32">
      <div className="max-w-[1200px] mx-auto">
        {/* Desktop layout - grid med varierende størrelser */}
        <div className="hidden md:grid grid-cols-3 gap-16 lg:gap-20 auto-rows-auto">
          {items.map((item) => {
            const width = item.drawing.asset.metadata?.dimensions.width || 800;
            const height = item.drawing.asset.metadata?.dimensions.height || 600;
            const orientation = getImageOrientation(width, height);
            const size = getImageSize(item._id, orientation);
            const textPosition = getTextPosition(item._id, orientation);
            const verticalOffset = getVerticalOffset(item._id);
            
            // Bestem kolonne-span basert på størrelse
            const colSpan = size === 'large' ? 'col-span-2' : size === 'medium' ? 'col-span-1' : 'col-span-1';
            const rowSpan = orientation === 'portrait' && size !== 'small' ? 'row-span-2' : 'row-span-1';
            
            return (
              <div 
                key={item._id} 
                className={`relative ${colSpan} ${rowSpan}`}
                style={{
                  marginTop: `${verticalOffset}px`,
                }}
              >
                {/* Right-bottom position */}
                {textPosition === 'right-bottom' && (
                  <div className="flex items-end gap-1">
                    <div className="relative flex-1 transition-transform hover:scale-[1.02] duration-300">
                      <Image
                        src={urlFor(item.drawing).url()}
                        alt={item.title}
                        width={width}
                        height={height}
                        className="w-full h-auto"
                        sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 400px"
                        quality={95}
                      />
                    </div>
                    <div className="flex flex-col items-start self-end">
                      <div style={{ writingMode: 'vertical-rl', textOrientation: 'mixed' }}>
                        <h2 className="text-sm font-light text-gray-700 tracking-wide whitespace-nowrap">
                          {item.title}
                        </h2>
                        {item.description && (
                          <p className="text-xs font-light text-gray-500 mt-4 tracking-wide whitespace-nowrap">
                            {item.description}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {/* Right-top position */}
                {textPosition === 'right-top' && (
                  <div className="flex items-start gap-1">
                    <div className="relative flex-1 transition-transform hover:scale-[1.02] duration-300">
                      <Image
                        src={urlFor(item.drawing).url()}
                        alt={item.title}
                        width={width}
                        height={height}
                        className="w-full h-auto"
                        sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 400px"
                        quality={95}
                      />
                    </div>
                    <div className="flex flex-col items-start self-start">
                      <div style={{ writingMode: 'vertical-rl', textOrientation: 'mixed' }}>
                        <h2 className="text-sm font-light text-gray-700 tracking-wide whitespace-nowrap">
                          {item.title}
                        </h2>
                        {item.description && (
                          <p className="text-xs font-light text-gray-500 mt-4 tracking-wide whitespace-nowrap">
                            {item.description}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {/* Top-left position (for landscape) */}
                {textPosition === 'top-left' && (
                  <div className="flex flex-col gap-1">
                    <div>
                      <h2 className="text-sm font-light text-gray-700 tracking-wide">
                        {item.title}
                      </h2>
                      {item.description && (
                        <p className="text-xs font-light text-gray-500 mt-1 tracking-wide">
                          {item.description}
                        </p>
                      )}
                    </div>
                    <div className="relative transition-transform hover:scale-[1.02] duration-300">
                      <Image
                        src={urlFor(item.drawing).url()}
                        alt={item.title}
                        width={width}
                        height={height}
                        className="w-full h-auto"
                        sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 800px"
                        quality={95}
                      />
                    </div>
                  </div>
                )}

                {/* Bottom-left position */}
                {textPosition === 'bottom-left' && (
                  <div className="flex flex-col gap-1">
                    <div className="relative transition-transform hover:scale-[1.02] duration-300">
                      <Image
                        src={urlFor(item.drawing).url()}
                        alt={item.title}
                        width={width}
                        height={height}
                        className="w-full h-auto"
                        sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 800px"
                        quality={95}
                      />
                    </div>
                    <div>
                      <h2 className="text-sm font-light text-gray-700 tracking-wide">
                        {item.title}
                      </h2>
                      {item.description && (
                        <p className="text-xs font-light text-gray-500 mt-1 tracking-wide">
                          {item.description}
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Mobile layout - ett bilde per rad med tekst på siden */}
        <div className="md:hidden flex flex-col gap-16">
          {items.map((item) => {
            const width = item.drawing.asset.metadata?.dimensions.width || 800;
            const height = item.drawing.asset.metadata?.dimensions.height || 600;
            const orientation = getImageOrientation(width, height);
            const textPosition = getTextPosition(item._id, orientation);
            
            return (
              <div key={item._id} className="relative">
                {textPosition === 'right-bottom' && (
                  <div className="flex items-end gap-1">
                    <div className="relative flex-1">
                      <Image
                        src={urlFor(item.drawing).url()}
                        alt={item.title}
                        width={width}
                        height={height}
                        className="w-full h-auto"
                        sizes="100vw"
                        quality={95}
                      />
                    </div>
                    <div className="flex flex-col items-start self-end">
                      <div style={{ writingMode: 'vertical-rl', textOrientation: 'mixed' }}>
                        <h2 className="text-xs font-light text-gray-700 tracking-wide whitespace-nowrap">
                          {item.title}
                        </h2>
                        {item.description && (
                          <p className="text-[10px] font-light text-gray-500 mt-3 tracking-wide whitespace-nowrap">
                            {item.description}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {textPosition === 'right-top' && (
                  <div className="flex items-start gap-1">
                    <div className="relative flex-1">
                      <Image
                        src={urlFor(item.drawing).url()}
                        alt={item.title}
                        width={width}
                        height={height}
                        className="w-full h-auto"
                        sizes="100vw"
                        quality={95}
                      />
                    </div>
                    <div className="flex flex-col items-start self-start">
                      <div style={{ writingMode: 'vertical-rl', textOrientation: 'mixed' }}>
                        <h2 className="text-xs font-light text-gray-700 tracking-wide whitespace-nowrap">
                          {item.title}
                        </h2>
                        {item.description && (
                          <p className="text-[10px] font-light text-gray-500 mt-3 tracking-wide whitespace-nowrap">
                            {item.description}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {textPosition === 'top-left' && (
                  <div className="flex flex-col gap-1">
                    <div>
                      <h2 className="text-xs font-light text-gray-700 tracking-wide">
                        {item.title}
                      </h2>
                      {item.description && (
                        <p className="text-[10px] font-light text-gray-500 mt-1 tracking-wide">
                          {item.description}
                        </p>
                      )}
                    </div>
                    <div className="relative">
                      <Image
                        src={urlFor(item.drawing).url()}
                        alt={item.title}
                        width={width}
                        height={height}
                        className="w-full h-auto"
                        sizes="100vw"
                        quality={95}
                      />
                    </div>
                  </div>
                )}

                {textPosition === 'bottom-left' && (
                  <div className="flex flex-col gap-1">
                    <div className="relative">
                      <Image
                        src={urlFor(item.drawing).url()}
                        alt={item.title}
                        width={width}
                        height={height}
                        className="w-full h-auto"
                        sizes="100vw"
                        quality={95}
                      />
                    </div>
                    <div>
                      <h2 className="text-xs font-light text-gray-700 tracking-wide">
                        {item.title}
                      </h2>
                      {item.description && (
                        <p className="text-[10px] font-light text-gray-500 mt-1 tracking-wide">
                          {item.description}
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        
        {items.length === 0 && (
          <p className="text-center text-gray-500 text-lg font-light">
            Bilete kjem seinare.
          </p>
        )}
      </div>
    </div>
  );
}
