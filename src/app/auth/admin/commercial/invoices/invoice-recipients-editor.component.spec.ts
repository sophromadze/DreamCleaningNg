import { ComponentFixture, TestBed } from '@angular/core/testing';

import { InvoiceRecipientsEditorComponent, MAX_INVOICE_RECIPIENTS } from './invoice-recipients-editor.component';

/**
 * The one editor every invoice recipient list is edited with — the form, the Recipients dialog
 * and the Send / Reminder dialogs. Addresses are refused with the same sentence the server would
 * answer with (`describeEmailProblem` mirrors `EmailAddressValidator`).
 */
describe('InvoiceRecipientsEditorComponent', () => {
  let fixture: ComponentFixture<InvoiceRecipientsEditorComponent>;
  let editor: InvoiceRecipientsEditorComponent;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [InvoiceRecipientsEditorComponent] });
    fixture = TestBed.createComponent(InvoiceRecipientsEditorComponent);
    editor = fixture.componentInstance;
    editor.recipients.set(['ap@client.invalid']);
    fixture.detectChanges();
  });

  it('lists every recipient with its own remove button, the default included', () => {
    const chips = fixture.nativeElement.querySelectorAll('.recipient-chip');
    expect(chips.length).toBe(1);

    (chips[0].querySelector('.chip-remove') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(editor.recipients()).toEqual([]);
    expect(fixture.nativeElement.textContent).toContain('Add at least one email address');
  });

  it('adds any number of valid addresses', () => {
    editor.onInput('cfo@client.invalid');
    editor.add();
    editor.onInput('  owner@client.invalid ');
    editor.add();

    expect(editor.recipients()).toEqual(['ap@client.invalid', 'cfo@client.invalid', 'owner@client.invalid']);
    expect(editor.newRecipient()).toBe('');
  });

  it('names the mistake in an invalid address and keeps what was typed', () => {
    editor.onInput('ap.client.invalid');
    editor.add();
    fixture.detectChanges();

    expect(editor.recipients()).toEqual(['ap@client.invalid']);
    expect(editor.error()).toContain('@');
    expect(editor.newRecipient()).toBe('ap.client.invalid');
    const input = fixture.nativeElement.querySelector('input') as HTMLInputElement;
    expect(input.getAttribute('aria-invalid')).toBe('true');

    // Typing again clears the complaint.
    editor.onInput('ap@client.invalid2');
    expect(editor.error()).toBe('');
  });

  it('refuses a duplicate, whatever its case', () => {
    editor.onInput('AP@Client.invalid');
    editor.add();

    expect(editor.recipients()).toEqual(['ap@client.invalid']);
    expect(editor.error()).toContain('already on the list');
  });

  it('stops at the server\'s maximum', () => {
    editor.recipients.set(Array.from({ length: MAX_INVOICE_RECIPIENTS }, (_, i) => `p${i}@client.invalid`));
    editor.onInput('one-more@client.invalid');
    editor.add();

    expect(editor.recipients().length).toBe(MAX_INVOICE_RECIPIENTS);
    expect(editor.error()).toContain(`${MAX_INVOICE_RECIPIENTS}`);
  });
});
