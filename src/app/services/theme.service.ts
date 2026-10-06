import { PLATFORM_ID, inject, Service } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { BehaviorSubject } from 'rxjs';
import { isPlatformBrowser } from '@angular/common';

export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'dreamcleaning-theme';

@Service()
export class ThemeService {
  private platformId = inject<Object>(PLATFORM_ID);

  private readonly currentTheme$ = new BehaviorSubject<Theme>('light');
  /** The subject as a signal, so views reading isDark/theme re-render on a change. */
  private readonly currentTheme = toSignal(this.currentTheme$, { requireSync: true });
  private readonly isBrowser: boolean;

  constructor() {
    this.isBrowser = isPlatformBrowser(this.platformId);
    if (this.isBrowser) {
      const stored = localStorage.getItem(STORAGE_KEY) as Theme | null;
      const theme: Theme = stored === 'dark' ? 'dark' : 'light';
      this.currentTheme$.next(theme);
      this.applyToDocument(theme);
    }
  }

  get theme(): Theme {
    return this.currentTheme();
  }

  get theme$() {
    return this.currentTheme$.asObservable();
  }

  get isDark(): boolean {
    return this.currentTheme() === 'dark';
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
