import { Injectable, Inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { environment } from '../../environments/environment';

@Injectable({ providedIn: 'root' })
export class GoogleMapsLoaderService {
  private loaded = false;
  private loading: Promise<void> | null = null;
  /** Cached places namespace (from importLibrary('places') or google.maps.places). */
  private placesLibrary: any = null;

  constructor(@Inject(PLATFORM_ID) private platformId: Object) {}

  load(): Promise<void> {
    if (!isPlatformBrowser(this.platformId)) {
      return Promise.reject('Not in browser');
    }
    if (this.loaded) return Promise.resolve();
    if (this.loading) return this.loading;

    this.loading = (async () => {
      try {
        if (typeof google !== 'undefined' && google.maps) {
          await this.cachePlacesLibrary();
          this.loaded = true;
          return;
        }
        await this.injectBootstrapAndLoadPlaces();
        this.loaded = true;
      } catch (err) {
        this.loading = null;
        throw err;
      }
    })();

    return this.loading;
  }

  /**
   * Use existing google.maps (e.g. from another script) to get places.
   */
  private async cachePlacesLibrary(): Promise<void> {
    const g = typeof google !== 'undefined' ? google : null;
    if (!g?.maps) throw new Error('Google Maps not available');
    if (typeof (g.maps as any).importLibrary === 'function') {
      this.placesLibrary = await (g.maps as any).importLibrary('places');
      return;
    }
    if ((g.maps as any).places) {
      this.placesLibrary = (g.maps as any).places;
      return;
    }
    throw new Error('Places library not available');
  }

  /**
   * Inject Google's bootstrap loader so that importLibrary is defined, then load places.
   * Single load, no duplicate API. See https://developers.google.com/maps/documentation/javascript/load-maps-js-api#dynamic-library-import
   */
  private injectBootstrapAndLoadPlaces(): Promise<void> {
    return new Promise((resolve, reject) => {
      const apiKey = environment.googleMapsApiKey.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      // Bootstrap sets up google.maps.importLibrary and loads the main script on first use
      // Use \${c} so TypeScript does not treat ${c} as interpolation; bootstrap expects literal ${c} (c="google" in minified code)
      const bootstrap = `(g=>{var h,a,k,p="The Google Maps JavaScript API",c="google",l="importLibrary",q="__ib__",m=document,b=window;b=b[c]||(b[c]={});var d=b.maps||(b.maps={}),r=new Set,e=new URLSearchParams,u=()=>h||(h=new Promise(async(f,n)=>{await (a=m.createElement("script"));e.set("libraries",[...r]+"");for(k in g)e.set(k.replace(/[A-Z]/g,t=>"_"+t[0].toLowerCase()),g[k]);e.set("callback",c+".maps."+q);a.src=\`https://maps.\${c}apis.com/maps/api/js?\`+e;d[q]=f;a.onerror=()=>h=n(Error(p+" could not load."));a.nonce=m.querySelector("script[nonce]")?.nonce||"";m.head.append(a)}));d[l]?console.warn(p+" only loads once. Ignoring:",g):d[l]=(f,...n)=>r.add(f)&&u().then(()=>d[l](f,...n))})({key:"${apiKey}",v:"weekly"});`;
      const script = document.createElement('script');
      script.textContent = bootstrap;
      script.onerror = () => reject(new Error('Google Maps bootstrap failed to load'));
      document.head.appendChild(script);
      // Bootstrap runs synchronously and defines google.maps.importLibrary
      (async () => {
        try {
          const g = (typeof google !== 'undefined' && google) ? google : null;
          if (!g?.maps || typeof (g.maps as any).importLibrary !== 'function') {
            reject(new Error('Google Maps importLibrary not available'));
            return;
          }
          this.placesLibrary = await (g.maps as any).importLibrary('places');
          resolve();
        } catch (e) {
          reject(e);
        }
      })();
    });
  }

  /** Returns the places namespace (PlaceAutocompleteElement, etc.). Call after load() has resolved. */
  getPlacesLibrary(): Promise<any> {
    if (this.placesLibrary) return Promise.resolve(this.placesLibrary);
    return this.load().then(() => this.placesLibrary);
  }

  get isLoaded(): boolean {
    return this.loaded;
  }
}
