import { Component, OnInit, ChangeDetectionStrategy, inject, signal, computed } from '@angular/core';
import { RouterModule, ActivatedRoute, Router } from '@angular/router';
import { BlogService, BlogPostListItem } from '../services/blog.service';

/**
 * Public blog index (/blog). Rendered per-request on the server (RenderMode.Server);
 * the SSR HTTP transfer cache hands the fetched list to the browser so hydration
 * doesn't re-fetch. Pagination/category live in query params so pages are crawlable.
 */
@Component({
  selector: 'app-blog',
  standalone: true,
  imports: [RouterModule],
  templateUrl: './blog.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './blog.component.scss'
})
export class BlogComponent implements OnInit {
  private blogService = inject(BlogService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  readonly posts = signal<BlogPostListItem[]>([]);
  readonly categories = signal<string[]>([]);
  readonly selectedCategory = signal<string | null>(null);
  readonly page = signal(1);
  pageSize = 9;
  readonly totalCount = signal(0);
  readonly loading = signal(true);
  readonly loadFailed = signal(false);
  /** Admin master switch is OFF — render the friendly coming-soon page. */
  readonly comingSoon = signal(false);

  ngOnInit(): void {
    this.route.queryParamMap.subscribe(params => {
      this.page.set(Math.max(1, parseInt(params.get('page') || '1', 10) || 1));
      this.selectedCategory.set(params.get('category'));
      this.load();
    });
  }

  readonly totalPages = computed<number>(() => Math.max(1, Math.ceil(this.totalCount() / this.pageSize)));

  readonly pageNumbers = computed<number[]>(() => Array.from({ length: this.totalPages() }, (_, i) => i + 1));

  private load(): void {
    this.loading.set(true);
    this.loadFailed.set(false);
    this.comingSoon.set(false);
    this.blogService.getPosts(this.page(), this.pageSize, this.selectedCategory() ?? undefined).subscribe({
      next: (res) => {
        // Owner's master switch is OFF → coming-soon page (admin publishing still works).
        if (res && res.publicVisible === false) {
          this.comingSoon.set(true);
          this.posts.set([]);
          this.loading.set(false);
          return;
        }
        // The SSR skip-path can hand back null bodies; treat as empty and let
        // the browser re-fetch after hydration.
        this.posts.set(res?.posts ?? []);
        this.categories.set(res?.categories ?? []);
        this.totalCount.set(res?.totalCount ?? 0);
        this.loading.set(false);
      },
      error: () => {
        this.posts.set([]);
        this.loading.set(false);
        this.loadFailed.set(true);
      }
    });
  }

  selectCategory(category: string | null): void {
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { category: category || null, page: null },
      queryParamsHandling: 'merge'
    });
  }

  goToPage(page: number): void {
    if (page < 1 || page > this.totalPages() || page === this.page()) return;
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { page: page === 1 ? null : page },
      queryParamsHandling: 'merge'
    });
  }

  formatDate(iso?: string): string {
    if (!iso) return '';
    return new Date(iso).toLocaleDateString('en-US', {
      timeZone: 'America/New_York',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  }
}
