'use client';

import Image, { type ImageProps } from 'next/image';

/** next/image served directly from the Sanity CDN, which handles resizing and modern formats. */
export default function SanityImage({ quality = 72, ...props }: ImageProps) {
  return <Image {...props} loader={({ src, width }) => `${src}?w=${width}&q=${quality}&fit=max&auto=format`} />;
}
