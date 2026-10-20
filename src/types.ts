export type Source = 'usgs' | 'nasa';

export type ColorKey = 'GREEN' | 'YELLOW' | 'ORANGE' | 'RED' | 'UNKNOWN';

export interface VolcanoEvent {
  id: string;
  source: Source;
  name: string;
  region: string;
  lat: number;
  lon: number;
  colorCode: ColorKey;
  alertLevel: string | null;
  updated: string | null;
  link: string;
  reportName: string;
}

export interface AirCurrent {
  time?: string;
  sulphur_dioxide: number | null;
  pm2_5: number | null;
  carbon_monoxide: number | null;
  european_aqi: number | null;
}

export interface AirQualityResult {
  current: AirCurrent;
  current_units: Record<string, string>;
  hourly?: {
    time: string[];
    sulphur_dioxide: (number | null)[];
    pm2_5: (number | null)[];
  };
}

export interface ShakeStation {
  code: string;        // "AM.R1A9C"
  lat: number;
  lon: number;
  elevation: number | null;
  distanceKm: number;
  active: boolean;     // has an open-ended operating epoch
}

export interface ShakeResult {
  stations: ShakeStation[];
  activeCount: number;
  nearest: ShakeStation | null;
  radiusKm: number;
}

export interface LoadResult {
  events: VolcanoEvent[];
  usgsOk: boolean;
  nasaOk: boolean;
  usgsCount: number;
  nasaCount: number;
}
