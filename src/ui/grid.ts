import { buildGradient, geometryFromLines } from './gradient.ts';
import type { ColumnGeometry } from './gradient.ts';
import type { DayHour } from './bands.ts';
import { wetnessAtLines } from './bands.ts';
import { textureLayer } from './texture.ts';
import { luminance, tintFor } from './tint.ts';
import type { Theme } from './tint.ts';
import { gridDateToIso } from './time.ts';

/** Notion week/day view: one of these per day, `data-grid-date` = UTC midnight of that date. */
export const COLUMN_SELECTOR = '[data-grid-container][data-grid-date]';
const APPLIED_ATTR = 'data-ncw-key';

/** 25 hourly samples (00:00 … 24:00) for an ISO date, or null when we have no data for it. */
export type SamplesSource = (isoDate: string) => readonly DayHour[] | null;

const BG_PROPS = ['background-image', 'background-size', 'background-position', 'background-repeat'] as const;
function clearBackground(el: HTMLElement): void {
  for (const p of BG_PROPS) el.style.removeProperty(p);
  el.removeAttribute(APPLIED_ATTR);
}

/**
 * The column's solid background layer: the first child of the grid container with an opaque
 * background. Painting a `background-image` here puts the gradient above the base colour but
 * below the hour lines and events (which live in a z-indexed sibling layer), with no extra DOM.
 */
function backgroundLayer(col: HTMLElement): HTMLElement | null {
  const layer = col.firstElementChild;
  if (!(layer instanceof HTMLElement)) return null;
  return getComputedStyle(layer).backgroundColor !== 'rgba(0, 0, 0, 0)' ? layer : null;
}

/** Nearest scrollable ancestor (Notion's grid viewport). */
export function scrollerOf(el: HTMLElement): HTMLElement | null {
  for (let e = el.parentElement; e; e = e.parentElement) {
    const oy = getComputedStyle(e).overflowY;
    if (oy === 'auto' || oy === 'scroll') return e;
  }
  return null;
}

/** Day columns only (Notion's scroll track also carries `data-grid-container` and is ~1M px wide). */
export function realColumns(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>(COLUMN_SELECTOR)].filter((c) => c.clientWidth <= window.innerWidth);
}

/** Background layer + measured geometry of a column, or null if it isn't laid out yet. */
export function columnLayout(col: HTMLElement): { layer: HTMLElement; geo: ColumnGeometry } | null {
  const layer = backgroundLayer(col);
  const geo = layer && measure(col, layer);
  return layer && geo ? { layer, geo } : null;
}

/** Hour lines are 1px-tall absolutely positioned children; read the first few to get geometry. */
function measure(col: HTMLElement, layer: HTMLElement): ColumnGeometry | null {
  const holder = layer.firstElementChild;
  if (!holder) return null;
  const top = col.getBoundingClientRect().top;
  const ys: number[] = [];
  for (const child of holder.children) {
    const r = child.getBoundingClientRect();
    // Real hour lines are ~1px tall. Notion also keeps a zero-height, full-width event container at
    // 00:00 in the same layer; counting it would shift every hour by one.
    if (r.height > 0 && r.height <= 2 && r.width >= col.clientWidth * 0.9) {
      ys.push(r.top - top);
      if (ys.length === 3) break;
    }
  }
  return geometryFromLines(ys);
}

export class GradientController {
  private readonly source: SamplesSource;
  private readonly onReconcile: (() => void) | undefined;
  private version = 0;
  private mo: MutationObserver | null = null;
  private ro: ResizeObserver | null = null;
  private raf = 0;
  private readonly sized = new WeakMap<Element, string>();
  private readonly lastScrollLeft = new WeakMap<Element, number>();
  // Horizontal scrolling moves headers relative to Notion's right-edge `±` button.
  private readonly onScroll = (e: Event) => {
    const t = e.target;
    if (!(t instanceof HTMLElement)) return;
    const prev = this.lastScrollLeft.get(t);
    this.lastScrollLeft.set(t, t.scrollLeft);
    if (prev !== undefined && prev !== t.scrollLeft) this.schedule();
  };

  /** `onReconcile` runs after every pass, so sibling features (header chips) share one observer. */
  constructor(source: SamplesSource, onReconcile?: () => void) {
    this.source = source;
    this.onReconcile = onReconcile;
  }

  start(): void {
    const root = document.getElementById('main') ?? document.body;
    // Columns mount/unmount as the user navigates; re-reconcile on (debounced) DOM changes.
    this.mo = new MutationObserver(() => this.schedule());
    this.mo.observe(root, { childList: true, subtree: true });
    this.ro = new ResizeObserver((entries) => {
      for (const e of entries) this.sized.delete(e.target);
      this.schedule();
    });
    document.addEventListener('scroll', this.onScroll, { capture: true, passive: true });
    this.reconcile();
  }

  stop(): void {
    document.removeEventListener('scroll', this.onScroll, { capture: true });
    this.mo?.disconnect();
    this.ro?.disconnect();
    cancelAnimationFrame(this.raf);
    for (const el of document.querySelectorAll<HTMLElement>(`[${APPLIED_ATTR}]`)) clearBackground(el);
  }

  /** Call after the data source changes (new forecast, units, location). */
  invalidate(): void {
    this.version++;
    this.schedule();
  }

  private schedule(): void {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this.reconcile();
    });
  }

  private reconcile(): void {
    for (const col of realColumns()) {
      const layer = backgroundLayer(col);
      if (!layer) continue;
      if (!this.sized.has(col)) this.ro?.observe(col);

      const date = gridDateToIso(col.dataset.gridDate!);
      const theme: Theme = (luminance(getComputedStyle(layer).backgroundColor) ?? 0) > 0.5 ? 'light' : 'dark';
      const sizeKey = `${col.clientHeight}`;
      const key = `${date}|${theme}|${sizeKey}|${this.version}`;
      if (layer.getAttribute(APPLIED_ATTR) === key) continue;

      const samples = this.source(date);
      const geo = samples && measure(col, layer);
      if (!samples || !geo) {
        if (layer.hasAttribute(APPLIED_ATTR)) clearBackground(layer);
        continue;
      }

      const wet = wetnessAtLines(samples);
      const gradient = buildGradient(samples.map((h, i) => tintFor(h, theme, wet[i])), geo);
      const texture = textureLayer(samples, geo, col.clientHeight, theme);
      if (texture) {
        // Rain streaks / snow dots on top of the colour wash.
        layer.style.backgroundImage = `${texture.image}, ${gradient}`;
        layer.style.backgroundSize = `${texture.size}, 100% 100%`;
        layer.style.backgroundPosition = '0 0, 0 0';
        layer.style.backgroundRepeat = `${texture.repeat}, no-repeat`;
      } else {
        layer.style.backgroundImage = gradient;
        layer.style.backgroundSize = '100% 100%';
        layer.style.backgroundPosition = '0 0';
        layer.style.backgroundRepeat = 'no-repeat';
      }
      layer.setAttribute(APPLIED_ATTR, key);
      this.sized.set(col, sizeKey);
    }
    this.onReconcile?.();
  }
}
