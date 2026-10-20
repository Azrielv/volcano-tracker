import Chart from 'chart.js/auto';

import type { AirQualityResult, VolcanoEvent } from './types';
import { fetchAirQuality, fetchShakeStations } from './api';
import { AVIATION } from './status';
import { fmt, must, timeAgo } from './util';

type PanelState = 'idle' | 'loading' | 'error' | 'data';

interface SO2Band {
  label: string;
  text: string;
  /** Numeric range that produced this band, e.g. "120–350 µg/m³". */
  basis: string;
  hex: string;
  ring: string;
  dot: string;
  bar: string;
  pct: number;
}

/* SO2 thresholds informed by EU / WHO ambient air-quality bands (μg/m³). */
function classifySO2(v: number | null): SO2Band {
  if (v == null || Number.isNaN(v)) {
    return {
      label: 'No data',
      text: 'No SO₂ measurement was returned for this location.',
      basis: '—',
      hex: '#9c8e7d', ring: 'border-stone-500/30 bg-stone-500/5', dot: 'bg-stone-400', bar: 'bg-stone-500', pct: 0,
    };
  }
  const pct = Math.min(100, (v / 350) * 100);
  if (v < 40) {
    return {
      label: 'Background degassing', pct, hex: '#3fa34d', basis: 'below 40 µg/m³',
      text: 'The reading is near typical ambient SO₂, so this is labelled background: passive, low-flux degassing consistent with a quiescent magmatic system.',
      ring: 'border-emerald-500/30 bg-emerald-500/5', dot: 'bg-emerald-400', bar: 'bg-emerald-500',
    };
  }
  if (v < 120) {
    return {
      label: 'Elevated degassing', pct, hex: '#d9a441', basis: '40–120 µg/m³',
      text: 'SO₂ sits above the background threshold (40 µg/m³) but below the high band, so it is labelled elevated. Rising gas flux can mark shallow magma movement or an open-vent plume — worth monitoring.',
      ring: 'border-amber-400/30 bg-amber-400/5', dot: 'bg-amber-300', bar: 'bg-amber-400',
    };
  }
  if (v < 350) {
    return {
      label: 'High degassing', pct, hex: '#e0762d', basis: '120–350 µg/m³',
      text: 'The reading crosses 120 µg/m³, so it is labelled high: a strong magmatic degassing signature with elevated eruptive potential and a real respiratory hazard downwind.',
      ring: 'border-orange-500/30 bg-orange-500/5', dot: 'bg-orange-400', bar: 'bg-orange-500',
    };
  }
  return {
    label: 'Extreme degassing', pct: 100, hex: '#d64545', basis: 'above 350 µg/m³',
    text: 'SO₂ exceeds 350 µg/m³, the extreme threshold — vigorous gas emission typical of an active eruption or imminent activity, and hazardous air quality near the source.',
    ring: 'border-red-500/30 bg-red-500/5', dot: 'bg-red-400', bar: 'bg-red-500',
  };
}

function classifyAsh(v: number | null): { label: string; text: string; cls: string } {
  if (v == null || Number.isNaN(v)) return { label: 'No data', text: '', cls: 'bg-stone-500/10 text-stone-300' };
  if (v < 25) return { label: 'Low. ', text: 'PM2.5 under 25 µg/m³ — particulate load within a normal air-quality range; minimal ashfall signal.', cls: 'bg-emerald-500/10 text-emerald-300' };
  if (v < 75) return { label: 'Moderate. ', text: 'PM2.5 of 25–75 µg/m³ — fine particulates elevated; possible light ash or aerosol drift downwind.', cls: 'bg-amber-400/10 text-amber-200' };
  if (v < 150) return { label: 'High. ', text: 'PM2.5 of 75–150 µg/m³ — heavy particulate loading consistent with active ashfall; respiratory protection advised.', cls: 'bg-orange-500/10 text-orange-300' };
  return { label: 'Severe. ', text: 'PM2.5 above 150 µg/m³ — dense ash-plume conditions near the source.', cls: 'bg-red-500/10 text-red-300' };
}

