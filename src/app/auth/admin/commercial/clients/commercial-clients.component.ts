import { Component, Input, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { finalize } from 'rxjs/operators';

import { InvoiceService, InvoiceClientOption } from '../../../../services/invoice.service';
import { ContractService } from '../../../../services/contract.service';
import { AdminService, UserProfile } from '../../../../services/admin.service';
import { CommercialClientModalComponent } from '../../../../shared/components/commercial-client-modal/commercial-client-modal.component';
import { UserManagementComponent } from '../../user-management/user-management.component';
import { extractApiErrorMessage } from '../../../../utils/http-error.utils';
import { getAdminAvatarColor, getAdminAvatarInitials } from '../../../../shared/admin/admin-avatar.utils';

/**
 * Commercial → Clients / Users → Business Clients: the one screen for managing commercial
 * customers. Mounted in both places on purpose — ContractClient is the source of truth, not
 * website Users, so standalone companies with no account appear beside linked ones.
 *
 * ## One list, two origins, and the admin is not asked to care
 *
 * A client here is either automatically linked to a customer account flagged as a business, or a
 * standalone record typed in by hand for a company with no website account. They are the same row
 * in the same table and behave identically — same edit form, same invoices, same contracts. The
 * only thing that differs is a badge, and what deleting one has to warn about.
 *
 * ## One endpoint, two acts: "Move to Customers" and "Delete"
 *
 * Nothing is ever hard-deleted: contracts, invoices, payments and reference numbers all survive,
 * and a historical invoice still resolves the client it was addressed to. For a LINKED client the
 * account's business designation goes too, in the same transaction — otherwise the account would
 * still be flagged as a business and the next sync would put the client straight back, so the
 * admin would delete it and watch it reappear.
 *
 * That side effect IS the thing an admin wants often enough to name it: a customer flagged as a
 * business by mistake, or one that stopped being one, belongs back under Customers. So a linked
 * client's button reads **Move to Customers** and the confirmation talks about the account
 * becoming an ordinary customer again — same request, honest wording. It is deliberately not
 * painted as a deletion (no danger styling): the account keeps its login, its bookings and its
 * history, and re-ticking the business flag on the Customers tab brings back this same row with
 * its contracts and invoices.
 *
 * A standalone client has no account behind it, so there is nothing to move it back TO — its
 * button stays **Delete**, which hides the row, and Restore brings it back from the "show
 * inactive" view.
 *
 * STYLING: `user-management.component.scss` is listed FIRST in styleUrls and the markup reuses the
 * Users tab's class names (table, chips, slide-in detail panel) — the same arrangement Cleaners
 * uses. Two admin tables listing people/clients must not carry their own paddings.
 */
@Component({
  selector: 'app-commercial-clients',
  standalone: true,
  imports: [
    CommonModule, FormsModule, RouterLink, CommercialClientModalComponent, UserManagementComponent
  ],
  templateUrl: './commercial-clients.component.html',
  styleUrls: [
    '../../user-management/user-management.component.scss',
    './commercial-clients.component.scss'
  ]
})
export class CommercialClientsComponent implements OnInit {
  private invoiceService = inject(InvoiceService);
  private contractService = inject(ContractService);
  private adminService = inject(AdminService);
  private router = inject(Router);

  clients: InvoiceClientOption[] = [];
  loading = true;
  error = '';
  notice = '';
  search = '';
  showInactive = false;

  /**
   * From the permission map (`GET api/admin/permissions`), never a local role test — it is the
   * same map `[RequirePermission]` enforces on each endpoint, so the buttons and the server agree
   * by construction. Moderators hold View only and get a read-only list.
   */
  canCreate = false;
  canUpdate = false;
  canDeactivate = false;

  modalOpen = false;
  editing: InvoiceClientOption | null = null;

  /** The client awaiting delete confirmation, or null. */
  pendingDelete: InvoiceClientOption | null = null;
  deleting = false;

  /** Which client's detail panel is open. Null when none. */
  selectedClientId: number | null = null;

  /**
   * Open this client's panel on arrival — the `?clientId=` deep link the orders panel's
   * "View User" uses for an invoice-billed order.
   *
   * Applied AFTER the list loads (the panel renders from the loaded row), and only once: a later
   * refresh or filter change must not drag the admin back to the client the link named.
   */
  @Input() openClientId: number | null = null;
  private deepLinkApplied = false;

  /**
   * The customer account behind a linked client, loaded on demand for the COMBINED panel.
   *
   * The two records describe different things — a legal entity vs. a person with a login — so
   * they are shown side by side rather than merged, exactly as BusinessClientMapper documents.
   * What changed is that an admin no longer has to visit a second tab to see the other half.
   *
   * Read through `users/{id}/profile` — the admin panel's ONE per-account read, which already
   * returns the phone / status / role / cleanings / spend this half shows. It originally called
   * `users/{id}/details`, an `AdminService` helper pointing at an endpoint that was never
   * implemented, so opening any LINKED client 404'd and this half silently stayed blank.
   */
  linkedAccount: UserProfile | null = null;
  loadingLinkedAccount = false;
  private linkedAccountUserId: number | null = null;

  /**
   * WHICH HALF OF THE CLIENT the panel is showing — the commercial record, or the customer one.
   *
   * A business client is one customer filed in two tables, so the panel offers both rather than
   * sending an admin to the Customers tab for the second: that tab deliberately HIDES exactly
   * these accounts (they are the ones this list is showing), so the trip was to a list the record
   * is not in, to read a panel that opened over it.
   *
   * The customer half is the real Users panel, mounted in its panel-only mode — see
   * `UserManagementComponent.embeddedUserId`. Not a summary of it: an admin reading a customer
   * wants the notes, the cleaning history and the flags, and a second view of those would be a
   * second view to keep in step.
   */
  panelTab: 'business' | 'customer' = 'business';

  /** The account behind the open client, or null when the client is standalone. */
  get linkedUserId(): number | null {
    return this.selectedClient?.sourceUserId ?? null;
  }

  /**
   * True while the customer half is the one on screen. The two panels are SIBLINGS occupying the
   * same slot, never nested: `.detail-panel` is a transformed, overflow-hidden box, which would
   * become the containing block for the customer panel's fixed-position photo lightbox and
   * recreate-order modal and then clip them out of existence.
   */
  get showsCustomerPanel(): boolean {
    return this.selectedClientId !== null
      && this.panelTab === 'customer'
      && this.linkedUserId !== null;
  }

  setPanelTab(tab: 'business' | 'customer'): void {
    this.panelTab = tab;
  }

  ngOnInit(): void {
    this.adminService.getUserPermissions().subscribe({
      next: p => {
        this.canCreate = !!p?.permissions?.canCreate;
        this.canUpdate = !!p?.permissions?.canUpdate;
        this.canDeactivate = !!p?.permissions?.canDeactivate;
      },
      error: () => {
        this.canCreate = this.canUpdate = this.canDeactivate = false;
      }
    });

    this.load();
  }

  /** Public so the Refresh button and the inactive toggle can call it. */
  load(): void {
    this.loading = true;
    this.invoiceService.clients(this.showInactive)
      .pipe(finalize(() => this.loading = false))
      .subscribe({
        next: list => {
          this.clients = list;
          // A deleted/filtered-away selection would leave the panel open on a ghost.
          if (this.selectedClientId != null
              && !list.some(c => c.id === this.selectedClientId)) {
            this.selectedClientId = null;
          }
          this.applyDeepLink();
          this.syncLinkedAccount();
        },
        error: err => this.error = extractApiErrorMessage(err, 'Could not load commercial clients.')
      });
  }

  onShowInactiveChange(): void {
    this.selectedClientId = null;
    this.load();
  }

  get filtered(): InvoiceClientOption[] {
    const term = this.search.trim().toLowerCase();
    if (!term) return this.clients;

    return this.clients.filter(c =>
      c.legalEntityName.toLowerCase().includes(term)
      || (c.billingContactName ?? '').toLowerCase().includes(term)
      || (c.billingEmail ?? '').toLowerCase().includes(term)
      || (c.linkedAccountName ?? '').toLowerCase().includes(term)
      || c.locations.some(l => l.address.toLowerCase().includes(term))
      || c.contracts.some(k => k.contractNumber.toLowerCase().includes(term)));
  }

  get selectedClient(): InvoiceClientOption | null {
    if (this.selectedClientId == null) return null;
    return this.clients.find(c => c.id === this.selectedClientId) ?? null;
  }

  openClientDetails(client: InvoiceClientOption): void {
    if (this.selectedClientId === client.id) {
      this.closeDetailPanel();
      return;
    }
    this.selectedClientId = client.id;
    // Every client opens on its commercial record. The customer half is a deliberate second look,
    // not a mode the panel remembers from whoever was open before.
    this.panelTab = 'business';
    this.syncLinkedAccount();
  }

  closeDetailPanel(): void {
    this.selectedClientId = null;
    this.linkedAccount = null;
    this.linkedAccountUserId = null;
    this.panelTab = 'business';
  }

  /**
   * Opens the client a `?clientId=` link named, ONCE.
   *
   * A "show removed" toggle or a refresh reloads the list, and re-applying the link there would
   * yank the panel back to the client the URL mentioned however far the admin had moved on. The
   * URL describes the arrival, not the session.
   */
  private applyDeepLink(): void {
    if (this.deepLinkApplied || this.openClientId == null) return;
    this.deepLinkApplied = true;

    if (this.clients.some(c => c.id === this.openClientId)) {
      this.selectedClientId = this.openClientId;
      return;
    }

    // The named client is not in the ACTIVE list — almost always because it was moved back to
    // Customers. Turning the toggle on and reloading is what shows it, rather than opening on
    // nothing and leaving the admin to wonder whether the link was wrong.
    if (!this.showInactive) {
      this.showInactive = true;
      this.selectedClientId = this.openClientId;
      this.load();
    }
  }

  /**
   * Loads (or drops) the customer account behind the open client.
   *
   * Fetched lazily per opened client rather than joined into the list: most clients in the table
   * are never opened, and the account's own orders and spend are a second query on the server.
   */
  private syncLinkedAccount(): void {
    const userId = this.selectedClient?.sourceUserId ?? null;

    if (userId == null) {
      this.linkedAccount = null;
      this.linkedAccountUserId = null;
      return;
    }
    if (userId === this.linkedAccountUserId) return;

    this.linkedAccountUserId = userId;
    this.linkedAccount = null;
    this.loadingLinkedAccount = true;

    this.adminService.getUserProfile(userId)
      .pipe(finalize(() => this.loadingLinkedAccount = false))
      .subscribe({
        next: user => {
          // The panel may have moved on while this was in flight.
          if (this.linkedAccountUserId === userId) this.linkedAccount = user;
        },
        // Non-fatal: the commercial half of the panel is complete without it, and the client's
        // own billing details are what this screen is primarily for.
        error: () => { if (this.linkedAccountUserId === userId) this.linkedAccount = null; }
      });
  }

  isLinked(client: InvoiceClientOption): boolean {
    return client.sourceUserId != null;
  }

  trackByClientId(_index: number, client: InvoiceClientOption): number {
    return client.id;
  }

  getAvatarColor(id: number): string {
    return getAdminAvatarColor(id);
  }

  /**
   * Initials for the contact's table avatar or the company's detail-panel avatar.
   * Prefer the first two word initials; fall back to the shared helper for a missing name.
   */
  getAvatarInitials(name: string): string {
    const parts = (name || '').trim().split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      return (parts[0].charAt(0) + parts[1].charAt(0)).toUpperCase();
    }
    if (parts.length === 1 && parts[0].length >= 2) {
      return parts[0].slice(0, 2).toUpperCase();
    }
    return getAdminAvatarInitials(parts[0] || null, null);
  }

  // ── Create / edit ──

  openCreate(): void {
    if (!this.canCreate) return;
    this.editing = null;
    this.modalOpen = true;
  }

  openEdit(client: InvoiceClientOption): void {
    if (!this.canUpdate) return;
    this.editing = client;
    this.modalOpen = true;
  }

  /**
   * Refetches rather than patching the list: this screen renders the server's join of client +
   * billing + locations + contracts, which is not the shape either write call returns. The search
   * is cleared on a creation for the same reason the new row must be visible — a stale filter
   * hiding it reads as the save having failed.
   */
  onClientCreated(clientId: number): void {
    this.search = '';
    this.selectedClientId = clientId;
    this.notice = '';
    this.load();
  }

  onClientSaved(clientId: number): void {
    this.selectedClientId = clientId;
    this.notice = '';
    this.load();
  }

  // ── Delete ──

  /**
   * Opens the confirmation for both acts — a linked client is moved back to Customers, a
   * standalone one is removed. One request either way; the wording is what differs.
   */
  askDelete(client: InvoiceClientOption): void {
    if (!this.canDeactivate) return;
    this.error = '';
    this.pendingDelete = client;
  }

  cancelDelete(): void {
    if (this.deleting) return;
    this.pendingDelete = null;
  }

  confirmDelete(): void {
    const client = this.pendingDelete;
    if (!client || this.deleting) return;

    this.deleting = true;
    this.contractService.deactivateClient(client.id)
      .pipe(finalize(() => this.deleting = false))
      .subscribe({
        next: result => {
          this.pendingDelete = null;
          this.notice = result.message;
          this.load();
        },
        error: err => {
          this.pendingDelete = null;
          this.error = extractApiErrorMessage(
            err,
            this.isLinked(client)
              ? 'Could not move the client back to Customers.'
              : 'Could not remove the client.');
        }
      });
  }

  /**
   * Standalone clients only. A linked one comes back by turning the business flag on again in the
   * Customers tab, which reactivates this very row — two routes to the same state is how the two
   * end up disagreeing, so the server refuses this one for a linked client and the button is hidden.
   */
  restore(client: InvoiceClientOption): void {
    if (!this.canDeactivate || this.isLinked(client)) return;

    this.contractService.restoreClient(client.id).subscribe({
      next: result => {
        this.notice = result.message;
        this.load();
      },
      error: err => this.error = extractApiErrorMessage(err, 'Could not restore the client.')
    });
  }

  // ── Navigation ──

  createInvoice(client: InvoiceClientOption): void {
    this.router.navigate(['/admin/commercial/invoices/create'], {
      queryParams: { clientId: client.id }
    });
  }
}
