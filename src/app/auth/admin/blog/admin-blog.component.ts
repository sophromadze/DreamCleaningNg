import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { Subject, Subscription, debounceTime } from 'rxjs';
import { marked } from 'marked';
import { AuthService } from '../../../services/auth.service';
import {
  BlogService,
  BlogPostAdmin,
  BlogPostAdminListItem,
  BlogPostStatus,
  BlogTopic,
  BlogTopicStatus,
  BlogSettings,
  SaveBlogPost,
  SuggestedTopic
} from '../../../services/blog.service';

type AdminBlogTab = 'posts' | 'editor' | 'topics' | 'settings' | 'guide';
type GuideLang = 'ka' | 'en';

interface SuggestionRow extends SuggestedTopic {
  selected: boolean;
}

/**
 * Admin Blog section: Posts / Editor / Topic Queue / Settings / How It Works.
 * The editor works on Markdown; the live preview renders client-side with `marked`
 * (admin-only convenience) while the published output is always the server-side
 * sanitized HTML — the pipelines are close enough for editing purposes.
 */
@Component({
  selector: 'app-admin-blog',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './admin-blog.component.html',
  styleUrl: './admin-blog.component.scss'
})
export class AdminBlogComponent implements OnInit, OnDestroy {
  readonly BlogPostStatus = BlogPostStatus;
  readonly BlogTopicStatus = BlogTopicStatus;
  readonly categories = ['Guides', 'NYC Living', 'Checklists', 'Seasonal'];

  activeTab: AdminBlogTab = 'posts';

  // ── Posts ──
  posts: BlogPostAdminListItem[] = [];
  postsLoading = false;
  statusFilter: number | null = null;
  actionBusyId: number | null = null;

  // ── Editor ──
  editingPost: BlogPostAdmin | null = null; // null = list mode; id 0 = new post
  editorForm: SaveBlogPost = this.emptyForm();
  editorSlugLocked = false;
  editorSlugManuallyEdited = false;
  editorBusy = false;
  editorError = '';
  previewHtml: SafeHtml | null = null;
  uploadBusy = false;
  private previewInput$ = new Subject<string>();

  // ── Topics ──
  topics: BlogTopic[] = [];
  topicsLoading = false;
  topicForm = { topicTitle: '', targetKeyword: '', notes: '' };
  editingTopicId: number | null = null;
  generateBusyTopicId: number | null = null;
  suggestBusy = false;
  suggestions: SuggestionRow[] = [];
  suggestionsVisible = false;
  addSuggestionsBusy = false;

  // ── Settings ──
  settings: BlogSettings | null = null;
  settingsLoading = false;
  settingsSaving = false;

  // ── Guide ── (client-side only; Georgian default for Nodar)
  guideLang: GuideLang = 'ka';

  private subscription = new Subscription();

  constructor(
    private blogService: BlogService,
    private sanitizer: DomSanitizer,
    private authService: AuthService
  ) {}

  /** Settings tab and Delete actions are SuperAdmin-only (mirrored server-side —
   *  the endpoints 403 other roles; this just keeps the UI honest). */
  get isSuperAdmin(): boolean {
    return this.authService.currentUserValue?.role === 'SuperAdmin';
  }

  /** Moderators are view-only: they browse posts/topics and open the editor read-only,
   *  but every write/generate action (which would 403 server-side) is hidden. */
  get canManage(): boolean {
    const role = this.authService.currentUserValue?.role;
    return role === 'SuperAdmin' || role === 'Admin';
  }

  ngOnInit(): void {
    this.loadPosts();
    this.subscription.add(
      this.previewInput$.pipe(debounceTime(250)).subscribe(md => this.renderPreview(md))
    );
  }

  ngOnDestroy(): void {
    this.subscription.unsubscribe();
  }

  setTab(tab: AdminBlogTab): void {
    if (tab === 'settings' && !this.isSuperAdmin) return;
    this.activeTab = tab;
    if (tab === 'posts') this.loadPosts();
    if (tab === 'topics') this.loadTopics();
    if (tab === 'settings') this.loadSettings();
  }

