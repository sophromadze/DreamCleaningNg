import { Component, Inject, OnDestroy, OnInit, Optional } from '@angular/core';
import { CommonModule, DOCUMENT } from '@angular/common';
import { RouterModule, ActivatedRoute } from '@angular/router';
import { Meta, Title, DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { Subscription, take } from 'rxjs';
import { BlogService, BlogPostDetail } from '../../services/blog.service';
import { BlogStatusService } from '../../services/blog-status.service';
import { SSR_RESPONSE_CONTEXT, SsrResponseContext } from '../../shared/ssr/ssr-response.token';

const BASE_URL = 'https://dreamcleaningnyc.com';

/**
 * Public blog article (/blog/:slug). SSR-critical: per-post title, meta description,
 * canonical, Open Graph/Twitter tags, and BlogPosting JSON-LD are all set after the
 * fetch resolves — which happens during the server render, so crawlers see them.
 * Unknown slugs render the not-found view AND set a real HTTP 404 on the SSR
 * response via SSR_RESPONSE_CONTEXT (absent in the browser — optional injection).
 */
@Component({
  selector: 'app-blog-post',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './blog-post.component.html',
  styleUrl: './blog-post.component.scss'
})
export class BlogPostComponent implements OnInit, OnDestroy {
  post: BlogPostDetail | null = null;
  safeContent: SafeHtml | null = null;
  loading = true;
  notFound = false;
  /** Blog master switch is OFF — show coming-soon instead of a broken-looking 404
   *  (kinder to stray traffic/backlinks while the blog is pre-launch). */
  comingSoon = false;

  private subscription = new Subscription();
  private schemaElement: HTMLScriptElement | null = null;
  /** OG/article tags added by this page — removed on destroy so they don't leak. */
  private readonly managedMetaSelectors: string[] = [];

  constructor(
    private route: ActivatedRoute,
    private blogService: BlogService,
    private blogStatusService: BlogStatusService,
    private titleService: Title,
    private metaService: Meta,
    private sanitizer: DomSanitizer,
    @Inject(DOCUMENT) private document: Document,
    @Optional() @Inject(SSR_RESPONSE_CONTEXT) private ssrResponse: SsrResponseContext | null
  ) {}

  ngOnInit(): void {
    this.subscription.add(
      this.route.paramMap.subscribe(params => {
        const slug = params.get('slug');
        if (!slug) {
          this.markNotFound();
          return;
        }
        this.loadPost(slug);
      })
    );
  }

  ngOnDestroy(): void {
    this.subscription.unsubscribe();
    this.removeSchema();
    this.removeManagedMeta();
  }

  private loadPost(slug: string): void {
    this.loading = true;
    this.notFound = false;
    this.comingSoon = false;

    this.subscription.add(
      this.blogService.getPost(slug).subscribe({
        next: (post) => {
          if (!post) {
            // SSR skip-path / dev-mode backend mismatch can produce a null body;
            // treat as not found on the server, the browser re-fetches after hydration.
            this.handleMissingPost();
            return;
          }
          this.post = post;
          // ContentHtml is allowlist-sanitized server-side on every save.
          this.safeContent = this.sanitizer.bypassSecurityTrustHtml(post.contentHtml);
          this.loading = false;
          this.applySeo(post);
        },
        error: () => this.handleMissingPost()
      })
    );
  }

  /** A 404 means either the blog is hidden (master switch OFF → coming soon at 200)
   *  or the slug genuinely doesn't exist (→ real 404). One cached status call decides. */
  private handleMissingPost(): void {
    this.subscription.add(
      this.blogStatusService.publicVisible$.pipe(take(1)).subscribe(visible => {
        if (visible) {
          this.markNotFound();
        } else {
          this.markComingSoon();
        }
      })
    );
  }

  private markNotFound(): void {
    this.loading = false;
    this.notFound = true;
    if (this.ssrResponse) {
      this.ssrResponse.statusCode = 404;
    }
    this.titleService.setTitle('Article Not Found | Dream Cleaning Blog');
    this.metaService.updateTag({ name: 'robots', content: 'noindex' });
    this.managedMetaSelectors.push('name="robots"');
  }

  private markComingSoon(): void {
    this.loading = false;
    this.comingSoon = true;
    // Deliberately HTTP 200 (friendlier to stray backlinks) but noindexed.
    this.titleService.setTitle('Blog Coming Soon | Dream Cleaning');
    this.metaService.updateTag({ name: 'robots', content: 'noindex' });
    this.managedMetaSelectors.push('name="robots"');
  }

  private applySeo(post: BlogPostDetail): void {
    const url = `${BASE_URL}/blog/${post.slug}`;
    const title = post.metaTitle || `${post.title} | Dream Cleaning Blog`;
    const description = post.metaDescription || post.excerpt;
    const image = post.featuredImagePath ? `${BASE_URL}${post.featuredImagePath}` : `${BASE_URL}/web-app-manifest-512x512.png`;

    this.titleService.setTitle(title);
    this.metaService.updateTag({ name: 'description', content: description });

    const ogTags: { property?: string; name?: string; content: string }[] = [
      { property: 'og:type', content: 'article' },
      { property: 'og:title', content: title },
      { property: 'og:description', content: description },
      { property: 'og:url', content: url },
      { property: 'og:image', content: image },
      { property: 'og:site_name', content: 'Dream Cleaning' },
      { name: 'twitter:card', content: 'summary_large_image' },
      { name: 'twitter:title', content: title },
      { name: 'twitter:description', content: description },
      { name: 'twitter:image', content: image }
    ];
    if (post.publishedAt) {
      ogTags.push({ property: 'article:published_time', content: post.publishedAt });
    }
    ogTags.push({ property: 'article:modified_time', content: post.updatedAt });

    for (const tag of ogTags) {
      this.metaService.updateTag(tag as any);
      this.managedMetaSelectors.push(
        tag.property ? `property="${tag.property}"` : `name="${tag.name}"`
      );
    }

    this.injectSchema(post, url, image);
  }

  private injectSchema(post: BlogPostDetail, url: string, image: string): void {
    this.removeSchema();

    const schema = {
      '@context': 'https://schema.org',
      '@type': 'BlogPosting',
      'headline': post.title,
      'description': post.metaDescription || post.excerpt,
      'image': image,
      'url': url,
      'mainEntityOfPage': { '@type': 'WebPage', '@id': url },
      'datePublished': post.publishedAt,
      'dateModified': post.updatedAt,
      'author': {
        '@type': 'Organization',
        'name': 'Dream Cleaning',
        'url': BASE_URL
      },
      'publisher': {
        '@type': 'Organization',
        'name': 'Dream Cleaning',
        '@id': `${BASE_URL}/#business`,
        'logo': {
          '@type': 'ImageObject',
          'url': `${BASE_URL}/web-app-manifest-512x512.png`
        }
      }
    };

    this.schemaElement = this.document.createElement('script');
    this.schemaElement.type = 'application/ld+json';
    this.schemaElement.textContent = JSON.stringify(schema);
    this.document.head.appendChild(this.schemaElement);
  }

  private removeSchema(): void {
    if (this.schemaElement && this.schemaElement.parentNode) {
      this.schemaElement.parentNode.removeChild(this.schemaElement);
      this.schemaElement = null;
    }
  }

  private removeManagedMeta(): void {
    for (const selector of this.managedMetaSelectors) {
      this.metaService.removeTag(selector);
    }
    this.managedMetaSelectors.length = 0;
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
