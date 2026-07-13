import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

// ===== Public =====

export interface BlogPostListItem {
  title: string;
  slug: string;
  excerpt: string;
  featuredImagePath?: string;
  featuredImageAlt?: string;
  category: string;
  publishedAt?: string;
}

export interface BlogPostListResponse {
  posts: BlogPostListItem[];
  totalCount: number;
  page: number;
  pageSize: number;
  categories: string[];
  /** False while the owner keeps the blog hidden — render "coming soon". */
  publicVisible: boolean;
}

export interface BlogStatus {
  publicVisible: boolean;
}

export interface BlogPostDetail {
  title: string;
  slug: string;
  excerpt: string;
  contentHtml: string;
  metaTitle?: string;
  metaDescription?: string;
  featuredImagePath?: string;
  featuredImageAlt?: string;
  category: string;
  tags: string[];
  authorName: string;
  publishedAt?: string;
  updatedAt: string;
  relatedPosts: BlogPostListItem[];
}

// ===== Admin =====

export enum BlogPostStatus {
  Draft = 0,
  PendingReview = 1,
  Published = 2,
  Archived = 3
}

export interface BlogPostAdminListItem {
  id: number;
  title: string;
  slug: string;
  status: BlogPostStatus;
  category: string;
  isAiGenerated: boolean;
  createdAt: string;
  publishedAt?: string;
  viewCount: number;
}

export interface BlogPostAdmin {
  id: number;
  title: string;
  slug: string;
  excerpt: string;
  contentMarkdown: string;
  contentHtml: string;
  metaTitle?: string;
  metaDescription?: string;
  featuredImagePath?: string;
  featuredImageAlt?: string;
  status: BlogPostStatus;
  category: string;
  tags?: string;
  authorName: string;
  isAiGenerated: boolean;
  createdAt: string;
  publishedAt?: string;
  updatedAt: string;
  viewCount: number;
}

export interface SaveBlogPost {
  title: string;
  slug?: string;
  excerpt: string;
  contentMarkdown: string;
  metaTitle?: string;
  metaDescription?: string;
  featuredImagePath?: string;
  featuredImageAlt?: string;
  category: string;
  tags?: string;
  authorName: string;
}

export enum BlogTopicStatus {
  Queued = 0,
  Generated = 1,
  Skipped = 2
}

export interface BlogTopic {
  id: number;
  topicTitle: string;
  targetKeyword?: string;
  notes?: string;
  status: BlogTopicStatus;
  priority: number;
  createdAt: string;
  generatedAt?: string;
  generatedBlogPostId?: number;
}

export interface SaveBlogTopic {
  topicTitle: string;
  targetKeyword?: string;
  notes?: string;
}

export interface SuggestedTopic {
  topicTitle: string;
  targetKeyword: string;
}

export interface BlogModelOption {
  id: string;
  label: string;
}

export interface BlogSettings {
  autoGenerateEnabled: boolean;
  publicVisible: boolean;
  generationIntervalDays: number;
  generationHourUtc: number;
  generationModel: string;
  modelOptions: BlogModelOption[];
  lastRunAt?: string;
  lastRunResult?: string;
  queuedTopicsCount: number;
}

export interface UpdateBlogSettings {
  autoGenerateEnabled: boolean;
  publicVisible: boolean;
  generationModel?: string;
}

@Injectable({
  providedIn: 'root'
})
export class BlogService {
  private apiUrl = environment.apiUrl;

  constructor(private http: HttpClient) {}

  // ===== Public =====

  /** Raw status call — components should go through BlogStatusService (shareReplay). */
  getStatus(): Observable<BlogStatus> {
    return this.http.get<BlogStatus>(`${this.apiUrl}/blog/status`);
  }

  getPosts(page = 1, pageSize = 9, category?: string): Observable<BlogPostListResponse> {
    let url = `${this.apiUrl}/blog/posts?page=${page}&pageSize=${pageSize}`;
    if (category) url += `&category=${encodeURIComponent(category)}`;
    return this.http.get<BlogPostListResponse>(url);
  }

  getPost(slug: string): Observable<BlogPostDetail> {
    return this.http.get<BlogPostDetail>(`${this.apiUrl}/blog/posts/${encodeURIComponent(slug)}`);
  }

