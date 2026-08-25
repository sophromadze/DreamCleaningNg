import { Component, EventEmitter, Input, OnChanges, OnDestroy, OnInit, Output, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subject, debounceTime, distinctUntilChanged, takeUntil } from 'rxjs';
import { AdminService, UserAdmin } from '../../services/admin.service';

/** Keystroke-to-filter delay. The list must stop moving before the admin reaches for the mouse. */
export const USER_SEARCH_DEBOUNCE_MS = 200;

/** Below this, nothing is rendered. Prevents dumping the whole customer base into the DOM. */
export const USER_SEARCH_MIN_CHARS = 2;

/** Hard cap on rendered rows; the rest are reported as a "refine your search" count. */
export const USER_SEARCH_MAX_RESULTS = 25;

/**
 * A click landing within this many ms of the list actually changing is refused.
 * A row that appeared under the cursor moments ago is by definition not one the admin read.
 */
export const USER_LIST_SETTLE_MS = 350;

/**
 * Admin-mode customer search box (extracted from the booking page).
 * Owns the user list + filtering; the booking page keeps ownership of the
 * selected target user and everything that happens after selection
 * (loading their apartments, subscription, loyalty, ...).
 *
 * ## Why this is more careful than a plain filter (2026-08 incident)
 *
 * An admin typed a partial name, saw the right customer, clicked — and the list changed under
 * the cursor at the exact moment of the click, so the click landed on a different customer's
 * row. The booking was created for the wrong person and nobody noticed.
 *
 * There is no network race to fix here: `GET /api/admin/users` returns the ENTIRE user table
 * once, and filtering is a synchronous in-memory `Array.filter`. The list moved because it was
 * re-rendering thousands of rows on every keystroke, so the painted DOM ran behind the model
 * and a queued render landed between the last paint and the click dispatch.
 *
 * Five defences, in the order they engage:
 *  1. `USER_SEARCH_MIN_CHARS` + `USER_SEARCH_MAX_RESULTS` — the list is never big enough to lag.
 *  2. `USER_SEARCH_DEBOUNCE_MS` — it stops moving while the admin is still typing.
 *  3. `trackByUserId` — matching rows are reused instead of destroyed and rebuilt.
 *  4. `lastListChangedAt` + `USER_LIST_SETTLE_MS` — a click during a change is refused outright.
 *  5. A generation token on `loadUsers()` so a late response can never overwrite a newer one.
 *
 * The booking page adds a sixth: Book Now names the customer in a confirmation dialog.
 */
@Component({
  selector: 'app-admin-user-search',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './admin-user-search.component.html',
  styleUrls: ['./admin-user-search.component.scss']
})
export class AdminUserSearchComponent implements OnInit, OnChanges, OnDestroy {
  /** Currently selected target user (owned by the booking page). */
  @Input() selectedUser: UserAdmin | null = null;

  /**
   * Customers the host created during THIS page session (the header's Register Customer action).
   *
   * They are merged into the list on top of whatever the server returns, and re-merged whenever
   * this array changes, so a just-registered customer is searchable without a page reload. Two
   * reasons the server response alone is not enough:
   *  - this component is inside the admin-mode `*ngIf`, so registering with Admin Mode OFF happens
   *    while it does not exist; it is created later and must still know about the new customer,
   *  - `GET /api/admin/users` is an ordinary cacheable GET.
   * A seeded entry disappears silently the moment the server's own list contains that id.
   */
  @Input() seedUsers: UserAdmin[] = [];

  @Output() userSelected = new EventEmitter<UserAdmin>();
  @Output() cleared = new EventEmitter<void>();

  userSearchTerm = '';

  /** Everything searchable: the server's customers plus any `seedUsers` it doesn't know about yet. */
  availableUsers: UserAdmin[] = [];
  filteredUsers: UserAdmin[] = [];
  isLoadingUsers = false;

  /** The last server response, kept raw so `seedUsers` can be re-merged without a refetch. */
  private serverUsers: UserAdmin[] = [];

  /** Total matches before `USER_SEARCH_MAX_RESULTS` truncation — drives the "refine" footer. */
  totalMatchCount = 0;

  /**
   * `Date.now()` of the last time the RENDERED list actually changed (different users, or a
   * different order). Only real changes stamp it — a debounced re-filter that produces the same
   * rows must not block a click the admin has every right to make.
   */
  lastListChangedAt = 0;

  /** Set when a click was refused by the settle guard; cleared on the next input or selection. */
  clickRejected = false;

  /** Monotonic token: only the newest `loadUsers()` response is allowed to apply. */
  private loadGeneration = 0;

  private searchTerm$ = new Subject<string>();
  private destroy$ = new Subject<void>();

  readonly minSearchChars = USER_SEARCH_MIN_CHARS;
  readonly maxResults = USER_SEARCH_MAX_RESULTS;

  constructor(private adminService: AdminService) {}

  ngOnInit(): void {
    this.searchTerm$
      .pipe(
        debounceTime(USER_SEARCH_DEBOUNCE_MS),
        distinctUntilChanged(),
        takeUntil(this.destroy$)
      )
      .subscribe(() => this.applyFilter());

    this.loadUsers();
  }