  // ─────────────────────────────────────────────
  //  Posts
  // ─────────────────────────────────────────────

  loadPosts(): void {
    this.postsLoading = true;
    this.blogService.adminGetPosts(this.statusFilter ?? undefined).subscribe({
      next: (posts) => {
        this.posts = posts;
        this.postsLoading = false;
      },
      error: () => { this.postsLoading = false; }
    });
  }

  setStatusFilter(status: number | null): void {
    this.statusFilter = status;
    this.loadPosts();
  }

  statusLabel(status: number): string {
    switch (status) {
      case BlogPostStatus.Draft: return 'Draft';
      case BlogPostStatus.PendingReview: return 'Pending Review';
      case BlogPostStatus.Published: return 'Published';
      case BlogPostStatus.Archived: return 'Archived';
      default: return '—';
    }
  }

  statusClass(status: number): string {
    switch (status) {
      case BlogPostStatus.Draft: return 'status-draft';
      case BlogPostStatus.PendingReview: return 'status-pending';
      case BlogPostStatus.Published: return 'status-published';
      case BlogPostStatus.Archived: return 'status-archived';
      default: return '';
    }
  }

  publishFromList(post: BlogPostAdminListItem): void {
    if (!confirm(`Publish "${post.title}"? It will appear on the website immediately.`)) return;
    this.actionBusyId = post.id;
    this.blogService.adminPublishPost(post.id).subscribe({
      next: () => { this.actionBusyId = null; this.loadPosts(); },
      error: (err) => {
        this.actionBusyId = null;
        alert(err?.error?.message || 'Failed to publish.');
      }
    });
  }

  unpublishFromList(post: BlogPostAdminListItem): void {
    if (!confirm(`Unpublish "${post.title}"? It will be removed from the website (Google may keep the old link for a while).`)) return;
    this.actionBusyId = post.id;
    this.blogService.adminUnpublishPost(post.id).subscribe({
      next: () => { this.actionBusyId = null; this.loadPosts(); },
      error: () => { this.actionBusyId = null; alert('Failed to unpublish.'); }
    });
  }

  deletePost(post: BlogPostAdminListItem): void {
    const warning = post.status === BlogPostStatus.Published
      ? `Delete PUBLISHED article "${post.title}"?\n\nGoogle has likely indexed this page — deleting it creates a broken link. Are you sure?`
      : `Delete "${post.title}"? This cannot be undone.`;
    if (!confirm(warning)) return;

    this.actionBusyId = post.id;
    this.blogService.adminDeletePost(post.id).subscribe({
      next: () => { this.actionBusyId = null; this.loadPosts(); },
      error: () => { this.actionBusyId = null; alert('Failed to delete.'); }
    });
  }

  // ─────────────────────────────────────────────
  //  Editor
  // ─────────────────────────────────────────────

  newPost(): void {
    this.editingPost = {
      id: 0, title: '', slug: '', excerpt: '', contentMarkdown: '', contentHtml: '',
      status: BlogPostStatus.Draft, category: 'Guides', authorName: 'Dream Cleaning Team',
      isAiGenerated: false, createdAt: '', updatedAt: '', viewCount: 0
    };
    this.editorForm = this.emptyForm();
    this.editorSlugLocked = false;
    this.editorSlugManuallyEdited = false;
    this.editorError = '';
    this.previewHtml = null;
    this.activeTab = 'editor';
  }

