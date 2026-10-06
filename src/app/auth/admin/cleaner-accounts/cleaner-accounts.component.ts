import { Component, OnDestroy, OnInit, ChangeDetectionStrategy, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Subject, debounceTime, distinctUntilChanged, takeUntil } from 'rxjs';
import { finalize } from 'rxjs/operators';
import {
  AdminService,
  CleanerAccount,
  LinkableCleaner,
  PromotableUser
} from '../../../services/admin.service';
import { extractApiErrorMessage } from '../../../utils/http-error.utils';
import { CleanersDashboardComponent } from '../../../cleaners-dashboard/cleaners-dashboard.component';
import { getAdminAvatarColor, getAdminAvatarInitials } from '../../../shared/admin/admin-avatar.utils';

/**
 * ADMIN PANEL -> "Cleaners".
 *
 * The tab is about the LOGIN ACCOUNTS cleaners use to open the read-only portal, and the link from
 * each account to a row on the Cleaners Dashboard (which is where the PEOPLE themselves live:
 * documents, ranking, availability, wages). It was called "Cleaner Accounts" until the owner
 * renamed it (2026-09) - the panel has no other tab competing for the word.
 *
 * Two jobs, both of which exist because the automatic email match cannot cover everything:
 *   1. Move an ordinary customer account onto the Cleaner role (and back off it).
 *   2. Point a Cleaner-role account at a specific cleaner record - for the records that carry no
 *      email, or a different one from the address the person actually signs in with.
 *
 * An account with NO link is the failure this tab exists to catch: that person signs in and
 * correctly sees nothing, and nothing else in the app would ever tell you why.
 *
 * STYLING: `user-management.component.scss` is listed FIRST in styleUrls and the markup reuses the
 * Users tab's class names, so the table, chips, row actions, pagination and their dark-mode
 * overrides all come from there - the same arrangement outgoing-payments uses with
 * `orders.component.scss`. Two admin tables listing people must not carry their own paddings.
 */
@Component({
  selector: 'app-cleaner-accounts',
  standalone: true,
  imports: [FormsModule, CleanersDashboardComponent],
  templateUrl: './cleaner-accounts.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrls: [
    '../user-management/user-management.component.scss',
    './cleaner-accounts.component.scss'
  ]
})
export class CleanerAccountsComponent implements OnInit, OnDestroy {
  private adminService = inject(AdminService);

  readonly accounts = signal<CleanerAccount[]>([], { equal: () => false });

  readonly loading = signal(true);
  readonly errorMessage = signal('');
  readonly successMessage = signal('');

  readonly canUpdate = signal(false);

  // ── Filters + paging (20 a page, matching the Users tab) ──
  readonly searchTerm = signal('');
  readonly statusFilter = signal<'all' | 'active' | 'inactive'>('all');
  readonly linkFilter = signal<'all' | 'linked' | 'unlinked'>('all');

  readonly currentPage = signal(1);
  readonly itemsPerPage = 20;
  readonly totalPages = signal(1);
  matchingCount = 0;

  /**
   * The rows on screen. Computed in `applyFilters`, NEVER in a template-called getter: a getter
   * that assigns `totalPages` while the template is reading it is the NG0100 the admin orders
   * component is on record about.
   */
  readonly pagedAccounts = signal<CleanerAccount[]>([]);

  // ── Link editor (one account at a time) ──
  readonly linkingUserId = signal<number | null>(null);
  readonly linkCleanerChoice = signal<number | null>(null);
  readonly savingLinkUserId = signal<number | null>(null);

  /** The cleaner picker's own search - name, last name, email or phone, resolved server-side. */
  readonly cleanerSearch = signal('');
  readonly cleanerResults = signal<LinkableCleaner[]>([]);
  readonly cleanerSearching = signal(false);

  // ── Promote an existing customer ──
  readonly promoteSearch = signal('');
  readonly promoteResults = signal<PromotableUser[]>([]);
  readonly promoteSearching = signal(false);
  readonly promotingUserId = signal<number | null>(null);
  readonly showPromotePanel = signal(false);

  // ── Demote back to Customer ──
  readonly demotingUserId = signal<number | null>(null);

  // ── The cleaner RECORD behind the account (2026-09) ──
  //
  // This tab is about accounts; the person - documents, ranking, availability, wages, notes - is a
  // Cleaner row, and the Cleaners Dashboard already owns the panel that shows one and the form
  // that edits it. Clicking a row here opens THAT component, embedded in a drawer, rather than a
  // second rendering of the same record that would drift from it on the first change either side.
  //
  // Null when the drawer is closed. Only a LINKED account can open it: an unlinked one has no
  // record to show, which is the very thing the "Not linked" chip on its row is reporting.
  readonly recordCleanerId = signal<number | null>(null);
  readonly recordCleanerName = signal('');

