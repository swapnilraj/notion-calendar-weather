import { scrollerOf } from './grid.ts';
import { ICON_COLOR, createIcon } from './icons.ts';
import { gridDateToIso } from './time.ts';
import type { DaySummary } from '../weather/types.ts';

export const CHIP_ATTR = 'data-ncw-chip';
const HEADER_SELECTOR = '[data-grid-date]:not([data-grid-container])';
/** Breathing room between the date label and our icon / temperatures. */
const GAP = 7;
const PRECIP_MIN_PERCENT = 30;
/** Only show a rain % next to a wet icon; "☀ 83%" (rain overnight, sunny day) reads as a contradiction. */
const WET: ReadonlySet<DaySummary['condition']> = new Set(['drizzle', 'rain', 'snow', 'thunderstorm']);
/** Notion overlays a small `±` button on the right end of the header; keep clear of it. */
const RIGHT_RESERVE = 30;

function styled<K extends keyof HTMLElementTagNameMap>(tag: K, css: string, text?: string): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  el.style.cssText = css;
  if (text !== undefined) el.textContent = text;
  return el;
}

/**
 * The day-header row ("Fri 20"): a short row with exactly one child (the date label) whose text is a
 * word plus a day number. The all-day event cells share the same `data-grid-date` but fail this test.
 */
function dateLabelOf(header: HTMLElement): { row: HTMLElement; label: HTMLElement } | null {
  const row = header.firstElementChild;
  if (!(row instanceof HTMLElement) || row.getBoundingClientRect().height > 40) return null;
  const kids = [...row.children].filter((c) => !c.hasAttribute(CHIP_ATTR));
  const label = kids[0];
  if (kids.length !== 1 || !(label instanceof HTMLElement)) return null;
  const text = (label.innerText ?? '').replace(/\s+/g, ' ').trim();
  return text.length <= 14 && /^\S+ ?\d{1,2}$/.test(text) ? { row, label } : null;
}

function buildChip(s: DaySummary, row: HTMLElement, rowW: number, labelLeft: number, labelRight: number, key: string): HTMLElement {
  const chip = styled('div', 'position:absolute;inset:0;pointer-events:none;font-size:11px;line-height:1;font-variant-numeric:tabular-nums;');
  chip.setAttribute(CHIP_ATTR, '');
  chip.setAttribute('data-ncw-key', key);

  // Icon (and rain %) hug the left of the date label; temperatures hug its right.
  const left = styled('span', `position:absolute;top:0;bottom:0;right:${rowW - labelLeft + GAP}px;display:flex;align-items:center;gap:3px;color:${ICON_COLOR[s.condition]};`);
  left.appendChild(createIcon(s.condition, true, 14));
  const precip =
    WET.has(s.condition) && s.precipProbability !== null && s.precipProbability >= PRECIP_MIN_PERCENT ? styled('span', 'font-size:10px;opacity:.9;', `${Math.round(s.precipProbability)}%`) : null;
  if (precip) left.appendChild(precip);

  const right = styled('span', `position:absolute;top:0;bottom:0;left:${labelRight + GAP}px;display:flex;align-items:center;gap:4px;white-space:nowrap;`);
  right.appendChild(styled('span', 'font-weight:600;opacity:.85;', `${s.tempMax}°`));
  const lo = styled('span', 'opacity:.5;', `${s.tempMin}°`);
  right.appendChild(lo);

  chip.append(left, right);

  // Fit to the space actually available around the label (depends on column width and sidebars).
  queueMicrotask(() => {
    if (!chip.isConnected) return;
    const leftSpace = labelLeft - GAP - 2;
    const rightSpace = rowW - labelRight - GAP - 2;
    if (precip && left.offsetWidth > leftSpace) precip.remove();
    if (left.offsetWidth > leftSpace) left.style.display = 'none';
    // Also stay clear of the `±` button when this is the last visible column.
    const scroller = scrollerOf(row)?.getBoundingClientRect();
    const overflows = () => right.offsetWidth > rightSpace || (scroller !== undefined && right.getBoundingClientRect().right > scroller.right - RIGHT_RESERVE);
    if (overflows()) lo.remove();
    if (overflows()) right.style.display = 'none';
  });
  return chip;
}

/** Add a small weather chip beside each day header's date. Re-added if React drops it. */
export function renderHeaderChips(summaryFor: (isoDate: string) => DaySummary | null): void {
  for (const header of document.querySelectorAll<HTMLElement>(HEADER_SELECTOR)) {
    if (header.clientWidth > window.innerWidth) continue;
    const parts = dateLabelOf(header);
    if (!parts) continue;
    const { row, label } = parts;

    const existing = row.querySelector(`:scope > [${CHIP_ATTR}]`);
    const summary = summaryFor(gridDateToIso(header.dataset.gridDate!));
    if (!summary) {
      existing?.remove();
      continue;
    }
    const rr = row.getBoundingClientRect();
    const lr = label.getBoundingClientRect();
    const labelLeft = Math.round(lr.left - rr.left);
    const labelRight = Math.round(lr.right - rr.left);
    const rowW = Math.round(rr.width);
    // Distance of this header from the `±` zone, clamped so only columns near the right edge
    // change key (and rebuild) as the grid scrolls.
    const sc = scrollerOf(row)?.getBoundingClientRect();
    const edge = sc ? Math.min(Math.round(rr.right - (sc.right - RIGHT_RESERVE)), 40) : 40;
    const key = [summary.condition, summary.tempMax, summary.tempMin, summary.precipProbability, rowW, labelLeft, labelRight, edge].join('|');
    if (existing?.getAttribute('data-ncw-key') === key) continue;
    existing?.remove();
    row.appendChild(buildChip(summary, row, rowW, labelLeft, labelRight, key));
  }
}

export function removeHeaderChips(): void {
  for (const el of document.querySelectorAll(`[${CHIP_ATTR}]`)) el.remove();
}