/** First 24 forecast hours from "now" for one hourly variable. */
function next24(
  hourly: AirQualityResult['hourly'],
  key: 'sulphur_dioxide' | 'pm2_5',
): { labels: string[]; values: (number | null)[] } {
  const out = { labels: [] as string[], values: [] as (number | null)[] };
  if (!hourly?.time) return out;
  const now = Date.now();
  for (let i = 0; i < hourly.time.length; i++) {
    const t = new Date(hourly.time[i]!).getTime();
    if (t < now - 3_600_000) continue;
    out.labels.push(new Date(hourly.time[i]!).toLocaleTimeString([], { hour: '2-digit' }));
    out.values.push(hourly[key]?.[i] ?? null);
    if (out.labels.length >= 24) break;
  }
  return out;
}

const TEMPLATE = /* html */ `
<div class="overflow-hidden rounded-2xl border border-hair bg-base-850">
  <div class="flex items-center gap-2.5 border-b border-hair px-5 py-4">
    <div class="grid h-8 w-8 place-items-center rounded-lg bg-ember-500/15 ring-1 ring-ember-500/30">
      <svg viewBox="0 0 24 24" class="h-4 w-4 text-ember-300" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12h4l3 8 4-16 3 8h4"/></svg>
    </div>
    <div>
      <h3 class="text-[13px] font-bold text-white">Atmospheric Data Analytics</h3>
      <p class="text-[10.5px] text-stone-500">Open-Meteo Air Quality · hourly forecast</p>
    </div>
  </div>

  <div data-state="idle" class="px-5 py-10 text-center">
    <div class="mx-auto mb-3 grid h-11 w-11 place-items-center rounded-full bg-white/5 ring-1 ring-white/10">
      <svg viewBox="0 0 24 24" class="h-5 w-5 text-stone-400" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18h6"/><path d="M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2z"/></svg>
    </div>
    <p class="text-[13px] font-semibold text-white">Select a volcano</p>
    <p class="mx-auto mt-1 max-w-[220px] text-[11.5px] leading-relaxed text-stone-500">Click any card or map marker to pull real-time SO₂ degassing telemetry and a 24-hour forecast.</p>
  </div>

  <div data-state="loading" class="hidden px-5 py-6">
    <div class="skeleton h-4 w-2/3 rounded"></div>
    <div class="skeleton mt-2 h-3 w-1/2 rounded"></div>
    <div class="skeleton mt-6 h-24 w-full rounded-xl"></div>
    <div class="skeleton mt-3 h-32 w-full rounded-xl"></div>
  </div>

  <div data-state="error" class="hidden px-5 py-6">
    <div class="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-[12px] text-red-300">
      <p class="font-semibold">Telemetry unavailable</p>
      <p data-err class="mt-1 text-red-300/80"></p>
    </div>
  </div>

  <div data-state="data" class="hidden px-5 py-5">
    <div class="flex items-start justify-between gap-2">
      <div class="min-w-0">
        <p class="text-[10.5px] font-semibold tracking-wider text-stone-500 uppercase">Monitoring Target</p>
        <h4 data-name class="mt-0.5 truncate text-[15px] leading-tight font-bold text-white">—</h4>
        <p data-coords class="mt-1 font-mono text-[11.5px] text-ember-300/90">—</p>
      </div>
      <span data-src class="shrink-0 rounded-md px-2 py-1 text-[10px] font-bold uppercase ring-1 ring-inset">—</span>
    </div>

    <!-- Why this alert colour (USGS only) -->
    <div data-why class="mt-3 hidden rounded-xl border px-3.5 py-3 text-[11px] leading-relaxed">
      <span data-why-label class="font-bold">—</span>
      <span data-why-text class="text-stone-400"></span>
    </div>

    <!-- SO2 hero -->
    <div class="mt-4 rounded-xl border border-hair bg-base-900/50 p-4">
      <div class="flex items-baseline justify-between">
        <span class="text-[11px] font-semibold tracking-wide text-stone-500 uppercase">Atmospheric SO₂ now</span>
        <span data-ago class="text-[10px] text-stone-600">—</span>
      </div>
      <div class="mt-1.5 flex items-end gap-1.5">
        <span data-so2 class="font-mono text-4xl font-bold text-white">—</span>
        <span class="mb-1.5 text-[12px] font-medium text-stone-400">μg/m³</span>
      </div>
      <div class="mt-3 h-2 w-full overflow-hidden rounded-full bg-white/5">
        <div data-bar class="h-full rounded-full transition-all duration-700" style="width:0%"></div>
      </div>
      <div class="mt-1 flex justify-between text-[9px] font-medium text-stone-600"><span>0</span><span>40</span><span>120</span><span>350+</span></div>
    </div>

    <div data-threat class="mt-3 rounded-xl border px-4 py-3">
      <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span data-threat-dot class="h-2 w-2 rounded-full"></span>
        <span data-threat-label class="text-[12px] font-bold">—</span>
        <span data-threat-basis class="rounded bg-white/10 px-1.5 py-0.5 font-mono text-[9.5px] text-stone-300">—</span>
      </div>
      <p data-threat-text class="mt-1.5 text-[11px] leading-relaxed text-stone-400"></p>
    </div>

    <!-- Nearby independent seismic coverage (Raspberry Shake FDSN) -->
    <div class="mt-3 rounded-xl border border-hair bg-base-900/50 px-4 py-3">
      <div class="flex items-center gap-2">
        <svg viewBox="0 0 24 24" class="h-3.5 w-3.5 text-ember-300" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12h3l2-7 4 18 3-11 2 4h6"/></svg>
        <span class="text-[11px] font-semibold tracking-wide text-stone-500 uppercase">Nearby Seismic Coverage</span>
      </div>
      <p data-shake-body class="mt-1.5 text-[11px] leading-relaxed text-stone-400">Checking the Raspberry Shake network…</p>
      <div data-shake-list class="mt-2 hidden flex-col gap-1"></div>
      <p class="mt-1.5 text-[9.5px] text-stone-600">Raspberry Shake · citizen-science seismometers · FDSN station service</p>
    </div>

    <!-- Tabs -->
    <div class="mt-4 flex gap-1 rounded-lg bg-white/[0.04] p-1">
      <button data-tab="forecast" class="an-tab flex-1 rounded-md px-2 py-1.5 text-[11px] font-semibold transition">24 h Forecast</button>
      <button data-tab="air" class="an-tab flex-1 rounded-md px-2 py-1.5 text-[11px] font-semibold transition">Air Quality</button>
    </div>

    <div data-panel="forecast" class="mt-3">
      <div class="rounded-xl border border-hair bg-base-900/50 p-4">
        <div class="flex items-center justify-between">
          <span class="text-[11px] font-semibold tracking-wide text-stone-500 uppercase">SO₂ degassing · next 24 h</span>
          <span class="text-[10px] text-stone-600">μg/m³</span>
        </div>
        <div class="mt-2 h-44"><canvas data-chart></canvas></div>
        <p data-chart-note class="mt-2 text-[10px] leading-relaxed text-stone-500"></p>
      </div>
    </div>

    <div data-panel="air" class="mt-3 hidden">
      <div class="rounded-xl border border-hair bg-base-900/50 p-4">
        <div class="flex items-center gap-2">
          <svg viewBox="0 0 24 24" class="h-3.5 w-3.5 text-stone-400" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 14h16M4 18h10M6 10h12M8 6h8"/></svg>
          <span class="text-[11px] font-semibold tracking-wide text-stone-500 uppercase">Particulate / Ashfall Hazard</span>
        </div>
        <div class="mt-2 grid grid-cols-2 gap-2 text-[11px]">
          <div class="rounded-lg bg-white/[0.03] px-3 py-2"><div class="text-stone-500">PM2.5 now</div><div data-pm class="mt-0.5 font-mono font-semibold text-white">—</div></div>
          <div class="rounded-lg bg-white/[0.03] px-3 py-2"><div class="text-stone-500">PM2.5 24 h peak</div><div data-pm-peak class="mt-0.5 font-mono font-semibold text-white">—</div></div>
        </div>
        <div data-ash class="mt-2 rounded-lg px-3 py-2 text-[10.5px]">
          <span data-ash-label class="font-bold">—</span><span data-ash-text class="text-stone-400"></span>
        </div>
      </div>

      <dl class="mt-3 grid grid-cols-3 gap-2 text-[11px]">
        <div class="rounded-lg border border-hair bg-base-900/50 px-3 py-2"><dt class="text-stone-500">SO₂ ppb</dt><dd data-ppb class="mt-0.5 font-mono font-semibold text-white">—</dd></div>
        <div class="rounded-lg border border-hair bg-base-900/50 px-3 py-2"><dt class="text-stone-500">CO µg/m³</dt><dd data-co class="mt-0.5 font-mono font-semibold text-white">—</dd></div>
        <div class="rounded-lg border border-hair bg-base-900/50 px-3 py-2"><dt class="text-stone-500">AQI (EU)</dt><dd data-aqi class="mt-0.5 font-mono font-semibold text-white">—</dd></div>
      </dl>
    </div>

    <p class="mt-4 text-[10px] leading-relaxed text-stone-600">
      Ambient SO₂ near a volcanic edifice is a primary signature of magmatic degassing — rising gas flux often precedes or accompanies eruptive activity. Readings can also be influenced by wind, industry and distance from the vent.
    </p>
  </div>
</div>
`;

