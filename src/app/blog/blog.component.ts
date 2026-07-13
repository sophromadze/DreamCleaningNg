import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
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
  imports: [CommonModule, RouterModule],
  templateUrl: './blog.component.html',
  styleUrl: './blog.component.scss'
})
export class BlogComponent implements OnInit {
  posts: BlogPostListItem[] = [];
  categories: string[] = [];
  selectedCategory: string | null = null;
  page = 1;
  pageSize = 9;
  totalCount = 0;
  loading = true;
  loadFailed = false;
  /** Admin master switch is OFF — render the friendly coming-soon page. */
  comingSoon = false;

  constructor(
    private blogService: BlogService,
    private route: ActivatedRoute,
    private router: Router
  ) {}

  ngOnInit(): void {
    this.route.queryParamMap.subscribe(params => {
      this.page = Math.max(1, parseInt(params.get('page') || '1', 10) || 1);
      this.selectedCategory = params.get('category');
      this.load();
    });
  }

  get totalPages(): number {
    return Math.max(1, Math.ceil(this.totalCount / this.pageSize));
  }

  get pageNumbers(): number[] {
    return Array.from({ length: this.totalPages }, (_, i) => i + 1);
  }

  private load(): void {
    this.loading = true;
    this.loadFailed = false;
    this.comingSoon = false;
    this.blogService.getPosts(this.page, this.pageSize, this.selectedCategory ?? undefined).subscribe({
      next: (res) => {
        // Owner's master switch is OFF → coming-soon page (admin publishing still works).
        if (res && res.publicVisible === false) {
          this.comingSoon = true;
          this.posts = [];
          this.loading = false;
          return;
        }
        // The SSR skip-path can hand back null bodies; treat as empty and let
        // the browser re-fetch after hydration.
        this.posts = res?.posts ?? [];
        this.categories = res?.categories ?? [];
        this.totalCount = res?.totalCount ?? 0;
        this.loading = false;
      },
      error: () => {
        this.posts = [];
        this.loading = false;
        this.loadFailed = true;
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
    if (page < 1 || page > this.totalPages || page === this.page) return;
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
