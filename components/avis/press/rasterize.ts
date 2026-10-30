// The DOM is the layout engine: a page is painted from where the browser put things.

const fontOf = (s: CSSStyleDeclaration) => `${s.fontStyle} ${s.fontWeight} ${s.fontSize} ${s.fontFamily}`;

const isOpaque = (color: string) => color !== 'transparent' && !color.endsWith(', 0)');

export function paperColor(element: Element, sheets: Element): string {
  for (let node: Element | null = element; node && node !== sheets; node = node.parentElement) {
    const color = getComputedStyle(node).backgroundColor;
    if (isOpaque(color)) return color;
  }
  return '#efe9db';
}

/** Asks for the page's images now and resolves when they are decoded, or have failed. */
export function prepareImages(page: Element): Promise<unknown> {
  return Promise.allSettled(
    Array.from(page.querySelectorAll('img'), (img) => {
      img.loading = 'eager';
      return img.decode();
    }),
  );
}

export function loadFonts(root: Element): Promise<unknown> {
  const fonts = new Set<string>();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const parent = walker.currentNode.parentElement;
    if (parent && walker.currentNode.nodeValue?.trim()) fonts.add(fontOf(getComputedStyle(parent)));
  }
  return Promise.allSettled(Array.from(fonts, (font) => document.fonts.load(font)));
}

const cased = (word: string, transform: string) => {
  if (transform === 'uppercase') return word.toUpperCase();
  if (transform === 'lowercase') return word.toLowerCase();
  return word;
};

/** Paints the element into ctx, which must be width×height device pixels. False when an image wasn't ready. */
export function rasterize(ctx: CanvasRenderingContext2D, page: HTMLElement, sheets: HTMLElement, dpr: number, paper: string): boolean {
  const { width, height } = ctx.canvas;
  const base = page.getBoundingClientRect();
  const snap = (v: number) => Math.round(v * dpr) / dpr;
  const originX = snap(base.left);
  const originY = snap(base.top);
  const range = document.createRange();
  let whole = true;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = paper;
  ctx.fillRect(0, 0, width, height);
  ctx.setTransform(dpr, 0, 0, dpr, -originX * dpr, -originY * dpr);
  ctx.imageSmoothingQuality = 'high';
  ctx.textBaseline = 'alphabetic';
  ctx.fontKerning = 'normal';

  const line = (x0: number, y0: number, x1: number, y1: number, color: string) => {
    const left = snap(x0);
    const top = snap(y0);
    ctx.fillStyle = color;
    ctx.fillRect(left, top, Math.max(snap(x1) - left, 1 / dpr), Math.max(snap(y1) - top, 1 / dpr));
  };

  const edge = (s: CSSStyleDeclaration, name: 'Top' | 'Bottom' | 'Left' | 'Right', r: DOMRect) => {
    const size = parseFloat(s[`border${name}Width` as const]);
    const style = s[`border${name}Style` as const];
    if (!size || style === 'none' || style === 'hidden') return;
    const color = s[`border${name}Color` as const];
    if (name === 'Top') line(r.left, r.top, r.right, r.top + size, color);
    else if (name === 'Bottom') line(r.left, r.bottom - size, r.right, r.bottom, color);
    else if (name === 'Left') line(r.left, r.top, r.left + size, r.bottom, color);
    else line(r.right - size, r.top, r.right, r.bottom, color);
  };

  const box = (element: Element, s: CSSStyleDeclaration) => {
    const r = element.getBoundingClientRect();
    if (element !== page && isOpaque(s.backgroundColor)) {
      ctx.fillStyle = s.backgroundColor;
      ctx.fillRect(r.left, r.top, r.width, r.height);
    }
    edge(s, 'Top', r);
    edge(s, 'Bottom', r);
    edge(s, 'Left', r);
    edge(s, 'Right', r);
  };

  const text = (node: Text, s: CSSStyleDeclaration) => {
    const value = node.data;
    ctx.font = fontOf(s);
    ctx.letterSpacing = s.letterSpacing === 'normal' ? '0px' : s.letterSpacing;
    ctx.fillStyle = s.color;
    const ascent = ctx.measureText('x').fontBoundingBoxAscent;
    const underline = s.textDecorationLine.includes('underline');
    const put = (from: number, to: number) => {
      range.setStart(node, from);
      range.setEnd(node, to);
      if (to - from > 1 && range.getClientRects().length > 1) {
        const half = (from + to) >> 1;
        put(from, half);
        put(half, to);
        return;
      }
      const r = range.getBoundingClientRect();
      if (!r.width) return;
      const baseline = r.top + ascent;
      ctx.fillText(cased(value.slice(from, to), s.textTransform), r.left, baseline);
      if (underline) {
        const gap = baseline + (parseFloat(s.textUnderlineOffset) || 1.5);
        line(r.left, gap, r.right, gap + (parseFloat(s.textDecorationThickness) || 1), s.color);
      }
    };
    for (const match of value.matchAll(/\S+/g)) put(match.index, match.index + match[0].length);
  };

  const image = (img: HTMLImageElement, s: CSSStyleDeclaration) => {
    if (!img.complete || !img.naturalWidth) {
      whole = false;
      return;
    }
    const r = img.getBoundingClientRect();
    const left = snap(r.left);
    const top = snap(r.top);
    ctx.globalCompositeOperation = s.mixBlendMode === 'normal' ? 'source-over' : 'multiply';
    ctx.drawImage(img, left, top, snap(r.right) - left, snap(r.bottom) - top);
    ctx.globalCompositeOperation = 'source-over';
  };

  const walk = (element: Element, opacity: number) => {
    const s = getComputedStyle(element);
    if (s.display === 'none' || s.visibility === 'hidden') return;
    const alpha = element === page ? 1 : opacity * parseFloat(s.opacity);
    ctx.globalAlpha = alpha;
    box(element, s);
    if (element instanceof HTMLImageElement) {
      image(element, s);
      return;
    }
    for (const child of element.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        ctx.globalAlpha = alpha;
        text(child as Text, s);
      } else if (child.nodeType === Node.ELEMENT_NODE) walk(child as Element, alpha);
    }
  };

  walk(page, 1);

  const masthead = sheets.querySelector('[data-masthead]');
  if (masthead && !page.contains(masthead)) {
    const m = masthead.getBoundingClientRect();
    if (m.right > base.left && m.left < base.right && m.bottom > base.top && m.top < base.bottom) walk(masthead, 1);
  }

  ctx.globalAlpha = 1;
  return whole;
}