type Tab = 'forecast' | 'air';

export class AnalyticsPanel {
  private readonly root: HTMLElement;
  private chart: Chart | null = null;
  private abort: AbortController | null = null;
  private shakeAbort: AbortController | null = null;
  private tab: Tab = 'forecast';

  constructor(root: HTMLElement) {
    this.root = root;
    this.root.innerHTML = TEMPLATE;
    this.show('idle');

    this.root.querySelectorAll<HTMLButtonElement>('.an-tab').forEach((btn) => {
      btn.addEventListener('click', () => this.setTab(btn.dataset.tab as Tab));
    });
    this.setTab('forecast');
  }

  private q<T extends HTMLElement = HTMLElement>(sel: string): T {
    return must<T>(sel, this.root);
  }

  private show(state: PanelState): void {
    this.root.querySelectorAll<HTMLElement>('[data-state]').forEach((el) => {
      el.classList.toggle('hidden', el.dataset.state !== state);
    });
  }

  private setTab(tab: Tab): void {
    this.tab = tab;
    this.root.querySelectorAll<HTMLButtonElement>('.an-tab').forEach((btn) => {
      const on = btn.dataset.tab === tab;
      btn.classList.toggle('bg-ember-500/20', on);
      btn.classList.toggle('text-ember-200', on);
      btn.classList.toggle('text-stone-400', !on);
    });
    this.root.querySelectorAll<HTMLElement>('[data-panel]').forEach((p) => {
      p.classList.toggle('hidden', p.dataset.panel !== tab);
    });
    // Chart needs a resize when its panel becomes visible.
    if (tab === 'forecast') this.chart?.resize();
  }

