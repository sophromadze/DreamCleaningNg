import { Component, OnInit, OnDestroy, PLATFORM_ID, EventEmitter, Output, ChangeDetectionStrategy, inject } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { Router, RouterModule, NavigationEnd } from '@angular/router';
import { Subject, Subscription } from 'rxjs';
import { takeUntil, filter } from 'rxjs/operators';
import { BubbleRewardsService, HeaderSummary } from '../../services/bubble-rewards.service';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-bubble-badge',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './bubble-badge.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './bubble-badge.component.scss'
})
export class BubbleBadgeComponent implements OnInit, OnDestroy {
  private bubbleRewardsService = inject(BubbleRewardsService);
  private authService = inject(AuthService);
  private router = inject(Router);
  private platformId = inject<Object>(PLATFORM_ID);

  summary: HeaderSummary | null = null;
  /**
   * Whether the points system is on for this account, reported after each load so the header can
   * drop the slot (and remember the answer for the next server render) when it is off.
   */
  @Output() availability = new EventEmitter<boolean>();
  /**
   * Stands in for the summary until it loads (and on the server): the badge is drawn from it in
   * full - visible - with an empty number slot, so the balance arriving fills reserved space
   * instead of pushing the nav. Never user data: the server renders it for any signed-in hint.
   * A five-digit balance still fits the pill's 120px minimum width.
   */
  readonly placeholder: HeaderSummary = {
    points: 0, tier: 'Bubble', tierEmoji: '', credits: 0, pointsSystemEnabled: true,
    tierProgressPercent: 0, nextTierName: null
  };
  isLoading = false;
  showTooltip = false;
  isBrowser: boolean;
  private destroy$ = new Subject<void>();
  private visibilityHandler?: () => void;

  constructor() {
    this.isBrowser = isPlatformBrowser(this.platformId);
  }

  ngOnInit(): void {
    if (!this.isBrowser) return;

    // Load on auth change
    this.authService.currentUser
      .pipe(takeUntil(this.destroy$))
      .subscribe(user => {
        if (user) {
          this.loadSummary();
        } else {
          this.summary = null;
        }
      });

    // Reload on page visibility change (tab focus)
    this.visibilityHandler = () => {
      if (!document.hidden && this.authService.isLoggedIn()) {
        this.loadSummary();
      }
    };
    document.addEventListener('visibilitychange', this.visibilityHandler);

    // Reload on navigation (e.g. after booking)
    this.router.events
      .pipe(
        filter(e => e instanceof NavigationEnd),
        takeUntil(this.destroy$)
      )
      .subscribe(() => {
        if (this.authService.isLoggedIn()) {
          this.loadSummary();
        }
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    if (this.visibilityHandler) {
      document.removeEventListener('visibilitychange', this.visibilityHandler);
    }
  }

  loadSummary(): void {
    this.isLoading = true;
    this.bubbleRewardsService.getHeaderSummary().subscribe({
      next: (data) => {
        this.summary = data;
        this.isLoading = false;
        this.availability.emit(!!data?.pointsSystemEnabled);
      },
      error: () => {
        this.isLoading = false;
        // No badge to show: give the reserved slot back rather than leave an invisible gap.
        this.availability.emit(false);
      }
    });
  }

  goToRewards(): void {
    this.router.navigate(['/rewards']);
  }
}