  ngOnChanges(changes: SimpleChanges): void {
    // A customer registered from the header arrives here as a new `seedUsers` array. Re-merge
    // against the response we already hold rather than refetching — the host may still be
    // waiting on its own reload, and the admin should not be.
    //
    // Deliberately NOT skipped on the first change: whether the host's first binding counts as
    // "first" depends on how the box was created (a fresh Admin Mode toggle binds a list that is
    // already populated), and merging into an empty server list is a no-op anyway.
    if (changes['seedUsers']) {
      this.rebuildAvailableUsers();
      this.applyFilter();
    }
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  /** With a selected user the input shows their label read-only; otherwise the live search term. */
  get displayTerm(): string {
    if (!this.selectedUser) return this.userSearchTerm;
    const emailLabel = this.selectedUser.isNoEmailUser ? 'No email' : this.selectedUser.email;
    return `${this.selectedUser.firstName} ${this.selectedUser.lastName} (${emailLabel})`;
  }

  /** True while the admin has typed too little for the list to be shown at all. */
  get needsMoreCharacters(): boolean {
    return this.userSearchTerm.trim().length < USER_SEARCH_MIN_CHARS;
  }

  /** How many matches were hidden by the render cap. */
  get hiddenMatchCount(): number {
    return Math.max(0, this.totalMatchCount - this.filteredUsers.length);
  }

  onSearchInput(value: string): void {
    this.userSearchTerm = value;
    this.clickRejected = false;
    // Deliberately NOT filtered synchronously — the debounce is what stops the list moving
    // while the admin is still typing.
    this.searchTerm$.next(value);
  }

  /**
   * @param forceRefresh bypass the HTTP cache. Pass true for any reload triggered by a WRITE
   *   (a customer was just registered): `GET /api/admin/users` is an ordinary cacheable GET, so a
   *   plain refetch can hand back the list from before the POST. The admin Users tab does the same.
   */
  loadUsers(forceRefresh = false): void {
    const generation = ++this.loadGeneration;
    this.isLoadingUsers = true;

    this.adminService.getUsers(forceRefresh)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response: any) => {
          // Stale response from a superseded load — dropping it is the whole point of the token.
          if (generation !== this.loadGeneration) return;

          // Handle both response formats
          if (response && response.users) {
            this.serverUsers = response.users.filter((u: UserAdmin) =>
              u.role === 'Customer' && u.isActive
            );
          } else if (Array.isArray(response)) {
            this.serverUsers = response.filter((u: UserAdmin) =>
              u.role === 'Customer' && u.isActive
            );
          } else {
            this.serverUsers = [];
          }
          this.rebuildAvailableUsers();
          this.applyFilter();
          this.isLoadingUsers = false;
        },
        error: (error) => {
          if (generation !== this.loadGeneration) return;
          console.error('Error loading users:', error);
          this.serverUsers = [];
          // Seeded customers survive a failed load on purpose: they exist, this request just
          // didn't come back, and the admin should still be able to book for them.
          this.rebuildAvailableUsers();
          this.applyFilter();
          this.isLoadingUsers = false;
        }
      });
  }

  /**
   * Rebuild the searchable list from the last server response plus any `seedUsers` that response
   * doesn't already contain.
   *
   * Seeds go FIRST so a just-registered customer is inside `USER_SEARCH_MAX_RESULTS` even when
   * their name is a common one. A seed whose id is already in the server list is dropped, so the
   * canonical row wins as soon as the backend knows about it and nobody is ever shown twice.
   */
  private rebuildAvailableUsers(): void {
    if (!this.seedUsers?.length) {
      this.availableUsers = this.serverUsers;
      return;
    }

    const knownIds = new Set(this.serverUsers.map(user => user.id));
    const pending = this.seedUsers.filter(user => !knownIds.has(user.id));

    this.availableUsers = pending.length ? [...pending, ...this.serverUsers] : this.serverUsers;
  }

  /**
   * Recompute the visible list from `userSearchTerm`. Never call this straight from a keystroke —
   * go through `onSearchInput` so the debounce applies.
   */
  applyFilter(): void {
    const search = this.userSearchTerm.toLowerCase().trim();

    // No more "empty box = render every customer": that unbounded ngFor is what made the list
    // lag behind the keystrokes in the first place.
    if (search.length < USER_SEARCH_MIN_CHARS) {
      this.setFilteredUsers([], 0);
      return;
    }

    const matches = this.availableUsers.filter(user =>
      user.email.toLowerCase().includes(search) ||
      user.firstName.toLowerCase().includes(search) ||
      user.lastName.toLowerCase().includes(search) ||
      user.id.toString().includes(search)
    );

    this.setFilteredUsers(matches.slice(0, USER_SEARCH_MAX_RESULTS), matches.length);
  }

  /**
   * Single writer for `filteredUsers`. Stamps `lastListChangedAt` only when the rendered rows
   * genuinely differ, so an identical re-filter can't lock the admin out of clicking.
   */
  private setFilteredUsers(next: UserAdmin[], totalMatches: number): void {
    const changed =
      next.length !== this.filteredUsers.length ||
      next.some((user, i) => user.id !== this.filteredUsers[i].id);

    this.filteredUsers = next;
    this.totalMatchCount = totalMatches;

    if (changed) {
      this.lastListChangedAt = Date.now();
    }
  }

  trackByUserId(_index: number, user: UserAdmin): number {
    return user.id;
  }

  selectUser(user: UserAdmin): void {
    // The list moved within the settle window, so this row may not be the one the admin was
    // aiming at. Refuse rather than book for whoever happens to be under the cursor.
    if (Date.now() - this.lastListChangedAt < USER_LIST_SETTLE_MS) {
      this.clickRejected = true;
      return;
    }

    this.clickRejected = false;
    this.userSearchTerm = '';
    this.applyFilter();
    this.userSelected.emit(user);
  }

  clearSelectedUser(): void {
    this.clickRejected = false;
    this.userSearchTerm = '';
    this.applyFilter();
    this.cleared.emit();
  }
}
