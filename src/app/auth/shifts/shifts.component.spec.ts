import type { MockedObject } from 'vitest';
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
  let bonusService: MockedObject<AdminBonusService>;

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
      fixedBonusAmount: 0,
      percentBonusAmount: 0,
      percentBonusUsd: 0,
      percentBonusOrderCount: 0,
      percentRules: [],
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
    bonusService = { getBonuses: vi.fn().mockName('AdminBonusService.getBonuses'), getRates: vi.fn().mockName('AdminBonusService.getRates'), setRates: vi.fn().mockName('AdminBonusService.setRates'), setOverride: vi.fn().mockName('AdminBonusService.setOverride'), getForAdmin: vi.fn().mockName('AdminBonusService.getForAdmin'), addPercentRule: vi.fn().mockName('AdminBonusService.addPercentRule'), deletePercentRule: vi.fn().mockName('AdminBonusService.deletePercentRule') } as unknown as MockedObject<AdminBonusService>;
    bonusService.getBonuses.mockReturnValue(of([]));
    bonusService.getRates.mockReturnValue(of(defaults));

    await TestBed.configureTestingModule({
      providers: [
        ...testProviders,
        { provide: AdminBonusService, useValue: bonusService }
      ],
      imports: [ShiftsComponent]
    }).compileComponents();

    fixture = TestBed.createComponent(ShiftsComponent);
    component = fixture.componentInstance;
    component.isSuperAdmin.set(true);
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

      expect(component.overrideEdit().ownBookingNewCustomerRate).toBe(12);
      expect(component.overrideEdit().ownBookingExistingCustomerRate).toBeNull();
    });

    it('seeds a manager both slots independently', () => {
      component.startEditingOverride(manager({
        ownNewCustomerRate: 16, ownNewCustomerRateIsCustom: true,
        ownExistingCustomerRate: 25, ownExistingCustomerRateIsCustom: false,
        teamNewCustomerRate: 5, teamNewCustomerRateIsCustom: false,
        teamExistingCustomerRate: 18, teamExistingCustomerRateIsCustom: true
      }));

      expect(component.overrideEdit().ownBookingNewCustomerRate).toBe(16);
      expect(component.overrideEdit().ownBookingExistingCustomerRate).toBeNull();
      expect(component.overrideEdit().teamBookingNewCustomerRate).toBeNull();
      expect(component.overrideEdit().teamBookingExistingCustomerRate).toBe(18);
    });

    it('sends null for a blank field, so it goes back to the company default', () => {
      bonusService.setOverride.mockReturnValue(of(row()));

      component.startEditingOverride(row());
      component.overrideEdit().ownBookingNewCustomerRate = 12;
      component.overrideEdit.set(component.overrideEdit());
      component.saveOverride(row());

      const [, override] = vi.mocked(bonusService.setOverride).mock.lastCall!;
      expect(override.ownBookingNewCustomerRate).toBe(12);
      expect(override.ownBookingExistingCustomerRate).toBeNull();
    });

    it('never sends team rates for an administrator', () => {
      // They can never earn on that slot, so a value parked there is a rate nobody chose that a
      // later promotion would start paying.
      bonusService.setOverride.mockReturnValue(of(row()));

      component.startEditingOverride(row());
      component.overrideEdit().teamBookingNewCustomerRate = 99;
      component.overrideEdit.set(component.overrideEdit());
      component.overrideEdit().teamBookingExistingCustomerRate = 99;
      component.overrideEdit.set(component.overrideEdit());
      component.saveOverride(row());

      const [, override] = vi.mocked(bonusService.setOverride).mock.lastCall!;
      expect(override.teamBookingNewCustomerRate).toBeNull();
      expect(override.teamBookingExistingCustomerRate).toBeNull();
    });

    it('sends both slots for a manager', () => {
      bonusService.setOverride.mockReturnValue(of(manager()));

      component.startEditingOverride(manager());
      component.overrideEdit().ownBookingNewCustomerRate = 16;
      component.overrideEdit.set(component.overrideEdit());
      component.overrideEdit().teamBookingExistingCustomerRate = 18;
      component.overrideEdit.set(component.overrideEdit());
      component.saveOverride(manager());

      const [, override] = vi.mocked(bonusService.setOverride).mock.lastCall!;
      expect(override.ownBookingNewCustomerRate).toBe(16);
      expect(override.teamBookingExistingCustomerRate).toBe(18);
    });

    it('treats a typed 0 as a real rate, not as a cleared field', () => {
      // "Earns nothing on new customers" and "follows the company rate" are different
      // instructions; collapsing them would quietly pay somebody who was zeroed out.
      bonusService.setOverride.mockReturnValue(of(row()));

      component.startEditingOverride(row());
      component.overrideEdit().ownBookingNewCustomerRate = 0;
      component.overrideEdit.set(component.overrideEdit());
      component.overrideEdit().ownBookingExistingCustomerRate = 0;
      component.overrideEdit.set(component.overrideEdit());
      component.saveOverride(row());

      const [, override] = vi.mocked(bonusService.setOverride).mock.lastCall!;
      expect(override.ownBookingNewCustomerRate).toBe(0);
      expect(override.ownBookingExistingCustomerRate).toBe(0);
    });

    it('clears every field when asked to use the default again', () => {
      bonusService.setOverride.mockReturnValue(of(manager()));

      component.startEditingOverride(manager({
        ownNewCustomerRate: 16, ownNewCustomerRateIsCustom: true,
        teamExistingCustomerRate: 18, teamExistingCustomerRateIsCustom: true
      }));
      component.clearOverride(manager());

      const [, override] = vi.mocked(bonusService.setOverride).mock.lastCall!;
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
      component.bonuses.set([row({ adminId: 1 }), manager({ adminId: 2 })]);
      const updated = manager({ adminId: 2, bonusAmount: 45 });
      bonusService.setOverride.mockReturnValue(of(updated));
      bonusService.getBonuses.mockClear();

      component.startEditingOverride(component.bonuses()[1]);
      component.saveOverride(component.bonuses()[1]);

      expect(component.bonuses()[1].bonusAmount).toBe(45);
      expect(component.bonuses()[0].adminId).toBe(1);
      expect(bonusService.getBonuses).not.toHaveBeenCalled();
    });

    it('rejects a negative rate before it reaches the server', () => {
      component.startEditingOverride(row());
      component.overrideEdit().ownBookingNewCustomerRate = -5;
      component.overrideEdit.set(component.overrideEdit());
      component.saveOverride(row());

      expect(bonusService.setOverride).not.toHaveBeenCalled();
    });

    it('keeps the editor open when the server refuses the change', () => {
      bonusService.setOverride.mockReturnValue(throwError(() => ({ error: { message: 'nope' } })));

      component.startEditingOverride(row({ adminId: 7 }));
      component.saveOverride(row({ adminId: 7 }));

      expect(component.editingOverrideAdminId()).toBe(7);
      expect(component.isSavingOverride()).toBe(false);
    });
  });

  describe('who may see the company pay table', () => {
    /** A fresh instance whose ngOnInit runs with the given viewer role. */
    function bootAs(isSuperAdmin: boolean): ShiftsComponent {
      bonusService.getRates.mockClear();
      const f = TestBed.createComponent(ShiftsComponent);
      f.componentInstance.isSuperAdmin.set(isSuperAdmin);
      f.detectChanges();
      return f.componentInstance;
    }

    it('does not even ask for the defaults as a regular admin', () => {
      // The endpoint is SuperAdmin-only, so asking would collect a 403 on every page load — and
      // the defaults are the whole pay table, which is not this person's to see.
      const c = bootAs(false);

      expect(bonusService.getRates).not.toHaveBeenCalled();
      expect(c.bonusRates()).toBeNull();
    });

    it('loads them for a SuperAdmin', () => {
      const c = bootAs(true);

      expect(bonusService.getRates).toHaveBeenCalled();
      expect(c.bonusRates()).toEqual(defaults);
    });

    it('still shows a regular admin their own rates', () => {
      // Their own row is theirs to know; it arrives on the bonus summary, not on the pay table.
      const mine = manager({ ownNewCustomerRate: 15, ownExistingCustomerRate: 25 });
      bonusService.getBonuses.mockReturnValue(of([mine]));

      const c = bootAs(false);

      expect(c.bonuses()[0].ownNewCustomerRate).toBe(15);
      expect(c.bonuses()[0].teamExistingCustomerRate).toBe(15);
    });
  });

  describe('company default rates', () => {
    it('restates the month on screen after a rate change', () => {
      // Everybody still on a default has just changed value, so the visible figures are stale
      // until they are refetched.
      bonusService.setRates.mockReturnValue(of({ ...defaults, administratorNewCustomerRate: 11 }));
      bonusService.getBonuses.mockClear();

      component.startEditingRates();
      component.rateEdit().administratorNewCustomerRate = 11;
      component.rateEdit.set(component.rateEdit());
      component.saveRates();

      expect(bonusService.getBonuses).toHaveBeenCalled();
      expect(component.isEditingRates()).toBe(false);
    });

    it('submits all three slots', () => {
      // The manager own-booking pair is its own figure, not the other two added together — if the
      // editor stopped sending it, it would silently freeze at whatever was stored.
      bonusService.setRates.mockReturnValue(of(defaults));

      component.startEditingRates();
      component.saveRates();

      const [sent] = vi.mocked(bonusService.setRates).mock.lastCall!;
      expect(sent.administratorNewCustomerRate).toBe(10);
      expect(sent.managerOwnBookingNewCustomerRate).toBe(15);
      expect(sent.managerOwnBookingExistingCustomerRate).toBe(25);
      expect(sent.managerTeamNewCustomerRate).toBe(5);
    });

    it('rejects a negative default before it reaches the server', () => {
      component.startEditingRates();
      component.rateEdit().managerTeamExistingCustomerRate = -1;
      component.rateEdit.set(component.rateEdit());
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

      expect(component.hasBothSides(both)).toBe(true);
      expect(component.hasBothSides(administratorOnly)).toBe(false);
      expect(component.hasBothSides(managerOnly)).toBe(false);
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

      expect(component.hasCustomRate(staleTeamOnly)).toBe(false);
      expect(component.hasCustomRate(managerWithNoTeam)).toBe(false);
      expect(component.hasCustomRate(realOverride)).toBe(true);
      expect(component.hasCustomRate(manager({ teamNewCustomerRateIsCustom: true }))).toBe(true);
    });

    it('hides the team rate from a manager who has nobody reporting to them', () => {
      // Printing "team 5 / 15" for somebody who cannot earn it reads as money they are owed.
      expect(component.showsTeamRate(manager({ teamSize: 0 }))).toBe(false);
      expect(component.showsTeamRate(manager({ teamSize: 1 }))).toBe(true);
      expect(component.showsTeamRate(row())).toBe(false);
    });

    it('keeps the team rate visible while it is still earning', () => {
      // A manager whose last administrator was just moved away can still have team shares inside
      // the window on screen; hiding the rate would leave part of their total unexplained.
      const lostTheirTeamMidMonth = manager({ teamSize: 0, teamExistingCustomerCount: 3 });

      expect(component.showsTeamRate(lostTheirTeamMidMonth)).toBe(true);
    });

    it('renders one card per person with the total and its breakdown', () => {
      component.bonuses.set([row({
        bonusAmount: 75.5, fixedBonusAmount: 20, percentBonusAmount: 55.5,
        percentBonusUsd: 20.54, percentBonusOrderCount: 1, eligibleCount: 2,
        percentRules: [{ id: 3, basis: 'NetIncome', newCustomerPercent: 10, existingCustomerPercent: 4,
          startDate: '2026-10-01T00:00:00', isCurrent: true, isUpcoming: false, createdAt: '2026-10-01T00:00:00' }]
      })]);
      fixture.detectChanges();

      const card = (fixture.nativeElement as HTMLElement).querySelector('.bonus-card')!;
      expect(card.querySelector('.bonus-total-value')!.textContent).toContain('75.50');
      expect(card.querySelector('.bonus-total-split')!.textContent).toContain('20.00 per-order + 55.50 percentage');
      const pcts = Array.from(card.querySelectorAll('dd.pct')).map(e => e.textContent!.trim());
      expect(pcts).toEqual(['10%', '4%']);
      expect(card.querySelectorAll('.bonus-block').length).toBe(3);
    });

    it('shows no percentage block to someone with no percentage bonus', () => {
      component.bonuses.set([row()]);
      fixture.detectChanges();

      const card = (fixture.nativeElement as HTMLElement).querySelector('.bonus-card')!;
      expect(card.querySelectorAll('.bonus-block').length).toBe(2);
      expect(card.textContent).not.toContain('Percentage bonus');
      // A SuperAdmin adds one from the per-order block instead.
      expect(card.textContent).toContain('Add percentage bonus');

      component.isSuperAdmin.set(false);
      fixture.detectChanges();
      expect(card.textContent).not.toContain('Add percentage bonus');
    });

  });

  describe('percentage bonus', () => {
    const rule = (o: Partial<import('../../services/admin-bonus.service').AdminPercentBonusRule> = {}) => ({
      id: 1, basis: 'FullOrder' as const, newCustomerPercent: 5, existingCustomerPercent: 5, startDate: '2026-10-01T00:00:00',
      isCurrent: true, isUpcoming: false, createdAt: '2026-10-01T00:00:00', ...o
    });

    it('sends the basis, a percent for new and for returning customers, and the start date', () => {
      const b = row();
      bonusService.addPercentRule.mockReturnValue(of(b));
      component.bonuses.set([b]);
      component.startEditingPercent(b);
      component.percentEdit.set({ basis: 'NetIncome', newPercent: 10, existingPercent: 7.5, startDate: '2026-10-10' });

      component.savePercent(b);

      const [adminId, sent] = vi.mocked(bonusService.addPercentRule).mock.lastCall!;
      expect(adminId).toBe(1);
      expect(sent).toEqual({ basis: 'NetIncome', newCustomerPercent: 10, existingCustomerPercent: 7.5, startDate: '2026-10-10' });
      expect(component.editingPercentAdminId()).toBeNull();
    });

    it('stops it from the chosen date by sending 0', () => {
      const b = row({ percentRules: [rule()] });
      bonusService.addPercentRule.mockReturnValue(of(b));
      component.startEditingPercent(b);
      component.percentEdit.set({ basis: 'FullOrder', newPercent: 5, existingPercent: 5, startDate: '2026-11-01' });

      component.savePercent(b, true);

      const sent = vi.mocked(bonusService.addPercentRule).mock.lastCall![1];
      expect(sent.newCustomerPercent).toBe(0);
      expect(sent.existingCustomerPercent).toBe(0);
    });

    it('treats one empty box as 0% for that kind of customer', () => {
      const b = row();
      bonusService.addPercentRule.mockReturnValue(of(b));
      component.startEditingPercent(b);
      component.percentEdit.set({ basis: 'FullOrder', newPercent: 8, existingPercent: null, startDate: '2026-10-10' });

      component.savePercent(b);

      const sent = vi.mocked(bonusService.addPercentRule).mock.lastCall![1];
      expect(sent.newCustomerPercent).toBe(8);
      expect(sent.existingCustomerPercent).toBe(0);
    });

    it('refuses a percentage above 100 or a missing one before it reaches the server', () => {
      const b = row();
      component.startEditingPercent(b);
      component.percentEdit.set({ basis: 'FullOrder', newPercent: 5, existingPercent: 120, startDate: '2026-10-10' });
      component.savePercent(b);
      component.percentEdit.set({ basis: 'FullOrder', newPercent: null, existingPercent: null, startDate: '2026-10-10' });
      component.savePercent(b);

      expect(bonusService.addPercentRule).not.toHaveBeenCalled();
    });

    it('opens the editor seeded with the rule in force and today as the start', () => {
      const b = row({ percentRules: [rule({ basis: 'NetIncome', newCustomerPercent: 6, existingCustomerPercent: 4 })] });
      component.startEditingPercent(b);

      expect(component.percentEdit().basis).toBe('NetIncome');
      expect(component.percentEdit().newPercent).toBe(6);
      expect(component.percentEdit().existingPercent).toBe(4);
      expect(component.percentEdit().startDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('treats a stopped rule as no percentage bonus', () => {
      const stopped = rule({ newCustomerPercent: 0, existingCustomerPercent: 0 });
      expect(component.currentPercentRule(row({ percentRules: [stopped] }))).toBeNull();
      expect(component.currentPercentRule(row({ percentRules: [rule()] }))?.newCustomerPercent).toBe(5);
      expect(component.describePercentRule(stopped)).toBe('Stopped');
      expect(component.describePercentRule(rule({ basis: 'NetIncome', newCustomerPercent: 3, existingCustomerPercent: 3 }))).toBe('3% of net');
      expect(component.describePercentRule(rule({ newCustomerPercent: 10, existingCustomerPercent: 5 })))
        .toBe('10% new · 5% returning of full order');
    });
  });
});