  openEditor(id: number): void {
    this.editorBusy = true;
    this.activeTab = 'editor';
    this.blogService.adminGetPost(id).subscribe({
      next: (post) => {
        this.editingPost = post;
        this.editorForm = {
          title: post.title,
          slug: post.slug,
          excerpt: post.excerpt,
          contentMarkdown: post.contentMarkdown,
          metaTitle: post.metaTitle || '',
          metaDescription: post.metaDescription || '',
          featuredImagePath: post.featuredImagePath || '',
          featuredImageAlt: post.featuredImageAlt || '',
          category: post.category,
          tags: post.tags || '',
          authorName: post.authorName
        };
        this.editorSlugLocked = post.status === BlogPostStatus.Published;
        // Keep auto-syncing only while the slug still looks auto-generated;
        // a slug that diverges from the title was chosen deliberately.
        this.editorSlugManuallyEdited = !!post.slug && post.slug !== this.slugify(post.title);
        this.editorError = '';
        this.editorBusy = false;
        this.renderPreview(post.contentMarkdown);
      },
      error: () => {
        this.editorBusy = false;
        this.activeTab = 'posts';
        alert('Failed to load the post.');
      }
    });
  }

  closeEditor(): void {
    this.editingPost = null;
    this.previewHtml = null;
    this.activeTab = 'posts';
    this.loadPosts();
  }

  onMarkdownChanged(value: string): void {
    this.previewInput$.next(value);
  }

  onTitleChanged(value: string): void {
    if (this.editorSlugLocked || this.editorSlugManuallyEdited) return;
    this.editorForm.slug = this.slugify(value);
  }

  onSlugEdited(value: string): void {
    // Clearing the field hands control back to auto-generation.
    if (!value.trim()) {
      this.editorSlugManuallyEdited = false;
      this.editorForm.slug = this.slugify(this.editorForm.title);
    } else {
      this.editorSlugManuallyEdited = true;
    }
  }

