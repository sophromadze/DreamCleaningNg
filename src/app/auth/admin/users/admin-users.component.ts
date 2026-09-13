import { Component, Input, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';

import { UserManagementComponent } from '../user-management/user-management.component';
import { CleanerAccountsComponent } from '../cleaner-accounts/cleaner-accounts.component';
import { CommercialClientsComponent } from '../commercial/clients/commercial-clients.component';

/**
 * The four audiences the business has, in the order the owner asked for them.
 * The KEYS are persisted to sessionStorage, so renaming one would bounce every admin
 * mid-session back to Customers — treat them as stable identifiers, not labels.
 */
export type AdminUsersTab = 'customers' | 'cleaners' | 'business-clients' | 'staff';

@Component({
  selector: 'app-admin-users',
  standalone: true,
  imports: [
    CommonModule,
    UserManagementComponent,
    CleanerAccountsComponent,
    CommercialClientsComponent
  ],
  templateUrl: './admin-users.component.html',
  styleUrls: ['./admin-users.component.scss']
})
/**
 * ADMIN → USERS: one area, four sub-tabs — Customers / Cleaners / Business Clients / Staff.
 *
 * A SHELL, NOT A REWRITE. Every tab mounts the component that already owned that job:
 *
 *  • Customers and Staff are both `<app-user-management>`, differing only by its `scope` input.
 *    They are the same records with the same detail panel, notes, flags and permission model;
 *    the only real difference is which roles belong on screen, so a second component would be a
 *    second copy of two thousand lines that drifts on the first change either side.
 *  • Cleaners is `<app-cleaner-accounts>` verbatim — the same component the old top-level
 *    "Cleaners" tab mounted. NOTHING about cleaner functionality changed; it simply lives here
 *    now. The people themselves (documents, ranking, wages) stay on /cleaners-dashboard.
 *  • Business Clients is `<app-commercial-clients>` — the SAME component Commercial → Clients
 *    uses, reading ContractClient. That is the point of the requirement: business clients are
 *    ContractClients, not website Users, so standalone commercial clients with no account appear
 *    here alongside the linked ones. Commercial → Clients is deliberately KEPT as a shortcut into
 *    the commercial workflow, and the two share this one implementation rather than growing a
 *    second.
 *
 * The tab strip uses the shared admin-tab-nav mixin, so it reads as a smaller version of the
 * panel's own navigation rather than a third style.
 */
export class AdminUsersComponent implements OnInit {
  /** Forwarded to the Customers tab — the ?userId= deep link from the orders panel. */
  @Input() openUserId: number | null = null;

  /**
   * Forwarded to the Business Clients tab — the ?clientId= deep link, which is how the orders
   * panel's "View User" lands on the COMMERCIAL record for an invoice-billed order rather than
   * on the customer list.
   */
  @Input() openClientId: number | null = null;

  /**
   * Which sub-tab to open on mount. Set by the panel when a legacy deep link asked for the old
   * top-level Cleaners tab, so `/admin?tab=cleaner-accounts` keeps landing on the cleaners.
   */
  @Input() initialTab: AdminUsersTab | null = null;

  activeTab: AdminUsersTab = 'customers';

  /** EXACTLY this order — the requirement is specific about it. */
  readonly tabs: { key: AdminUsersTab; label: string }[] = [
    { key: 'customers', label: 'Customers' },
    { key: 'cleaners', label: 'Cleaners' },
    { key: 'business-clients', label: 'Business Clients' },
    { key: 'staff', label: 'Staff' }
  ];

  private static readonly STORAGE_KEY = 'adminUsersTab';

  ngOnInit(): void {
    if (this.initialTab) {
      this.activeTab = this.initialTab;
      return;
    }

    // Restored per session so switching to Orders and back does not lose the admin's place.
    // Validated against the known list: a stale or hand-edited value falls back to Customers
    // rather than rendering nothing.
    try {
      const saved = sessionStorage.getItem(AdminUsersComponent.STORAGE_KEY) as AdminUsersTab | null;
      if (saved && this.tabs.some(t => t.key === saved)) this.activeTab = saved;
    } catch {
      // Private browsing, or storage disabled. The default is perfectly usable.
    }
  }

  setActiveTab(tab: AdminUsersTab): void {
    this.activeTab = tab;
    try {
      sessionStorage.setItem(AdminUsersComponent.STORAGE_KEY, tab);
    } catch {
      // Same as above — remembering the tab is a convenience, never a requirement.
    }
  }
}
