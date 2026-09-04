import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { of, throwError } from 'rxjs';

import { CleanerPortalComponent } from './cleaner-portal.component';
import { CleanerPortalService } from '../services/cleaner-portal.service';
import { testProviders } from '../../testing/test-providers';

/**
 * THE CLEANER PORTAL.
 *
 * The behaviours pinned here are the ones that would be wrong in a way nobody notices:
 *
 *  - The MODE comes from the server, not from the JWT. The cleaner link lives in the database and
 *    an admin can create or remove it at any moment, so a token minted before that is stale about
 *    the only thing this page needs to know.
 *  - An unlinked cleaner account must not render as "you have no work". Those two states look
 *    identical from an empty list and only one of them is something the person can act on.
 *  - Opening an order detail is SuperAdmin-only, enforced in the component as well as on the
 *    endpoint - the cleaner view must not be one stray click away from an order's pricing.
 *  - Dates are NY wall-clock and must not be shifted by the viewer's timezone.
 *  - A COMPLETED job appears in the month but opens into nothing. The briefing is for work ahead;
 *    telling somebody what to bring to a cleaning they finished last week is noise.
 *  - The LANGUAGE comes from the server, for the same reason the mode does, and a cleaner's own
 *    choice overrides their nationality rather than sitting beside it.
 */
