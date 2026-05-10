import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { AuthService } from './auth.service';

export interface BeforeAfterPhotoDto {
  id: number;
  title: string;
  subtitle?: string | null;
  beforePhotoUrl: string;
  afterPhotoUrl: string;
  linkUrl?: string | null;
  displayOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt?: string | null;
}

export interface CreateBeforeAfterPhotoDto {
  title: string;
  subtitle?: string | null;
  linkUrl?: string | null;
  displayOrder?: number;
}

export interface UpdateBeforeAfterPhotoDto {
  title?: string;
  subtitle?: string | null;
  linkUrl?: string | null;
  displayOrder?: number;
  isActive?: boolean;
}

@Injectable({ providedIn: 'root' })
export class BeforeAfterPhotoService {
  private apiUrl = environment.apiUrl;

  constructor(private http: HttpClient, private authService: AuthService) {}

  private authHeaders(): HttpHeaders {
    const token = this.authService.getToken();
    const headers: Record<string, string> = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;
    return new HttpHeaders(headers);
  }

  /** Public: list of active before/after pairs for the homepage. */
  getPublic(): Observable<BeforeAfterPhotoDto[]> {
    return this.http.get<BeforeAfterPhotoDto[]>(`${this.apiUrl}/before-after-photos`);
  }

  /** Admin: list everything (active + inactive). */
  listAdmin(): Observable<BeforeAfterPhotoDto[]> {
    return this.http.get<BeforeAfterPhotoDto[]>(
      `${this.apiUrl}/admin/before-after-photos`,
      { headers: this.authHeaders() }
    );
  }

  /** Admin: create a new pair. Two file inputs (before, after) plus metadata. */
  create(payload: CreateBeforeAfterPhotoDto, beforeFile: File, afterFile: File): Observable<BeforeAfterPhotoDto> {
    const fd = new FormData();
    fd.append('beforeFile', beforeFile);
    fd.append('afterFile', afterFile);
    fd.append('title', payload.title);
    if (payload.subtitle) fd.append('subtitle', payload.subtitle);
    if (payload.linkUrl) fd.append('linkUrl', payload.linkUrl);
    if (payload.displayOrder !== undefined && payload.displayOrder !== null) {
      fd.append('displayOrder', String(payload.displayOrder));
    }
    return this.http.post<BeforeAfterPhotoDto>(
      `${this.apiUrl}/admin/before-after-photos`,
      fd,
      { headers: this.authHeaders() }
    );
  }

  /** Admin: update text / order / active flag. */
  update(id: number, payload: UpdateBeforeAfterPhotoDto): Observable<BeforeAfterPhotoDto> {
    return this.http.patch<BeforeAfterPhotoDto>(
      `${this.apiUrl}/admin/before-after-photos/${id}`,
      payload,
      { headers: this.authHeaders() }
    );
  }

  /** Admin: replace either the before or after image for an existing pair. */
  replaceImage(id: number, side: 'before' | 'after', file: File): Observable<BeforeAfterPhotoDto> {
    const fd = new FormData();
    fd.append('file', file);
    return this.http.post<BeforeAfterPhotoDto>(
      `${this.apiUrl}/admin/before-after-photos/${id}/replace-${side}`,
      fd,
      { headers: this.authHeaders() }
    );
  }

  /** Admin: delete a pair (also removes the two image files from disk). */
  delete(id: number): Observable<void> {
    return this.http.delete<void>(
      `${this.apiUrl}/admin/before-after-photos/${id}`,
      { headers: this.authHeaders() }
    );
  }
}
