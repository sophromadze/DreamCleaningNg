import { ChangeDetectorRef, DestroyRef, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AbstractControl } from '@angular/forms';

/**
 * Reactive forms are not signals. A patchValue / reset / setErrors / markAllAsTouched made outside a
 * template event - an HTTP callback filling a saved address, a Places selection, a timer - changes what
 * the template shows (validation messages, disabled buttons, the booking summary) without Angular being
 * told. zone.js used to refresh the page after any such callback; an OnPush view does not.
 *
 * Create one per component in a field initializer and hand it every form the template reads, right after
 * the form is built:
 *
 *   private readonly watchForm = formViewRefresher();
 *   constructor() { this.form = this.fb.group(...); this.watchForm(this.form); }
 *
 * Every event the form emits (value, status, touched, pristine, reset, submit) marks the view for check.
 */
export function formViewRefresher(): (...controls: AbstractControl[]) => void {
  const cdr = inject(ChangeDetectorRef);
  const destroyRef = inject(DestroyRef);
  return (...controls: AbstractControl[]) => {
    for (const control of controls) {
      control.events.pipe(takeUntilDestroyed(destroyRef)).subscribe(() => cdr.markForCheck());
    }
  };
}