describe('CleanerPortalComponent', () => {
  let component: CleanerPortalComponent;
  let fixture: ComponentFixture<CleanerPortalComponent>;
  let portal: jasmine.SpyObj<CleanerPortalService>;

  const job = (over: Partial<any> = {}) => ({
    orderId: 91,
    serviceDate: '2026-09-10T00:00:00',
    serviceTime: '14:30',
    serviceTypeName: 'Deep Cleaning',
    services: [{ name: 'Bedrooms', quantity: 3, serviceKey: 'bedrooms' }],
    extraServices: ['Oven Cleaning'],
    customerName: 'Dana',
    address: '12 Fake St, Brooklyn, NY, 11201',
    bringCleaningSupplies: true,
    serviceDurationMinutes: 390,
    propertyType: 'House',
    levelsQuantity: 2,
    floorTypes: ['Hardwood'],
    customerInstructions: 'Ring the bell twice.',
    cleanerInstructions: 'Park on the side street.',
    isCompleted: false,
    ...over
  });

  beforeEach(async () => {
    portal = jasmine.createSpyObj('CleanerPortalService',
      ['getContext', 'getMyJobs', 'getAllJobs', 'getOrderDetail', 'setLanguage']);
    portal.getContext.and.returnValue(of({
      isCleanerView: true, isSystemWideView: false, cleanerId: 7, cleanerName: 'Maria K',
      language: 'en', preferredLanguage: null
    }));
    portal.getMyJobs.and.returnValue(of({
      current: [job()],
      past: [job({ orderId: 4, serviceDate: '2026-08-01T00:00:00', isCompleted: true })]
    }));
    portal.setLanguage.and.returnValue(of({ language: 'ka', preferredLanguage: 'ka' }));
    portal.getAllJobs.and.returnValue(of([]));
    portal.getOrderDetail.and.returnValue(of({ cleanerView: job(), order: {} as any, assignedCleaners: [] }));

    await TestBed.configureTestingModule({
      imports: [CleanerPortalComponent],
      providers: [...testProviders, { provide: CleanerPortalService, useValue: portal }]
    }).compileComponents();

    fixture = TestBed.createComponent(CleanerPortalComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    fixture.detectChanges();
    expect(component).toBeTruthy();
  });

  /**
   * The greeting is the one place in the app addressed to the person reading it, so it uses their
   * FIRST name: "Hello, Nika!" is a greeting, "Hello, Nika Sophromadze!" is a letter from an
   * institution. `cleanerName` itself stays the full name — the record's name, wanted in full
   * everywhere else.
   */
  describe('the greeting', () => {
    it('uses the first name only', () => {
      fixture.detectChanges();
      expect(component.greetingName).toBe('Maria');
    });

    it('copes with one name, extra spacing and no name at all', () => {
      fixture.detectChanges();

      component.context = { ...component.context!, cleanerName: 'Nino' };
      expect(component.greetingName).toBe('Nino');

      component.context = { ...component.context!, cleanerName: '  Nika   Sophromadze  ' };
      expect(component.greetingName).toBe('Nika');

      // Nothing to greet by: the template drops the comma rather than rendering "Hello, !".
      component.context = { ...component.context!, cleanerName: null as any };
      expect(component.greetingName).toBe('');
    });
  });

  /**
   * Rendered inside the Cleaners page's Portal tab. `embedded` drops this component's own page
   * padding and title because the host provides both — it must never decide WHICH view is shown,
   * which stays the server's answer.
   */
  describe('embedded in the Cleaners page', () => {
    it('is off by default, and changes nothing about the view when on', () => {
      expect(component.embedded).toBeFalse();

      component.embedded = true;
      portal.getContext.and.returnValue(of({
        isCleanerView: false, isSystemWideView: true, cleanerId: null,
        cleanerName: null, language: 'en', preferredLanguage: null
      } as any));
      fixture.detectChanges();

      expect(component.context?.isSystemWideView).toBeTrue();
      expect(portal.getAllJobs).toHaveBeenCalled();
    });
  });

  describe('which view to render', () => {
    it('asks the SERVER which mode it is in, and loads only that mode', () => {
      fixture.detectChanges();

      expect(portal.getContext).toHaveBeenCalled();
      expect(portal.getMyJobs).toHaveBeenCalled();
      // A cleaner must never hit the system-wide endpoint - it would 403, and asking at all is
      // the wrong question.
      expect(portal.getAllJobs).not.toHaveBeenCalled();
    });

    it('loads every cleaning for a SuperAdmin, and never the single-cleaner endpoint', () => {
      portal.getContext.and.returnValue(of({ isCleanerView: false, isSystemWideView: true, cleanerId: null }));
      fixture.detectChanges();

      expect(portal.getAllJobs).toHaveBeenCalled();
      expect(portal.getMyJobs).not.toHaveBeenCalled();
    });
  });

  describe('a cleaner account nobody has linked yet', () => {
    it('reports no cleanerId rather than an empty job list', () => {
      portal.getContext.and.returnValue(of({ isCleanerView: true, isSystemWideView: false, cleanerId: null }));
      portal.getMyJobs.and.returnValue(of({ current: [], past: [] }));
      fixture.detectChanges();

      // The template keys the "ask the office to link your account" notice off this. An empty
      // list alone would read as "you have no work", which is a different and unactionable claim.
      expect(component.context?.cleanerId).toBeNull();
      expect(component.currentJobs.length).toBe(0);
    });
  });

  describe('the month calendar', () => {
    it('files a job under its NY service date, so the dot lands on the day it is worked', () => {
      portal.getMyJobs.and.returnValue(of({
        current: [job({ orderId: 1, serviceTime: '14:30' }), job({ orderId: 2, serviceTime: '09:00' })],
        past: []
      }));
      fixture.detectChanges();

      component.selectDay('2026-09-10');

      expect(component.selectedDayJobs.length).toBe(2);
      // Same-day jobs read in the order they are worked, not the order the API sent them.
      expect(component.selectedDayJobs[0].orderId).toBe(2);
      // ...and the day carries a dot, which is what makes the month itself answer "when am I
      // working" before anything is clicked.
      const cell = component.calendarCells.find(c => c.key === '2026-09-10');
      expect(cell?.jobCount).toBe(2);
    });

    it('opens the first job of the day it is pointed at', () => {
      fixture.detectChanges();

      component.selectDay('2026-09-10');
      expect(component.selectedJob?.orderId).toBe(91);

      // A day with no work clears the side card rather than leaving the previous day job on screen.
      component.selectDay('2026-09-11');
      expect(component.selectedJob).toBeNull();
      expect(component.selectedDayJobs.length).toBe(0);
    });

    it('moves the month when a trailing square from the next month is clicked', () => {
      fixture.detectChanges();

      component.selectDay('2026-11-03');

      expect(component.calendarMonthLabel).toBe('November 2026');
      expect(component.calendarCells.some(c => c.key === '2026-11-03' && c.inMonth)).toBeTrue();
    });
  });

  describe('completed jobs', () => {
    it('puts finished work in the calendar beside the work still ahead', () => {
      fixture.detectChanges();

      // Both lists feed ONE index, so the month reads as a whole rather than as a grid that goes
      // blank the moment a cleaner looks back at last week.
      const august = component.calendarCells.find(c => c.key === '2026-08-01');
      component.selectDay('2026-08-01');
      expect(component.selectedDayJobs.length).toBe(1);
      expect(august === undefined || august.jobCount === 1).toBeTrue();
    });

    it('marks the dot done rather than active, and never opens a briefing for it', () => {
      fixture.detectChanges();

      component.selectDay('2026-08-01');
      const done = component.selectedDayJobs[0];
      expect(done.isCompleted).toBeTrue();

      // Nothing to open: the side card stays on whatever it was, and is null on a day of only
      // finished work.
      expect(component.selectedJob).toBeNull();
      component.selectJob(done);
      expect(component.selectedJob).toBeNull();

      const cells = component.calendarCells;
      const augustCell = cells.find(c => c.key === '2026-08-01');
      if (augustCell) expect(augustCell.dots).toEqual(['done']);
    });

    it('opens a briefing for work still ahead', () => {
      fixture.detectChanges();

      component.selectDay('2026-09-10');
      expect(component.selectedJob?.orderId).toBe(91);

      const cell = component.calendarCells.find(c => c.key === '2026-09-10');
      expect(cell?.dots).toEqual(['active']);
    });
  });

  describe('the language a cleaner reads in', () => {
    it('takes the language from the SERVER, not from the browser', () => {
      portal.getContext.and.returnValue(of({
        isCleanerView: true, isSystemWideView: false, cleanerId: 7, cleanerName: 'Nino',
        language: 'ka', preferredLanguage: null
      }));
      fixture.detectChanges();

      expect(component.language).toBe('ka');
      // Following their nationality, so the picker reads "Automatic" rather than naming Georgian -
      // otherwise saving once would pin them to it.
      expect(component.languageChoice).toBe('');
      expect(component.t.today).toBe('დღეს');
    });

    it('applies a chosen language immediately and persists it', () => {
      fixture.detectChanges();
      expect(component.language).toBe('en');

      component.onLanguageChange('ka');

      expect(portal.setLanguage).toHaveBeenCalledWith('ka');
      expect(component.language).toBe('ka');
      expect(component.languageChoice).toBe('ka');
    });

    it('clears back to Automatic with a null, never with the current default', () => {
      portal.setLanguage.and.returnValue(of({ language: 'ru', preferredLanguage: null }));
      fixture.detectChanges();

      component.onLanguageChange('');

      // Re-sending whatever the default resolves to today would pin them to it forever.
      expect(portal.setLanguage).toHaveBeenCalledWith(null);
      expect(component.languageChoice).toBe('');
      expect(component.language).toBe('ru');
    });

    it('counts and names things in the chosen language', () => {
      portal.getContext.and.returnValue(of({
        isCleanerView: true, isSystemWideView: false, cleanerId: 7, language: 'ru', preferredLanguage: 'ru'
      }));
      fixture.detectChanges();

      // Russian needs three plural forms; an English two-form rule prints the wrong one on most
      // numbers, which is exactly the kind of thing that marks a page as not written for you.
      expect(component.formatServiceLine({ name: 'Bedrooms', quantity: 1, serviceKey: 'bedrooms' })).toBe('1 спальня');
      expect(component.formatServiceLine({ name: 'Bedrooms', quantity: 2, serviceKey: 'bedrooms' })).toBe('2 спальни');
      expect(component.formatServiceLine({ name: 'Bedrooms', quantity: 5, serviceKey: 'bedrooms' })).toBe('5 спален');
    });
  });

  describe('the SuperAdmin detail panel', () => {
    it('never opens for a cleaner, even if something calls it', () => {
      fixture.detectChanges();          // cleaner context

      component.openDetail(91);

      expect(portal.getOrderDetail).not.toHaveBeenCalled();
      expect(component.selectedDetail).toBeNull();
    });

    it('opens for a SuperAdmin', () => {
      portal.getContext.and.returnValue(of({ isCleanerView: false, isSystemWideView: true, cleanerId: null }));
      fixture.detectChanges();

      component.openDetail(91);

      expect(portal.getOrderDetail).toHaveBeenCalledWith(91);
      expect(component.selectedDetail).toBeTruthy();
    });
  });

  describe('display helpers', () => {
    it('renders a NY service date on its own day, whatever timezone the viewer is in', () => {
      // Parsed from the date PARTS, never handed to Date() whole - that would apply the viewer's
      // offset and slide a job to the previous day for anybody west of New York.
      expect(component.formatDate('2026-09-10T00:00:00')).toContain('Sep 10, 2026');
      expect(component.formatDate(null)).toBe('');
    });

    it('names a service line as a counted noun, and a studio as a studio', () => {
      fixture.detectChanges();

      // "Bedrooms x 2" is our storage shape leaking onto a page somebody reads at a front door.
      expect(component.formatServiceLine({ name: 'Bedrooms', quantity: 1, serviceKey: 'bedrooms' })).toBe('1 Bedroom');
      expect(component.formatServiceLine({ name: 'Bedrooms', quantity: 2, serviceKey: 'bedrooms' })).toBe('2 Bedrooms');
      // Zero bedrooms is not "0 Bedrooms" - it is what everybody calls a studio.
      expect(component.formatServiceLine({ name: 'Bedrooms', quantity: 0, serviceKey: 'bedrooms' })).toBe('Studio');
      expect(component.formatServiceLine({ name: 'Bathrooms', quantity: 1, serviceKey: 'bathrooms' })).toBe('1 Bathroom');

      // An unknown key keeps the stored name rather than being hidden.
      expect(component.formatServiceLine({ name: 'Balcony', quantity: 2, serviceKey: 'balcony' })).toBe('Balcony x 2');
    });

    it('flags a job staffed with fewer people than it was priced for', () => {
      expect(component.isUnderstaffed({ ...job(), maidsCount: 3, assignedCleaners: ['A', 'B'], status: 'Active', isPaid: true })).toBe(true);
      expect(component.isUnderstaffed({ ...job(), maidsCount: 2, assignedCleaners: ['A', 'B'], status: 'Active', isPaid: true })).toBe(false);
      // Over-assigned is not under-staffed.
      expect(component.isUnderstaffed({ ...job(), maidsCount: 1, assignedCleaners: ['A', 'B'], status: 'Active', isPaid: true })).toBe(false);
    });
  });

  describe('failures', () => {
    it('says something went wrong instead of leaving a blank page', () => {
      portal.getContext.and.returnValue(throwError(() => ({ status: 500 })));
      fixture.detectChanges();

      expect(component.errorMessage).toBeTruthy();
      expect(component.loading).toBeFalse();
    });
  });

  describe('the SuperAdmin calendar and search', () => {
    const asSuperAdmin = () => {
      portal.getContext.and.returnValue(of({ isCleanerView: false, isSystemWideView: true, cleanerId: null }));
      fixture.detectChanges();
    };

    it('loads ONE MONTH at a time, not every cleaning ever booked', () => {
      asSuperAdmin();

      const [from, to, search] = portal.getAllJobs.calls.mostRecent().args;
      // The calendar is the navigation, so the fetch follows the visible month. An unbounded
      // fetch here would return the whole history of the company to draw one grid.
      expect(from).toMatch(/^\d{4}-\d{2}-01$/);
      expect(to).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(search).toBeNull();
      expect(component.showSchedule).toBeTrue();
    });

    it('refetches when the month moves', () => {
      asSuperAdmin();
      portal.getAllJobs.calls.reset();

      component.nextMonth();

      expect(portal.getAllJobs.calls.count()).toBe(1);
    });

    it('searches ACROSS ALL TIME, not within the visible month', fakeAsync(() => {
      asSuperAdmin();
      portal.getAllJobs.calls.reset();

      component.onSearchChanged('br');
      component.onSearchChanged('bro');
      component.onSearchChanged('brook');
      tick(300);

      // Debounced to one request...
      expect(portal.getAllJobs.calls.count()).toBe(1);
      // ...and unbounded: somebody looking a customer up does not know which month to stand in.
      expect(portal.getAllJobs).toHaveBeenCalledWith(null, null, 'brook');
      // The calendar steps aside for the results rather than describing a set it is not showing.
      expect(component.isSearchMode).toBeTrue();
      expect(component.showSchedule).toBeFalse();
    }));

    it('puts the month back when the search is cleared', () => {
      asSuperAdmin();
      component.onSearchChanged('brook');
      portal.getAllJobs.calls.reset();

      component.clearSearch();

      expect(component.isSearchMode).toBeFalse();
      expect(component.showSchedule).toBeTrue();
      expect(portal.getAllJobs.calls.mostRecent().args[2]).toBeNull();
    });

    it('opens the full read-only detail when a cleaning is clicked', () => {
      asSuperAdmin();

      component.selectAdminJob({ ...job(), status: 'Active', assignedCleaners: ['A'], maidsCount: 1, isPaid: true });

      expect(portal.getOrderDetail).toHaveBeenCalledWith(91);
      expect(component.selectedAdminJob?.orderId).toBe(91);
    });

    it('does NOT throw the detail panel open when a month simply finishes loading', () => {
      portal.getAllJobs.and.returnValue(of([
        { ...job(), status: 'Active', assignedCleaners: ['A'], maidsCount: 1, isPaid: true }
      ]));
      asSuperAdmin();

      // The job is selected so the side card has something to show, but nothing was clicked.
      expect(portal.getOrderDetail).not.toHaveBeenCalled();
      expect(component.selectedDetail).toBeNull();
    });
  });
});
