import {
  Map as MLMap,
  Marker,
  Popup,
  LngLatBounds,
  NavigationControl,
  AttributionControl,
  type StyleSpecification,
} from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

import type { VolcanoEvent } from './types';
import { AVIATION, markerHex } from './status';
import { escapeHtml } from './util';

/* Keyless raster basemap: Esri World Imagery + a dark reference label overlay. */
const IMAGERY_TILES =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const REFERENCE_TILES =
  'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}';

const STYLE: StyleSpecification = {
  version: 8,
  sources: {
    imagery: {
      type: 'raster',
      tiles: [IMAGERY_TILES],
      tileSize: 256,
      maxzoom: 19,
      attribution: 'Imagery © Esri, Maxar, Earthstar Geographics',
    },
    reference: {
      type: 'raster',
      tiles: [REFERENCE_TILES],
      tileSize: 256,
      maxzoom: 16,
    },
  },
  layers: [
    { id: 'space', type: 'background', paint: { 'background-color': '#0c0a08' } },
    {
      id: 'imagery',
      type: 'raster',
      source: 'imagery',
      // Darken + slightly desaturate the imagery so coloured markers pop.
      paint: {
        'raster-brightness-max': 0.6,
        'raster-brightness-min': 0.0,
        'raster-contrast': 0.06,
        'raster-saturation': -0.12,
      },
    },
    { id: 'reference', type: 'raster', source: 'reference', paint: { 'raster-opacity': 0.82 } },
  ],
};

export class TacticalMap {
  private readonly map: MLMap;
  private readonly markers = new Map<string, { marker: Marker; el: HTMLElement }>();
  private ready = false;
  private pending: VolcanoEvent[] | null = null;

  /** Fired when a map marker is clicked. */
  onSelect: (id: string) => void = () => {};

  constructor(container: string, onError: () => void) {
    this.map = new MLMap({
      container,
      style: STYLE,
      center: [12, 20],
      zoom: 1.6,
      minZoom: 1,
      maxZoom: 12,
      renderWorldCopies: true,
      attributionControl: false,
      dragRotate: false,
      pitchWithRotate: false,
    });

    this.map.addControl(new NavigationControl({ showCompass: false }), 'top-right');
    this.map.addControl(new AttributionControl({ compact: true }), 'bottom-right');
    this.map.touchZoomRotate.disableRotation();
    this.map.keyboard.enable();

    this.map.on('load', () => {
      this.ready = true;
      if (this.pending) {
        this.plot(this.pending);
        this.pending = null;
      }
    });

    this.map.on('error', (e: unknown) => {
      const msg = String((e as { error?: { message?: string } })?.error?.message ?? '');
      if (!this.ready && /tile|style|fetch|network|load/i.test(msg)) onError();
    });
  }

  setEvents(events: VolcanoEvent[]): void {
    if (!this.ready) {
      this.pending = events;
      return;
    }
    this.plot(events);
  }

  private plot(events: VolcanoEvent[]): void {
    this.markers.forEach(({ marker }) => marker.remove());
    this.markers.clear();

    const bounds = new LngLatBounds();

    for (const e of events) {
      const hex = markerHex(e);
      const el = document.createElement('div');
      el.className = 'vmarker';
      if (e.source === 'nasa' || e.colorCode === 'RED' || e.colorCode === 'ORANGE') {
        el.classList.add('is-pulsing');
      }
      el.innerHTML = `<span class="halo" style="background:${hex}"></span><span class="core" style="background:${hex}"></span>`;
      el.title = e.name;

      const detail =
        e.source === 'nasa'
          ? 'NASA satellite event'
          : `${AVIATION[e.colorCode].label} · aviation ${e.colorCode}`;

      const why =
        e.source === 'nasa'
          ? 'Flagged by NASA EONET as an open volcanic event — active thermal or plume signal detected from orbit.'
          : AVIATION[e.colorCode].why;

      const popup = new Popup({ offset: 16, closeButton: false, maxWidth: '260px' }).setHTML(
        `<p class="font-bold text-white leading-tight text-[12px]">${escapeHtml(e.name)}</p>
         <p class="mt-0.5 text-stone-400 text-[11px]">${escapeHtml(e.region)}</p>
         <p class="mt-1 font-mono text-[11px] text-ember-300">${e.lat.toFixed(3)}, ${e.lon.toFixed(3)}</p>
         <p class="mt-1.5 text-[11px] font-semibold" style="color:${hex}">${detail}</p>
         <p class="mt-1 text-[10.5px] leading-relaxed text-stone-400">${escapeHtml(why)}</p>`,
      );

      const marker = new Marker({ element: el })
        .setLngLat([e.lon, e.lat])
        .setPopup(popup)
        .addTo(this.map);

      el.addEventListener('click', (ev) => {
        ev.stopPropagation();
        this.onSelect(e.id);
      });

      this.markers.set(e.id, { marker, el });
      bounds.extend([e.lon, e.lat]);
    }

    if (events.length && !bounds.isEmpty()) {
      this.map.fitBounds(bounds, { padding: 60, maxZoom: 3.5, duration: 900 });
    }
  }

  /** Show only the given ids (keeps the map in sync with the filtered list). */
  setVisible(ids: Set<string>): void {
    this.markers.forEach(({ el }, id) => {
      el.style.display = ids.has(id) ? '' : 'none';
    });
  }

  /** Highlight one marker and fly the camera to it. */
  focus(e: VolcanoEvent): void {
    this.markers.forEach(({ el }) => el.classList.remove('is-active'));
    const entry = this.markers.get(e.id);
    if (entry) {
      entry.el.classList.add('is-active');
      if (!entry.marker.getPopup()?.isOpen()) entry.marker.togglePopup();
    }
    this.map.flyTo({
      center: [e.lon, e.lat],
      zoom: Math.max(this.map.getZoom(), 5.5),
      speed: 0.9,
      curve: 1.5,
      essential: true,
    });
  }

  resize(): void {
    this.map.resize();
  }
}
