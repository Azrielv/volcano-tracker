import './styles.css';

import { loadEvents } from './api';
import { TacticalMap } from './map';
import { Feed } from './feed';
import { AnalyticsPanel } from './analytics';
import { must } from './util';
import type { VolcanoEvent } from './types';

const map = new TacticalMap('map', showMapError);
const feed = new Feed();
const analytics = new AnalyticsPanel(must('#analytics-mount'));

const mapSkeleton = must('#map-skeleton');
const mapError = must('#map-error');
const mapCount = must('#map-count');
const feedError = must('#feed-error');
const feedControls = must('#feed-controls');
const statusPills = must('#status-pills');
const pillUsgs = must('#pill-usgs');
const pillNasa = must('#pill-nasa');
const lastUpdated = must('#last-updated');
const refreshBtn = must<HTMLButtonElement>('#refresh-btn');
const refreshIcon = must('#refresh-icon');

let events: VolcanoEvent[] = [];

function showMapError(): void {
  mapSkeleton.classList.add('hidden');
  mapError.classList.remove('hidden');
  mapError.classList.add('flex');
}

function selectById(id: string, from: 'card' | 'map'): void {
  const e = events.find((x) => x.id === id);
  if (!e) return;
  feed.select(id, { scroll: from === 'map' });
  map.focus(e);
  void analytics.load(e);

  // Make the result visible: on card clicks, bring the map + analytics into view.
  if (from === 'card' && window.matchMedia('(max-width: 1023px)').matches) {
    must('#analytics-mount').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

feed.onSelect = (id) => selectById(id, 'card');
map.onSelect = (id) => selectById(id, 'map');
feed.onListChange = (ids) => map.setVisible(ids);

async function refresh(): Promise<void> {
  refreshIcon.classList.add('animate-spin');
  feedError.classList.add('hidden');
  feed.showSkeleton();

  const result = await loadEvents();
  events = result.events;

  statusPills.classList.remove('hidden');
  statusPills.classList.add('flex');
  pillUsgs.textContent = result.usgsOk ? `${result.usgsCount} active` : 'offline';
  pillUsgs.className = result.usgsOk ? 'text-white' : 'text-red-400';
  pillNasa.textContent = result.nasaOk ? `${result.nasaCount} active` : 'offline';
  pillNasa.className = result.nasaOk ? 'text-white' : 'text-red-400';

  feedControls.classList.remove('hidden');
  feedControls.classList.add('flex');

  if (!result.usgsOk && !result.nasaOk) {
    feedError.textContent =
      'Both data sources are currently unreachable — they may be rate-limiting or blocking cross-origin requests. Try refreshing in a moment.';
    feedError.classList.remove('hidden');
  } else if (!result.usgsOk || !result.nasaOk) {
    feedError.textContent = `Partial data: the ${
      result.usgsOk ? 'NASA EONET feed' : 'USGS alert feed'
    } could not be loaded. Showing results from the other source.`;
    feedError.classList.remove('hidden');
  }

  feed.setEvents(events);
  map.setEvents(events);

  mapSkeleton.classList.add('hidden');
  mapCount.textContent = `${events.length} systems plotted`;
  mapCount.classList.toggle('hidden', events.length === 0);

  lastUpdated.textContent = `Last updated ${new Date().toLocaleString()} · ${events.length} active systems tracked`;
  refreshIcon.classList.remove('animate-spin');
}

refreshBtn.addEventListener('click', () => void refresh());
window.addEventListener('resize', () => map.resize());

void refresh();
