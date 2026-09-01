import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';

import { ShiftsComponent } from './shifts.component';
import { testProviders } from '../../../testing/test-providers';
import { AdminBonusService, AdminBonusSummary, AdminBonusRates } from '../../services/admin-bonus.service';

/**
 * The shifts page's staff-bonus panel.
 *
 * Three things it has to get right, all about money:
 *
 *  - a manager earns on TWO slots at DIFFERENT rates (orders they book themselves, and their share
 *    of their team's), and the editor must keep them apart;
 *  - a person's rates are either their OWN or the company's, and the editor must never turn the
 *    second into the first by accident;
 *  - blank means "follow the company default", 0 means "earns nothing". They are different
 *    instructions and the panel is where a SuperAdmin gives them.
 */
describe('ShiftsComponent', () => {
  let component: ShiftsComponent;
  let fixture: ComponentFixture<ShiftsComponent>;
  let bonusService: jasmine.SpyObj<AdminBonusService>;

  const defaults: AdminBonusRates = {
    administratorNewCustomerRate: 10,
    administratorExistingCustomerRate: 10,
    managerOwnBookingNewCustomerRate: 15,
    managerOwnBookingExistingCustomerRate: 25,
    managerTeamNewCustomerRate: 5,
    managerTeamExistingCustomerRate: 15,
    currency: 'GEL',
    updatedAt: '2026-08-01T00:00:00Z'
  };

  /** An administrator on the company defaults, unless the test says otherwise. */
  function row(overrides: Partial<AdminBonusSummary> = {}): AdminBonusSummary {
    return {
      adminId: 1,
      firstName: 'Nino',
      lastName: 'B',
      shiftColor: null,
      position: 'Administrator',
      managerId: null,
      managerName: null,
      teamSize: 0,
      assignedCount: 0,
      eligibleCount: 0,
      ownNewCustomerCount: 0,
      ownExistingCustomerCount: 0,
      teamNewCustomerCount: 0,
      teamExistingCustomerCount: 0,
      ownNewCustomerRate: 10,
      ownExistingCustomerRate: 10,
      ownNewCustomerRateIsCustom: false,
      ownExistingCustomerRateIsCustom: false,
      teamNewCustomerRate: 5,
      teamExistingCustomerRate: 15,
      teamNewCustomerRateIsCustom: false,
      teamExistingCustomerRateIsCustom: false,
      bonusAmount: 0,
      currency: 'GEL',
      ...overrides
    };
  }

  function manager(overrides: Partial<AdminBonusSummary> = {}): AdminBonusSummary {
    return row({
      adminId: 2,
      firstName: 'Nika',
      position: 'Manager',
      teamSize: 1,
      ownNewCustomerRate: 15,
      ownExistingCustomerRate: 25,
      ...overrides
    });
  }

  beforeEach(async () => {
    bonusService = jasmine.createSpyObj<AdminBonusService>(
      'AdminBonusService', ['getBonuses', 'getRates', 'setRates', 'setOverride', 'getForAdmin']);
    bonusService.getBonuses.and.returnValue(of([]));
    bonusService.getRates.and.returnValue(of(defaults));

    await TestBed.configureTestingModule({
      providers: [
        ...testProviders,
        { provide: AdminBonusService, useValue: bonusService }
      ],
      imports: [ShiftsComponent]
    }).compileComponents();

    fixture = TestBed.createComponent(ShiftsComponent);
    component = fixture.componentInstance;
    component.isSuperAdmin = true;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('per-person rate editor', () => {
    it('seeds only the fields the person actually overrides', () => {
      // Pre-filling a defaulted field with the company figure would silently convert "follows the
      // default" into a personal rate the next time anybody pressed Save.
      component.startEditingOverride(row({
        ownNewCustomerRate: 12,
        ownNewCustomerRateIsCustom: true,
        ownExistingCustomerRate: 10,
        ownExistingCustomerRateIsCustom: false
      }));

      expect(component.overrideEdit.ownBookingNewCustomerRate).toBe(12);
      expect(component.overrideEdit.ownBookingExistingCustomerRate).toBeNull();
    });

    it('seeds a manager both slots independently', () => {
      component.startEditingOverride(manager({
        ownNewCustomerRate: 16, ownNewCustomerRateIsCustom: true,
        ownExistingCustomerRate: 25, ownExistingCustomerRateIsCustom: false,
        teamNewCustomerRate: 5, teamNewCustomerRateIsCustom: false,
        teamExistingCustomerRate: 18, teamExistingCustomerRateIsCustom: true
      }));

      expect(component.overrideEdit.ownBookingNewCustomerRate).toBe(16);
      expect(component.overrideEdit.ownBookingExistingCustomerRate).toBeNull();
      expect(component.overrideEdit.teamBookingNewCustomerRate).toBeNull();
      expect(component.overrideEdit.teamBookingExistingCustomerRate).toBe(18);
    });

    it('sends null for a blank field, so it goes back to the company default', () => {
      bonusService.setOverride.and.returnValue(of(row()));

      component.startEditingOverride(row());
      component.overrideEdit.ownBookingNewCustomerRate = 12;
      component.saveOverride(row());

      const [, override] = bonusService.setOverride.calls.mostRecent().args;
      expect(override.ownBookingNewCustomerRate).toBe(12);
      expect(override.ownBookingExistingCustomerRate).toBeNull();
    });

    it('never sends team rates for an administrator', () => {
      // They can never earn on that slot, so a value parked there is a rate nobody chose that a
      // later promotion would start paying.
      bonusService.setOverride.and.returnValue(of(row()));

      component.startEditingOverride(row());
      component.overrideEdit.teamBookingNewCustomerRate = 99;
      component.overrideEdit.teamBookingExistingCustomerRate = 99;
      component.saveOverride(row());

      const [, override] = bonusService.setOverride.calls.mostRecent().args;
      expect(override.teamBookingNewCustomerRate).toBeNull();
      expect(override.teamBookingExistingCustomerRate).toBeNull();
    });

    it('sends both slots for a manager', () => {
      bonusService.setOverride.and.returnValue(of(manager()));

      component.startEditingOverride(manager());
      component.overrideEdit.ownBookingNewCustomerRate = 16;
      component.overrideEdit.teamBookingExistingCustomerRate = 18;
      component.saveOverride(manager());

      const [, override] = bonusService.setOverride.calls.mostRecent().args;
      expect(override.ownBookingNewCustomerRate).toBe(16);
      expect(override.teamBookingExistingCustomerRate).toBe(18);
    });

    it('treats a typed 0 as a real rate, not as a cleared field', () => {
      // "Earns nothing on new customers" and "follows the company rate" are different
      // instructions; collapsing them would quietly pay somebody who was zeroed out.
      bonusService.setOverride.and.returnValue(of(row()));

      component.startEditingOverride(row());
      component.overrideEdit.ownBookingNewCustomerRate = 0;
      component.overrideEdit.ownBookingExistingCustomerRate = 0;
      component.saveOverride(row());

      const [, override] = bonusService.setOverride.calls.mostRecent().args;
      expect(override.ownBookingNewCustomerRate).toBe(0);
      expect(override.ownBookingExistingCustomerRate).toBe(0);
    });

    it('clears every field when asked to use the default again', () => {
      bonusService.setOverride.and.returnValue(of(manager()));

      component.startEditingOverride(manager({
        ownNewCustomerRate: 16, ownNewCustomerRateIsCustom: true,
        teamExistingCustomerRate: 18, teamExistingCustomerRateIsCustom: true
      }));
      component.clearOverride(manager());

      const [, override] = bonusService.setOverride.calls.mostRecent().args;
      expect(override).toEqual({
        ownBookingNewCustomerRate: null,
        ownBookingExistingCustomerRate: null,
        teamBookingNewCustomerRate: null,
        teamBookingExistingCustomerRate: null
      });
    });

    it('replaces just the edited row rather than refetching the month', () => {
      // The response is already computed over the visible window, so a reload would cost a round
      // trip to arrive at numbers we have been handed.
      component.bonuses = [row({ adminId: 1 }), manager({ adminId: 2 })];
      const updated = manager({ adminId: 2, bonusAmount: 45 });
      bonusService.setOverride.and.returnValue(of(updated));
      bonusService.getBonuses.calls.reset();

      component.startEditingOverride(component.bonuses[1]);
      component.saveOverride(component.bonuses[1]);

      expect(component.bonuses[1].bonusAmount).toBe(45);
      expect(component.bonuses[0].adminId).toBe(1);
      expect(bonusService.getBonuses).not.toHaveBeenCalled();
    });

    it('rejects a negative rate before it reaches the server', () => {
      component.startEditingOverride(row());
      component.overrideEdit.ownBookingNewCustomerRate = -5;
      component.saveOverride(row());

      expect(bonusService.setOverride).not.toHaveBeenCalled();
    });

    it('keeps the editor open when the server refuses the change', () => {
      bonusService.setOverride.and.returnValue(
        throwError(() => ({ error: { message: 'nope' } })));

      component.startEditingOverride(row({ adminId: 7 }));
      component.saveOverride(row({ adminId: 7 }));

      expect(component.editingOverrideAdminId).toBe(7);
      expect(component.isSavingOverride).toBeFalse();
    });
  });

  describe('who may see the company pay table', () => {
    /** A fresh instance whose ngOnInit runs with the given viewer role. */
    function bootAs(isSuperAdmin: boolean): ShiftsComponent {
      bonusService.getRates.calls.reset();
      const f = TestBed.createComponent(ShiftsComponent);
      f.componentInstance.isSuperAdmin = isSuperAdmin;
      f.detectChanges();
      return f.componentInstance;
    }

    it('does not even ask for the defaults as a regular admin', () => {
      // The endpoint is SuperAdmin-only, so asking would collect a 403 on every page load — and
      // the defaults are the whole pay table, which is not this person's to see.
      const c = bootAs(false);

      expect(bonusService.getRates).not.toHaveBeenCalled();
      expect(c.bonusRates).toBeNull();
    });

    it('loads them for a SuperAdmin', () => {
      const c = bootAs(true);

      expect(bonusService.getRates).toHaveBeenCalled();
      expect(c.bonusRates).toEqual(defaults);
    });

    it('still shows a regular admin their own rates', () => {
      // Their own row is theirs to know; it arrives on the bonus summary, not on the pay table.
      const mine = manager({ ownNewCustomerRate: 15, ownExistingCustomerRate: 25 });
      bonusService.getBonuses.and.returnValue(of([mine]));

      const c = bootAs(false);

      expect(c.bonuses[0].ownNewCustomerRate).toBe(15);
      expect(c.bonuses[0].teamExistingCustomerRate).toBe(15);
    });
  });

  describe('company default rates', () => {
    it('restates the month on screen after a rate change', () => {
      // Everybody still on a default has just changed value, so the visible figures are stale
      // until they are refetched.
      bonusService.setRates.and.returnValue(of({ ...defaults, administratorNewCustomerRate: 11 }));
      bonusService.getBonuses.calls.reset();

      component.startEditingRates();
      component.rateEdit.administratorNewCustomerRate = 11;
      component.saveRates();

      expect(bonusService.getBonuses).toHaveBeenCalled();
      expect(component.isEditingRates).toBeFalse();
    });

    it('submits all three slots', () => {
      // The manager own-booking pair is its own figure, not the other two added together — if the
      // editor stopped sending it, it would silently freeze at whatever was stored.
      bonusService.setRates.and.returnValue(of(defaults));

      component.startEditingRates();
      component.saveRates();

      const [sent] = bonusService.setRates.calls.mostRecent().args;
      expect(sent.administratorNewCustomerRate).toBe(10);
      expect(sent.managerOwnBookingNewCustomerRate).toBe(15);
      expect(sent.managerOwnBookingExistingCustomerRate).toBe(25);
      expect(sent.managerTeamNewCustomerRate).toBe(5);
    });

    it('rejects a negative default before it reaches the server', () => {
      component.startEditingRates();
      component.rateEdit.managerTeamExistingCustomerRate = -1;
      component.saveRates();

      expect(bonusService.setRates).not.toHaveBeenCalled();
    });
  });

  describe('what a row reports', () => {
    it('shows the own/team split only when the person earned on both slots', () => {
      // On a plain administrator, or a manager who took no bookings themselves, one half is
      // always zero and printing it is noise.
      const both = manager({ ownNewCustomerCount: 2, teamExistingCustomerCount: 3 });
      const administratorOnly = row({ ownNewCustomerCount: 2 });
      const managerOnly = manager({ teamExistingCustomerCount: 3 });

      expect(component.hasBothSides(both)).toBeTrue();
      expect(component.hasBothSides(administratorOnly)).toBeFalse();
      expect(component.hasBothSides(managerOnly)).toBeFalse();
    });

    it('adds both slots together for the new/returning counts', () => {
      const b = manager({
        ownNewCustomerCount: 2, ownExistingCustomerCount: 1,
        teamNewCustomerCount: 4, teamExistingCustomerCount: 3
      });

      expect(component.newCount(b)).toBe(6);
      expect(component.existingCount(b)).toBe(4);
      expect(component.ownCount(b)).toBe(3);
      expect(component.teamCount(b)).toBe(7);
    });

    it('ignores a stale team override when marking somebody as on their own rate', () => {
      // A leftover value on a slot the person cannot earn on is not a rate they are on, and must
      // not light up the "own rate" pill.
      const staleTeamOnly = row({ teamNewCustomerRateIsCustom: true });
      const realOverride = row({ ownNewCustomerRateIsCustom: true });
      const managerWithNoTeam = manager({ teamSize: 0, teamNewCustomerRateIsCustom: true });

      expect(component.hasCustomRate(staleTeamOnly)).toBeFalse();
      expect(component.hasCustomRate(managerWithNoTeam)).toBeFalse();
      expect(component.hasCustomRate(realOverride)).toBeTrue();
      expect(component.hasCustomRate(manager({ teamNewCustomerRateIsCustom: true }))).toBeTrue();
    });

    it('hides the team rate from a manager who has nobody reporting to them', () => {
      // Printing "team 5 / 15" for somebody who cannot earn it reads as money they are owed.
      expect(component.showsTeamRate(manager({ teamSize: 0 }))).toBeFalse();
      expect(component.showsTeamRate(manager({ teamSize: 1 }))).toBeTrue();
      expect(component.showsTeamRate(row())).toBeFalse();
    });

    it('keeps the team rate visible while it is still earning', () => {
      // A manager whose last administrator was just moved away can still have team shares inside
      // the window on screen; hiding the rate would leave part of their total unexplained.
      const lostTheirTeamMidMonth = manager({ teamSize: 0, teamExistingCustomerCount: 3 });

      expect(component.showsTeamRate(lostTheirTeamMidMonth)).toBeTrue();
    });

    it('does not wipe a stored team rate when the inputs are hidden', () => {
      // The seeded value rides through untouched — nulling it would delete a rate that applies
      // again the moment somebody is attached to them.
      const teamless = manager({
        teamSize: 0,
        teamNewCustomerRate: 7, teamNewCustomerRateIsCustom: true,
        teamExistingCustomerRate: 18, teamExistingCustomerRateIsCustom: true
      });
      bonusService.setOverride.and.returnValue(of(teamless));

      component.startEditingOverride(teamless);
      component.saveOverride(teamless);

      const [, override] = bonusService.setOverride.calls.mostRecent().args;
      expect(override.teamBookingNewCustomerRate).toBe(7);
      expect(override.teamBookingExistingCustomerRate).toBe(18);
    });
  });
});
