import type { ColorKey, Source } from './types';

export interface StatusMeta {
  label: string;
  sev: number;
  hex: string;
  badge: string;
  dot: string;
  text: string;
  border: string;
  /** Subtle border + tint for callout panels. */
  soft: string;
  /** Plain-language reason this colour is assigned (USGS aviation code criteria). */
  why: string;
}

/** USGS aviation colour codes → display metadata + Tailwind utility classes. */
export const AVIATION: Record<ColorKey, StatusMeta> = {
  GREEN: {
    label: 'Normal', sev: 1, hex: '#3fa34d',
    badge: 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30', dot: 'bg-emerald-400',
    text: 'text-emerald-300', border: 'border-emerald-400/50', soft: 'border-emerald-500/30 bg-emerald-500/5',
    why: 'Volcano is at typical background activity — no signs of unrest above its normal, non-eruptive state.',
  },
  YELLOW: {
    label: 'Advisory', sev: 2, hex: '#d9a441',
    badge: 'bg-amber-400/15 text-amber-200 ring-amber-400/30', dot: 'bg-amber-300',
    text: 'text-amber-200', border: 'border-amber-300/50', soft: 'border-amber-400/30 bg-amber-400/5',
    why: 'Elevated unrest detected — seismicity, deformation or gas output are above known background levels.',
  },
  ORANGE: {
    label: 'Watch', sev: 3, hex: '#e0762d',
    badge: 'bg-orange-500/15 text-orange-300 ring-orange-500/30', dot: 'bg-orange-400',
    text: 'text-orange-300', border: 'border-orange-400/50', soft: 'border-orange-500/30 bg-orange-500/5',
    why: 'Heightened unrest with an increased likelihood of eruption, or a minor eruption is already underway.',
  },
  RED: {
    label: 'Warning', sev: 4, hex: '#d64545',
    badge: 'bg-red-500/15 text-red-300 ring-red-500/30', dot: 'bg-red-400',
    text: 'text-red-300', border: 'border-red-400/50', soft: 'border-red-500/30 bg-red-500/5',
    why: 'A hazardous eruption is imminent, underway, or producing a significant ash plume into the atmosphere.',
  },
  UNKNOWN: {
    label: 'Unassigned', sev: 0, hex: '#9c8e7d',
    badge: 'bg-stone-500/15 text-stone-300 ring-stone-500/30', dot: 'bg-stone-400',
    text: 'text-stone-300', border: 'border-stone-400/50', soft: 'border-stone-500/30 bg-stone-500/5',
    why: 'The observatory has not currently assigned an aviation colour code for this volcano.',
  },
};

export const NASA_HEX = '#c0619b';

export const markerHex = (e: { source: Source; colorCode: ColorKey }): string =>
  e.source === 'nasa' ? NASA_HEX : AVIATION[e.colorCode].hex;