  async load(e: VolcanoEvent): Promise<void> {
    this.show('loading');
    this.abort?.abort();
    this.abort = new AbortController();
    void this.loadStations(e);
    try {
      const data = await fetchAirQuality(e.lat, e.lon, this.abort.signal);
      this.render(e, data);
    } catch (err) {
      const error = err as Error;
      if (error.name === 'AbortError') return;
      this.q('[data-err]').textContent = /failed to fetch|network/i.test(error.message)
        ? 'Network error contacting the Open-Meteo Air Quality API.'
        : error.message;
      this.show('error');
    }
  }

  /** Independent seismic-monitoring coverage from the Raspberry Shake FDSN network. */
  private async loadStations(e: VolcanoEvent): Promise<void> {
    const body = this.q('[data-shake-body]');
    const listEl = this.q('[data-shake-list]');
    body.textContent = 'Checking the Raspberry Shake network…';
    body.className = 'mt-1.5 text-[11px] leading-relaxed text-stone-400';
    listEl.classList.add('hidden');
    listEl.innerHTML = '';

    this.shakeAbort?.abort();
    this.shakeAbort = new AbortController();

    try {
      const r = await fetchShakeStations(e.lat, e.lon, this.shakeAbort.signal);

      if (!r.activeCount) {
        body.textContent = r.stations.length
          ? `No currently-operating Raspberry Shake stations within ${r.radiusKm} km (${r.stations.length} past site${r.stations.length > 1 ? 's' : ''} on record). Independent citizen-science coverage here is sparse.`
          : `No Raspberry Shake stations within ${r.radiusKm} km — this volcano has no nearby citizen-science seismic coverage.`;
        return;
      }

      const n = r.nearest!;
      body.innerHTML =
        `<b class="text-ember-300">${r.activeCount}</b> active Raspberry Shake ` +
        `seismometer${r.activeCount > 1 ? 's' : ''} within ${r.radiusKm} km — ` +
        `independent ground-motion coverage. Nearest is <b class="text-stone-200">${n.code}</b> at ${n.distanceKm.toFixed(0)} km.`;

      listEl.classList.remove('hidden');
      r.stations
        .filter((s) => s.active)
        .slice(0, 4)
        .forEach((s) => {
          const row = document.createElement('div');
          row.className = 'flex items-center justify-between font-mono text-[10.5px] text-stone-500';
          row.innerHTML =
            `<span class="text-stone-400">${s.code}</span>` +
            `<span>${s.distanceKm.toFixed(0)} km${s.elevation != null ? ` · ${s.elevation.toFixed(0)} m` : ''}</span>`;
          listEl.appendChild(row);
        });
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      body.textContent =
        'Raspberry Shake station service unavailable right now (rate-limited or offline).';
      body.className = 'mt-1.5 text-[11px] leading-relaxed text-stone-500';
    }
  }

