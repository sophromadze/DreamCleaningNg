import { Component, OnInit, OnDestroy, Inject, PLATFORM_ID } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';

export interface BubbleConfig {
  style: { [key: string]: string };
}

const MOBILE_BREAKPOINT_PX = 768;

@Component({
  selector: 'app-bubble-field',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './bubble-field.component.html',
  styleUrl: './bubble-field.component.scss'
})
export class BubbleFieldComponent implements OnInit, OnDestroy {
  bubbles: BubbleConfig[] = [];
  private resizeListener: (() => void) | null = null;

  constructor(@Inject(PLATFORM_ID) private platformId: Object) {}

  ngOnInit(): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }
    this.bubbles = this.buildBubbles();
    this.resizeListener = () => this.onResize();
    window.addEventListener('resize', this.resizeListener);
  }

  ngOnDestroy(): void {
    if (this.resizeListener && isPlatformBrowser(this.platformId)) {
      window.removeEventListener('resize', this.resizeListener);
    }
  }

  private onResize(): void {
    this.bubbles = this.buildBubbles();
  }

  private isMobile(): boolean {
    return isPlatformBrowser(this.platformId) && window.innerWidth <= MOBILE_BREAKPOINT_PX;
  }

  private rand(min: number, max: number): number {
    return Math.random() * (max - min) + min;
  }

  private randInt(min: number, max: number): number {
    return Math.floor(this.rand(min, max));
  }

  private px(v: number): string {
    return v + 'px';
  }

  private buildBubbles(): BubbleConfig[] {
    const list: BubbleConfig[] = [];
    const count = this.isMobile() ? 14 : 55; // 1/4 on viewports ≤768px

    for (let i = 0; i < count; i++) {
      const size = this.rand(24, 130);
      const x = this.rand(-2, 100);
      const y = this.rand(-2, 100);

      const drift = size * 0.4;
      const s1 = (0.97 + Math.random() * 0.06).toFixed(3);
      const s2 = (0.97 + Math.random() * 0.06).toFixed(3);

      list.push({
        style: {
          width: this.px(size),
          height: this.px(size),
          left: x + '%',
          top: y + '%',
          '--dx1': this.px(this.rand(-drift, drift)),
          '--dy1': this.px(this.rand(-drift, drift)),
          '--dx2': this.px(this.rand(-drift, drift)),
          '--dy2': this.px(this.rand(-drift, drift)),
          '--dx3': this.px(this.rand(-drift, drift)),
          '--dy3': this.px(this.rand(-drift, drift)),
          '--dx4': this.px(this.rand(-drift, drift)),
          '--dy4': this.px(this.rand(-drift, drift)),
          '--s1': s1,
          '--s2': s2,
          '--duration': this.rand(12, 28).toFixed(1) + 's',
          '--delay': this.rand(-20, 0).toFixed(1) + 's',
          '--iri-duration': this.rand(8, 18).toFixed(1) + 's',
          '--film-duration': this.rand(10, 22).toFixed(1) + 's',
          '--hue-start': this.randInt(0, 360) + 'deg',
          opacity: (0.35 + (size / 130) * 0.55).toFixed(2)
        }
      });
    }

    const topLeftSeeds = [
      { x: 3, y: 4, size: 72 },
      { x: 12, y: 14, size: 48 },
      { x: 8, y: 28, size: 90 },
      { x: 20, y: 6, size: 38 },
      { x: 1, y: 18, size: 55 }
    ];

    const seedCount = this.isMobile() ? 1 : 5; // 1/4 seeds on mobile
    topLeftSeeds.slice(0, seedCount).forEach(seed => {
      const drift = seed.size * 0.35;
      list.push({
        style: {
          width: this.px(seed.size),
          height: this.px(seed.size),
          left: seed.x + '%',
          top: seed.y + '%',
          '--dx1': this.px(this.rand(-drift, drift)),
          '--dy1': this.px(this.rand(-drift, drift)),
          '--dx2': this.px(this.rand(-drift, drift)),
          '--dy2': this.px(this.rand(-drift, drift)),
          '--dx3': this.px(this.rand(-drift, drift)),
          '--dy3': this.px(this.rand(-drift, drift)),
          '--dx4': this.px(this.rand(-drift, drift)),
          '--dy4': this.px(this.rand(-drift, drift)),
          '--s1': (0.97 + Math.random() * 0.06).toFixed(3),
          '--s2': (0.97 + Math.random() * 0.06).toFixed(3),
          '--duration': this.rand(14, 26).toFixed(1) + 's',
          '--delay': this.rand(-15, 0).toFixed(1) + 's',
          '--iri-duration': this.rand(8, 18).toFixed(1) + 's',
          '--film-duration': this.rand(10, 22).toFixed(1) + 's',
          '--hue-start': this.randInt(0, 360) + 'deg',
          opacity: (0.4 + (seed.size / 130) * 0.5).toFixed(2)
        }
      });
    });

    return list;
  }
}
