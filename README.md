# Global Multi-API Volcano Tracker

TypeScript + Vite dashboard merging **USGS** elevated-volcano alerts, **NASA EONET**
active eruptions, **Open-Meteo** air-chemistry telemetry, and **Raspberry Shake**
FDSN seismic-station coverage onto a keyless **satellite tactical map**
(MapLibre GL + Esri World Imagery) with Chart.js SO₂ forecasting.

The live feed is sorted newest-activity-first (USGS alert time / EONET detection
time). Selecting a volcano also queries the Raspberry Shake FDSN `station`
service for citizen-science seismometers within ~220 km — a proxy for
independent ground-motion coverage.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173  (opens automatically)
```

Production build:

```bash
npm run build      # type-checks, then emits static files to dist/
npm run preview    # serve the built dist/
```

## Deploy (Vercel)

Push the source folder — Vercel auto-detects Vite, runs `npm run build`, and
serves `dist/`. `node_modules/` and `dist/` are git-ignored, so the upload is
< 1 MB. To deploy the pre-built output instead, upload the `dist/` folder
(~1.9 MB) as a static site. The one large asset (MapLibre GL, ~1 MB) is served
gzip/brotli-compressed by Vercel, so real transfer is ~285 KB.

## Project layout

| File | Responsibility |
| --- | --- |
| `index.html` | Static page chrome + mount points |
| `src/main.ts` | Wiring: load data → sync map ⇄ feed ⇄ analytics |
| `src/api.ts` | Concurrent fetch + normalisation for USGS / EONET / Open-Meteo / Raspberry Shake FDSN |
| `src/map.ts` | `TacticalMap` — satellite basemap, colour-coded markers, `flyTo` |
| `src/feed.ts` | `Feed` — cards, instant search, quick filters |
| `src/analytics.ts` | `AnalyticsPanel` — SO₂ gauge, threat bands, 24 h Chart.js line, PM2.5 / ashfall, nearby Raspberry Shake stations |
| `src/status.ts` | Aviation colour-code metadata |
| `src/types.ts` · `src/util.ts` | Shared types and helpers |
| `src/styles.css` | Tailwind v4 theme + component styles |

## Notes

- **No map token / no credit card.** The basemap is Esri World Imagery raster tiles
  plus a dark reference-label overlay, both keyless. Swap the tile URLs in
  `src/map.ts` if you prefer another provider.
- **CORS:** the USGS and NASA endpoints occasionally omit permissive CORS headers.
  The dev server is same-origin to your browser, not to those APIs — if a feed
  shows "offline", it is rate-limiting or blocking; retry with **Refresh**.
  Raspberry Shake's FDSN service sends `Access-Control-Allow-Origin: *` and is
  queried directly from the browser; a `404` there just means no stations in range.
- All coordinates flow through one `selectById()` path, so clicking a card or a
  marker always updates the map camera, the highlighted card, and the analytics
  panel together.
