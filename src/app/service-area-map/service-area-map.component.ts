import {
  Component,
  Input,
  AfterViewInit,
  OnDestroy,
  PLATFORM_ID,
  inject,
  ChangeDetectorRef,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { skip } from 'rxjs/operators';
import type { Feature, FeatureCollection } from 'geojson';
import {
  getZipToNeighborhood,
  getAllZipsForBorough,
  type BoroughType,
} from '../data/zip-code-data';
import { ThemeService } from '../services/theme.service';

/** Served from public folder at site root so production can load it reliably. */
const GEOJSON_URL = '/nyc-zip-codes.json';

const ZIP_PROP_KEYS = ['postalCode', 'ZIPCODE', 'ZCTA5CE10', 'zcta5'];

/** ZIPs where the GeoJSON has separate island features; we keep only the northernmost (mainland) feature. All other ZIPs show every feature (full area). */
const ZIPS_WITH_ISLANDS = new Set(['10004', '10005']);

/** For MultiPolygons, keep only the single largest part (mainland only; drop islands). */

@Component({
  selector: 'app-service-area-map',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './service-area-map.component.html',
  styleUrls: ['./service-area-map.component.scss'],
})
export class ServiceAreaMapComponent implements AfterViewInit, OnDestroy {
  @Input() borough: BoroughType = 'brooklyn';
  @Input() serviceZipCodes: string[] = [];
  @Input() mapCenter: [number, number] = [40.6502, -73.9496];
  @Input() zoomLevel = 12;

  private platformId = inject(PLATFORM_ID);
  private http = inject(HttpClient);
  private cdr = inject(ChangeDetectorRef);
  private themeService = inject(ThemeService);
  private themeSub?: Subscription;

  searchZip = '';
  searchMessage = '';
  searchSuccess: boolean | null = null;
  highlightedZipCode: string | null = null;

  private map: import('leaflet').Map | null = null;
  private tileLayer: import('leaflet').TileLayer | null = null;
  private geoJsonLayer: import('leaflet').GeoJSON | null = null;
  private zipToLayer = new Map<string, import('leaflet').Layer>();
  private zipToNeighborhood: Record<string, string> = {};
  private boroughZips: string[] = [];
  private L: typeof import('leaflet') | null = null;

  ngAfterViewInit(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    this.zipToNeighborhood = getZipToNeighborhood(this.borough);
    this.boroughZips = getAllZipsForBorough(this.borough);
    this.themeSub = this.themeService.theme$.pipe(skip(1)).subscribe(() => this.updateMapTileLayer());
    this.loadGeoJsonAndInitMap();
  }

  ngOnDestroy(): void {
    this.themeSub?.unsubscribe();
    this.clearMap();
  }

  private clearMap(): void {
    if (this.tileLayer && this.map) {
      this.map.removeLayer(this.tileLayer);
      this.tileLayer = null;
    }
    if (this.geoJsonLayer) {
      this.geoJsonLayer.clearLayers();
      this.geoJsonLayer = null;
    }
    this.zipToLayer.clear();
    if (this.map) {
      this.map.remove();
      this.map = null;
    }
  }

  private loadGeoJsonAndInitMap(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    this.http.get<unknown>(GEOJSON_URL).subscribe({
      next: (data) => {
        if (!isPlatformBrowser(this.platformId)) return;
        const geojson = this.normalizeGeoJson(data);
        this.initMap(geojson);
      },
      error: (err) => {
        console.warn('Could not load NYC ZIP GeoJSON. Using empty map.', err);
        if (isPlatformBrowser(this.platformId)) {
          this.initMap({ type: 'FeatureCollection', features: [] });
        }
      },
    });
  }

  /** Filter out features with null/malformed geometry so Leaflet never calls .map() on invalid coordinates. */
  private hasValidGeometry(f: Feature): boolean {
    if (!f.geometry) return false;
    const geom = f.geometry as { type?: string; coordinates?: unknown };
    if (!geom.type || !geom.coordinates) return false;
    if (!Array.isArray(geom.coordinates)) return false;
    if (geom.type === 'Polygon') {
      return geom.coordinates.length > 0 && Array.isArray(geom.coordinates[0]);
    }
    if (geom.type === 'MultiPolygon') {
      return geom.coordinates.length > 0 && Array.isArray(geom.coordinates[0]);
    }
    return true;
  }

  /** Ensure we have a valid FeatureCollection so .map() is never called on non-array. */
  private normalizeGeoJson(data: unknown): FeatureCollection {
    if (data && typeof data === 'object' && 'features' in data) {
      const features = (data as { features?: unknown }).features;
      if (Array.isArray(features)) {
        return { type: 'FeatureCollection', features };
      }
    }
    return { type: 'FeatureCollection', features: [] };
  }

  private getZipFromFeature(props: Record<string, unknown>): string | null {
    for (const key of ZIP_PROP_KEYS) {
      const v = props[key];
      if (v != null && typeof v === 'string') return v;
      if (v != null && typeof v === 'number') return String(v);
    }
    return null;
  }

  /** Signed area of a ring (array of [lng, lat]) using Shoelace formula; use Math.abs for area. */
  private static ringArea(ring: number[][]): number {
    if (!ring || ring.length < 3) return 0;
    let sum = 0;
    const n = ring.length;
    for (let i = 0; i < n; i++) {
      const [x1, y1] = ring[i];
      const [x2, y2] = ring[(i + 1) % n];
      sum += x1 * y2 - x2 * y1;
    }
    return Math.abs(sum) / 2;
  }

  /** Area of a feature's geometry (Polygon = exterior ring; MultiPolygon = largest part). */
  private static featureArea(feature: Feature): number {
    const geom = feature.geometry as { type?: string; coordinates?: unknown } | undefined;
    if (!geom || !geom.coordinates) return 0;
    if (geom.type === 'Polygon') {
      const coords = geom.coordinates as number[][][];
      return ServiceAreaMapComponent.ringArea(coords[0] || []);
    }
    if (geom.type === 'MultiPolygon') {
      const multi = geom.coordinates as number[][][][];
      const areas = multi.map((poly) => ServiceAreaMapComponent.ringArea(poly[0] || []));
      return Math.max(0, ...areas);
    }
    return 0;
  }

  /** Max latitude in a ring (GeoJSON coords are [lng, lat]). */
  private static ringMaxLat(ring: number[][]): number {
    if (!ring?.length) return -90;
    return Math.max(...ring.map((p) => p[1]));
  }

  /** Maximum latitude of any point in the feature (northernmost extent). Mainland is typically north of islands. */
  private static featureMaxLat(feature: Feature): number {
    const geom = feature.geometry as { type?: string; coordinates?: unknown } | undefined;
    if (!geom || !geom.coordinates) return -90;
    if (geom.type === 'Polygon') {
      const coords = geom.coordinates as number[][][];
      return ServiceAreaMapComponent.ringMaxLat(coords[0] || []);
    }
    if (geom.type === 'MultiPolygon') {
      const multi = geom.coordinates as number[][][][];
      return Math.max(...multi.map((poly) => ServiceAreaMapComponent.ringMaxLat(poly[0] || [])));
    }
    return -90;
  }

  /**
   * For ZIPs in ZIPS_WITH_ISLANDS: keep only the northernmost feature (mainland). Other ZIPs: keep all features so the full area (e.g. both halves of 10021) shows.
   */
  private pickFeaturesPerZip(features: Feature[]): Feature[] {
    const byZip = new Map<string, Feature[]>();
    for (const f of features) {
      const zip = this.getZipFromFeature((f.properties || {}) as Record<string, unknown>);
      if (zip) {
        const list = byZip.get(zip) ?? [];
        list.push(f);
        byZip.set(zip, list);
      }
    }
    const result: Feature[] = [];
    byZip.forEach((list, zip) => {
      if (list.length === 0) return;
      if (ZIPS_WITH_ISLANDS.has(zip)) {
        let best = list[0];
        let bestMaxLat = ServiceAreaMapComponent.featureMaxLat(best);
        for (let i = 1; i < list.length; i++) {
          const maxLat = ServiceAreaMapComponent.featureMaxLat(list[i]);
          if (maxLat > bestMaxLat) {
            bestMaxLat = maxLat;
            best = list[i];
          }
        }
        result.push(best);
      } else {
        result.push(...list);
      }
    });
    return result;
  }

  /** Only simplify MultiPolygon to largest part for ZIPs with islands (10004, etc.). Other ZIPs keep full MultiPolygon so e.g. 10021 shows both halves. */
  private maybeFilterSmallPolygonParts(feature: Feature): Feature {
    const zip = this.getZipFromFeature((feature.properties || {}) as Record<string, unknown>);
    if (zip && ZIPS_WITH_ISLANDS.has(zip)) {
      return this.filterSmallPolygonParts(feature);
    }
    return feature;
  }

  /** For non-island ZIPs, expand MultiPolygon into one feature per part so every part is drawn (fixes 10021 showing only half). */
  private expandMultiPolygonToPolygons(features: Feature[]): Feature[] {
    const out: Feature[] = [];
    for (const f of features) {
      const zip = this.getZipFromFeature((f.properties || {}) as Record<string, unknown>);
      const geom = f.geometry as { type?: string; coordinates?: unknown[] } | undefined;
      if (zip && !ZIPS_WITH_ISLANDS.has(zip) && geom?.type === 'MultiPolygon' && Array.isArray(geom.coordinates)) {
        const multi = geom.coordinates as number[][][][];
        for (const poly of multi) {
          out.push({
            ...f,
            geometry: { type: 'Polygon' as const, coordinates: poly },
          });
        }
      } else {
        out.push(f);
      }
    }
    return out;
  }

  /**
   * For MultiPolygon, keep only the single largest polygon part (mainland).
   * Drops all smaller parts (e.g. Governor's Island, Liberty Island, Ellis Island for 10004).
   */
  private filterSmallPolygonParts(feature: Feature): Feature {
    const geom = feature.geometry as { type?: string; coordinates?: unknown[] } | undefined;
    if (!geom || geom.type !== 'MultiPolygon' || !Array.isArray(geom.coordinates)) {
      return feature;
    }
    const multi = geom.coordinates as number[][][][]; // [polygon][ring][point][lng,lat]
    const areas = multi.map((poly) => ServiceAreaMapComponent.ringArea(poly[0] || []));
    let maxIdx = 0;
    let maxArea = areas[0] ?? 0;
    for (let i = 1; i < areas.length; i++) {
      if (areas[i] > maxArea) {
        maxArea = areas[i];
        maxIdx = i;
      }
    }
    const largest = multi[maxIdx];
    if (!largest) return feature;
    return {
      ...feature,
      geometry: { type: 'Polygon' as const, coordinates: largest },
    };
  }

  private initMap(geojson: FeatureCollection): void {
    import('leaflet').then((leafletModule: any) => {
      const L = leafletModule.default || leafletModule;
      this.clearMap();
      const mapEl = document.getElementById('service-area-map');
      if (!mapEl) return;
      (mapEl as unknown as { _leaflet_id?: number })._leaflet_id = undefined;

      this.L = L;
      const boroughZipSet = new Set(this.boroughZips);
      const rawFeatures = Array.isArray(geojson?.features) ? geojson.features : [];
      const filtered = rawFeatures.filter((f: Feature) => {
        const zip = this.getZipFromFeature((f.properties || {}) as Record<string, unknown>);
        return zip != null && boroughZipSet.has(zip);
      });
      const picked = this.pickFeaturesPerZip(filtered);
      const filteredParts = picked.map((f) => this.maybeFilterSmallPolygonParts(f));
      const expanded = this.expandMultiPolygonToPolygons(filteredParts);
      const validFeatures = expanded.filter((f: Feature) => this.hasValidGeometry(f));

      console.log(`[ServiceAreaMap] Borough: ${this.borough}, Total features loaded: ${validFeatures.length}`);
      if (validFeatures.length === 0) {
        console.warn('[ServiceAreaMap] No features found for this borough. Check GeoJSON file and ZIP code matching.');
      }

      this.map = L.map('service-area-map', {
        center: this.mapCenter,
        zoom: this.zoomLevel,
        zoomControl: false,
      });
      L.control.zoom({ position: 'topright' }).addTo(this.map);

      this.tileLayer = L.tileLayer(this.getTileUrl(), {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>',
        subdomains: 'abcd',
        maxZoom: 19,
      }).addTo(this.map) as import('leaflet').TileLayer;

      const serviceSet = new Set(this.serviceZipCodes);

      this.geoJsonLayer = L.geoJSON(undefined, {
        style: (feature: Feature | undefined) => this.getStyle(feature, serviceSet, L),
        onEachFeature: (feature: Feature, layer: import('leaflet').Layer) => {
          const zip = this.getZipFromFeature((feature.properties || {}) as Record<string, unknown>);
          if (zip) this.zipToLayer.set(zip, layer);

          const neighborhood = this.zipToNeighborhood[zip || ''] || '';
          const label = zip ? `${zip}${neighborhood ? ` — ${neighborhood}` : ''}` : '';

          layer.bindTooltip(label, {
            permanent: false,
            direction: 'top',
            className: 'service-area-tooltip',
          });

          layer.on('click', () => {
            const leafletLayer = layer as unknown as { getBounds?: () => import('leaflet').LatLngBounds };
            const bounds = leafletLayer.getBounds?.();
            if (bounds && this.map) this.map.fitBounds(bounds, { maxZoom: 14, animate: true });
          });
        },
      }).addTo(this.map);

      for (const feature of validFeatures) {
        try {
          this.geoJsonLayer!.addData(feature as any);
        } catch (err) {
          const zip = this.getZipFromFeature((feature.properties || {}) as Record<string, unknown>);
          console.warn(`[ServiceAreaMap] Skipping feature with bad geometry — ZIP: ${zip}`, err);
        }
      }

      this.cdr.markForCheck();
    });
  }

  private getTileUrl(): string {
    return this.themeService.theme === 'dark'
      ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
      : 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';
  }

  private updateMapTileLayer(): void {
    if (!this.map || !this.L) return;
    if (this.tileLayer) this.map.removeLayer(this.tileLayer);
    this.tileLayer = this.L.tileLayer(this.getTileUrl(), {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>',
      subdomains: 'abcd',
      maxZoom: 19,
    }).addTo(this.map) as import('leaflet').TileLayer;
    this.cdr.markForCheck();
  }

  private getStyle(
    feature: Feature | undefined,
    serviceSet: Set<string>,
    L: typeof import('leaflet')
  ): import('leaflet').PathOptions {
    if (!feature) {
      return { fillColor: '#555', color: '#666', weight: 1, opacity: 0.5, fillOpacity: 0.15 };
    }
    const zip = this.getZipFromFeature((feature.properties || {}) as Record<string, unknown>);
    const isService = zip != null && serviceSet.has(zip);
    const isHighlighted = zip === this.highlightedZipCode;

    if (isHighlighted) {
      return {
        fillColor: '#4ade80',
        color: '#4ade80',
        weight: 2,
        opacity: 0.8,
        fillOpacity: 0.5,
      };
    }
    if (isService) {
      return {
        fillColor: '#1e90ff',
        color: '#1e90ff',
        weight: 1.5,
        opacity: 0.7,
        fillOpacity: 0.25,
      };
    }
    return {
      fillColor: '#555',
      color: '#666',
      weight: 1,
      opacity: 0.5,
      fillOpacity: 0.1,
    };
  }

  private reapplyStyles(): void {
    if (!this.geoJsonLayer) return;
    const serviceSet = new Set(this.serviceZipCodes);
    this.zipToLayer.forEach((layer, zip) => {
      const isService = serviceSet.has(zip);
      const isHighlighted = zip === this.highlightedZipCode;
      const opts: import('leaflet').PathOptions = isHighlighted
        ? { fillColor: '#4ade80', color: '#4ade80', weight: 2, opacity: 0.8, fillOpacity: 0.5 }
        : isService
          ? { fillColor: '#1e90ff', color: '#1e90ff', weight: 1.5, opacity: 0.7, fillOpacity: 0.25 }
          : { fillColor: '#555', color: '#666', weight: 1, opacity: 0.5, fillOpacity: 0.1 };
      (layer as unknown as import('leaflet').Path).setStyle(opts);
    });
  }

  private flyToZip(zip: string): void {
    const layer = this.zipToLayer.get(zip);
    if (layer && this.map) {
      const leafletLayer = layer as unknown as { getBounds?: () => import('leaflet').LatLngBounds };
      const bounds = leafletLayer.getBounds?.();
      if (bounds) this.map.fitBounds(bounds, { maxZoom: 13, animate: true });
    }
  }

  onSearch(): void {
    const raw = this.searchZip.trim().replace(/\D/g, '');
    this.searchMessage = '';
    this.searchSuccess = null;
    this.highlightedZipCode = null;
    this.reapplyStyles();

    if (raw.length !== 5) {
      this.searchMessage = 'Please enter a valid ZIP code';
      this.searchSuccess = false;
      this.cdr.markForCheck();
      return;
    }

    if (!this.boroughZips.includes(raw)) {
      this.searchMessage = `Sorry, we don't currently service ${raw}. Contact us to request service in your area.`;
      this.searchSuccess = false;
      this.cdr.markForCheck();
      return;
    }

    const neighborhood = this.zipToNeighborhood[raw] || '';
    const isServiced = this.serviceZipCodes.includes(raw);

    if (isServiced) {
      this.searchMessage = `Great news! We service ${raw} — ${neighborhood}! Book your cleaning today.`;
      this.searchSuccess = true;
      this.highlightedZipCode = raw;
      this.reapplyStyles();
      this.flyToZip(raw);
    } else {
      this.searchMessage = `Sorry, we don't currently service ${raw}. Contact us to request service in your area.`;
      this.searchSuccess = false;
      this.flyToZip(raw);
    }
    this.cdr.markForCheck();
  }

  get messageClass(): string {
    if (this.searchSuccess === true) return 'message success';
    if (this.searchSuccess === false) return 'message error';
    return 'message';
  }
}
