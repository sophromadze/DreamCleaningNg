import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpTestingController } from '@angular/common/http/testing';

import { LoyaltyDiscountAdminComponent } from './loyalty-discount-admin.component';
import { testProviders } from '../../../../testing/test-providers';

/**
 * WHO MAY CHANGE THE LOYALTY POLICY (2026-09).
 *
 * Panel A sets the standing discount every customer who stops booking is handed, and how long
 * they wait for it. That is company-wide policy, not one account, so it is SuperAdmin-only —
 * matched by [Authorize(Roles = "SuperAdmin")] on both loyalty-discount-settings endpoints, which
 * is the actual control; hiding the panel only keeps an Admin from collecting a 403.
 *
 * Panel B (the audit feed) stays visible to everybody who can reach the tab: it is read-only and
 * it is how an Admin sees a customer's discount move without being able to move it.
 */
describe('LoyaltyDiscountAdminComponent', () => {
  let fixture: ComponentFixture<LoyaltyDiscountAdminComponent>;
  let component: LoyaltyDiscountAdminComponent;
  let http: HttpTestingController;

  // The test environment points at an absolute apiUrl, so requests are matched on the tail of
  // the URL rather than on a literal path.
  const endsWith = (path: string) => (r: { url: string }) => r.url.endsWith(path);

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      providers: [...testProviders],
      imports: [LoyaltyDiscountAdminComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(LoyaltyDiscountAdminComponent);
    component = fixture.componentInstance;
    http = TestBed.inject(HttpTestingController);
  });

  const startAs = (role: string) => {
    fixture.detectChanges();
    http.expectOne(endsWith('/admin/permissions')).flush({ role, permissions: {} });
    fixture.detectChanges();
  };

  it('should create', () => {
    startAs('SuperAdmin');
    expect(component).toBeTruthy();
  });

  it('shows the settings panel to a SuperAdmin and loads it', () => {
    startAs('SuperAdmin');

    expect(component.canManageSettings).toBeTrue();
    // The settings GET only goes out for the role that can see the panel.
    const settings = http.match(endsWith('/admin/loyalty-discount-settings'));
    expect(settings.length).toBe(1);
  });

  it('hides it from a regular Admin, and never asks the API for the settings', () => {
    startAs('Admin');

    expect(component.canManageSettings).toBeFalse();
    expect(http.match(endsWith('/admin/loyalty-discount-settings')).length).toBe(0);

    const headings = Array.from(fixture.nativeElement.querySelectorAll('.panel-header h2'))
      .map((h) => (h as HTMLElement).textContent?.trim());
    expect(headings).not.toContain('Loyalty Discount Settings');
    // The read-only audit feed is still there — that is the half an Admin keeps.
    expect(headings).toContain('Recent Activity (last 30 days)');
  });

  it('hides it from a Moderator too', () => {
    startAs('Moderator');

    expect(component.canManageSettings).toBeFalse();
    expect(fixture.nativeElement.querySelector('form.settings-form')).toBeNull();
  });

  it('refuses to save when the role is not SuperAdmin', () => {
    startAs('Admin');

    component.saveSettings();

    expect(http.match((r) => r.method === 'PUT').length).toBe(0);
  });
});
