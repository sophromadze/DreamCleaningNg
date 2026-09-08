import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { finalize } from 'rxjs/operators';

import { InvoiceService, InvoiceClientOption } from '../../../../services/invoice.service';
import { ContractService } from '../../../../services/contract.service';
import { AdminService } from '../../../../services/admin.service';
import { CommercialClientModalComponent } from '../../../../shared/components/commercial-client-modal/commercial-client-modal.component';
import { extractApiErrorMessage } from '../../../../utils/http-error.utils';

/**
 * Commercial → Clients: the one screen for managing commercial customers.
 *
 * ## One list, two origins, and the admin is not asked to care
 *
 * A client here is either automatically linked to a customer account flagged as a business, or a
 * standalone record typed in by hand for a company with no website account. They are the same row
 * in the same table and behave identically — same edit form, same invoices, same contracts. The
 * only thing that differs is a badge, and what deleting one has to warn about.
 *
 * ## Delete is a deactivation, and for a linked client it clears the business flag
 *
 * Nothing is ever hard-deleted: contracts, invoices, payments and reference numbers all survive,
 * and a historical invoice still resolves the client it was addressed to. For a LINKED client the
 * account's business designation goes too, in the same transaction — otherwise the account would
 * still be flagged as a business and the next sync would put the client straight back, so the
 * admin would delete it and watch it reappear. The confirmation says so before it happens, and
 * re-ticking the business flag on the Users tab brings back this same row with its history.
 *
 * A standalone client has no account behind it, so Delete simply hides it and Restore brings it
 * back from the "show inactive" view.
 */
@Component({
  selector: 'app-commercial-clients',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, CommercialClientModalComponent],
  templateUrl: './commercial-clients.component.html',
  styleUrls: ['./commercial-clients.component.scss']
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

  /** Which client's card is expanded. Null when all are collapsed. */
  expandedId: number | null = null;

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

  private load(): void {
    this.loading = true;
    this.invoiceService.clients(this.showInactive)
      .pipe(finalize(() => this.loading = false))
      .subscribe({
        next: list => this.clients = list,
        error: err => this.error = extractApiErrorMessage(err, 'Could not load commercial clients.')
      });
  }

  onShowInactiveChange(): void {
    this.expandedId = null;
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

  toggle(clientId: number): void {
    this.expandedId = this.expandedId === clientId ? null : clientId;
  }

  isLinked(client: InvoiceClientOption): boolean {
    return client.sourceUserId != null;
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
    this.expandedId = clientId;
    this.notice = '';
    this.load();
  }

  onClientSaved(clientId: number): void {
    this.expandedId = clientId;
    this.notice = '';
    this.load();
  }

  // ── Delete ──

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
          this.error = extractApiErrorMessage(err, 'Could not remove the client.');
        }
      });
  }

  /**
   * Standalone clients only. A linked one comes back by turning the business flag on again in the
   * Users tab, which reactivates this very row — two routes to the same state is how the two end
   * up disagreeing, so the server refuses this one for a linked client and the button is hidden.
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