  // ===== Admin: posts =====

  adminGetPosts(status?: BlogPostStatus): Observable<BlogPostAdminListItem[]> {
    const query = status !== undefined ? `?status=${status}` : '';
    return this.http.get<BlogPostAdminListItem[]>(`${this.apiUrl}/admin/blog/posts${query}`);
  }

  adminGetPendingCount(): Observable<{ count: number }> {
    return this.http.get<{ count: number }>(`${this.apiUrl}/admin/blog/pending-count`);
  }

  adminGetPost(id: number): Observable<BlogPostAdmin> {
    return this.http.get<BlogPostAdmin>(`${this.apiUrl}/admin/blog/posts/${id}`);
  }

  adminCreatePost(dto: SaveBlogPost): Observable<BlogPostAdmin> {
    return this.http.post<BlogPostAdmin>(`${this.apiUrl}/admin/blog/posts`, dto);
  }

  adminUpdatePost(id: number, dto: SaveBlogPost): Observable<BlogPostAdmin> {
    return this.http.put<BlogPostAdmin>(`${this.apiUrl}/admin/blog/posts/${id}`, dto);
  }

  adminDeletePost(id: number): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/admin/blog/posts/${id}`);
  }

  adminPublishPost(id: number): Observable<BlogPostAdmin> {
    return this.http.post<BlogPostAdmin>(`${this.apiUrl}/admin/blog/posts/${id}/publish`, {});
  }

  adminUnpublishPost(id: number): Observable<BlogPostAdmin> {
    return this.http.post<BlogPostAdmin>(`${this.apiUrl}/admin/blog/posts/${id}/unpublish`, {});
  }

  adminPreview(contentMarkdown: string): Observable<{ contentHtml: string }> {
    return this.http.post<{ contentHtml: string }>(`${this.apiUrl}/admin/blog/preview`, { contentMarkdown });
  }

  adminUploadImage(file: File): Observable<{ url: string }> {
    const formData = new FormData();
    formData.append('file', file);
    return this.http.post<{ url: string }>(`${this.apiUrl}/admin/blog/upload-image`, formData);
  }

  // ===== Admin: topics =====

  adminGetTopics(): Observable<BlogTopic[]> {
    return this.http.get<BlogTopic[]>(`${this.apiUrl}/admin/blog/topics`);
  }

  adminCreateTopic(dto: SaveBlogTopic): Observable<BlogTopic> {
    return this.http.post<BlogTopic>(`${this.apiUrl}/admin/blog/topics`, dto);
  }

  adminAddTopics(topics: SaveBlogTopic[]): Observable<BlogTopic[]> {
    return this.http.post<BlogTopic[]>(`${this.apiUrl}/admin/blog/topics/bulk`, { topics });
  }

  adminUpdateTopic(id: number, dto: SaveBlogTopic): Observable<BlogTopic> {
    return this.http.put<BlogTopic>(`${this.apiUrl}/admin/blog/topics/${id}`, dto);
  }

  adminDeleteTopic(id: number): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/admin/blog/topics/${id}`);
  }

  adminReorderTopics(topicIds: number[]): Observable<void> {
    return this.http.post<void>(`${this.apiUrl}/admin/blog/topics/reorder`, { topicIds });
  }

  adminGenerate(request: { topicId?: number; freeformTopic?: string; targetKeyword?: string; notes?: string }): Observable<BlogPostAdmin> {
    return this.http.post<BlogPostAdmin>(`${this.apiUrl}/admin/blog/generate`, request);
  }

  adminSuggestTopics(): Observable<SuggestedTopic[]> {
    return this.http.post<SuggestedTopic[]>(`${this.apiUrl}/admin/blog/topics/suggest`, {});
  }

  // ===== Admin: settings =====

  adminGetSettings(): Observable<BlogSettings> {
    return this.http.get<BlogSettings>(`${this.apiUrl}/admin/blog/settings`);
  }

  adminUpdateSettings(settings: UpdateBlogSettings): Observable<void> {
    return this.http.put<void>(`${this.apiUrl}/admin/blog/settings`, settings);
  }
}
