import { Injectable, Inject, PLATFORM_ID } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { isPlatformBrowser } from '@angular/common';

export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'dreamcleaning-theme';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly currentTheme$ = new BehaviorSubject<Theme>('light');
  private readonly isBrowser: boolean;

  constructor(@Inject(PLATFORM_ID) private platformId: Object) {
    this.isBrowser = isPlatformBrowser(this.platformId);
    if (this.isBrowser) {
      const stored = localStorage.getItem(STORAGE_KEY) as Theme | null;
      const theme: Theme = stored === 'dark' ? 'dark' : 'light';
      this.currentTheme$.next(theme);
      this.applyToDocument(theme);
    }
  }

  get theme(): Theme {
    return this.currentTheme$.value;
  }

  get theme$() {
    return this.currentTheme$.asObservable();
  }

  get isDark(): boolean {
    return this.currentTheme$.value === 'dark';
  }

  setTheme(theme: Theme): void {
    if (!this.isBrowser) return;
    this.currentTheme$.next(theme);
    localStorage.setItem(STORAGE_KEY, theme);
    this.applyToDocument(theme);
  }

  toggle(): void {
    this.setTheme(this.currentTheme$.value === 'dark' ? 'light' : 'dark');
  }

  private applyToDocument(theme: Theme): void {
    if (!this.isBrowser || typeof document === 'undefined') return;
    document.documentElement.setAttribute('data-theme', theme);
  }
}
