import { SKY_LABEL, TEMP_LABEL, precipIntensity, precipLabel, skyBand, tempBand, toCelsius } from './bands.ts';
import type { DayHour } from './bands.ts';
import { columnLayout, realColumns, scrollerOf } from './grid.ts';
import { ICON_COLOR, createIcon } from './icons.ts';
import { luminance } from './tint.ts';
import { gridDateToIso } from './time.ts';
import type { HourlyForecast, Units } from '../weather/types.ts';

export type HourLookup = (isoDate: string, hour: number) => HourlyForecast | undefined;

const EVENT_SELECTOR = '[data-event-chip-key]';
const HEADER_SELECTOR = '[data-grid-date]:not([data-grid-container])';
const Z = '2147483000';

function toDayHour(h: HourlyForecast, units: Units): DayHour {
  return { condition: h.condition, precipProbability: h.precipProbability, precipMm: h.precipMm, isDay: h.isDay, tempC: toCelsius(h.temp, units) };
}

/**
 * Hour-by-hour readout: hovering empty space in a day column washes that hour's band and shows a
 * small pill (time, temperature, condition, rain chance). Hovering an event does nothing.
 */
export class HoverScrubber {
  private readonly lookup: HourLookup;
  private readonly units: () => Units;
  private band: HTMLDivElement | null = null;
  private pill: HTMLDivElement | null = null;
  private raf = 0;
  private x = 0;
  private y = 0;
  private target: EventTarget | null = null;
  private readonly onMove = (e: MouseEvent) => {
    this.x = e.clientX;
    this.y = e.clientY;
    this.target = e.target;
    if (!this.raf) this.raf = requestAnimationFrame(() => ((this.raf = 0), this.update()));
  };
  private readonly hide = () => {
    if (this.band) this.band.style.display = 'none';
    if (this.pill) this.pill.style.display = 'none';
  };
  private readonly onOut = (e: MouseEvent) => {
    if (!e.relatedTarget) this.hide();
  };

  constructor(lookup: HourLookup, units: () => Units) {
    this.lookup = lookup;
    this.units = units;
  }

  start(): void {
    document.addEventListener('mousemove', this.onMove, { capture: true, passive: true });
    document.addEventListener('mouseout', this.onOut, { capture: true, passive: true });
    document.addEventListener('scroll', this.hide, { capture: true, passive: true });
  }

  stop(): void {
    document.removeEventListener('mousemove', this.onMove, { capture: true });
    document.removeEventListener('mouseout', this.onOut, { capture: true });
    document.removeEventListener('scroll', this.hide, { capture: true });
    cancelAnimationFrame(this.raf);
    this.band?.remove();
    this.pill?.remove();
    this.band = this.pill = null;
  }

  private update(): void {
    const t = this.target;
    if (!(t instanceof Element) || t.closest(EVENT_SELECTOR) || t.closest(HEADER_SELECTOR)) return this.hide();

    const col = realColumns().find((c) => {
      const r = c.getBoundingClientRect();
      return this.x >= r.left && this.x < r.right && this.y >= r.top && this.y < r.bottom;
    });
    if (!col || !col.contains(t)) return this.hide();
    const layout = columnLayout(col);
    if (!layout) return this.hide();

    const rect = col.getBoundingClientRect();
    const { offsetPx, hourPx } = layout.geo;
    const rel = this.y - (rect.top + offsetPx);
    const hour = Math.floor(rel / hourPx);
    if (rel < 0 || hour < 0 || hour > 23) return this.hide();

    const iso = gridDateToIso(col.dataset.gridDate!);
    const at = this.lookup(iso, hour);
    if (!at) return this.hide();
    // Hour h→h+1: sky and temperature come from the stamp at h; rain fell during the hour before the
    // stamp at h+1 (Open-Meteo sums the preceding hour), so rain comes from there. Same rule as the texture.
    const data = { ...at, rainBlock: this.lookup(iso, hour + 1) ?? at };

    // Clip the band to the scrollable grid area so it never paints over the sticky header.
    const scroller = scrollerOf(col)?.getBoundingClientRect();
    const clipTop = scroller ? scroller.top + offsetPx : -Infinity;
    const clipBottom = scroller ? scroller.bottom : Infinity;
    const top = Math.max(rect.top + offsetPx + hour * hourPx, clipTop);
    const bottom = Math.min(rect.top + offsetPx + (hour + 1) * hourPx, clipBottom);
    if (bottom <= top) return this.hide();

    const dark = (luminance(getComputedStyle(layout.layer).backgroundColor) ?? 0) <= 0.5;
    this.showBand(rect.left, top, rect.width, bottom - top, dark);
    this.showPill(hour, data, dark);
  }

  private showBand(left: number, top: number, width: number, height: number, dark: boolean): void {
    const b = (this.band ??= this.make('ncw-band'));
    b.style.cssText = `position:fixed;pointer-events:none;z-index:${Z};left:${left}px;top:${top}px;width:${width}px;height:${height}px;background:${dark ? 'rgba(255,255,255,.04)' : 'rgba(0,0,0,.04)'};`;
  }

  private showPill(hour: number, h: HourlyForecast & { rainBlock: HourlyForecast }, dark: boolean): void {
    const p = (this.pill ??= this.make('ncw-pill'));
    const rainLabel = precipLabel(toDayHour(h.rainBlock, this.units()));
    const wet = rainLabel !== null;
    const shown = wet ? h.rainBlock : h;
    p.style.cssText =
      `position:fixed;pointer-events:none;z-index:${Z};display:flex;align-items:center;gap:6px;padding:5px 9px;border-radius:8px;font-size:12px;line-height:1;white-space:nowrap;` +
      `font-variant-numeric:tabular-nums;box-shadow:0 2px 10px rgba(0,0,0,.35);` +
      (dark ? 'background:rgba(44,44,44,.96);color:#e6e6e6;border:1px solid rgba(255,255,255,.1);' : 'background:rgba(255,255,255,.97);color:#222;border:1px solid rgba(0,0,0,.1);');
    const icon = createIcon(shown.condition, h.isDay, 14);
    icon.style.color = ICON_COLOR[shown.condition];
    const time = document.createElement('span');
    time.style.opacity = '.6';
    time.textContent = `${String(hour).padStart(2, '0')}:00`;
    // Names the three signals the background blends (sky | rain | temperature), so hovering doubles as the legend.
    const sky = SKY_LABEL[skyBand(h)];
    const temp = `${TEMP_LABEL[tempBand(toCelsius(h.temp, this.units()))]} ${h.temp}°`;
    const text = document.createElement('span');
    text.textContent = `${sky} · ${rainLabel ?? 'Dry'} · ${temp}`;
    p.replaceChildren(icon, time, text);

    // Place right/below the pointer, flipping near the viewport edges.
    p.style.left = '0px';
    p.style.top = '0px';
    const w = p.offsetWidth;
    const ht = p.offsetHeight;
    const left = this.x + 16 + w > window.innerWidth ? this.x - 16 - w : this.x + 16;
    const top = this.y + 18 + ht > window.innerHeight ? this.y - 18 - ht : this.y + 18;
    p.style.left = `${Math.max(4, left)}px`;
    p.style.top = `${Math.max(4, top)}px`;
  }

  private make(id: string): HTMLDivElement {
    const el = document.createElement('div');
    el.id = id;
    document.body.appendChild(el);
    return el;
  }
}
