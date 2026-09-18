import { ComponentFixture, TestBed } from '@angular/core/testing';

import { CommercialCleaningPoliciesComponent } from './commercial-cleaning-policies.component';
import { COMMERCIAL_POLICY_CONTENT } from '../shared/commercial-policies/commercial-policy.content';
import { testProviders } from '../../testing/test-providers';

/**
 * The page renders the published policy in full, and links the two downloads by the filenames the
 * backend serves.
 *
 * The WORDING is not asserted here — it is asserted once, on the backend, against the canonical
 * source this page's content module is generated from (`CommercialPolicyContentTests`). Repeating
 * those assertions in Karma would create a second place to update whenever a policy changes, which
 * is the drift the generated module exists to prevent. What this spec covers is the part only the
 * browser can get wrong: that every section reaches the DOM, that the contents list actually links
 * to the sections it names, and that a `Note` is rendered as a callout rather than flattened into
 * another paragraph.
 */
describe('CommercialCleaningPoliciesComponent', () => {
  let component: CommercialCleaningPoliciesComponent;
  let fixture: ComponentFixture<CommercialCleaningPoliciesComponent>;

  const el = (): HTMLElement => fixture.nativeElement as HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CommercialCleaningPoliciesComponent],
      providers: [...testProviders]
    }).compileComponents();

    fixture = TestBed.createComponent(CommercialCleaningPoliciesComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('renders every section of the published policy', () => {
    const sections = el().querySelectorAll('section.policy-section');

    expect(sections.length).toBe(COMMERCIAL_POLICY_CONTENT.complete.sections.length);
    expect(sections.length).toBe(18);

    COMMERCIAL_POLICY_CONTENT.complete.sections.forEach(section => {
      const rendered = el().querySelector(`#${section.anchor}`);
      expect(rendered)
        .withContext(`section ${section.number} (${section.anchor}) is missing`).not.toBeNull();
      expect(rendered!.textContent).toContain(section.title);
    });
  });

  it('renders every block of every section, so nothing is silently dropped', () => {
    COMMERCIAL_POLICY_CONTENT.complete.sections.forEach(section => {
      const rendered = el().querySelector(`#${section.anchor}`)!;
      section.blocks.forEach(block => {
        // Compared on letters alone: the template is free to wrap, and the DOM collapses
        // whitespace differently from the source string.
        const haystack = letters(rendered.textContent ?? '');
        expect(haystack)
          .withContext(`${section.anchor}: "${block.text.slice(0, 60)}…" is missing`)
          .toContain(letters(block.text));
      });
    });
  });

  // The qualifier a reader must not skim past — "this cap is not an automatic charge", "the signed
  // agreement governs". Flattening it into an ordinary paragraph is the failure to catch: nothing
  // errors, the sentence is still there, and the emphasis the policy depends on is gone.
  it('renders a Note block as a callout, not as an ordinary paragraph', () => {
    const notes = el().querySelectorAll('.policy-note');
    const expected = COMMERCIAL_POLICY_CONTENT.complete.sections
      .flatMap(s => s.blocks)
      .filter(b => b.kind === 'Note').length
      + COMMERCIAL_POLICY_CONTENT.complete.intro.filter(b => b.kind === 'Note').length;

    expect(expected).toBeGreaterThan(0);
    expect(notes.length).toBe(expected);
  });

  // Consecutive bullets are one list. Four `<ul>`s in a row is what a screen reader announces,
  // and it is wrong about the structure of the document.
  it('groups consecutive bullets into a single list', () => {
    const contact = el().querySelector('#contact')!;
    const lists = contact.querySelectorAll('ul.policy-bullets');

    expect(lists.length).toBe(1);
    expect(lists[0].querySelectorAll('li').length).toBe(4);
  });

  it('gives the contents list a working link to every section', () => {
    const links = Array.from(el().querySelectorAll('nav.policy-contents a'));

    expect(links.length).toBe(COMMERCIAL_POLICY_CONTENT.complete.sections.length);

    links.forEach(link => {
      const fragment = (link.getAttribute('href') ?? '').replace(/^.*#/, '');
      expect(fragment).withContext('a contents link with no fragment').not.toBe('');
      expect(el().querySelector(`#${fragment}`))
        .withContext(`contents links to #${fragment}, which is not on the page`).not.toBeNull();
    });
  });

  it('offers two distinguishable downloads pointing at the backend endpoints', () => {
    const cards = el().querySelectorAll('a.download-card');
    expect(cards.length).toBe(2);

    const [complete, cancellation] = Array.from(cards) as HTMLAnchorElement[];

    expect(complete.getAttribute('href')).toBe('/api/commercial-policies/complete.pdf');
    expect(complete.getAttribute('download'))
      .toBe('Dream-Cleaning-NYC-Commercial-Cleaning-Policies.pdf');
    expect(complete.textContent).toContain('Download Complete Commercial Cleaning Policies (PDF)');

    expect(cancellation.getAttribute('href'))
      .toBe('/api/commercial-policies/cancellation-termination.pdf');
    expect(cancellation.getAttribute('download'))
      .toBe('Dream-Cleaning-NYC-Cancellation-Termination-Policy.pdf');
    expect(cancellation.textContent)
      .toContain('Download Cancellation & Termination Policy (PDF)');

    // Two different files. A shared filename would have the second download overwrite the first
    // in the reader's downloads folder.
    expect(complete.getAttribute('download')).not.toBe(cancellation.getAttribute('download'));
  });

  it('shows the version and effective date, which is what a client quotes back at us', () => {
    const header = el().querySelector('.policy-header')!.textContent ?? '';

    expect(header).toContain(`Version ${COMMERCIAL_POLICY_CONTENT.complete.version}`);
    expect(header).toContain('Effective September 16, 2026');
  });

  // Parsed as parts rather than `new Date(iso)`: a bare ISO date is parsed as UTC midnight and
  // then displayed in the viewer's zone, so a reader west of Greenwich would be shown the day
  // before the policy took effect.
  it('formats the effective date without shifting it into the local timezone', () => {
    expect(component.formatEffectiveDate('2026-09-16')).toBe('September 16, 2026');
    expect(component.formatEffectiveDate('2026-01-01')).toBe('January 1, 2026');
  });

  it('leaves an unparseable effective date as written rather than rendering "Invalid Date"', () => {
    expect(component.formatEffectiveDate('soon')).toBe('soon');
    expect(component.formatEffectiveDate('')).toBe('');
  });

  it('uses one h1 and heading levels a screen reader can navigate', () => {
    expect(el().querySelectorAll('h1').length).toBe(1);
    expect(el().querySelector('h1')!.textContent).toContain('Commercial Cleaning Policies');

    // Every section heading is an h2 under that single h1 — no level is skipped.
    expect(el().querySelectorAll('h3').length).toBe(0);
  });

  // The commercial policies must not start answering for residential bookings; they point at the
  // Terms & Conditions instead. The two are deliberately separate documents for two audiences.
  it('points a residential reader at the Terms & Conditions', () => {
    const footer = el().querySelector('.policy-footer')!;
    const link = Array.from(footer.querySelectorAll('a'))
      .find(a => (a.textContent ?? '').includes('Terms'));

    expect(link).withContext('no link to the residential terms').toBeTruthy();
    expect(link!.getAttribute('href')).toBe('/terms-and-conditions');
  });

  function letters(value: string): string {
    return value.replace(/[^a-zA-Z]/g, '').toLowerCase();
  }
});
