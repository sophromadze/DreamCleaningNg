import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { Subscription } from 'rxjs';
import { AuthService } from '../../../services/auth.service';
import { canViewAdminPage } from '../../../shared/admin-viewable-pages';

/**
 * Shell for the "Company" area (Statistics / Expenses / Finances / Ads) — the money & performance
 * counterpart to CRM (relationships). A thin layout: back-link, title, a tab bar, and a
 * <router-outlet> for the child routes (each keeps its own pageViewGuard). Tabs render only when the
 * signed-in user may see them — all four are pageView-gated via canViewAdminPage (SuperAdmin always;
 * a regular Admin per grant). The bare route lands on the first granted tab (companyLandingGuard).
 */
@Component({
  selector: 'app-company',
  standalone: true,
  imports: [CommonModule, RouterLink, RouterLinkActive, RouterOutlet],
  templateUrl: './company.component.html',
  styleUrls: ['./company.component.scss']
})
export class CompanyComponent implements OnInit, OnDestroy {
  currentUser: any = null;
  private sub?: Subscription;

  constructor(private auth: AuthService) {}

  ngOnInit(): void {
    this.sub = this.auth.currentUser.subscribe(u => this.currentUser = u);
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }

  canView(pageKey: string): boolean {
    return canViewAdminPage(this.currentUser, pageKey);
  }
}