  private readonly promoteSearch$ = new Subject<string>();
  private readonly cleanerSearch$ = new Subject<string>();
  private readonly destroy$ = new Subject<void>();

  ngOnInit(): void {
    this.promoteSearch$
      .pipe(debounceTime(300), distinctUntilChanged(), takeUntil(this.destroy$))
      .subscribe(term => this.runPromoteSearch(term));

    this.cleanerSearch$
      .pipe(debounceTime(300), distinctUntilChanged(), takeUntil(this.destroy$))
      .subscribe(term => this.runCleanerSearch(term));

    // Gated on the permission map from GET api/admin/permissions, not on a local role test - the
    // same map the backend's [RequirePermission] enforces. Admins hold Update and do everything
    // here; a Moderator holds View only and must see this tab read-only.
    this.adminService.getUserPermissions().subscribe({
      next: p => { this.canUpdate.set(!!p?.permissions?.canUpdate); },
      error: () => { this.canUpdate.set(false); }
    });

    this.load();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  load(): void {
    this.loading.set(true);
    this.adminService.getCleanerAccounts()
      .pipe(finalize(() => this.loading.set(false)))
      .subscribe({
        next: rows => {
          this.accounts.set(rows || []);
          this.applyFilters();
        },
        error: err => {
          this.errorMessage.set(extractApiErrorMessage(err, 'Could not load cleaner accounts.'));
        }
      });
  }

  // ── Filtering + paging ─────────────────────────────────────────────────────────────

  /** Called by every filter control and after every write. Recomputes the page in one pass. */
  applyFilters(resetPage = false): void {
    if (resetPage) this.currentPage.set(1);

    const term = this.searchTerm().trim().toLowerCase();
    const matching = this.accounts().filter(a => {
      if (this.statusFilter() === 'active' && !a.isActive) return false;
      if (this.statusFilter() === 'inactive' && a.isActive) return false;
      if (this.linkFilter() === 'linked' && !a.cleanerId) return false;
      if (this.linkFilter() === 'unlinked' && a.cleanerId) return false;
      if (!term) return true;

      return [
        a.firstName, a.lastName, `${a.firstName} ${a.lastName}`,
        // Both numbers, not the resolved one: the box says it searches by phone, and a number an
        // admin can read off the row has to be a number they can then search for.
        a.email, a.phone, a.cleanerPhone, a.cleanerName, String(a.userId)
      ].some(v => (v || '').toLowerCase().includes(term));
    });

    this.matchingCount = matching.length;
    this.totalPages.set(Math.max(1, Math.ceil(matching.length / this.itemsPerPage)));
    // A filter that shrinks the list can otherwise strand the viewer past the end of it.
    if (this.currentPage() > this.totalPages()) this.currentPage.set(this.totalPages());

    const start = (this.currentPage() - 1) * this.itemsPerPage;
    this.pagedAccounts.set(matching.slice(start, start + this.itemsPerPage));
  }

  onFilterChanged(): void { this.applyFilters(true); }

  previousPage(): void { if (this.currentPage() > 1) { this.currentPage.update(v => v - 1); this.applyFilters(); } }
  nextPage(): void { if (this.currentPage() < this.totalPages()) { this.currentPage.update(v => v + 1); this.applyFilters(); } }
  goToPage(page: number): void {
    if (page >= 1 && page <= this.totalPages()) { this.currentPage.set(page); this.applyFilters(); }
  }

  /** The middle page buttons, same shape as the Users tab's pager. */
  getVisiblePages(): number[] {
    const pages: number[] = [];
    const maxVisiblePages = 3;

    if (this.totalPages() <= 5) {
      for (let i = 2; i < this.totalPages(); i++) pages.push(i);
    } else {
      let start = Math.max(2, this.currentPage() - 1);
      const end = Math.min(this.totalPages() - 1, start + maxVisiblePages - 1);
      if (end === this.totalPages() - 1) start = Math.max(2, end - maxVisiblePages + 1);
      for (let i = start; i <= end; i++) pages.push(i);
    }

    return pages;
  }

  // ── Linking ────────────────────────────────────────────────────────────────────────

  startLinking(account: CleanerAccount): void {
    if (!this.canUpdate()) return;
    this.linkingUserId.set(account.userId);
    this.linkCleanerChoice.set(account.cleanerId ?? null);
    this.cleanerSearch.set('');
    // Opens on the full roster; the search box below only ever narrows it.
    this.runCleanerSearch('');
  }

  cancelLinking(): void {
    this.linkingUserId.set(null);
    this.linkCleanerChoice.set(null);
    this.cleanerSearch.set('');
    this.cleanerResults.set([]);
  }

  onCleanerSearchChanged(term: string): void {
    this.cleanerSearch.set(term);
    this.cleanerSearch$.next(term);
  }

  /**
   * Searched on the SERVER rather than over whatever the client already holds: the roster is the
   * authority on who exists, and a client-side filter would silently stop finding people once the
   * roster outgrew the first response.
   */
  private runCleanerSearch(term: string): void {
    this.cleanerSearching.set(true);
    this.adminService.getLinkableCleaners(term)
      .pipe(finalize(() => this.cleanerSearching.set(false)))
      .subscribe({
        next: rows => { this.cleanerResults.set(rows || []); },
        error: err => {
          this.errorMessage.set(extractApiErrorMessage(err, 'Could not load the cleaner list.'));
        }
      });
  }

  /**
   * A cleaner already attached to a DIFFERENT account cannot be picked. Such rows are still shown
   * and named - "why is she not in the list" has to be answerable from the list itself.
   */
  isCleanerTaken(cleaner: LinkableCleaner, forUserId: number): boolean {
    return !!cleaner.linkedUserId && cleaner.linkedUserId !== forUserId;
  }

  chooseCleaner(cleaner: LinkableCleaner, forUserId: number): void {
    if (this.isCleanerTaken(cleaner, forUserId)) return;
    this.linkCleanerChoice.set(cleaner.cleanerId);
  }

  saveLink(account: CleanerAccount): void {
    if (!this.canUpdate() || !this.linkCleanerChoice()) return;

    this.savingLinkUserId.set(account.userId);
    this.clearMessages();

    this.adminService.linkCleanerAccount(account.userId, this.linkCleanerChoice()!)
      .pipe(finalize(() => this.savingLinkUserId.set(null)))
      .subscribe({
        next: updated => {
          this.applyUpdated(updated);
          this.cancelLinking();
          this.flashSuccess(`${updated.firstName} is now linked to ${updated.cleanerName}. Their cleaner record's email was set to ${updated.email || 'the account address'}.`);
        },
        error: err => {
          this.errorMessage.set(extractApiErrorMessage(err, 'Could not link that cleaner.'));
        }
      });
  }

  unlink(account: CleanerAccount): void {
    if (!this.canUpdate() || !account.cleanerId) return;
    if (!confirm(`Unlink ${account.firstName} ${account.lastName} from ${account.cleanerName}? They will keep their Cleaner role but stop seeing any jobs until they are linked again.`)) return;

    this.savingLinkUserId.set(account.userId);
    this.clearMessages();

    this.adminService.unlinkCleanerAccount(account.userId)
      .pipe(finalize(() => this.savingLinkUserId.set(null)))
      .subscribe({
        next: updated => {
          this.applyUpdated(updated);
          this.flashSuccess('Account unlinked.');
        },
        error: err => {
          this.errorMessage.set(extractApiErrorMessage(err, 'Could not unlink that account.'));
        }
      });
  }

  // ── The linked cleaner record ──────────────────────────────────────────────────────

  /**
   * Opens the Cleaners Dashboard's own detail panel over this table - the whole ROW is the way in,
   * the same as a Customers row opening its detail panel. There is deliberately no Edit button on
   * the row: Edit belongs in the panel, next to the record it edits, and the panel already has one.
   *
   * A no-op for an unlinked account. Called from the row itself, so the guard lives here rather
   * than in six `*ngIf`s in the template.
   */
  openCleanerRecord(account: CleanerAccount): void {
    if (!account.cleanerId) return;

    this.recordCleanerName.set(account.cleanerName || `${account.firstName} ${account.lastName}`);
    this.recordCleanerId.set(account.cleanerId);
  }

  closeCleanerRecord(): void {
    this.recordCleanerId.set(null);
    this.recordCleanerName.set('');
  }

  /**
   * A save or a delete inside the panel. The row's linked-cleaner name, and whether it is linked
   * at all, both come from the cleaner record - so the table underneath is stale the moment either
   * happens.
   */
  onCleanerRecordChanged(): void {
    this.load();
  }

  private applyUpdated(updated: CleanerAccount): void {
    const index = this.accounts().findIndex(a => a.userId === updated.userId);
    if (index >= 0) { this.accounts()[index] = updated; this.accounts.set(this.accounts()); }
    this.applyFilters();
  }

  // ── Promoting a customer into the Cleaner role ─────────────────────────────────────

  togglePromotePanel(): void {
    this.showPromotePanel.set(!this.showPromotePanel());
    if (!this.showPromotePanel()) {
      this.promoteSearch.set('');
      this.promoteResults.set([]);
    }
  }

  onPromoteSearchChanged(term: string): void {
    this.promoteSearch.set(term);
    this.promoteSearch$.next(term);
  }

  private runPromoteSearch(term: string): void {
    if (!term || term.trim().length < 2) {
      this.promoteResults.set([]);
      return;
    }
    this.promoteSearching.set(true);
    this.adminService.getPromotableUsers(term.trim())
      .pipe(finalize(() => this.promoteSearching.set(false)))
      .subscribe({
        next: rows => { this.promoteResults.set(rows || []); },
        error: err => {
          this.errorMessage.set(extractApiErrorMessage(err, 'Could not search accounts.'));
        }
      });
  }

  promote(user: PromotableUser): void {
    if (!this.canUpdate()) return;

    this.promotingUserId.set(user.userId);
    this.clearMessages();

    // The SAME endpoint the Users tab's role control uses, so the audit row, the role-change
    // notification and the validation rules are identical however the change was made.
    this.adminService.updateUserRole(user.userId, 'Cleaner')
      .pipe(finalize(() => this.promotingUserId.set(null)))
      .subscribe({
        next: () => {
          this.promoteResults.set(this.promoteResults().filter(r => r.userId !== user.userId));
          this.promoteSearch.set('');
          this.load();
          this.flashSuccess(`${user.firstName} ${user.lastName} is now a cleaner account. Link them to a cleaner record so they can see their jobs.`);
        },
        error: err => {
          this.errorMessage.set(extractApiErrorMessage(err, 'Could not change that account\'s role.'));
        }
      });
  }

  demote(account: CleanerAccount): void {
    if (!this.canUpdate()) return;
    if (!confirm(`Move ${account.firstName} ${account.lastName} back to a customer account? They will lose access to the cleaner portal, and any link to a cleaner record is released.`)) return;

    this.demotingUserId.set(account.userId);
    this.clearMessages();

    this.adminService.updateUserRole(account.userId, 'Customer')
      .pipe(finalize(() => this.demotingUserId.set(null)))
      .subscribe({
        next: () => {
          this.accounts.set(this.accounts().filter(a => a.userId !== account.userId));
          this.applyFilters();
          this.flashSuccess(`${account.firstName} is back in the Users tab as a customer.`);
        },
        error: err => {
          this.errorMessage.set(extractApiErrorMessage(err, 'Could not change that account\'s role.'));
        }
      });
  }

  // ── Display helpers ────────────────────────────────────────────────────────────────

  /**
   * The number to show for a row, and where it came from.
   *
   * `phone` is the ACCOUNT's, and it is blank far more often than not: it is optional on the
   * registration form and a Google or Apple sign-in never supplies one, so a cleaner who made her
   * own login has nothing there while her mobile sits on her cleaner record, entered by an admin
   * on the Cleaners Dashboard. Showing only the account's turned that into a row reading "-"
   * directly beside a linked record whose number the same admin had just typed in.
   *
   * The account's own number still WINS when it has one - this tab is about accounts, and the two
   * are allowed to differ (a personal line vs. a work line). The record's is a fallback, marked as
   * such on the row rather than silently merged, so "which of the two is this" stays answerable.
   */
  resolvePhone(account: CleanerAccount): { value: string | null; fromCleanerRecord: boolean } {
    const own = (account.phone || '').trim();
    if (own) return { value: own, fromCleanerRecord: false };

    const record = (account.cleanerPhone || '').trim();
    return record
      ? { value: record, fromCleanerRecord: true }
      : { value: null, fromCleanerRecord: false };
  }

  /** Shared with the Users tab so one person is one colour wherever an admin sees them. */
  getAvatarColor(id: number): string { return getAdminAvatarColor(id); }
  getInitials(first?: string | null, last?: string | null): string {
    return getAdminAvatarInitials(first, last);
  }

  /**
   * A social-login photo URL can 404 (Google rotates them) - drop it so the coloured initials
   * bubble takes over instead of leaving a broken-image glyph in the circle.
   */
  onAvatarError(account: CleanerAccount): void {
    account.profilePictureUrl = null;
  }

  private clearMessages(): void {
    this.errorMessage.set('');
    this.successMessage.set('');
  }

  private flashSuccess(message: string): void {
    this.successMessage.set(message);
    setTimeout(() => this.successMessage.set(''), 6000);
  }

  trackByUserId(_i: number, row: { userId: number }): number {
    return row.userId;
  }

  trackByCleanerId(_i: number, row: { cleanerId: number }): number {
    return row.cleanerId;
  }
}
