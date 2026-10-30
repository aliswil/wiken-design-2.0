import type { CSSProperties } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import type { AvisDrawing, AvisEdition as Edition, AvisPage } from './types';
import styles from './avis.module.css';

const LARGE_WIDTH = 2000;

/** Share of the page width each slot takes, for the `sizes` attribute. */
const SLOT_SHARE: Record<'duo' | 'leadLarge' | 'leadSmall' | 'solo' | 'wide', number> = {
  duo: 0.45,
  leadLarge: 0.53,
  leadSmall: 0.37,
  solo: 0.58,
  wide: 0.94,
};

/** Mirrors --sw: the drawing is limited by the column height, which has a floor of 480px. */
const STRIP_SIZE = 'min(90vw, max(calc(56vh - 100px), 187px))';

/** The floor of --pw in the CSS: 460px of page height at 0.86. */
const MIN_PAGE_WIDTH = 396;

/** Mirrors the --pw formula in the CSS, so the browser picks the right candidate. */
function sizesFor(share: number): string {
  const byWidth = `calc(${(share * 50).toFixed(2)}vw - ${Math.round(share * 32)}px)`;
  const byHeight = `calc(${(share * 86).toFixed(2)}vh - ${Math.round(share * 180)}px)`;
  const floor = `${Math.round(share * MIN_PAGE_WIDTH)}px`;
  return `(max-width: 819px) ${STRIP_SIZE}, (max-aspect-ratio: 1/1) ${STRIP_SIZE}, min(${byWidth}, max(${byHeight}, ${floor}))`;
}

function largeUrl(drawing: AvisDrawing): string {
  return `${drawing.url}?w=${Math.min(LARGE_WIDTH, drawing.width)}&q=85&fm=jpg&auto=format`;
}

/** Sizes a lead headline so that its longest word still fits the narrow column. */
function headlineSize(title: string): string {
  const longest = Math.max(...title.split(/[\s-]+/).map((word) => word.length));
  return `${Math.min(2.5, Math.max(1.5, 26 / longest)).toFixed(2)}em`;
}

interface FigureProps {
  drawing: AvisDrawing;
  index: number;
  share: number;
  /** The one lead headline that sits above its drawing. */
  headline?: boolean;
}

function Figure({ drawing, index, share, headline = false }: FigureProps) {
  const { title, description } = drawing;
  const style = {
    '--r': drawing.width / drawing.height,
    ...(headline && title ? { '--headline': headlineSize(title) } : {}),
  } as CSSProperties;

  return (
    <figure className={headline ? `${styles.fig} ${styles.headlined}` : styles.fig} data-stop="strip" style={style}>
      <div className={styles.plate}>
        <a
          data-drawing={index}
          href={largeUrl(drawing)}
          aria-label={title ? `Vis «${title}» stort` : `Vis teikning ${index + 1} stort`}
        >
          <Image
            src={drawing.url}
            alt={drawing.alt}
            width={drawing.width}
            height={drawing.height}
            sizes={sizesFor(share)}
            draggable={false}
            preload={index === 0}
          />
        </a>
      </div>
      {(title || description) && (
        <figcaption>
          {title && <h2>{title}</h2>}
          {description && <p>{description}</p>}
        </figcaption>
      )}
    </figure>
  );
}

function Masthead({ count }: { count: number }) {
  return (
    <header className={styles.masthead} data-masthead>
      <h1>Avisteikningar</h1>
      <p className={styles.dateline}>
        <span>Wiken Design</span>
        <span>Akvarell og tusj</span>
        <span>
          {count} {count === 1 ? 'teikning' : 'teikningar'}
        </span>
      </p>
    </header>
  );
}

function Folio({ number }: { number: number }) {
  return (
    <div className={styles.folio}>
      <span>Avisteikningar</span>
      <span className={styles.folioNumber}>{number}</span>
    </div>
  );
}

function BackPage({ page }: { page: AvisPage }) {
  return (
    <section
      className={`${styles.page} ${styles.back}`}
      data-page
      data-stop="strip"
      data-outer={page.number % 2 === 0 ? 'left' : 'right'}
      aria-label={`Side ${page.number}`}
    >
      <Folio number={page.number} />
      <div className={styles.colophon}>
        <p className={styles.colophonName}>Wiken Design</p>
        <p className={styles.colophonLine}>Akvarell og tusj</p>
        <nav aria-label="Vidare" className={styles.colophonLinks}>
          <Link href="/om-meg">Om meg</Link>
          <Link href="/avisteikningar">Alle teikningane i rutenett</Link>
        </nav>
      </div>
    </section>
  );
}

/** On odd pages the small drawing comes first, so the large one always sits on the outer edge. */
function LeadFigures({ page, drawings }: { page: AvisPage; drawings: AvisDrawing[] }) {
  const largeFirst = page.number % 2 === 0;
  return (
    <>
      {page.drawings.map((index, position) => {
        const large = (position === 0) === largeFirst;
        return (
          <Figure
            key={drawings[index].id}
            drawing={drawings[index]}
            index={index}
            share={large ? SLOT_SHARE.leadLarge : SLOT_SHARE.leadSmall}
            headline={!large}
          />
        );
      })}
    </>
  );
}

function isWide({ width, height }: AvisDrawing): boolean {
  return width > height;
}

function PageContent({ page, edition }: { page: AvisPage; edition: Edition }) {
  const { drawings } = edition;
  if (page.layout === 'lead') {
    return <LeadFigures page={page} drawings={drawings} />;
  }
  const alone = page.layout === 'front' && page.drawings.length === 1;
  const wideAlone = alone && isWide(drawings[page.drawings[0]]);
  const soloAlone = alone && !wideAlone;
  const share = wideAlone || page.layout === 'wide' ? SLOT_SHARE.wide : SLOT_SHARE[soloAlone || page.layout === 'solo' ? 'solo' : 'duo'];
  return (
    <>
      {page.drawings.map((index) => (
        <Figure key={drawings[index].id} drawing={drawings[index]} index={index} share={share} />
      ))}
    </>
  );
}

/** A front page holding a single drawing borrows the layout that drawing would get on its own. */
function frontVariant(page: AvisPage, drawings: AvisDrawing[]): string {
  if (page.layout !== 'front' || page.drawings.length > 1) return '';
  return isWide(drawings[page.drawings[0]]) ? styles.wide : styles.solo;
}

function SheetPage({ page, edition }: { page: AvisPage; edition: Edition }) {
  if (page.layout === 'back') {
    return <BackPage page={page} />;
  }
  return (
    <section
      className={[styles.page, styles[page.layout], frontVariant(page, edition.drawings)].filter(Boolean).join(' ')}
      data-page
      data-outer={page.number % 2 === 0 ? 'left' : 'right'}
      aria-label={`Side ${page.number}`}
    >
      {page.layout === 'front' ? <Masthead count={edition.drawings.length} /> : <Folio number={page.number} />}
      <PageContent page={page} edition={edition} />
    </section>
  );
}

export default function AvisEdition({ edition }: { edition: Edition }) {
  return (
    <div className={styles.sheets} data-avis-sheets>
      {edition.spreads.map((spread) => (
        <div key={spread[0]} className={styles.spread} data-stop="spread">
          {spread.map((pageIndex) => (
            <SheetPage key={pageIndex} page={edition.pages[pageIndex]} edition={edition} />
          ))}
        </div>
      ))}
    </div>
  );
}
