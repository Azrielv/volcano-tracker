import type {
  AirQualityResult,
  ColorKey,
  LoadResult,
  ShakeResult,
  ShakeStation,
  VolcanoEvent,
} from './types';
import { AVIATION } from './status';
import { haversineKm } from './util';

const ENDPOINTS = {
  // Elevated alert states — carries color code + alert level, but no coordinates.
  usgsElevated: 'https://volcanoes.usgs.gov/hans-public/api/volcano/getElevatedVolcanoes',
  // Full US volcano catalogue — the coordinate / region source, joined by `vnum`.
  usgsCatalogue: 'https://volcanoes.usgs.gov/hans-public/api/volcano/getUSVolcanoes',
  nasa: 'https://eonet.gsfc.nasa.gov/api/v3/events?category=volcanoes&status=open&limit=100',
  airQuality: 'https://air-quality-api.open-meteo.com/v1/air-quality',
  // Raspberry Shake FDSN station web service — citizen-science seismic network.
  shakeStation: 'https://data.raspberryshake.org/fdsnws/station/1/query',
} as const;

interface Coord {
  lat: number;
  lon: number;
  region: string;
  url: string;
}

const TIMEOUT = 15_000;

async function fetchJSON<T>(url: string, timeout = TIMEOUT): Promise<T | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    if (!text.trim()) return null;
    return JSON.parse(text) as T;
  } finally {
    clearTimeout(timer);
  }
}

const COLOR_KEYS = new Set<string>(['GREEN', 'YELLOW', 'ORANGE', 'RED', 'UNKNOWN']);
const toColorKey = (v: unknown): ColorKey => {
  const k = String(v ?? '').trim().toUpperCase();
  return COLOR_KEYS.has(k) ? (k as ColorKey) : 'UNKNOWN';
};

/* eslint-disable @typescript-eslint/no-explicit-any */
function buildCoordIndex(payload: any): Map<string, Coord> {
  const index = new Map<string, Coord>();
  const rows: any[] = Array.isArray(payload) ? payload : [];
  for (const r of rows) {
    const lat = parseFloat(r.latitude);
    const lon = parseFloat(r.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    index.set(String(r.vnum), {
      lat,
      lon,
      region: r.region ?? '—',
      url: r.volcano_url ?? 'https://volcanoes.usgs.gov',
    });
  }
  return index;
}

function normalizeUSGS(payload: any, coords: Map<string, Coord>): VolcanoEvent[] {
  const rows: any[] = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.data)
      ? payload.data
      : Array.isArray(payload?.elevatedVolcanoes)
        ? payload.elevatedVolcanoes
        : [];

  return rows
    .map((v, i): VolcanoEvent => {
      const vnum = String(v.vnum ?? v.volcano_id ?? '');
      const c = coords.get(vnum);
      return {
        id: `usgs-${vnum || i}`,
        source: 'usgs',
        name: v.volcano_name ?? v.volcanoName ?? v.name ?? 'Unnamed volcano',
        region: c?.region ?? v.subregion ?? v.region ?? v.obs_fullname ?? '—',
        lat: c?.lat ?? parseFloat(v.latitude ?? v.lat),
        lon: c?.lon ?? parseFloat(v.longitude ?? v.lon ?? v.lng),
        colorCode: toColorKey(v.color_code ?? v.colorCode ?? v.avcolor ?? v.aviationColorCode),
        alertLevel: v.alert_level ?? v.alertLevel ?? null,
        updated: v.sent_utc ?? v.sent ?? v.alert_time ?? null,
        link: v.notice_url ?? c?.url ?? 'https://volcanoes.usgs.gov',
        reportName: 'USGS',
      };
    })
    .filter((v) => Number.isFinite(v.lat) && Number.isFinite(v.lon));
}