  /** Mirrors BlogContentService.Slugify on the backend (which still has the
   *  final word on save — uniqueness suffixes are applied server-side). */
  private slugify(title: string): string {
    if (!title || !title.trim()) return '';
    const slug = title
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '-')
      .replace(/-{2,}/g, '-')
      .replace(/^-+|-+$/g, '');
    return slug.length > 200 ? slug.slice(0, 200).replace(/-+$/, '') : slug;
  }

  private renderPreview(md: string): void {
    const html = marked.parse(md || '', { async: false }) as string;
    this.previewHtml = this.sanitizer.bypassSecurityTrustHtml(html);
  }

  get metaTitleLength(): number { return (this.editorForm.metaTitle || '').length; }
  get metaDescriptionLength(): number { return (this.editorForm.metaDescription || '').length; }
  get excerptLength(): number { return (this.editorForm.excerpt || '').length; }

  uploadFeaturedImage(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    this.uploadBusy = true;
    this.blogService.adminUploadImage(file).subscribe({
      next: (res) => {
        this.editorForm.featuredImagePath = res.url;
        this.uploadBusy = false;
      },
      error: (err) => {
        this.uploadBusy = false;
        alert(err?.error?.message || 'Image upload failed.');
      }
    });
    input.value = '';
  }

  savePost(publishAfter: boolean): void {
    if (!this.editingPost) return;
    if (!this.editorForm.title.trim()) { this.editorError = 'Title is required.'; return; }
    if (!this.editorForm.contentMarkdown.trim()) { this.editorError = 'Article content is required.'; return; }
    if (publishAfter && !confirm('Publish this article? It will appear on the website immediately.')) return;

    this.editorBusy = true;
    this.editorError = '';

    const save$ = this.editingPost.id === 0
      ? this.blogService.adminCreatePost(this.editorForm)
      : this.blogService.adminUpdatePost(this.editingPost.id, this.editorForm);

    save$.subscribe({
      next: (saved) => {
        this.editingPost = saved;
        this.editorForm.slug = saved.slug;
        // Server may have adjusted the slug (uniqueness suffix); re-derive
        // whether it still tracks the title so auto-sync doesn't clobber it.
        this.editorSlugManuallyEdited = !!saved.slug && saved.slug !== this.slugify(saved.title);

        if (publishAfter && saved.status !== BlogPostStatus.Published) {
          this.blogService.adminPublishPost(saved.id).subscribe({
            next: (published) => {
              this.editingPost = published;
              this.editorSlugLocked = true;
              this.editorBusy = false;
            },
            error: (err) => {
              this.editorBusy = false;
              this.editorError = err?.error?.message || 'Saved, but publishing failed.';
            }
          });
        } else {
          this.editorBusy = false;
        }
      },
      error: (err) => {
        this.editorBusy = false;
        this.editorError = err?.error?.message || 'Failed to save the post.';
      }
    });
  }

  unpublishFromEditor(): void {
    if (!this.editingPost || this.editingPost.id === 0) return;
    if (!confirm('Unpublish this article? It will be removed from the website.')) return;
    this.editorBusy = true;
    this.blogService.adminUnpublishPost(this.editingPost.id).subscribe({
      next: (post) => {
        this.editingPost = post;
        this.editorSlugLocked = false;
        this.editorBusy = false;
      },
      error: () => { this.editorBusy = false; alert('Failed to unpublish.'); }
    });
  }

  // ─────────────────────────────────────────────
  //  Topics
  // ─────────────────────────────────────────────

  loadTopics(): void {
    this.topicsLoading = true;
    this.blogService.adminGetTopics().subscribe({
      next: (topics) => { this.topics = topics; this.topicsLoading = false; },
      error: () => { this.topicsLoading = false; }
    });
  }

  get queuedTopics(): BlogTopic[] {
    return this.topics.filter(t => t.status === BlogTopicStatus.Queued);
  }

  get generatedTopics(): BlogTopic[] {
    return this.topics.filter(t => t.status !== BlogTopicStatus.Queued);
  }

  saveTopic(): void {
    const title = this.topicForm.topicTitle.trim();
    if (!title) return;

    const dto = {
      topicTitle: title,
      targetKeyword: this.topicForm.targetKeyword.trim() || undefined,
      notes: this.topicForm.notes.trim() || undefined
    };

    const save$ = this.editingTopicId
      ? this.blogService.adminUpdateTopic(this.editingTopicId, dto)
      : this.blogService.adminCreateTopic(dto);

    save$.subscribe({
      next: () => {
        this.topicForm = { topicTitle: '', targetKeyword: '', notes: '' };
        this.editingTopicId = null;
        this.loadTopics();
      },
      error: () => alert('Failed to save the topic.')
    });
  }

  editTopic(topic: BlogTopic): void {
    this.editingTopicId = topic.id;
    this.topicForm = {
      topicTitle: topic.topicTitle,
      targetKeyword: topic.targetKeyword || '',
      notes: topic.notes || ''
    };
  }

  cancelTopicEdit(): void {
    this.editingTopicId = null;
    this.topicForm = { topicTitle: '', targetKeyword: '', notes: '' };
  }

  deleteTopic(topic: BlogTopic): void {
    if (!confirm(`Delete topic "${topic.topicTitle}"?`)) return;
    this.blogService.adminDeleteTopic(topic.id).subscribe({
      next: () => this.loadTopics(),
      error: () => alert('Failed to delete the topic.')
    });
  }

  moveTopic(topic: BlogTopic, direction: -1 | 1): void {
    const queued = this.queuedTopics;
    const index = queued.findIndex(t => t.id === topic.id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= queued.length) return;

    const reordered = [...queued];
    [reordered[index], reordered[target]] = [reordered[target], reordered[index]];

    this.blogService.adminReorderTopics(reordered.map(t => t.id)).subscribe({
      next: () => this.loadTopics(),
      error: () => alert('Failed to reorder.')
    });
  }

  generateNow(topic: BlogTopic): void {
    if (!confirm(`Generate an article draft for "${topic.topicTitle}" now?\n\nThis takes up to a minute.`)) return;
    this.generateBusyTopicId = topic.id;
    this.blogService.adminGenerate({ topicId: topic.id }).subscribe({
      next: (post) => {
        this.generateBusyTopicId = null;
        this.loadTopics();
        this.openEditor(post.id);
      },
      error: (err) => {
        this.generateBusyTopicId = null;
        alert(err?.error?.message || 'Generation failed. Try again.');
      }
    });
  }

  suggestTopics(): void {
    this.suggestBusy = true;
    this.suggestionsVisible = true;
    this.suggestions = [];
    this.blogService.adminSuggestTopics().subscribe({
      next: (list) => {
        this.suggestions = list.map(s => ({ ...s, selected: false }));
        this.suggestBusy = false;
      },
      error: (err) => {
        this.suggestBusy = false;
        this.suggestionsVisible = false;
        alert(err?.error?.message || 'Failed to get suggestions. Try again.');
      }
    });
  }

  get selectedSuggestionsCount(): number {
    return this.suggestions.filter(s => s.selected).length;
  }

  addSelectedSuggestions(): void {
    const selected = this.suggestions.filter(s => s.selected);
    if (selected.length === 0) return;

    this.addSuggestionsBusy = true;
    this.blogService.adminAddTopics(
      selected.map(s => ({ topicTitle: s.topicTitle, targetKeyword: s.targetKeyword }))
    ).subscribe({
      next: () => {
        this.addSuggestionsBusy = false;
        this.suggestionsVisible = false;
        this.suggestions = [];
        this.loadTopics();
      },
      error: () => {
        this.addSuggestionsBusy = false;
        alert('Failed to add topics.');
      }
    });
  }

  // ─────────────────────────────────────────────
  //  Settings
  // ─────────────────────────────────────────────

  loadSettings(): void {
    this.settingsLoading = true;
    this.blogService.adminGetSettings().subscribe({
      next: (settings) => { this.settings = settings; this.settingsLoading = false; },
      error: () => { this.settingsLoading = false; }
    });
  }

  toggleAutoGenerate(): void {
    if (!this.settings) return;
    this.persistSettings({ autoGenerateEnabled: !this.settings.autoGenerateEnabled });
  }

  togglePublicVisible(): void {
    if (!this.settings) return;
    const turningOn = !this.settings.publicVisible;
    const message = turningOn
      ? 'Make the blog VISIBLE to everyone? The /blog page, header link, and sitemap go live immediately.'
      : 'Hide the blog from the public? Visitors will see a "coming soon" page. Publishing in the admin keeps working.';
    if (!confirm(message)) return;
    this.persistSettings({ publicVisible: turningOn });
  }

  onModelChange(modelId: string): void {
    if (!this.settings) return;
    this.persistSettings({ generationModel: modelId });
  }

  /** Sends the full settings payload with one field changed; reverts UI on failure. */
  private persistSettings(change: Partial<{ autoGenerateEnabled: boolean; publicVisible: boolean; generationModel: string }>): void {
    if (!this.settings) return;
    const previous = { ...this.settings };
    const payload = {
      autoGenerateEnabled: change.autoGenerateEnabled ?? this.settings.autoGenerateEnabled,
      publicVisible: change.publicVisible ?? this.settings.publicVisible,
      generationModel: change.generationModel ?? this.settings.generationModel
    };

    // Optimistic UI; revert on failure.
    Object.assign(this.settings, payload);
    this.settingsSaving = true;

    this.blogService.adminUpdateSettings(payload).subscribe({
      next: () => { this.settingsSaving = false; },
      error: (err) => {
        Object.assign(this.settings!, previous);
        this.settingsSaving = false;
        alert(err?.error?.message || 'Failed to update the setting.');
      }
    });
  }

  // ─────────────────────────────────────────────
  //  Shared
  // ─────────────────────────────────────────────

  formatDate(iso?: string): string {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('en-US', {
      timeZone: 'America/New_York',
      year: 'numeric', month: 'short', day: 'numeric'
    });
  }

  formatDateTime(iso?: string): string {
    if (!iso) return '—';
    return new Date(iso).toLocaleString('en-US', {
      timeZone: 'America/New_York',
      year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
    });
  }

  private emptyForm(): SaveBlogPost {
    return {
      title: '', slug: '', excerpt: '', contentMarkdown: '',
      metaTitle: '', metaDescription: '', featuredImagePath: '', featuredImageAlt: '',
      category: 'Guides', tags: '', authorName: 'Dream Cleaning Team'
    };
  }
}
