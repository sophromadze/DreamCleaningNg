import { Component, OnInit, ChangeDetectionStrategy, inject, signal } from '@angular/core';
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
  imports: [FormsModule],
  templateUrl: './before-after-photos.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './before-after-photos.component.scss'
})
export class BeforeAfterPhotosComponent implements OnInit {
  private service = inject(BeforeAfterPhotoService);

  readonly photos = signal<BeforeAfterPhotoDto[]>([], { equal: () => false });
  readonly isLoading = signal(false);
  readonly errorMessage = signal('');
  readonly successMessage = signal('');

  readonly showCreateForm = signal(false);
  readonly isSubmitting = signal(false);
  readonly createForm = signal<CreateForm>(this.emptyCreateForm(), { equal: () => false });

  readonly editing = signal<EditState | null>(null);

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
    this.isLoading.set(true);
    this.service.listAdmin().subscribe({
      next: (rows) => {
        this.photos.set(rows ?? []);
        this.isLoading.set(false);
      },
      error: (err) => {
        this.errorMessage.set(err?.error?.message || 'Failed to load before/after photos.');
        this.isLoading.set(false);
      }
    });
  }

  // ---------- Create flow ----------
  openCreate() {
    this.createForm.set(this.emptyCreateForm());
    this.showCreateForm.set(true);
    this.errorMessage.set('');
  }

  cancelCreate() {
    this.showCreateForm.set(false);
    this.createForm.set(this.emptyCreateForm());
  }

  onBeforeFileChange(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files && input.files[0] ? input.files[0] : null;
    this.createForm().beforeFile = file;
    this.createForm.set(this.createForm());
    this.createForm().beforePreview = file ? URL.createObjectURL(file) : null;
    this.createForm.set(this.createForm());
  }

  onAfterFileChange(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files && input.files[0] ? input.files[0] : null;
    this.createForm().afterFile = file;
    this.createForm.set(this.createForm());
    this.createForm().afterPreview = file ? URL.createObjectURL(file) : null;
    this.createForm.set(this.createForm());
  }

  submitCreate() {
    this.errorMessage.set('');
    this.successMessage.set('');

    if (!this.createForm().title.trim()) {
      this.errorMessage.set('Title is required.');
      return;
    }
    if (!this.createForm().beforeFile || !this.createForm().afterFile) {
      this.errorMessage.set('Both before and after photos are required.');
      return;
    }

    this.isSubmitting.set(true);
    const payload: CreateBeforeAfterPhotoDto = {
      title: this.createForm().title.trim(),
      subtitle: this.createForm().subtitle.trim() || null,
      linkUrl: this.createForm().linkUrl.trim() || null,
      displayOrder: this.createForm().displayOrder ?? 0
    };

    this.service.create(payload, this.createForm().beforeFile!, this.createForm().afterFile!).subscribe({
      next: (created) => {
        this.photos.set([created, ...this.photos()].sort((a, b) =>
          a.displayOrder - b.displayOrder || (b.id - a.id)
        ));
        this.successMessage.set('Photo pair added.');
        this.cancelCreate();
        this.isSubmitting.set(false);
      },
      error: (err) => {
        this.errorMessage.set(err?.error?.message || 'Upload failed.');
        this.isSubmitting.set(false);
      }
    });
  }

  // ---------- Edit flow ----------
  startEdit(p: BeforeAfterPhotoDto) {
    this.editing.set({
      id: p.id,
      title: p.title,
      subtitle: p.subtitle ?? '',
      linkUrl: p.linkUrl ?? '',
      displayOrder: p.displayOrder,
      isActive: p.isActive
    });
  }

  cancelEdit() {
    this.editing.set(null);
  }

  saveEdit() {
    const e = this.editing();
    if (!e) return;
    if (!e.title.trim()) {
      this.errorMessage.set('Title cannot be empty.');
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
        const idx = this.photos().findIndex(p => p.id === updated.id);
        if (idx >= 0) { this.photos()[idx] = updated; this.photos.set(this.photos()); }
        this.editing.set(null);
        this.successMessage.set('Saved.');
      },
      error: (err) => {
        this.errorMessage.set(err?.error?.message || 'Update failed.');
      }
    });
  }

  toggleActive(p: BeforeAfterPhotoDto) {
    this.service.update(p.id, { isActive: !p.isActive }).subscribe({
      next: (updated) => {
        const idx = this.photos().findIndex(x => x.id === updated.id);
        if (idx >= 0) { this.photos()[idx] = updated; this.photos.set(this.photos()); }
      },
      error: (err) => {
        this.errorMessage.set(err?.error?.message || 'Toggle failed.');
      }
    });
  }

  replaceImage(p: BeforeAfterPhotoDto, side: 'before' | 'after', event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files && input.files[0] ? input.files[0] : null;
    if (!file) return;
    this.service.replaceImage(p.id, side, file).subscribe({
      next: (updated) => {
        const idx = this.photos().findIndex(x => x.id === updated.id);
        if (idx >= 0) { this.photos()[idx] = updated; this.photos.set(this.photos()); }
        this.successMessage.set(`Replaced ${side} photo.`);
        input.value = '';
      },
      error: (err) => {
        this.errorMessage.set(err?.error?.message || 'Replace failed.');
        input.value = '';
      }
    });
  }

  delete(p: BeforeAfterPhotoDto) {
    if (!confirm(`Delete "${p.title}"? Both photos will be removed.`)) return;
    this.service.delete(p.id).subscribe({
      next: () => {
        this.photos.set(this.photos().filter(x => x.id !== p.id));
        this.successMessage.set('Deleted.');
      },
      error: (err) => {
        this.errorMessage.set(err?.error?.message || 'Delete failed.');
      }
    });
  }

  trackById(_i: number, p: BeforeAfterPhotoDto) {
    return p.id;
  }
}
