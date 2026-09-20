import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SaveCardModalComponent } from './save-card-modal.component';

/**
 * The modal asked BETWEEN the Pay click and the charge. It owns no payment logic: it answers one
 * question exactly once, and closing it must start nothing.
 */
describe('SaveCardModalComponent', () => {
  let fixture: ComponentFixture<SaveCardModalComponent>;
  let component: SaveCardModalComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [SaveCardModalComponent] }).compileComponents();
    fixture = TestBed.createComponent(SaveCardModalComponent);
    component = fixture.componentInstance;
    component.open = true;
    component.amountLabel = '$141.54';
    fixture.detectChanges();
  });

  function dialog(): HTMLElement {
    return fixture.nativeElement.querySelector('[role=dialog]');
  }

  it('says that BOTH choices pay — never an ambiguous "Save Card"', () => {
    const labels = Array.from(dialog().querySelectorAll('.scm-btn')).map(b => (b.textContent ?? '').trim());
    expect(labels).toEqual(['Save Card & Pay', 'Pay Without Saving']);
    expect(dialog().textContent).toContain('does');
    expect(dialog().textContent).toContain('not');
    expect(dialog().textContent).toContain('enable automatic payments');
  });

  it('emits the choice, and only once however many times the button is clicked', () => {
    const choices: boolean[] = [];
    component.choose.subscribe(v => choices.push(v));

    const save = dialog().querySelector('.scm-btn--primary') as HTMLButtonElement;
    save.click(); save.click(); save.click();

    expect(choices).toEqual([true]);
  });

  it('emits false for "Pay Without Saving"', () => {
    const choices: boolean[] = [];
    component.choose.subscribe(v => choices.push(v));
    (dialog().querySelector('.scm-btn--ghost') as HTMLButtonElement).click();
    expect(choices).toEqual([false]);
  });

  it('closing with ✕, Escape or the backdrop dismisses and never chooses', () => {
    let chosen = 0;
    let dismissed = 0;
    component.choose.subscribe(() => chosen++);
    component.dismissed.subscribe(() => dismissed++);

    (fixture.nativeElement.querySelector('.scm-close') as HTMLButtonElement).click();
    dialog().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    (fixture.nativeElement.querySelector('.scm-backdrop') as HTMLElement).click();

    expect(chosen).toBe(0);
    expect(dismissed).toBe(3);
  });

  it('locks both buttons while the host is paying, so one answer is one payment', () => {
    component.busy = true;
    fixture.detectChanges();

    let chosen = 0;
    let dismissed = 0;
    component.choose.subscribe(() => chosen++);
    component.dismissed.subscribe(() => dismissed++);

    component.decide(true);
    component.dismiss();

    expect(chosen).toBe(0);
    expect(dismissed).toBe(0);   // closing mid-charge must not abandon a payment in flight
    const buttons = Array.from(dialog().querySelectorAll('button')) as HTMLButtonElement[];
    expect(buttons.every(b => b.disabled)).toBeTrue();
  });

  it('asks again after being re-opened for a new attempt', () => {
    const choices: boolean[] = [];
    component.choose.subscribe(v => choices.push(v));

    component.decide(true);
    component.open = false;
    fixture.detectChanges();
    component.open = true;
    fixture.detectChanges();
    component.decide(false);

    expect(choices).toEqual([true, false]);
  });

  it('moves focus to the primary action when it opens', () => {
    expect(document.activeElement).toBe(dialog().querySelector('.scm-btn--primary'));
  });
});
