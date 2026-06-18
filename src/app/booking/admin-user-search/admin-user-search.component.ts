import { Component, EventEmitter, Input, OnInit, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AdminService, UserAdmin } from '../../services/admin.service';

/**
 * Admin-mode customer search box (extracted from the booking page).
 * Owns the user list + filtering; the booking page keeps ownership of the
 * selected target user and everything that happens after selection
 * (loading their apartments, subscription, loyalty, ...).
 */
@Component({
  selector: 'app-admin-user-search',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './admin-user-search.component.html',
  styleUrls: ['./admin-user-search.component.scss']
})
export class AdminUserSearchComponent implements OnInit {
  /** Currently selected target user (owned by the booking page). */
  @Input() selectedUser: UserAdmin | null = null;
  @Output() userSelected = new EventEmitter<UserAdmin>();
  @Output() cleared = new EventEmitter<void>();

  userSearchTerm = '';
  availableUsers: UserAdmin[] = [];
  filteredUsers: UserAdmin[] = [];
  isLoadingUsers = false;

  constructor(private adminService: AdminService) {}

  ngOnInit(): void {
    this.loadUsers();
  }

  /** With a selected user the input shows their label read-only; otherwise the live search term. */
  get displayTerm(): string {
    return this.selectedUser
      ? `${this.selectedUser.firstName} ${this.selectedUser.lastName} (${this.selectedUser.email})`
      : this.userSearchTerm;
  }

  onSearchInput(value: string): void {
    this.userSearchTerm = value;
    this.filterUsers();
  }

  loadUsers(): void {
    this.isLoadingUsers = true;
    this.adminService.getUsers().subscribe({
      next: (response: any) => {
        // Handle both response formats
        if (response && response.users) {
          this.availableUsers = response.users.filter((u: UserAdmin) =>
            u.role === 'Customer' && u.isActive
          );
        } else if (Array.isArray(response)) {
          this.availableUsers = response.filter((u: UserAdmin) =>
            u.role === 'Customer' && u.isActive
          );
        } else {
          this.availableUsers = [];
        }
        this.filterUsers();
        this.isLoadingUsers = false;
      },
      error: (error) => {
        console.error('Error loading users:', error);
        this.availableUsers = [];
        this.isLoadingUsers = false;
      }
    });
  }

  filterUsers(): void {
    if (!this.userSearchTerm.trim()) {
      this.filteredUsers = this.availableUsers; // Show all users
      return;
    }

    const search = this.userSearchTerm.toLowerCase().trim();
    this.filteredUsers = this.availableUsers.filter(user =>
      user.email.toLowerCase().includes(search) ||
      user.firstName.toLowerCase().includes(search) ||
      user.lastName.toLowerCase().includes(search) ||
      user.id.toString().includes(search)
    );
  }

  selectUser(user: UserAdmin): void {
    this.userSearchTerm = '';
    this.userSelected.emit(user);
  }

  clearSelectedUser(): void {
    this.userSearchTerm = '';
    this.filterUsers();
    this.cleared.emit();
  }
}