  private render(e: VolcanoEvent, data: AirQualityResult): void {
    const c = data.current;
    const units = data.current_units ?? {};
    const band = classifySO2(c.sulphur_dioxide);

    this.q('[data-name]').textContent = e.name;
    this.q('[data-coords]').textContent = `${e.lat.toFixed(4)}°, ${e.lon.toFixed(4)}°`;

    const src = this.q('[data-src]');
    if (e.source === 'usgs') {
      src.textContent = 'USGS';
      src.className = 'shrink-0 rounded-md px-2 py-1 text-[10px] font-bold uppercase ring-1 ring-inset bg-ember-500/15 text-ember-300 ring-ember-500/30';
    } else {
      src.textContent = 'NASA';
      src.className = 'shrink-0 rounded-md px-2 py-1 text-[10px] font-bold uppercase ring-1 ring-inset bg-pink-500/15 text-pink-300 ring-pink-500/30';
    }

    // Why is this alert coloured the way it is?
    const why = this.q('[data-why]');
    if (e.source === 'usgs') {
      const st = AVIATION[e.colorCode];
      const code = e.colorCode === 'UNKNOWN' ? 'UNASSIGNED' : e.colorCode;
      why.className = `mt-3 rounded-xl border px-3.5 py-3 text-[11px] leading-relaxed ${st.soft}`;
      this.q('[data-why-label]').className = `font-bold ${st.text}`;
      this.q('[data-why-label]').textContent = `Aviation code ${code} — ${st.label}. `;
      this.q('[data-why-text]').textContent = st.why;
      why.classList.remove('hidden');
    } else {
      why.className = 'mt-3 rounded-xl border border-pink-400/30 bg-pink-500/5 px-3.5 py-3 text-[11px] leading-relaxed';
      this.q('[data-why-label]').className = 'font-bold text-pink-300';
      this.q('[data-why-label]').textContent = 'NASA EONET active event. ';
      this.q('[data-why-text]').textContent =
        'Flagged because a satellite thermal hot-spot or ash / gas plume is currently detectable at this location. EONET tracks observed activity from orbit, not ground-based alert levels.';
      why.classList.remove('hidden');
    }

    this.q('[data-so2]').textContent = fmt(c.sulphur_dioxide, 1);
    this.q('[data-ago]').textContent = c.time ? timeAgo(c.time) || 'latest' : 'latest';

    const bar = this.q('[data-bar]');
    bar.style.width = `${band.pct}%`;
    bar.className = `h-full rounded-full transition-all duration-700 ${band.bar}`;

    const threat = this.q('[data-threat]');
    threat.className = `mt-3 rounded-xl border px-4 py-3 ${band.ring}`;
    this.q('[data-threat-dot]').className = `h-2 w-2 rounded-full ${band.dot}`;
    this.q('[data-threat-label]').textContent = band.label;
    this.q('[data-threat-basis]').textContent = band.basis;
    this.q('[data-threat-text]').textContent = band.text;

    const ppb = c.sulphur_dioxide == null ? null : c.sulphur_dioxide / 2.62;
    this.q('[data-ppb]').textContent = fmt(ppb, 1);
    this.q('[data-co]').textContent =
      c.carbon_monoxide == null ? '—' : `${fmt(c.carbon_monoxide, 0)}`;
    this.q('[data-aqi]').textContent = fmt(c.european_aqi, 0);

    const pmSeries = next24(data.hourly, 'pm2_5');
    const pmVals = pmSeries.values.filter((x): x is number => x != null);
    const pmPeak = pmVals.length ? Math.max(...pmVals) : null;
    this.q('[data-pm]').textContent =
      c.pm2_5 == null ? '—' : `${fmt(c.pm2_5, 1)} ${units.pm2_5 ?? 'µg/m³'}`;
    this.q('[data-pm-peak]').textContent = pmPeak == null ? '—' : `${fmt(pmPeak, 1)} µg/m³`;

    const ash = classifyAsh(c.pm2_5 ?? pmPeak);
    this.q('[data-ash]').className = `mt-2 rounded-lg px-3 py-2 text-[10.5px] ${ash.cls}`;
    this.q('[data-ash-label]').textContent = ash.label;
    this.q('[data-ash-text]').textContent = ash.text;

    const so2Series = next24(data.hourly, 'sulphur_dioxide');
    this.drawChart(so2Series, band.hex);
    const sVals = so2Series.values.filter((x): x is number => x != null);
    if (sVals.length) {
      const peak = Math.max(...sVals);
      const trough = Math.min(...sVals);
      const trend = sVals[sVals.length - 1]! - sVals[0]!;
      this.q('[data-chart-note]').textContent =
        `Forecast range ${fmt(trough, 0)}–${fmt(peak, 0)} µg/m³ · ${trend >= 0 ? 'rising' : 'easing'} degassing trend over 24 h.`;
    } else {
      this.q('[data-chart-note]').textContent = 'No hourly SO₂ forecast returned for this location.';
    }

    this.show('data');
  }