function normalizeEONET(payload: any): VolcanoEvent[] {
  const events: any[] = Array.isArray(payload?.events) ? payload.events : [];

  return events
    .filter((e) => !e.closed)
    .map((e, i): VolcanoEvent => {
      const geoms: any[] = Array.isArray(e.geometry) ? e.geometry : [];
      const last = geoms[geoms.length - 1] ?? {};
      const coords: any[] = Array.isArray(last.coordinates) ? last.coordinates : [];
      const src = e.sources?.[0] ?? {};
      return {
        id: `nasa-${e.id ?? i}`,
        source: 'nasa',
        name: String(e.title ?? 'Active volcanic event').replace(/^Volcano\s*-\s*/i, ''),
        region: 'Satellite-detected anomaly',
        lat: parseFloat(coords[1]),
        lon: parseFloat(coords[0]),
        colorCode: 'UNKNOWN',
        alertLevel: null,
        updated: last.date ?? geoms[0]?.date ?? null,
        link: src.url ?? e.link ?? 'https://eonet.gsfc.nasa.gov',
        reportName: src.id ? String(src.id).toUpperCase() : 'EONET',
      };
    })
    .filter((v) => Number.isFinite(v.lat) && Number.isFinite(v.lon));
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** Fire both source requests concurrently; one failure never blocks the other. */
export async function loadEvents(): Promise<LoadResult> {
  const [elevated, catalogue, nasa] = await Promise.all([
    fetchJSON<unknown>(ENDPOINTS.usgsElevated).then((d) => ({ ok: true, d })).catch(() => ({ ok: false, d: null })),
    fetchJSON<unknown>(ENDPOINTS.usgsCatalogue).then((d) => d).catch(() => null),
    fetchJSON<unknown>(ENDPOINTS.nasa).then((d) => ({ ok: true, d })).catch(() => ({ ok: false, d: null })),
  ]);

  const coords = buildCoordIndex(catalogue);
  const usgsEvents = elevated.ok ? normalizeUSGS(elevated.d, coords) : [];
  const nasaEvents = nasa.ok ? normalizeEONET(nasa.d) : [];

  // Live feed: newest activity first. Events with no timestamp fall to the
  // bottom, tie-broken by aviation severity then name so they stay stable.
  const ts = (v: VolcanoEvent): number => {
    const t = v.updated ? new Date(v.updated).getTime() : NaN;
    return Number.isFinite(t) ? t : 0;
  };
  const merged = [...usgsEvents, ...nasaEvents].sort(
    (a, b) =>
      ts(b) - ts(a) ||
      AVIATION[b.colorCode].sev - AVIATION[a.colorCode].sev ||
      a.name.localeCompare(b.name),
  );

  return {
    events: merged,
    usgsOk: elevated.ok,
    nasaOk: nasa.ok,
    usgsCount: usgsEvents.length,
    nasaCount: nasaEvents.length,
  };
}

/** Current + 48h hourly air chemistry for a coordinate. */
export async function fetchAirQuality(
  lat: number,
  lon: number,
  signal: AbortSignal,
): Promise<AirQualityResult> {
  const params = new URLSearchParams({
    latitude: lat.toFixed(4),
    longitude: lon.toFixed(4),
    current: 'sulphur_dioxide,pm2_5,carbon_monoxide,european_aqi',
    hourly: 'sulphur_dioxide,pm2_5',
    timezone: 'auto',
    forecast_days: '2',
  });

  const res = await fetch(`${ENDPOINTS.airQuality}?${params.toString()}`, { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as AirQualityResult;
  if (!data?.current) throw new Error('No air-quality data returned for this location.');
  return data;
}

/**
 * Raspberry Shake seismometers near a coordinate — a proxy for independent
 * ground-based monitoring coverage around a volcano. FDSN `station` service,
 * pipe-delimited text ( Net|Sta|Lat|Lon|Elev|Site|Start|End ).
 */
export async function fetchShakeStations(
  lat: number,
  lon: number,
  signal: AbortSignal,
  radiusDeg = 2,
): Promise<ShakeResult> {
  const params = new URLSearchParams({
    latitude: lat.toFixed(4),
    longitude: lon.toFixed(4),
    maxradius: String(radiusDeg),
    level: 'station',
    format: 'text',
    nodata: '404',
  });

  const res = await fetch(`${ENDPOINTS.shakeStation}?${params.toString()}`, {
    signal,
    headers: { Accept: 'text/plain' },
  });

  const radiusKm = Math.round(radiusDeg * 111);
  // 204/404 = the service ran fine but nothing is deployed in range.
  if (res.status === 204 || res.status === 404) {
    return { stations: [], activeCount: 0, nearest: null, radiusKm };
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const text = await res.text();
  const byCode = new Map<string, ShakeStation>();

  for (const line of text.split('\n')) {
    if (!line || line.startsWith('#')) continue;
    const f = line.split('|');
    if (f.length < 7) continue;
    const code = `${f[0]}.${f[1]}`;
    const sLat = parseFloat(f[2]!);
    const sLon = parseFloat(f[3]!);
    if (!Number.isFinite(sLat) || !Number.isFinite(sLon)) continue;
    const open = !f[7] || f[7].trim() === '';

    const existing = byCode.get(code);
    if (existing) {
      if (open) existing.active = true;
      continue;
    }
    const elev = parseFloat(f[4] ?? '');
    byCode.set(code, {
      code,
      lat: sLat,
      lon: sLon,
      elevation: Number.isFinite(elev) ? elev : null,
      distanceKm: haversineKm(lat, lon, sLat, sLon),
      active: open,
    });
  }

  const stations = [...byCode.values()].sort((a, b) => a.distanceKm - b.distanceKm);
  const activeStations = stations.filter((s) => s.active);

  return {
    stations,
    activeCount: activeStations.length,
    nearest: activeStations[0] ?? stations[0] ?? null,
    radiusKm,
  };
}
