import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { Subscription } from 'rxjs';
import { AuthService } from '../../../services/auth.service';

/**
 * Shell for the "Commercial" area - Invoices / Contracts / Clients.
 *
 * The three sit together because they are one workflow: a commercial client signs a contract, and
 * the contract is billed by invoices. Contracts moved in here from its own top-level
 * /admin/contracts section (2026-09); the old paths still resolve through redirects in
 * app.routes.ts, because the contract revision emails already in people's inboxes link to them.
 *
 * Same thin-shell pattern as /admin/company and /admin/crm: back-link, title, tab bar, and a
 * <router-outlet> for the child routes, each of which keeps its own guard. Role gating here is
 * presentation only - every endpoint behind these tabs re-checks authorization server-side.
 */
@Component({
  selector: 'app-commercial',
  standalone: true,
  imports: [CommonModule, RouterLink, RouterLinkActive, RouterOutlet],
  templateUrl: './commercial.component.html',
  styleUrls: ['./commercial.component.scss']
})
export class CommercialComponent implements OnInit, OnDestroy {
  currentUser: any = null;
  private sub?: Subscription;

  constructor(private auth: AuthService) {}

  ngOnInit(): void {
    this.sub = this.auth.currentUser.subscribe(u => this.currentUser = u);
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }

  /**
   * Billing settings holds the company's bank details, so the tab is SuperAdmin-only - matching
   * the endpoint, which refuses a write from anyone else. An Admin can still SEE the payment
   * instructions their client receives; they see them on the invoice itself.
   */
  get canManageBilling(): boolean {
    return this.currentUser?.role === 'SuperAdmin';
  }
}
