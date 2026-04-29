import { Component, OnInit, AfterViewInit, OnDestroy, ViewChild, ElementRef, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AdminService, UserAdmin, UserPermissions, DetailedUser, SuperAdminUpdateUserDto } from '../../../services/admin.service';
import { OrderService, OrderList } from '../../../services/order.service';
import { Apartment, CreateApartment } from '../../../services/profile.service';
import { BubbleRewardsService } from '../../../services/bubble-rewards.service';
import { environment } from '../../../../environments/environment';
import { normalizePhone10, sanitizePhoneInput } from '../../../utils/phone.utils';

@Component({
  selector: 'app-user-management',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './user-management.component.html',
  styleUrls: ['./user-management.component.scss']
})
export class UserManagementComponent implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('tableWrapper', { static: false }) tableWrapper!: ElementRef<HTMLDivElement>;
  @ViewChild('tableHeader', { static: false }) tableHeader!: ElementRef<HTMLTableSectionElement>;
  
  users: UserAdmin[] = [];
  loadingUsers = false;
  userRole: string = '';
  currentUserRole: string = '';
  roleDropdownUserId: number | null = null;
  userPermissions: UserPermissions | null = null;
  canCreate = false;
  canUpdate = false;
  canDelete = false;
  canActivate = false;
  canDeactivate = false;
  searchTerm: string = '';
  statusFilter: string = 'all';
  roleFilter: string = 'all';
  currentPage = 1;
  itemsPerPage = 20;
  totalPages = 1;

  errorMessage = '';
  successMessage = '';

  showRegisterModal = false;
  registerForm = {
    firstName: '',
    lastName: '',
    email: '',
    phone: ''
  };
  isRegistering = false;
  registerModalError = '';

  // Sticky header management
  private scrollListener?: () => void;
  private horizontalScrollListener?: () => void;
  private stickyHeaderInitialized = false;
  private initializationRetries = 0;
  private readonly maxRetries = 20;
  
  get headerStickyOffset(): number {
    if (window.innerWidth <= 768) {
      return 60;
    }
    return 80;
  }

  // NEW: User details functionality
  selectedUser: DetailedUser | null = null;
  viewingUserId: number | null = null;
  loadingUserDetails = false;
  // SuperAdmin full edit
  editingUser = false;
  editUserForm: SuperAdminUpdateUserDto = { firstName: '', lastName: '', email: '', role: 'Customer', isActive: true, firstTimeOrder: true, canReceiveCommunications: true, canReceiveEmails: true, canReceiveMessages: true };
  savingUser = false;
  togglingCommsUserId: number | null = null;
  showCommentForm = false;
  commentFormText = '';
  savingComment = false;
  // Address editing (SuperAdmin)
  editingAddressId: number | null = null;
  showAddAddress = false;
  newAddress: CreateApartment = { name: '', address: '', city: '', state: '', postalCode: '' };
  savingAddress = false;

  // Bubble Rewards (admin view)
  userRewardsSummary: any = null;
  rewardsLoading = false;
  adjustPointsAmount: number = 0;
  adjustPointsDesc: string = '';
  savingPoints = false;
  pointsSaveMessage = '';

  // Referral management (SuperAdmin)
  newReferralEmail = '';
  newReferralSearchResults: { id: number; email: string; name: string }[] = [];
  addingReferral = false;
  referralActionMessage = '';
  removingReferralId: number | null = null;
  removingReferredBy = false;

  constructor(
    private adminService: AdminService,
    private orderService: OrderService,
    private bubbleRewardsService: BubbleRewardsService
  ) {}

  ngOnInit() {
    this.loadUserPermissions();
    this.loadUsers();
  }

  ngAfterViewInit() {
    this.initializeStickyHeader();
  }

  private initializeStickyHeader() {
    if (!this.tableWrapper || !this.tableHeader) {
      if (this.initializationRetries < this.maxRetries) {
        this.initializationRetries++;
        setTimeout(() => {
          this.initializeStickyHeader();
        }, 50);
      }
      return;
    }
    
    if (!this.tableWrapper.nativeElement || !this.tableHeader.nativeElement) {
      if (this.initializationRetries < this.maxRetries) {
        this.initializationRetries++;
        setTimeout(() => {
          this.initializeStickyHeader();
        }, 50);
      }
      return;
    }
    
    this.initializationRetries = 0;
    this.setupStickyHeader();
  }

  ngOnDestroy() {
    if (this.scrollListener) {
      window.removeEventListener('scroll', this.scrollListener, true);
    }
    if (this.horizontalScrollListener && this.tableWrapper) {
      const wrapperEl = this.tableWrapper.nativeElement;
      wrapperEl.removeEventListener('scroll', this.horizontalScrollListener);
      wrapperEl.removeEventListener('touchmove', this.horizontalScrollListener);
      wrapperEl.removeEventListener('wheel', this.horizontalScrollListener);
    }
    this.stickyHeaderInitialized = false;
    this.initializationRetries = 0;
  }

  @HostListener('window:resize')
  onResize() {
    setTimeout(() => {
      this.updateStickyHeader();
    }, 50);
  }

  private setupStickyHeader() {
    if (!this.tableWrapper || !this.tableHeader) {
      return;
    }

    if (this.stickyHeaderInitialized) {
      this.updateStickyHeader();
      return;
    }

    this.scrollListener = () => {
      this.updateStickyHeader();
    };
    window.addEventListener('scroll', this.scrollListener, true);

    // Direct sync for immediate updates on mobile
    this.horizontalScrollListener = () => {
      this.syncHorizontalScroll();
    };
    const wrapperEl = this.tableWrapper.nativeElement;
    wrapperEl.addEventListener('scroll', this.horizontalScrollListener, { passive: true });
    wrapperEl.addEventListener('touchmove', this.horizontalScrollListener, { passive: true });
    wrapperEl.addEventListener('wheel', this.horizontalScrollListener, { passive: true });

    this.stickyHeaderInitialized = true;
    this.updateStickyHeader();
  }

  private updateStickyHeader() {
    if (!this.tableWrapper || !this.tableHeader) {
      return;
    }

    const wrapper = this.tableWrapper.nativeElement;
    const header = this.tableHeader.nativeElement;
    const rect = wrapper.getBoundingClientRect();
    const offset = this.headerStickyOffset;
    
    const shouldBeSticky = rect.top <= offset;
    
    if (shouldBeSticky) {
      const table = header.closest('table') as HTMLTableElement;
      if (!table) return;
      
      const headerCells = header.querySelectorAll('th');
      const firstDataRow = table.querySelector('tbody tr') as HTMLTableRowElement;
      
      // IMPORTANT: Capture widths BEFORE making header sticky to get accurate measurements
      const cellWidths: number[] = [];
      if (firstDataRow) {
        const dataCells = firstDataRow.querySelectorAll('td');
        dataCells.forEach((td: Element, index: number) => {
          const tdElement = td as HTMLElement;
          const cellRect = tdElement.getBoundingClientRect();
          cellWidths[index] = cellRect.width;
        });
      } else {
        headerCells.forEach((th: Element) => {
          const thElement = th as HTMLElement;
          const cellRect = thElement.getBoundingClientRect();
          cellWidths.push(cellRect.width);
        });
      }
      
      // Store wrapper's current left position for horizontal positioning
      const wrapperLeft = rect.left;
      
      // Get the actual table width (not just visible wrapper width)
      const tableRect = table.getBoundingClientRect();
      const tableWidth = tableRect.width;
      
      // Make header sticky
      header.style.position = 'fixed';
      header.style.top = `${offset}px`;
      header.style.left = `${wrapperLeft}px`;
      // Set header width to match the FULL table width, not just visible wrapper width
      header.style.width = `${tableWidth}px`;
      header.style.zIndex = '100';
      header.style.backgroundColor = '#f8f9fa';
      header.style.display = 'table-header-group';
      header.style.tableLayout = 'fixed';
      header.style.overflow = 'hidden';
      
      // Initialize transform to match current scroll position
      const initialScrollLeft = wrapper.scrollLeft;
      header.style.transform = `translate3d(-${initialScrollLeft}px, 0, 0)`;
      header.style.webkitTransform = `translate3d(-${initialScrollLeft}px, 0, 0)`;
      
      const headerRow = header.querySelector('tr') as HTMLTableRowElement;
      if (headerRow) {
        headerRow.style.overflow = 'visible';
        headerRow.style.width = `${tableWidth}px`;
      }
      
      headerCells.forEach((th: Element, index: number) => {
        const thElement = th as HTMLElement;
        if (cellWidths[index] !== undefined) {
          thElement.style.width = `${cellWidths[index]}px`;
          thElement.style.minWidth = `${cellWidths[index]}px`;
          thElement.style.maxWidth = `${cellWidths[index]}px`;
        }
        thElement.style.backgroundColor = '#f8f9fa';
        thElement.style.display = 'table-cell';
        thElement.style.textAlign = 'center';
        thElement.style.overflow = 'hidden';
        thElement.style.textOverflow = 'ellipsis';
      });
      
      // Also preserve widths on data cells to prevent them from changing
      if (firstDataRow) {
        const dataCells = firstDataRow.querySelectorAll('td');
        dataCells.forEach((td: Element, index: number) => {
          const tdElement = td as HTMLElement;
          if (cellWidths[index] !== undefined) {
            tdElement.style.width = `${cellWidths[index]}px`;
            tdElement.style.minWidth = `${cellWidths[index]}px`;
            tdElement.style.maxWidth = `${cellWidths[index]}px`;
          }
        });
      }
      
      // Sync horizontal scroll immediately
      setTimeout(() => {
        this.syncHorizontalScroll();
      }, 0);
    } else {
      header.style.position = '';
      header.style.top = '';
      header.style.left = '';
      header.style.width = '';
      header.style.zIndex = '';
      header.style.transform = '';
      header.style.webkitTransform = '';
      header.style.display = '';
      header.style.tableLayout = '';
      header.style.overflow = '';
      header.style.maxWidth = '';
      header.style.willChange = '';
      
      // Reset header row styles
      const headerRow = header.querySelector('tr') as HTMLTableRowElement;
      if (headerRow) {
        headerRow.style.overflow = '';
        headerRow.style.width = '';
      }
      
      // Reset cell widths and styles on header cells
      const headerCells = header.querySelectorAll('th');
      headerCells.forEach((cell: Element) => {
        const cellElement = cell as HTMLElement;
        cellElement.style.width = '';
        cellElement.style.minWidth = '';
        cellElement.style.maxWidth = '';
        cellElement.style.display = '';
        cellElement.style.overflow = '';
        cellElement.style.textOverflow = '';
      });
      
      // Reset cell widths on data cells
      const table = header.closest('table') as HTMLTableElement;
      if (table) {
        const firstDataRow = table.querySelector('tbody tr') as HTMLTableRowElement;
        if (firstDataRow) {
          const dataCells = firstDataRow.querySelectorAll('td');
          dataCells.forEach((td: Element) => {
            const tdElement = td as HTMLElement;
            tdElement.style.width = '';
            tdElement.style.minWidth = '';
            tdElement.style.maxWidth = '';
          });
        }
      }
    }
  }

  private syncHorizontalScroll() {
    if (!this.tableWrapper || !this.tableHeader) {
      return;
    }

    const wrapper = this.tableWrapper.nativeElement;
    const header = this.tableHeader.nativeElement;
    
    // Sync horizontal scroll position by translating the header
    // Only sync if header is currently fixed/sticky
    if (header.style.position === 'fixed') {
      // Get the scroll position
      const scrollLeft = wrapper.scrollLeft;
      
      // Get current wrapper position to ensure left is correct
      const wrapperRect = wrapper.getBoundingClientRect();
      const wrapperLeft = wrapperRect.left;
      
      // Update left position to match wrapper's current position
      header.style.left = `${wrapperLeft}px`;
      
      // Translate header horizontally to match the wrapper's scroll position
      // Use translate3d for better performance and to force GPU acceleration
      header.style.transform = `translate3d(-${scrollLeft}px, 0, 0)`;
      header.style.webkitTransform = `translate3d(-${scrollLeft}px, 0, 0)`;
      
      // Use will-change for better performance on mobile
      header.style.willChange = 'transform';
    }
  }

  loadUserPermissions() {
    this.adminService.getUserPermissions().subscribe({
      next: (permissions) => {
        this.userPermissions = permissions;
        this.userRole = permissions.role;
        this.currentUserRole = permissions.role;
        
        this.canCreate = permissions.permissions.canCreate;
        this.canUpdate = permissions.permissions.canUpdate;
        this.canDelete = permissions.permissions.canDelete;
        this.canActivate = permissions.permissions.canActivate;
        this.canDeactivate = permissions.permissions.canDeactivate;
      },
      error: (error) => {
        console.error('Failed to load permissions', error);
        this.userRole = '';
        this.canCreate = false;
        this.canUpdate = false;
        this.canDelete = false;
        this.canActivate = false;
        this.canDeactivate = false;
      }
    });
  }

  loadUsers() {
    if (this.loadingUsers) return;

    this.loadingUsers = true;
    this.errorMessage = '';
    this.successMessage = '';

    // Keep current filters, but reset pagination + close any open detail panel
    this.currentPage = 1;
    this.roleDropdownUserId = null;
    this.viewingUserId = null;
    this.selectedUser = null;
    this.editingUser = false;

    this.adminService.getUsers(true).subscribe({
      next: (response) => {
        this.users = Array.isArray(response) ? response : response.users;
      },
      error: (error) => {
        console.error('Failed to load users', error);
        this.errorMessage = error?.error?.message || 'Failed to load users. Please try again.';
      },
      complete: () => {
        this.loadingUsers = false;
        setTimeout(() => {
          if (!this.stickyHeaderInitialized) {
            this.initializeStickyHeader();
          } else {
            this.updateStickyHeader();
          }
        }, 150);
      }
    });
  }

  // NEW: View user details functionality
  viewUserDetails(userId: number) {
    // Toggle behavior: if clicking the same user, close the details
    if (this.viewingUserId === userId) {
      this.viewingUserId = null;
      this.selectedUser = null;
      this.editingUser = false;
      this.userRewardsSummary = null;
      return;
    }
    
    this.viewingUserId = userId;
    this.roleDropdownUserId = null;
    this.editingUser = false;
    this.loadingUserDetails = true;
    this.selectedUser = null;
    
    // Find the basic user info from the current users list
    const basicUser = this.users.find(u => u.id === userId);
    if (!basicUser) {
      this.errorMessage = 'User not found';
      this.loadingUserDetails = false;
      return;
    }

    // Create detailed user object starting with basic info
    this.selectedUser = { ...basicUser };
    
    // Load additional user details concurrently
    this.loadUserOrders(userId);
    this.loadUserApartments(userId);
    this.loadUserRewards(userId);
  }

  private loadUserOrders(userId: number) {
    this.adminService.getUserOrders(userId).subscribe({
      next: (orders: OrderList[]) => {
        if (this.selectedUser) {
          // Filter out cancelled orders for statistics calculation
          const validOrders = orders.filter(order => 
            order.status && order.status.toLowerCase() !== 'cancelled'
          );
          
          this.selectedUser.orders = orders; // Keep all orders for display
          this.selectedUser.totalOrders = validOrders.length; // Only count non-cancelled orders
          this.selectedUser.totalSpent = validOrders.reduce((sum, order) => sum + (order.total || 0), 0);
          this.selectedUser.registrationDate = new Date(this.selectedUser.createdAt);
          
          // Find the most recent order date from valid orders
          if (validOrders.length > 0) {
            const sortedOrders = validOrders.sort((a, b) => 
              new Date(b.orderDate).getTime() - new Date(a.orderDate).getTime()
            );
            this.selectedUser.lastOrderDate = new Date(sortedOrders[0].orderDate);
          }
        }
        this.loadingUserDetails = false;
      },
      error: (error) => {
        console.error('Failed to load user orders', error);
        if (this.selectedUser) {
          this.selectedUser.orders = [];
          this.selectedUser.totalOrders = 0;
          this.selectedUser.totalSpent = 0;
        }
        this.loadingUserDetails = false;
      }
    });
  }

  private loadUserApartments(userId: number) {
    this.adminService.getUserApartments(userId).subscribe({
      next: (apartments: Apartment[]) => {
        if (this.selectedUser) {
          this.selectedUser.apartments = apartments;
        }
      },
      error: (error) => {
        console.error('Failed to load user apartments', error);
        if (this.selectedUser) {
          this.selectedUser.apartments = [];
        }
      }
    });
  }

  // ORIGINAL: Your existing methods preserved exactly as they were
  toggleRoleDropdown(userId: number) {
    this.roleDropdownUserId = this.roleDropdownUserId === userId ? null : userId;
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent) {
    const target = event.target as HTMLElement;
    if (!target.closest('.role-dropdown')) {
      this.roleDropdownUserId = null;
    }
  }

  canChangeUserRole(user: UserAdmin, newRole: string): boolean {
    // Don't allow changing your own role
    const currentUserId = this.getCurrentUserId();
    if (user.id === currentUserId) {
      return false;
    }
  
    // Existing logic
    if (this.currentUserRole === 'SuperAdmin') return true;
    if (this.currentUserRole === 'Admin' && user.role !== 'SuperAdmin') return true;
    return false;
  }

  canModifyUserRole(user: any): boolean {
    const currentUserId = this.getCurrentUserId();
    if (user.id === currentUserId) {
      return false; // Can't modify your own role
    }
    
    // Admins cannot modify SuperAdmin roles
    if (this.currentUserRole === 'Admin' && user.role === 'SuperAdmin') {
      return false;
    }
    
    return this.canUpdate;
  }

  getRoleButtonTooltip(user: any): string {
    const currentUserId = this.getCurrentUserId();
    if (user.id === currentUserId) {
      return "You cannot change your own role";
    }
    if (this.currentUserRole === 'Admin' && user.role === 'SuperAdmin') {
      return "Admins cannot modify SuperAdmin roles";
    }
    return "";
  }

  updateUserRole(user: UserAdmin, newRole: string) {
    if (!this.canChangeUserRole(user, newRole)) {
      return;
    }

    // Clear previous messages
    this.errorMessage = '';
    this.successMessage = '';

    // Show loading state (optional)
    const originalRole = user.role;
    user.role = newRole; // Optimistic update

    this.adminService.updateUserRole(user.id, newRole).subscribe({
      next: () => {
        this.roleDropdownUserId = null;
        // Also update selectedUser if it's the same user
        if (this.selectedUser && this.selectedUser.id === user.id) {
          this.selectedUser.role = newRole;
        }
        this.successMessage = `User ${user.firstName} ${user.lastName}'s role has been updated to ${newRole}. The user has been notified and their interface will update automatically.`;
        
        // Clear success message after 5 seconds
        setTimeout(() => {
          this.successMessage = '';
        }, 5000);
      },
      error: (error) => {
        // Revert optimistic update
        user.role = originalRole;
        
        // Show user-friendly error message
        if (error.error?.message) {
          this.errorMessage = error.error.message;
        } else {
          this.errorMessage = 'Failed to update user role. Please try again.';
        }
        
        // Clear error message after 5 seconds
        setTimeout(() => {
          this.errorMessage = '';
        }, 5000);
      }
    });
  }

  updateUserStatus(user: UserAdmin, isActive: boolean) {
    // Clear previous messages
    this.errorMessage = '';
    this.successMessage = '';

    // Show loading state (optional)
    const originalStatus = user.isActive;
    user.isActive = isActive; // Optimistic update

    this.adminService.updateUserStatus(user.id, isActive).subscribe({
      next: () => {
        const action = isActive ? 'unblocked' : 'blocked';
        // Also update selectedUser if it's the same user
        if (this.selectedUser && this.selectedUser.id === user.id) {
          this.selectedUser.isActive = isActive;
        }
        this.successMessage = `User ${user.firstName} ${user.lastName} has been ${action} successfully.`;
        
        // If blocking, show additional info about real-time notification
        if (!isActive) {
          this.successMessage += ' The user has been notified and will be logged out automatically.';
        }
        
        // Clear success message after 5 seconds
        setTimeout(() => {
          this.successMessage = '';
        }, 5000);
      },
      error: (error) => {
        // Revert optimistic update
        user.isActive = originalStatus;
        
        // Show user-friendly error message
        if (error.error?.message) {
          this.errorMessage = error.error.message;
        } else {
          this.errorMessage = 'Failed to update user status. Please try again.';
        }
        
        // Clear error message after 5 seconds
        setTimeout(() => {
          this.errorMessage = '';
        }, 5000);
      }
    });
  }

  canModifyUserStatus(user: any): boolean {
    // Admins cannot modify SuperAdmin status
    if (this.currentUserRole === 'Admin' && user.role === 'SuperAdmin') {
      return false;
    }
    return true;
  }

  canBanUser(user: any): boolean {
    // Don't allow banning yourself
    const currentUserId = this.getCurrentUserId();
    if (user.id === currentUserId) {
      return false;
    }
    
    return this.canDeactivate && user.isActive && this.canModifyUserStatus(user);
  }
  
  canUnbanUser(user: any): boolean {
    // Don't allow unbanning yourself (though this might be allowed)
    return this.canActivate && !user.isActive && this.canModifyUserStatus(user);
  }

  private getCurrentUserId(): number {
    // For cookie auth, we can't access tokens from localStorage
    // The user ID should be available from the auth service
    if (environment.useCookieAuth) {
      // Return a default or get from auth service
      return 0; // You might want to get this from auth service instead
    }

    // For localStorage auth, decode from token
    const token = localStorage.getItem('token');
    if (token) {
      try {
        // Validate token format before decoding
        const tokenParts = token.split('.');
        if (tokenParts.length !== 3) {
          console.warn('Invalid JWT token format');
          return 0;
        }
        
        const payload = JSON.parse(atob(tokenParts[1]));
        return parseInt(payload.UserId || payload.sub);
      } catch (e) {
        console.warn('Error decoding token:', e);
        return 0;
      }
    }
    return 0;
  }

  // Add this method to show online status
  getUserOnlineStatus(userId: number): void {
    this.adminService.getUserOnlineStatus(userId).subscribe({
      next: (response) => {
        // You can update the UI to show online/offline status
      },
      error: (error) => {
        console.error('Failed to get user online status:', error);
      }
    });
  }

  get filteredUsers(): UserAdmin[] {
    let filtered = this.users;
    // Search filter (by id or email)
    if (this.searchTerm) {
      const search = this.searchTerm.toLowerCase();
      filtered = filtered.filter(user =>
        user.id.toString().includes(search) ||
        (user.email && user.email.toLowerCase().includes(search))
      );
    }
    // Status filter
    if (this.statusFilter !== 'all') {
      filtered = filtered.filter(user =>
        (this.statusFilter === 'active' && user.isActive) ||
        (this.statusFilter === 'inactive' && !user.isActive)
      );
    }
    // Role filter
    if (this.roleFilter !== 'all') {
      filtered = filtered.filter(user => user.role && user.role.toLowerCase() === this.roleFilter.toLowerCase());
    }
    // Sort by createdAt descending (newest first)
    filtered = filtered.sort((a, b) => {
      const dateA = new Date(a.createdAt).getTime();
      const dateB = new Date(b.createdAt).getTime();
      return dateB - dateA; // Descending order (newest first)
    });
    // Pagination
    this.totalPages = Math.ceil(filtered.length / this.itemsPerPage);
    const start = (this.currentPage - 1) * this.itemsPerPage;
    return filtered.slice(start, start + this.itemsPerPage);
  }

  previousPage() {
    if (this.currentPage > 1) {
      this.currentPage--;
    }
  }

  nextPage() {
    if (this.currentPage < this.totalPages) {
      this.currentPage++;
    }
  }

  goToPage(page: number) {
    if (page >= 1 && page <= this.totalPages) {
      this.currentPage = page;
    }
  }

  // NEW: Helper methods for user details
  formatDate(date: any): string {
    if (!date) return 'N/A';
    return new Date(date).toLocaleDateString();
  }

  formatCurrency(amount: number): string {
    return `$${amount.toFixed(2)}`;
  }

  getStatusClass(status: string): string {
    switch (status.toLowerCase()) {
      case 'active': return 'status-active';
      case 'done': return 'status-done';
      case 'cancelled': return 'status-cancelled';
      default: return 'status-pending';
    }
  }

  get isSuperAdmin(): boolean {
    return this.currentUserRole === 'SuperAdmin';
  }

  loadUserRewards(userId: number): void {
    this.rewardsLoading = true;
    this.userRewardsSummary = null;
    this.adjustPointsDesc = '';
    this.newReferralEmail = '';
    this.newReferralSearchResults = [];
    this.referralActionMessage = '';
    this.bubbleRewardsService.getAdminUserSummary(userId).subscribe({
      next: (s) => {
        this.userRewardsSummary = s;
        this.adjustPointsAmount = s.currentPoints ?? 0;
        this.rewardsLoading = false;
      },
      error: () => { this.rewardsLoading = false; }
    });
  }

  getTierLabel(tier: string): string {
    if (tier === 'UltraBubble') return 'Ultra Bubble';
    if (tier === 'SuperBubble') return 'Super Bubble';
    return 'Bubble';
  }

  savePointsAdjustment(): void {
    if (!this.selectedUser || !this.isSuperAdmin || this.savingPoints) return;
    const newTotal = Number(this.adjustPointsAmount);
    if (isNaN(newTotal) || newTotal < 0) return;
    const currentPoints = this.userRewardsSummary?.currentPoints ?? 0;
    const delta = newTotal - currentPoints;
    if (delta === 0) return;
    this.savingPoints = true;
    this.bubbleRewardsService.adjustUserPoints(
      this.selectedUser.id,
      delta,
      this.adjustPointsDesc || 'Admin adjustment'
    ).subscribe({
      next: () => {
        this.savingPoints = false;
        this.adjustPointsDesc = '';
        this.pointsSaveMessage = `Points set to ${newTotal.toLocaleString()}.`;
        this.loadUserRewards(this.selectedUser!.id);
        setTimeout(() => this.pointsSaveMessage = '', 3000);
      },
      error: () => { this.savingPoints = false; }
    });
  }

  searchReferrals(query: string): void {
    if (!this.selectedUser || query.length < 2) { this.newReferralSearchResults = []; return; }
    this.bubbleRewardsService.searchEligibleReferrals(this.selectedUser.id, query).subscribe({
      next: (r) => this.newReferralSearchResults = r,
      error: () => this.newReferralSearchResults = []
    });
  }

  selectReferralSuggestion(email: string): void {
    this.newReferralEmail = email;
    this.newReferralSearchResults = [];
  }

  addReferredUser(): void {
    if (!this.selectedUser || !this.isSuperAdmin || this.addingReferral || !this.newReferralEmail.trim()) return;
    this.addingReferral = true;
    this.referralActionMessage = '';
    this.bubbleRewardsService.addReferredUser(this.selectedUser.id, this.newReferralEmail.trim()).subscribe({
      next: () => {
        this.addingReferral = false;
        this.newReferralEmail = '';
        this.newReferralSearchResults = [];
        this.referralActionMessage = 'Referred user added.';
        this.loadUserRewards(this.selectedUser!.id);
        setTimeout(() => this.referralActionMessage = '', 3000);
      },
      error: (err) => {
        this.addingReferral = false;
        this.referralActionMessage = err?.error?.message ?? 'Failed to add referred user.';
        setTimeout(() => this.referralActionMessage = '', 4000);
      }
    });
  }

  removeReferredUser(referralId: number): void {
    if (!this.selectedUser || !this.isSuperAdmin || this.removingReferralId != null) return;
    this.removingReferralId = referralId;
    this.referralActionMessage = '';
    this.bubbleRewardsService.removeReferredUser(this.selectedUser.id, referralId).subscribe({
      next: () => {
        this.removingReferralId = null;
        this.loadUserRewards(this.selectedUser!.id);
      },
      error: (err) => {
        this.removingReferralId = null;
        this.referralActionMessage = err?.error?.message ?? 'Failed to remove.';
        setTimeout(() => this.referralActionMessage = '', 4000);
      }
    });
  }

  removeReferredBy(): void {
    if (!this.selectedUser || !this.isSuperAdmin || this.removingReferredBy) return;
    this.removingReferredBy = true;
    this.referralActionMessage = '';
    this.bubbleRewardsService.removeReferredBy(this.selectedUser.id).subscribe({
      next: () => {
        this.removingReferredBy = false;
        this.loadUserRewards(this.selectedUser!.id);
      },
      error: (err) => {
        this.removingReferredBy = false;
        this.referralActionMessage = err?.error?.message ?? 'Failed to remove.';
        setTimeout(() => this.referralActionMessage = '', 4000);
      }
    });
  }

  openOrderInAdmin(orderId: number): void {
    window.open('/admin?orderId=' + orderId, '_blank');
  }

  onEditPhoneInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    const cleaned = sanitizePhoneInput(input.value);
    if (input.value !== cleaned) {
      input.value = cleaned;
    }
    this.editUserForm.phone = cleaned || null;
  }

  onRegisterPhoneInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    const cleaned = sanitizePhoneInput(input.value);
    if (input.value !== cleaned) {
      input.value = cleaned;
    }
    this.registerForm.phone = cleaned;
  }

  startEditUser(): void {
    if (!this.selectedUser || !this.isSuperAdmin) return;
    this.editUserForm = {
      firstName: this.selectedUser.firstName,
      lastName: this.selectedUser.lastName,
      email: this.selectedUser.email,
      phone: normalizePhone10(this.selectedUser.phone),
      role: this.selectedUser.role,
      isActive: this.selectedUser.isActive,
      firstTimeOrder: this.selectedUser.firstTimeOrder,
      canReceiveCommunications: this.selectedUser.canReceiveCommunications !== false,
      canReceiveEmails: this.userCanReceiveEmails(this.selectedUser),
      canReceiveMessages: this.userCanReceiveMessages(this.selectedUser)
    };
    this.editingUser = true;
  }

  cancelEditUser(): void {
    this.editingUser = false;
    this.editingAddressId = null;
    this.showAddAddress = false;
    this.newAddress = { name: '', address: '', city: '', state: '', postalCode: '' };
  }

  saveUserEdit(): void {
    if (!this.selectedUser || !this.isSuperAdmin || this.savingUser) return;
    this.editUserForm.phone = normalizePhone10(this.editUserForm.phone);
    this.savingUser = true;
    this.errorMessage = '';
    this.successMessage = '';
    this.adminService.superAdminFullUpdateUser(this.selectedUser.id, this.editUserForm).subscribe({
      next: () => {
        this.successMessage = 'User updated successfully. All changes are recorded in Audit logs.';
        this.editingUser = false;
        
        // Update selectedUser immediately
        Object.assign(this.selectedUser!, this.editUserForm);
        
        // Update the user in the users list immediately
        const userIndex = this.users.findIndex(user => user.id === this.selectedUser!.id);
        if (userIndex !== -1) {
          const updatedUser = this.users[userIndex];
          updatedUser.firstName = this.editUserForm.firstName;
          updatedUser.lastName = this.editUserForm.lastName;
          updatedUser.email = this.editUserForm.email;
          updatedUser.phone = this.editUserForm.phone ?? updatedUser.phone;
          updatedUser.role = this.editUserForm.role;
          updatedUser.isActive = this.editUserForm.isActive;
          updatedUser.firstTimeOrder = this.editUserForm.firstTimeOrder;
          updatedUser.canReceiveCommunications = this.editUserForm.canReceiveCommunications;
          updatedUser.canReceiveEmails = this.editUserForm.canReceiveEmails;
          updatedUser.canReceiveMessages = this.editUserForm.canReceiveMessages;
        }
        
        // Optionally reload from server to ensure consistency (but UI is already updated)
        this.loadUsers();
        setTimeout(() => { this.successMessage = ''; }, 5000);
      },
      error: (err) => {
        this.errorMessage = err.error?.message || 'Failed to update user.';
        setTimeout(() => { this.errorMessage = ''; }, 5000);
      },
      complete: () => { this.savingUser = false; }
    });
  }

  deleteUser(user: UserAdmin, event?: Event): void {
    if (event) (event as Event).stopPropagation();
    if (!this.isSuperAdmin) return;
    if (!confirm(`Permanently delete ${user.firstName} ${user.lastName} (${user.email})? This cannot be undone.`)) return;
    this.errorMessage = '';
    this.successMessage = '';
    this.adminService.deleteUser(user.id).subscribe({
      next: () => {
        this.successMessage = 'User deleted successfully.';
        this.viewingUserId = null;
        this.selectedUser = null;
        this.loadUsers();
        setTimeout(() => { this.successMessage = ''; }, 5000);
      },
      error: (err) => {
        this.errorMessage = err.error?.message || 'Failed to delete user.';
        setTimeout(() => { this.errorMessage = ''; }, 5000);
      }
    });
  }

  // --- Address (apartment) editing (SuperAdmin) ---
  startEditAddress(apartment: Apartment): void {
    this.editingAddressId = apartment.id;
    this.showAddAddress = false;
  }

  cancelEditAddress(): void {
    this.editingAddressId = null;
  }

  saveEditAddress(apartment: Apartment): void {
    if (!this.selectedUser || this.savingAddress) return;
    this.savingAddress = true;
    this.errorMessage = '';
    this.adminService.updateUserApartment(this.selectedUser.id, apartment.id, { ...apartment }).subscribe({
      next: (updated) => {
        const idx = this.selectedUser!.apartments?.findIndex(a => a.id === apartment.id) ?? -1;
        if (idx !== -1 && this.selectedUser!.apartments)
          this.selectedUser!.apartments[idx] = updated;
        this.editingAddressId = null;
        this.successMessage = 'Address updated.';
        setTimeout(() => { this.successMessage = ''; }, 3000);
      },
      error: (err) => {
        this.errorMessage = err.error?.message || 'Failed to update address.';
        setTimeout(() => { this.errorMessage = ''; }, 5000);
      },
      complete: () => { this.savingAddress = false; }
    });
  }

  openAddAddress(): void {
    this.showAddAddress = true;
    this.newAddress = { name: '', address: '', city: '', state: '', postalCode: '' };
    this.editingAddressId = null;
  }

  cancelAddAddress(): void {
    this.showAddAddress = false;
    this.newAddress = { name: '', address: '', city: '', state: '', postalCode: '' };
  }

  addNewAddress(): void {
    if (!this.selectedUser || this.savingAddress) return;
    if (!this.newAddress.name?.trim() || !this.newAddress.address?.trim() || !this.newAddress.city?.trim() ||
        !this.newAddress.state?.trim() || !this.newAddress.postalCode?.trim()) {
      this.errorMessage = 'Name, address, city, state and postal code are required.';
      setTimeout(() => { this.errorMessage = ''; }, 5000);
      return;
    }
    this.savingAddress = true;
    this.errorMessage = '';
    this.adminService.addUserApartment(this.selectedUser.id, this.newAddress).subscribe({
      next: (created) => {
        if (!this.selectedUser!.apartments) this.selectedUser!.apartments = [];
        this.selectedUser!.apartments.push(created);
        this.showAddAddress = false;
        this.newAddress = { name: '', address: '', city: '', state: '', postalCode: '' };
        this.successMessage = 'Address added.';
        setTimeout(() => { this.successMessage = ''; }, 3000);
      },
      error: (err) => {
        this.errorMessage = err.error?.message || 'Failed to add address.';
        setTimeout(() => { this.errorMessage = ''; }, 5000);
      },
      complete: () => { this.savingAddress = false; }
    });
  }

  deleteAddress(apartment: Apartment, event?: Event): void {
    if (event) event.stopPropagation();
    if (!this.selectedUser || this.savingAddress) return;
    if (!confirm(`Delete address "${apartment.name}"?`)) return;
    this.savingAddress = true;
    this.errorMessage = '';
    this.adminService.deleteUserApartment(this.selectedUser.id, apartment.id).subscribe({
      next: () => {
        if (this.selectedUser!.apartments)
          this.selectedUser!.apartments = this.selectedUser!.apartments.filter(a => a.id !== apartment.id);
        if (this.editingAddressId === apartment.id) this.editingAddressId = null;
        this.successMessage = 'Address deleted.';
        setTimeout(() => { this.successMessage = ''; }, 3000);
      },
      error: (err) => {
        this.errorMessage = err.error?.message || 'Failed to delete address.';
        setTimeout(() => { this.errorMessage = ''; }, 5000);
      },
      complete: () => { this.savingAddress = false; }
    });
  }

  /** Display value for emails preference (fallback to canReceiveCommunications if backend omits new fields). */
  userCanReceiveEmails(user: { canReceiveEmails?: boolean; canReceiveCommunications?: boolean }): boolean {
    return user.canReceiveEmails ?? user.canReceiveCommunications !== false;
  }

  /** Display value for messages preference (fallback to canReceiveCommunications if backend omits new fields). */
  userCanReceiveMessages(user: { canReceiveMessages?: boolean; canReceiveCommunications?: boolean }): boolean {
    return user.canReceiveMessages ?? user.canReceiveCommunications !== false;
  }

  toggleUserEmailsPreference(user: UserAdmin, newValue: boolean, event?: Event): void {
    if (event) (event as Event).stopPropagation();
    if (!this.canUpdate) return;
    this.togglingCommsUserId = user.id;
    this.errorMessage = '';
    this.adminService.updateUserCommunicationPreference(user.id, 'emails', newValue).subscribe({
      next: () => {
        user.canReceiveEmails = newValue;
        if (this.selectedUser && this.selectedUser.id === user.id) this.selectedUser.canReceiveEmails = newValue;
        this.successMessage = newValue ? 'User will receive emails.' : 'User will not receive emails.';
        setTimeout(() => { this.successMessage = ''; }, 3000);
      },
      error: (err) => {
        this.errorMessage = err.error?.message || 'Failed to update email preference.';
        setTimeout(() => { this.errorMessage = ''; }, 3000);
      },
      complete: () => { this.togglingCommsUserId = null; }
    });
  }

  toggleUserMessagesPreference(user: UserAdmin, newValue: boolean, event?: Event): void {
    if (event) (event as Event).stopPropagation();
    if (!this.canUpdate) return;
    this.togglingCommsUserId = user.id;
    this.errorMessage = '';
    this.adminService.updateUserCommunicationPreference(user.id, 'messages', newValue).subscribe({
      next: () => {
        user.canReceiveMessages = newValue;
        if (this.selectedUser && this.selectedUser.id === user.id) this.selectedUser.canReceiveMessages = newValue;
        this.successMessage = newValue ? 'User will receive messages.' : 'User will not receive messages.';
        setTimeout(() => { this.successMessage = ''; }, 3000);
      },
      error: (err) => {
        this.errorMessage = err.error?.message || 'Failed to update messages preference.';
        setTimeout(() => { this.errorMessage = ''; }, 3000);
      },
      complete: () => { this.togglingCommsUserId = null; }
    });
  }

  openCommentForm(): void {
    this.commentFormText = this.selectedUser?.adminNotes ?? '';
    this.showCommentForm = true;
  }

  cancelCommentForm(): void {
    this.showCommentForm = false;
  }

  saveComment(): void {
    if (!this.selectedUser || this.savingComment) return;
    this.savingComment = true;
    const newNotes = this.commentFormText.trim() || null;
    this.adminService.updateUserAdminNotes(this.selectedUser.id, newNotes).subscribe({
      next: (res) => {
        this.selectedUser!.adminNotes = res.adminNotes ?? newNotes;
        const u = this.users.find(x => x.id === this.selectedUser!.id);
        if (u) u.adminNotes = this.selectedUser!.adminNotes;
        this.showCommentForm = false;
        this.successMessage = res.message || 'Comment saved.';
        setTimeout(() => { this.successMessage = ''; }, 3000);
      },
      error: (err) => {
        this.errorMessage = err.error?.message || 'Failed to save comment.';
        setTimeout(() => { this.errorMessage = ''; }, 3000);
      },
      complete: () => { this.savingComment = false; }
    });
  }

  openRegisterModal(): void {
    this.registerForm = { firstName: '', lastName: '', email: '', phone: '' };
    this.registerModalError = '';
    this.showRegisterModal = true;
  }

  closeRegisterModal(): void {
    this.showRegisterModal = false;
    this.registerModalError = '';
  }

  registerUser(): void {
    const f = this.registerForm;
    if (!f.firstName?.trim() || !f.lastName?.trim() || !f.email?.trim()) {
      this.registerModalError = 'First name, last name, and email are required.';
      return;
    }
    this.registerModalError = '';
    this.isRegistering = true;
    this.adminService.registerUser({
      firstName: f.firstName.trim(),
      lastName: f.lastName.trim(),
      email: f.email.trim(),
      phone: normalizePhone10(f.phone) || undefined
    }).subscribe({
      next: (res: any) => {
        const name = `${res.firstName || this.registerForm.firstName} ${res.lastName || this.registerForm.lastName}`;
        this.successMessage = `User ${name} registered successfully.`;
        this.closeRegisterModal();
        this.loadUsers();
        setTimeout(() => { this.successMessage = ''; }, 5000);
      },
      error: (err) => {
        if (err.status === 409) {
          this.registerModalError = 'A user with this email already exists.';
        } else {
          this.registerModalError = err.error?.message || err.message || 'Registration failed. Please try again.';
        }
      },
      complete: () => { this.isRegistering = false; }
    });
  }

  getVisiblePages(): number[] {
    const pages: number[] = [];
    const maxVisiblePages = 3; // Number of pages to show in the middle

    if (this.totalPages <= 5) {
      // If total pages is 5 or less, show all pages
      for (let i = 2; i < this.totalPages; i++) {
        pages.push(i);
      }
    } else {
      // Calculate the range of pages to show
      let start = Math.max(2, this.currentPage - 1);
      let end = Math.min(this.totalPages - 1, start + maxVisiblePages - 1);

      // Adjust start if we're near the end
      if (end === this.totalPages - 1) {
        start = Math.max(2, end - maxVisiblePages + 1);
      }

      // Add pages to the array
      for (let i = start; i <= end; i++) {
        pages.push(i);
      }
    }

    return pages;
  }

  displayRole(role: string): string {
    return role === 'SuperAdmin' ? 'SAdmin' : role;
  }
}