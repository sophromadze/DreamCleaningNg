import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FormControl, FormGroup, Validators } from '@angular/forms';

import { formViewRefresher } from './form-view-refresher';

@Component({
  selector: 'app-form-refresher-host',
  template: `<span class="state">{{ form.valid ? 'valid' : 'invalid' }} {{ form.value.name }}</span>`,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class HostComponent {
  readonly form = new FormGroup({ name: new FormControl('', Validators.required) });
  private readonly watchForm = formViewRefresher();
  constructor() { this.watchForm(this.form); }
}

describe('formViewRefresher', () => {
  it('re-renders an OnPush view when a form is changed outside a template event', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    // attached to the app's scheduler, as a real page is: only a notification re-renders it
    fixture.autoDetectChanges();
    await fixture.whenStable();
    const text = () => (fixture.nativeElement.querySelector('.state') as HTMLElement).textContent!.trim();
    expect(text()).toBe('invalid');

    // what an HTTP callback filling a saved value does
    fixture.componentInstance.form.patchValue({ name: 'Ada' });
    await fixture.whenStable();

    expect(text()).toBe('valid Ada');
  });

  it('stops listening once the component is destroyed', () => {
    const fixture = TestBed.createComponent(HostComponent);
    const form = fixture.componentInstance.form;
    fixture.destroy();
    expect(() => form.patchValue({ name: 'late' })).not.toThrow();
  });
});
