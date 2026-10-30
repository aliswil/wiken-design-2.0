import type { AvisDrawing, AvisEdition, AvisPage, AvisPageLayout } from './types';

const WIDE_RATIO = 1.1;

type DraftPage = Pick<AvisPage, 'layout' | 'drawings'>;

/** Duo, lead, duo, duo, lead, duo, duo, ... */
function rhythm(beat: number): AvisPageLayout {
  return beat % 3 === 1 ? 'lead' : 'duo';
}

function packPages(drawings: AvisDrawing[]): DraftPage[] {
  const isWide = (index: number) => drawings[index].width / drawings[index].height >= WIDE_RATIO;
  const isPairable = (index: number) => index < drawings.length && !isWide(index);

  const front = isPairable(0) && isPairable(1) ? [0, 1] : [0];
  const pages: DraftPage[] = [{ layout: 'front', drawings: front }];

  let next = front.length;
  let beat = 0;
  while (next < drawings.length) {
    if (isWide(next)) {
      pages.push({ layout: 'wide', drawings: [next] });
      next += 1;
    } else if (isPairable(next + 1)) {
      pages.push({ layout: rhythm(beat), drawings: [next, next + 1] });
      next += 2;
      beat += 1;
    } else {
      pages.push({ layout: 'solo', drawings: [next] });
      next += 1;
    }
  }
  return pages;
}

/** Adds exactly one page, preferring to give a drawing more room over printing a blank page. */
function addOnePage(pages: DraftPage[]): void {
  for (let i = pages.length - 1; i > 0; i -= 1) {
    if (pages[i].layout === 'duo' || pages[i].layout === 'lead') {
      const [a, b] = pages[i].drawings;
      pages.splice(i, 1, { layout: 'solo', drawings: [a] }, { layout: 'solo', drawings: [b] });
      return;
    }
  }
  const [first, second] = pages[0].drawings;
  if (second !== undefined) {
    pages[0] = { layout: 'front', drawings: [first] };
    pages.splice(1, 0, { layout: 'solo', drawings: [second] });
    return;
  }
  pages.push({ layout: 'blank', drawings: [] });
}

export function buildEdition(drawings: AvisDrawing[]): AvisEdition {
  if (drawings.length === 0) {
    return { drawings, pages: [], spreads: [] };
  }

  const drafts = packPages(drawings);
  // The back page is still to come, so the drafts must be odd to end up even.
  if (drafts.length % 2 === 0) {
    addOnePage(drafts);
  }
  drafts.push({ layout: 'back', drawings: [] });

  const pages: AvisPage[] = drafts.map((page, index) => ({ ...page, number: index + 1 }));

  const spreads: number[][] = [[0]];
  for (let i = 1; i < pages.length - 1; i += 2) {
    spreads.push([i, i + 1]);
  }
  spreads.push([pages.length - 1]);

  return { drawings, pages, spreads };
}
