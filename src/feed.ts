import type { VolcanoEvent } from './types';
import { AVIATION } from './status';
import { escapeHtml, fmtDateTime, must, timeAgo } from './util';

type Filter = 'all' | 'highalert' | 'nasa';

export class Feed {
  private readonly listEl: HTMLElement;
  private readonly emptyEl: HTMLElement;
  private readonly emptyMsgEl: HTMLElement;
  private readonly skeletonEl: HTMLElement;
  private readonly countEl: HTMLElement;
  private readonly searchInput: HTMLInputElement;
  private readonly searchClear: HTMLElement;

  private events: VolcanoEvent[] = [];
  private filter: Filter = 'all';
  private search = '';
  private selectedId: string | null = null;
  private cards = new Map<string, HTMLElement>();
  private debounce: number | undefined;

  onSelect: (id: string) => void = () => {};
  onListChange: (visibleIds: Set<string>) => void = () => {};

  constructor() {
    this.listEl = must('#feed');
    this.emptyEl = must('#feed-empty');
    this.emptyMsgEl = must('#feed-empty-msg');
    this.skeletonEl = must('#feed-skeleton');
    this.countEl = must('#feed-count');
    this.searchInput = must<HTMLInputElement>('#search-input');
    this.searchClear = must('#search-clear');

    this.searchInput.addEventListener('input', () => {
      const val = this.searchInput.value;
      this.searchClear.classList.toggle('hidden', val.length === 0);
      window.clearTimeout(this.debounce);
      this.debounce = window.setTimeout(() => {
        this.search = val.trim().toLowerCase();
        this.render();
      }, 110);
    });

    this.searchClear.addEventListener('click', () => {
      this.searchInput.value = '';
      this.searchClear.classList.add('hidden');
      this.search = '';
      this.render();
      this.searchInput.focus();
    });

    document.querySelectorAll<HTMLButtonElement>('.feed-filter').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.filter = (btn.dataset.filter as Filter) ?? 'all';
        this.syncFilterButtons();
        this.render();
      });
    });
  }

  private syncFilterButtons(): void {
    document.querySelectorAll<HTMLButtonElement>('.feed-filter').forEach((btn) => {
      const on = btn.dataset.filter === this.filter;
      btn.classList.toggle('bg-white/10', on);
      btn.classList.toggle('text-white', on);
      btn.classList.toggle('text-stone-400', !on);
    });
  }

  showSkeleton(): void {
    this.skeletonEl.classList.remove('hidden');
    this.listEl.classList.add('hidden');
    this.emptyEl.classList.add('hidden');
  }

  setEvents(events: VolcanoEvent[]): void {
    this.events = events;
    this.render();
  }

  private matches(v: VolcanoEvent): boolean {
    if (this.filter === 'nasa' && v.source !== 'nasa') return false;
    if (this.filter === 'highalert' && !(v.source === 'usgs' && (v.colorCode === 'RED' || v.colorCode === 'ORANGE'))) {
      return false;
    }
    if (this.search) {
      return `${v.name} ${v.region} ${v.source}`.toLowerCase().includes(this.search);
    }
    return true;
  }

  private visible(): VolcanoEvent[] {
    return this.events.filter((v) => this.matches(v));
  }

  /** Select programmatically (e.g. from a map-marker click). */
  select(id: string, opts: { scroll?: boolean } = {}): void {
    // Relax filters if the target is currently hidden so its card is reachable.
    if (!this.visible().some((v) => v.id === id)) {
      this.filter = 'all';
      this.search = '';
      this.searchInput.value = '';
      this.searchClear.classList.add('hidden');
      this.syncFilterButtons();
      this.render();
    }
    this.selectedId = id;
    this.cards.forEach((card, cid) => {
      card.classList.toggle('is-selected', cid === id);
    });
    if (opts.scroll) {
      this.cards.get(id)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  private render(): void {
    const list = this.visible();
    this.skeletonEl.classList.add('hidden');
    this.listEl.innerHTML = '';
    this.cards.clear();

    this.countEl.textContent = this.events.length ? `${list.length} / ${this.events.length} shown` : '';

    if (!this.events.length || !list.length) {
      this.listEl.classList.add('hidden');
      this.emptyEl.classList.remove('hidden');
      this.emptyMsgEl.textContent = this.events.length
        ? 'No systems match the current search or filter. Try “All Systems”.'
        : 'Neither data source is currently reporting active volcanic systems.';
      this.onListChange(new Set(list.map((v) => v.id)));
      return;
    }

    this.emptyEl.classList.add('hidden');
    this.listEl.classList.remove('hidden');

    list.forEach((v, i) => {
      const card = v.source === 'usgs' ? this.usgsCard(v) : this.nasaCard(v);
      card.dataset.id = v.id;
      card.style.animationDelay = `${Math.min(i * 28, 340)}ms`;
      card.classList.add('animate-rise');
      if (v.id === this.selectedId) card.classList.add('is-selected');
      card.addEventListener('click', (ev) => {
        if ((ev.target as HTMLElement).closest('[data-nolink]')) return;
        this.onSelect(v.id);
      });
      this.cards.set(v.id, card);
      this.listEl.appendChild(card);
    });

    this.onListChange(new Set(list.map((v) => v.id)));
  }

  /** A "when it happened" row + an explicit Fly & analyze action button. */
  private whenRow(label: string, iso: string | null, accent: string): string {
    const abs = fmtDateTime(iso);
    const rel = timeAgo(iso);
    const value = abs ? `${escapeHtml(abs)}${rel ? ` · ${escapeHtml(rel)}` : ''}` : 'Not reported';
    return /* html */ `
      <div class="mt-3 flex items-center gap-1.5 text-[11px] text-stone-400">
        <svg viewBox="0 0 24 24" class="h-3.5 w-3.5 shrink-0 ${accent}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>
        <span class="text-stone-500">${escapeHtml(label)}:</span>
        <span class="font-medium text-stone-300">${value}</span>
      </div>`;
  }

  private flyButton(accent: string): string {
    return /* html */ `
      <button type="button" data-fly class="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-lg border ${accent} px-3 py-2 text-[11px] font-bold uppercase tracking-wide transition hover:brightness-125">
        Fly &amp; analyze
        <svg viewBox="0 0 24 24" class="h-3.5 w-3.5" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
      </button>`;
  }

  private usgsCard(v: VolcanoEvent): HTMLElement {
    const st = AVIATION[v.colorCode];
    const cc = v.colorCode === 'UNKNOWN' ? 'UNASSIGNED' : v.colorCode;
    const card = document.createElement('article');
    card.className =
      'feed-card group cursor-pointer rounded-2xl border border-hair bg-base-850 p-5 transition hover:-translate-y-0.5 hover:border-ember-400/40 hover:bg-base-800';
    card.innerHTML = /* html */ `
      <div class="flex items-center justify-between gap-2">
        <span class="inline-flex items-center gap-1.5 text-[10px] font-bold tracking-wider text-ember-300 uppercase"><span class="h-1.5 w-1.5 rounded-full bg-ember-400"></span>USGS Alert</span>
        <span class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10.5px] font-bold tracking-wide uppercase ring-1 ring-inset ${st.badge}"><span class="h-1.5 w-1.5 rounded-full ${st.dot}"></span>${escapeHtml(st.label)}</span>
      </div>
      <h3 class="mt-3 text-[16px] leading-tight font-bold text-white group-hover:text-ember-200">${escapeHtml(v.name)}</h3>
      <p class="mt-0.5 flex items-center gap-1.5 text-[12px] text-stone-400">
        <svg viewBox="0 0 24 24" class="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 21s-7-5.2-7-11a7 7 0 0 1 14 0c0 5.8-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/></svg>
        ${escapeHtml(v.region)}
      </p>
      <div class="mt-4 grid grid-cols-2 gap-2 text-[11px]">
        <div class="rounded-lg bg-white/[0.03] px-3 py-2"><div class="text-stone-500">Aviation Color</div><div class="mt-0.5 font-mono font-semibold ${st.text}">${escapeHtml(cc)}</div></div>
        <div class="rounded-lg bg-white/[0.03] px-3 py-2"><div class="text-stone-500">Alert Level</div><div class="mt-0.5 font-mono font-semibold text-stone-200">${escapeHtml(v.alertLevel ?? '—')}</div></div>
      </div>
      <p class="mt-3 border-l-2 ${st.border} pl-2.5 text-[11px] leading-relaxed text-stone-400">
        <span class="font-semibold ${st.text}">Why ${escapeHtml(cc)}?</span> ${escapeHtml(st.why)}
      </p>
      ${this.whenRow('Alert issued', v.updated, 'text-ember-400')}
      <div class="mt-3 border-t border-hair pt-3">
        <span class="font-mono text-[11px] text-stone-500">${v.lat.toFixed(3)}, ${v.lon.toFixed(3)}</span>
        ${this.flyButton('border-ember-500/30 bg-ember-500/10 text-ember-300')}
      </div>`;
    return card;
  }

  private nasaCard(v: VolcanoEvent): HTMLElement {
    const card = document.createElement('article');
    card.className =
      'feed-card group cursor-pointer rounded-2xl border border-hair bg-base-850 p-5 transition hover:-translate-y-0.5 hover:border-pink-400/40 hover:bg-base-800';
    card.innerHTML = /* html */ `
      <div class="flex items-center justify-between gap-2">
        <span class="inline-flex items-center gap-1.5 text-[10px] font-bold tracking-wider text-pink-300 uppercase"><span class="h-1.5 w-1.5 rounded-full bg-pink-400"></span>NASA EONET</span>
        <span class="inline-flex items-center gap-1.5 rounded-full bg-red-500/15 px-2.5 py-1 text-[10.5px] font-bold tracking-wide text-red-300 uppercase ring-1 ring-inset ring-red-500/30"><span class="h-1.5 w-1.5 animate-pulse rounded-full bg-red-400"></span>Active Event</span>
      </div>
      <h3 class="mt-3 text-[16px] leading-tight font-bold text-white group-hover:text-pink-200">${escapeHtml(v.name)}</h3>
      <p class="mt-0.5 flex items-center gap-1.5 text-[12px] text-stone-400">
        <svg viewBox="0 0 24 24" class="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 3 2.5 15 0 18M12 3c-2.5 3-2.5 15 0 18"/></svg>
        Satellite-detected thermal / plume anomaly
      </p>
      <div class="mt-4 grid grid-cols-2 gap-2 text-[11px]">
        <div class="rounded-lg bg-white/[0.03] px-3 py-2"><div class="text-stone-500">Latitude</div><div class="mt-0.5 font-mono font-semibold text-stone-200">${v.lat.toFixed(4)}</div></div>
        <div class="rounded-lg bg-white/[0.03] px-3 py-2"><div class="text-stone-500">Longitude</div><div class="mt-0.5 font-mono font-semibold text-stone-200">${v.lon.toFixed(4)}</div></div>
      </div>
      <p class="mt-3 border-l-2 border-pink-400/50 pl-2.5 text-[11px] leading-relaxed text-stone-400">
        <span class="font-semibold text-pink-300">Why flagged?</span> Listed by NASA EONET as an open volcanic event — a thermal hot-spot or ash / gas plume is currently detectable from orbit. EONET aggregates satellite sensors, not ground alert levels.
      </p>
      ${this.whenRow('Last satellite detection', v.updated, 'text-pink-400')}
      <div class="mt-3 border-t border-hair pt-3 text-[11px]">
        <a href="${escapeHtml(v.link)}" target="_blank" rel="noopener" data-nolink class="inline-flex items-center gap-1 font-semibold text-pink-300 hover:text-pink-200 hover:underline">${escapeHtml(v.reportName)} report
          <svg viewBox="0 0 24 24" class="h-3 w-3" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17 17 7M7 7h10v10"/></svg>
        </a>
        ${this.flyButton('border-pink-500/30 bg-pink-500/10 text-pink-300')}
      </div>`;
    return card;
  }
}
