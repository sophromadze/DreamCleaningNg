import { TestBed } from '@angular/core/testing';
import { AppComponent } from './app.component';

import { testProviders } from '../testing/test-providers';

describe('AppComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      providers: [...testProviders],
      imports: [AppComponent],
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  // Replaces the old `'DreamCleaningNG'` assertion, which tested the pre-rename
  // scaffold identity rather than anything the app actually does.
  it(`should have the 'DreamCleaning' title`, () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance;
    expect(app.title).toEqual('DreamCleaning');
  });

  // Replaces the old `<h1>Hello, DreamCleaningNG</h1>` check — the real shell
  // template has no such heading. A render smoke test keeps the useful part of
  // that test's intent (the shell renders) without asserting scaffold markup.
  it('should render the app shell without throwing', () => {
    const fixture = TestBed.createComponent(AppComponent);
    expect(() => fixture.detectChanges()).not.toThrow();
  });
});