  private drawChart(series: { labels: string[]; values: (number | null)[] }, hex: string): void {
    const canvas = this.q<HTMLCanvasElement>('[data-chart]');
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const grad = ctx.createLinearGradient(0, 0, 0, 160);
    grad.addColorStop(0, `${hex}55`);
    grad.addColorStop(1, `${hex}00`);

    this.chart?.destroy();
    this.chart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: series.labels,
        datasets: [
          {
            data: series.values,
            borderColor: hex,
            backgroundColor: grad,
            borderWidth: 2,
            fill: true,
            tension: 0.35,
            pointRadius: 0,
            pointHoverRadius: 4,
            pointHoverBackgroundColor: hex,
            spanGaps: true,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 500 },
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#1a1613',
            borderColor: 'rgba(240,224,208,.12)',
            borderWidth: 1,
            titleColor: '#f0e8dd',
            bodyColor: '#b8a999',
            padding: 10,
            displayColors: false,
            callbacks: {
              label: (item) =>
                ` ${item.parsed.y == null ? '—' : item.parsed.y.toFixed(1)} µg/m³ SO₂`,
            },
          },
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { color: '#8a7d6e', font: { size: 9 }, maxRotation: 0, autoSkipPadding: 16 },
          },
          y: {
            beginAtZero: true,
            grid: { color: 'rgba(240,224,208,.06)' },
            ticks: { color: '#8a7d6e', font: { size: 9 }, maxTicksLimit: 5 },
          },
        },
      },
    });
  }
}
