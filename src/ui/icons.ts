import type { Condition } from '../weather/types.ts';

interface IconDef {
  paths: string[];
  circle?: [cx: number, cy: number, r: number];
}

// 24x24 stroke icons (Lucide-style geometry).
const CLOUD = 'M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z';
const CLOUD_TOP = 'M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242';

const ICONS: Record<string, IconDef> = {
  sun: {
    circle: [12, 12, 4],
    paths: ['M12 2v2', 'M12 20v2', 'm4.93 4.93 1.41 1.41', 'm17.66 17.66 1.41 1.41', 'M2 12h2', 'M20 12h2', 'm6.34 17.66-1.41 1.41', 'm19.07 4.93-1.41 1.41'],
  },
  moon: { paths: ['M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z'] },
  'cloud-sun': {
    paths: ['M12 2v2', 'm4.93 4.93 1.41 1.41', 'M20 12h2', 'm19.07 4.93-1.41 1.41', 'M15.947 12.65a4 4 0 0 0-5.925-4.128', 'M13 22H7a5 5 0 1 1 4.9-6H13a3 3 0 0 1 0 6Z'],
  },
  'cloud-moon': {
    paths: ['M13 16a3 3 0 0 1 0 6H7a5 5 0 1 1 4.9-6Z', 'M10.1 9A6 6 0 0 1 16 4a4.24 4.24 0 0 0 6 6 6 6 0 0 1-3 5.197'],
  },
  cloud: { paths: [CLOUD] },
  fog: { paths: [CLOUD_TOP, 'M16 17H7', 'M17 21H9'] },
  drizzle: { paths: [CLOUD_TOP, 'M8 19v1', 'M8 14v1', 'M16 19v1', 'M16 14v1', 'M12 21v1', 'M12 16v1'] },
  rain: { paths: [CLOUD_TOP, 'M16 14v6', 'M8 14v6', 'M12 16v6'] },
  snow: { paths: [CLOUD_TOP, 'M8 15h.01', 'M8 19h.01', 'M12 17h.01', 'M12 21h.01', 'M16 15h.01', 'M16 19h.01'] },
  thunder: { paths: ['M6 16.326A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 .5 8.973', 'm13 12-3 5h4l-3 5'] },
};

function iconKey(condition: Condition, isDay: boolean): string {
  switch (condition) {
    case 'clear':
      return isDay ? 'sun' : 'moon';
    case 'partly-cloudy':
      return isDay ? 'cloud-sun' : 'cloud-moon';
    case 'cloudy':
    case 'unknown':
      return 'cloud';
    case 'fog':
      return 'fog';
    case 'drizzle':
      return 'drizzle';
    case 'rain':
      return 'rain';
    case 'snow':
      return 'snow';
    case 'thunderstorm':
      return 'thunder';
  }
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Build an inline SVG (via DOM APIs, no innerHTML). Colour comes from `currentColor`. */
export function createIcon(condition: Condition, isDay: boolean, size = 14): SVGSVGElement {
  const def = ICONS[iconKey(condition, isDay)]!;
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.style.flex = 'none';
  if (def.circle) {
    const c = document.createElementNS(SVG_NS, 'circle');
    c.setAttribute('cx', String(def.circle[0]));
    c.setAttribute('cy', String(def.circle[1]));
    c.setAttribute('r', String(def.circle[2]));
    svg.appendChild(c);
  }
  for (const d of def.paths) {
    const p = document.createElementNS(SVG_NS, 'path');
    p.setAttribute('d', d);
    svg.appendChild(p);
  }
  return svg;
}

/** Icon colour per condition, picked to read on both dark and light backgrounds. */
export const ICON_COLOR: Record<Condition, string> = {
  clear: '#e8a22c',
  'partly-cloudy': '#c9a86a',
  cloudy: '#8d9aae',
  fog: '#9aa4b0',
  drizzle: '#6a9bd6',
  rain: '#4f8fe8',
  snow: '#8fb8e8',
  thunderstorm: '#9a78e6',
  unknown: '#8d9aae',
};
