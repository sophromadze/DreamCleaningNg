import { Component, OnInit, OnDestroy, Inject, PLATFORM_ID } from '@angular/core';
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
  styleUrl: './bubble-badge.component.scss'
})
export class BubbleBadgeComponent implements OnInit, OnDestroy {
  summary: HeaderSummary | null = null;
  isLoading = false;
  showTooltip = false;
  isBrowser: boolean;
  private destroy$ = new Subject<void>();
  private visibilityHandler?: () => void;

  constructor(
    private bubbleRewardsService: BubbleRewardsService,
    private authService: AuthService,
    private router: Router,
    @Inject(PLATFORM_ID) private platformId: Object
  ) {
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
      },
      error: () => {
        this.isLoading = false;
      }
    });
  }

  goToRewards(): void {
    this.router.navigate(['/rewards']);
  }
}
