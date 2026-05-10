import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  BeforeAfterPhotoService,
  BeforeAfterPhotoDto,
  CreateBeforeAfterPhotoDto,
  UpdateBeforeAfterPhotoDto
} from '../../../services/before-after-photo.service';

interface CreateForm {
  title: string;
  subtitle: string;
  linkUrl: string;
  displayOrder: number | null;
  beforeFile: File | null;
  afterFile: File | null;
  beforePreview: string | null;
  afterPreview: string | null;
}

interface EditState {
  id: number;
  title: string;
  subtitle: string;
  linkUrl: string;
  displayOrder: number;
  isActive: boolean;
}

@Component({
  selector: 'app-before-after-photos',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './before-after-photos.component.html',
  styleUrl: './before-after-photos.component.scss'
})
export class BeforeAfterPhotosComponent implements OnInit {
  photos: BeforeAfterPhotoDto[] = [];
  isLoading = false;
  errorMessage = '';
  successMessage = '';

  showCreateForm = false;
  isSubmitting = false;
  createForm: CreateForm = this.emptyCreateForm();

  editing: EditState | null = null;

  constructor(private service: BeforeAfterPhotoService) {}

  ngOnInit() {
    this.load();
  }

  private emptyCreateForm(): CreateForm {
    return {
      title: '',
      subtitle: '',
      linkUrl: '',
      displayOrder: null,
      beforeFile: null,
      afterFile: null,
      beforePreview: null,
      afterPreview: null
    };
  }

  load() {
    this.isLoading = true;
    this.service.listAdmin().subscribe({
      next: (rows) => {
        this.photos = rows ?? [];
        this.isLoading = false;
      },
      error: (err) => {
        this.errorMessage = err?.error?.message || 'Failed to load before/after photos.';
        this.isLoading = false;
      }
    });
  }

  // ---------- Create flow ----------
  openCreate() {
    this.createForm = this.emptyCreateForm();
    this.showCreateForm = true;
    this.errorMessage = '';
  }

  cancelCreate() {
    this.showCreateForm = false;
    this.createForm = this.emptyCreateForm();
  }

  onBeforeFileChange(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files && input.files[0] ? input.files[0] : null;
    this.createForm.beforeFile = file;
    this.createForm.beforePreview = file ? URL.createObjectURL(file) : null;
  }

  onAfterFileChange(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files && input.files[0] ? input.files[0] : null;
    this.createForm.afterFile = file;
    this.createForm.afterPreview = file ? URL.createObjectURL(file) : null;
  }

  submitCreate() {
    this.errorMessage = '';
    this.successMessage = '';

    if (!this.createForm.title.trim()) {
      this.errorMessage = 'Title is required.';
      return;
    }
    if (!this.createForm.beforeFile || !this.createForm.afterFile) {
      this.errorMessage = 'Both before and after photos are required.';
      return;
    }

    this.isSubmitting = true;
    const payload: CreateBeforeAfterPhotoDto = {
      title: this.createForm.title.trim(),
      subtitle: this.createForm.subtitle.trim() || null,
      linkUrl: this.createForm.linkUrl.trim() || null,
      displayOrder: this.createForm.displayOrder ?? 0
    };

    this.service.create(payload, this.createForm.beforeFile, this.createForm.afterFile).subscribe({
      next: (created) => {
        this.photos = [created, ...this.photos].sort((a, b) =>
          a.displayOrder - b.displayOrder || (b.id - a.id)
        );
        this.successMessage = 'Photo pair added.';
        this.cancelCreate();
        this.isSubmitting = false;
      },
      error: (err) => {
        this.errorMessage = err?.error?.message || 'Upload failed.';
        this.isSubmitting = false;
      }
    });
  }

  // ---------- Edit flow ----------
  startEdit(p: BeforeAfterPhotoDto) {
    this.editing = {
      id: p.id,
      title: p.title,
      subtitle: p.subtitle ?? '',
      linkUrl: p.linkUrl ?? '',
      displayOrder: p.displayOrder,
      isActive: p.isActive
    };
  }

  cancelEdit() {
    this.editing = null;
  }

  saveEdit() {
    if (!this.editing) return;
    const e = this.editing;
    if (!e.title.trim()) {
      this.errorMessage = 'Title cannot be empty.';
      return;
    }
    const body: UpdateBeforeAfterPhotoDto = {
      title: e.title.trim(),
      subtitle: e.subtitle.trim() || null,
      linkUrl: e.linkUrl.trim() || null,
      displayOrder: e.displayOrder,
      isActive: e.isActive
    };
    this.service.update(e.id, body).subscribe({
      next: (updated) => {
        const idx = this.photos.findIndex(p => p.id === updated.id);
        if (idx >= 0) this.photos[idx] = updated;
        this.editing = null;
        this.successMessage = 'Saved.';
      },
      error: (err) => {
        this.errorMessage = err?.error?.message || 'Update failed.';
      }
    });
  }

  toggleActive(p: BeforeAfterPhotoDto) {
    this.service.update(p.id, { isActive: !p.isActive }).subscribe({
      next: (updated) => {
        const idx = this.photos.findIndex(x => x.id === updated.id);
        if (idx >= 0) this.photos[idx] = updated;
      },
      error: (err) => {
        this.errorMessage = err?.error?.message || 'Toggle failed.';
      }
    });
  }

  replaceImage(p: BeforeAfterPhotoDto, side: 'before' | 'after', event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files && input.files[0] ? input.files[0] : null;
    if (!file) return;
    this.service.replaceImage(p.id, side, file).subscribe({
      next: (updated) => {
        const idx = this.photos.findIndex(x => x.id === updated.id);
        if (idx >= 0) this.photos[idx] = updated;
        this.successMessage = `Replaced ${side} photo.`;
        input.value = '';
      },
      error: (err) => {
        this.errorMessage = err?.error?.message || 'Replace failed.';
        input.value = '';
      }
    });
  }

  delete(p: BeforeAfterPhotoDto) {
    if (!confirm(`Delete "${p.title}"? Both photos will be removed.`)) return;
    this.service.delete(p.id).subscribe({
      next: () => {
        this.photos = this.photos.filter(x => x.id !== p.id);
        this.successMessage = 'Deleted.';
      },
      error: (err) => {
        this.errorMessage = err?.error?.message || 'Delete failed.';
      }
    });
  }

  trackById(_i: number, p: BeforeAfterPhotoDto) {
    return p.id;
  }
}
