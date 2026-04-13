import { Component, OnInit, HostListener, ElementRef, Inject, PLATFORM_ID, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { RouterLink, RouterLinkActive, Router, NavigationEnd, NavigationStart } from '@angular/router';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { BubbleBadgeComponent } from './bubble-badge/bubble-badge.component';
import { AuthService } from '../services/auth.service';
import { AuthModalService } from '../services/auth-modal.service';
import { OrderService } from '../services/order.service';
import { StickyCtaService } from '../services/sticky-cta.service';
import { ThemeService } from '../services/theme.service';
import { NewOrderNotificationService } from '../services/new-order-notification.service';
import { TaskService } from '../services/task.service';
import { SignalRService } from '../services/signalr.service';
import { combineLatest, Subject, fromEvent } from 'rxjs';
import { takeUntil, filter, debounceTime } from 'rxjs/operators';
import { environment } from '../../environments/environment';

@Component({
  selector: 'app-header',
  standalone: true,
  imports: [CommonModule, RouterLink, RouterLinkActive, BubbleBadgeComponent],
  templateUrl: './header.component.html',
  styleUrl: './header.component.scss'
})
export class HeaderComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();
  isMenuOpen = false;
  isUserMenuOpen = false;
  isLoginMenuOpen = false;
  isServicesMenuOpen = false;
  isResidentialCleaningSubmenuOpen = false;
  isMoreMenuOpen = false;
  currentUser: any = null;
  userInitials: string = '';
  isAuthInitialized = false;
  isMobile = false;
  showAuthUI = false; // Only show auth UI when we have a definitive answer
  hasUnpaidOrders = false; // Track if user has unpaid orders
  hasUnviewedNewOrders = false; // Track if there are new orders not viewed by admins
  hasPendingPersonalTasks = false; // Track if admin has pending personal tasks
  hasUncheckedDoneTasks = false; // Track if admin has unchecked completed tasks they created
  stickyCtaVisible = false; // When true, hide header mobile call icon (sticky CTA bar is shown)
  nyTime: string = ''; // Live New York time for admins/superadmins
  private nyTimeInterval: any;
  public isBrowser: boolean;

  constructor(
    private authService: AuthService,
    private authModalService: AuthModalService,
    private orderService: OrderService,
    private stickyCtaService: StickyCtaService,
    public themeService: ThemeService,
    private router: Router,
    private elementRef: ElementRef,
    private cdr: ChangeDetectorRef,
    private newOrderNotificationService: NewOrderNotificationService,
    private taskService: TaskService,
    private signalRService: SignalRService,
    @Inject(PLATFORM_ID) private platformId: Object
  ) {
    this.isBrowser = isPlatformBrowser(this.platformId);
  }

  ngOnInit() {
    // Only check screen size in browser environment
    if (this.isBrowser) {
      this.checkScreenSize();
    }
    // Immediately restore user data from cache to prevent flickering on refresh
    if (this.isBrowser && environment.useCookieAuth) {
      this.restoreFromCache();
    }
    // Get initial values from auth service (only if we don't have cached data)
    if (!this.currentUser) {
      const initialUser = this.authService.currentUserValue;
      if (initialUser) {
        this.currentUser = initialUser;
        this.userInitials = `${initialUser.firstName[0]}${initialUser.lastName[0]}`.toUpperCase();
      }
    }
    // Listen for real-time personal task updates
    this.setupTaskSignalR();

    // Subscribe to auth state for updates
    combineLatest([
      this.authService.isInitialized$,
      this.authService.currentUser
    ]).pipe(takeUntil(this.destroy$)).subscribe(([isInitialized, user]) => {
      this.isAuthInitialized = isInitialized;
      // Update user data if changed
      if (user) {
        this.currentUser = user;
        this.userInitials = `${user.firstName[0]}${user.lastName[0]}`.toUpperCase();
        // Cache the minimal user data for next refresh
        if (this.isBrowser) {
          this.cacheUserData(user);
        }
        // Start NY time clock for admins/superadmins
        if (this.isAdminOrSuperAdmin && !this.nyTimeInterval) {
          this.startNyTimeClock();
        } else if (!this.isAdminOrSuperAdmin) {
          this.stopNyTimeClock();
        }
        // Check for unpaid orders when user is logged in
        this.checkUnpaidOrders();
        // Check pending personal tasks and unchecked done tasks for admins
        if (this.isAdminOrSuperAdmin) {
          this.checkPendingPersonalTasks();
          this.checkUncheckedDoneTasks();
        }
      } else if (isInitialized) {
        // Only clear user data if auth service is initialized and user is null
        this.currentUser = null;
        this.userInitials = '';
        this.hasUnpaidOrders = false;
        this.hasPendingPersonalTasks = false;
        this.stopNyTimeClock();
        if (this.isBrowser) {
          this.clearUserCache();
        }
      }
      // Show auth UI after auth is ready; use requestAnimationFrame + short delay so shimmer is visible at least one frame
      if (isInitialized && this.isBrowser) {
        const showNow = () => {
          this.showAuthUI = true;
          this.cdr.detectChanges();
        };
        if (typeof requestAnimationFrame !== 'undefined') {
          requestAnimationFrame(() => {
            setTimeout(showNow, 80);
          });
        } else {
          setTimeout(showNow, 80);
        }
      }
    });

    // Subscribe to new order notifications for admin indicator
    this.newOrderNotificationService.hasUnviewedOrders$
      .pipe(takeUntil(this.destroy$))
      .subscribe(has => {
        this.hasUnviewedNewOrders = has;
        this.cdr.detectChanges();
      });

    // Close user/login dropdown when any navigation starts (e.g. clicking a menu link)
    this.router.events
      .pipe(
        filter(event => event instanceof NavigationStart),
        takeUntil(this.destroy$)
      )
      .subscribe(() => {
        this.isUserMenuOpen = false;
        this.isLoginMenuOpen = false;
      });

    // Listen to router navigation events to refresh unpaid orders check
    if (this.isBrowser) {
      this.router.events
        .pipe(
          filter(event => event instanceof NavigationEnd),
          takeUntil(this.destroy$)
        )
        .subscribe(() => {
          // Refresh unpaid orders check after navigation
          if (this.currentUser) {
            this.checkUnpaidOrders();
            if (this.isAdminOrSuperAdmin) {
              this.checkPendingPersonalTasks();
              this.checkUncheckedDoneTasks();
            }
          }
        });

      // Also refresh when window regains focus (in case user cancels order and stays on same page)
      fromEvent(window, 'focus')
        .pipe(
          debounceTime(500), // Debounce to avoid too many checks
          takeUntil(this.destroy$)
        )
        .subscribe(() => {
          if (this.currentUser) {
            this.checkUnpaidOrders();
          }
        });

      // Listen for custom event when orders are updated (e.g., after cancellation)
      fromEvent(window, 'ordersUpdated')
        .pipe(
          debounceTime(300), // Small delay to ensure backend has processed the cancellation
          takeUntil(this.destroy$)
        )
        .subscribe(() => {
          if (this.currentUser) {
            this.checkUnpaidOrders();
          }
        });
    }

    // Hide header mobile call icon when sticky CTA bar is visible (avoids duplicate call buttons)
    this.stickyCtaService.visible$
      .pipe(takeUntil(this.destroy$))
      .subscribe(visible => {
        this.stickyCtaVisible = visible;
      });
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
    if (this.nyTimeInterval) {
      clearInterval(this.nyTimeInterval);
    }
  }

  get isAdminOrSuperAdmin(): boolean {
    return this.currentUser?.role === 'SuperAdmin' || this.currentUser?.role === 'Admin';
  }

  get isInternalUser(): boolean {
    const role = this.currentUser?.role;
    return role === 'SuperAdmin' || role === 'Admin' || role === 'Moderator' || role === 'Cleaner';
  }

  private startNyTimeClock(): void {
    if (!this.isBrowser) return;
    this.updateNyTime();
    this.nyTimeInterval = setInterval(() => this.updateNyTime(), 1000);
  }

  private stopNyTimeClock(): void {
    if (this.nyTimeInterval) {
      clearInterval(this.nyTimeInterval);
      this.nyTimeInterval = null;
    }
    this.nyTime = '';
  }

  private updateNyTime(): void {
    const now = new Date();
    this.nyTime = now.toLocaleTimeString('en-GB', {
      timeZone: 'America/New_York',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
  }

  private checkUnpaidOrders() {
    if (!this.isBrowser) return;
    
    this.orderService.getUserOrders()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (orders) => {
          // Check if there are any unpaid orders that are not cancelled
          this.hasUnpaidOrders = orders.some(order =>
            (order.status !== 'Cancelled') &&
            (
              !order.isPaid ||
              ((order.pendingUpdateAmount ?? 0) > 0.01)
            )
          );
        },
        error: (error) => {
          // Silently fail - don't show error for unpaid orders check
          console.error('Error checking unpaid orders:', error);
          this.hasUnpaidOrders = false;
        }
      });
  }

  // Public method to refresh unpaid orders check (can be called from other components)
  refreshUnpaidOrdersCheck() {
    this.checkUnpaidOrders();
  }

  private checkPendingPersonalTasks(): void {
    if (!this.isBrowser) return;
    this.taskService.getPendingPersonalTaskCount()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (count) => {
          this.hasPendingPersonalTasks = count > 0;
          this.cdr.detectChanges();
        },
        error: () => {
          this.hasPendingPersonalTasks = false;
          this.hasUncheckedDoneTasks = false;
        }
      });
  }

  private checkUncheckedDoneTasks(): void {
    if (!this.isBrowser) return;
    this.taskService.getUncheckedDoneCount()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (count) => {
          this.hasUncheckedDoneTasks = count > 0;
          this.cdr.detectChanges();
        },
        error: () => {
          this.hasUncheckedDoneTasks = false;
        }
      });
  }

  private setupTaskSignalR(): void {
    if (!this.isBrowser) return;
    this.signalRService.tasksUpdated$.pipe(
      takeUntil(this.destroy$),
      filter(e => e !== null && e.type === 'personal')
    ).subscribe(() => {
      if (this.isAdminOrSuperAdmin) {
        this.checkPendingPersonalTasks();
        this.checkUncheckedDoneTasks();
      }
    });
  }



  private cacheUserData(user: any): void {
    try {
      // Cache only minimal data needed for UI
      const cacheData = {
        user: {
          id: user.id,
          firstName: user.firstName,
          lastName: user.lastName,
          email: user.email,
          role: user.role,
          profilePictureUrl: user.profilePictureUrl
        },
        userInitials: this.userInitials,
        timestamp: Date.now()
      };
      
      localStorage.setItem('headerUserCache', JSON.stringify(cacheData));
    } catch (error) {
      // Ignore cache errors in production
    }
  }

  private restoreFromCache(): void {
    try {
      const cachedData = localStorage.getItem('headerUserCache');
      if (cachedData) {
        const cached = JSON.parse(cachedData);
        const cacheAge = Date.now() - cached.timestamp;
        if (cacheAge < 24 * 60 * 60 * 1000) {
          this.currentUser = cached.user;
          this.userInitials = cached.userInitials;
          this.isAuthInitialized = true;
          // Do NOT set showAuthUI here: let combineLatest set it so the template
          // shows the shimmer placeholder until auth state is confirmed.
        }
      }
    } catch (error) {
      // Ignore cache errors in production
    }
  }

  private clearUserCache(): void {
    this.authService.clearHeaderCache();
  }

  @HostListener('window:resize')
  onResize() {
    if (this.isBrowser) {
      this.checkScreenSize();
    }
  }

  /** True if the device has a touch screen (mobile/tablet). On touch devices we always show mobile UI regardless of width. */
  private isTouchDevice(): boolean {
    return this.isBrowser && (
      'ontouchstart' in window ||
      (navigator.maxTouchPoints != null && navigator.maxTouchPoints > 0)
    );
  }

  checkScreenSize() {
    if (this.isBrowser) {
      const narrowScreen = window.innerWidth <= 768;
      this.isMobile = narrowScreen || this.isTouchDevice();
    }
  }

  // Listen for clicks outside the dropdown
  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent) {
    const targetElement = event.target as HTMLElement;
    const clickedInsideUserMenu = this.elementRef.nativeElement.querySelector('.user-menu')?.contains(targetElement);
    const clickedInsideGuestAuth = this.elementRef.nativeElement.querySelector('.guest-auth-menu')?.contains(targetElement);
    const clickedInsideServices = this.elementRef.nativeElement.querySelector('.has-dropdown.services-dropdown')?.contains(targetElement);
    const clickedInsideMore = this.elementRef.nativeElement.querySelector('.has-dropdown.more-dropdown')?.contains(targetElement);

    if (!clickedInsideUserMenu && this.isUserMenuOpen) {
      this.isUserMenuOpen = false;
    }
    if (!clickedInsideGuestAuth && this.isLoginMenuOpen) {
      this.isLoginMenuOpen = false;
    }
    
    if (!clickedInsideServices && this.isServicesMenuOpen) {
      this.isServicesMenuOpen = false;
      this.isResidentialCleaningSubmenuOpen = false;
    }
    
    if (!clickedInsideMore && this.isMoreMenuOpen) {
      this.isMoreMenuOpen = false;
    }
  }

  // Helper method to determine if we should show login button
  shouldShowLogin(): boolean {
    // Show login button if we have no user
    return !this.currentUser;
  }

  // Helper method to determine if we should show user menu
  shouldShowUserMenu(): boolean {
    // Show user menu if we have a user (from cache or auth service)
    return !!this.currentUser;
  }

  toggleMenu() {
    this.isMenuOpen = !this.isMenuOpen;
    if (this.isBrowser) {
      const navLinks = this.elementRef.nativeElement.querySelector('.nav-links');
      if (navLinks) {
        navLinks.classList.toggle('active');
      }
    }
    // Close other menus when mobile menu is toggled
    if (!this.isMenuOpen) {
      this.isUserMenuOpen = false;
      this.isServicesMenuOpen = false;
      this.isResidentialCleaningSubmenuOpen = false;
      this.isMoreMenuOpen = false;
    }
  }

  closeMobileMenu() {
    this.closeAllMenus();
  }

  closeDropdownMenu() {
    this.isUserMenuOpen = false;
  }

  toggleLoginMenu(event?: Event) {
    if (event) {
      event.stopPropagation();
    }
    this.isLoginMenuOpen = !this.isLoginMenuOpen;
    if (this.isLoginMenuOpen) {
      this.isUserMenuOpen = false;
    }
  }

  closeLoginMenu() {
    this.isLoginMenuOpen = false;
  }

  toggleUserMenu(event?: Event) {
    // If user clicked a link or anything inside the dropdown, only close — never toggle (avoids re-opening)
    if (event?.target) {
      const el = event.target as HTMLElement;
      if (el.closest('a') || el.closest('.dropdown-menu')) {
        this.isUserMenuOpen = false;
        if (event) event.stopPropagation();
        return;
      }
    }
    // Prevent the document click listener from immediately closing the menu
    if (event) {
      event.stopPropagation();
    }
    
    this.isUserMenuOpen = !this.isUserMenuOpen;
    // Close other menus when user menu is opened
    if (this.isUserMenuOpen) {
      this.isLoginMenuOpen = false;
      this.isMenuOpen = false;
      this.isServicesMenuOpen = false;
      this.isResidentialCleaningSubmenuOpen = false;
      this.isMoreMenuOpen = false;
        if (this.isBrowser) {
          const navLinks = this.elementRef.nativeElement.querySelector('.nav-links');
          if (navLinks) {
            navLinks.classList.remove('active');
          }
        }
      }
  }

  // Mobile-friendly services menu handlers (Services and More are mutually exclusive)
  toggleServicesMenu(event?: Event) {
    if (event) {
      event.stopPropagation();
    }
    
    if (this.isMobile) {
      const openingServices = !this.isServicesMenuOpen;
      if (openingServices) {
        this.isMoreMenuOpen = false;
      }
      this.isServicesMenuOpen = !this.isServicesMenuOpen;
      if (!this.isServicesMenuOpen) {
        this.isResidentialCleaningSubmenuOpen = false;
      }
    }
  }

  toggleResidentialCleaningSubmenu(event?: Event) {
    if (event) {
      event.stopPropagation();
    }
    
    if (this.isMobile) {
      this.isResidentialCleaningSubmenuOpen = !this.isResidentialCleaningSubmenuOpen;
    }
  }

  // Handle services link click
  onServicesClick(event: Event) {
    if (this.isMobile) {
      // On mobile, only toggle menu, don't navigate
      event.preventDefault();
      this.toggleServicesMenu(event);
    } else {
      // On desktop, navigate to service page and close menu
      this.closeServicesMenu();
      this.router.navigate(['/service-page']);
    }
  }

  // Handle residential cleaning link click
  onResidentialCleaningClick(event: Event) {
    if (this.isMobile) {
      // On mobile, only toggle submenu, don't navigate
      event.preventDefault();
      this.toggleResidentialCleaningSubmenu(event);
    } else {
      // On desktop, navigate to residential cleaning page and close menu
      this.closeServicesMenu();
      this.router.navigate(['/services/residential-cleaning']);
    }
  }

  // Handle "All Services" link click (mobile only)
  onAllServicesClick(event: Event) {
    if (this.isMobile) {
      // On mobile, navigate to service page and close all menus
      this.closeAllMenus();
    } else {
      // On desktop, prevent navigation and close menu
      event.preventDefault();
      this.closeServicesMenu();
    }
  }

  // Close all menus and mobile menu
  displayRole(role: string): string {
    return role === 'SuperAdmin' ? 'SAdmin' : role;
  }

  closeAllMenus() {
    this.isServicesMenuOpen = false;
    this.isResidentialCleaningSubmenuOpen = false;
    this.isMoreMenuOpen = false;
    this.isUserMenuOpen = false;
    this.isLoginMenuOpen = false;
    this.isMenuOpen = false;
    this.cdr.detectChanges(); // Ensure dropdown hides immediately when a link is clicked
    if (this.isBrowser) {
      const navLinks = this.elementRef.nativeElement.querySelector('.nav-links');
      if (navLinks) {
        navLinks.classList.remove('active');
      }
      // Immediately hide dropdown and prevent hover from reopening
      const hasDropdowns = this.elementRef.nativeElement.querySelectorAll('.has-dropdown');
      const megaDropdowns = this.elementRef.nativeElement.querySelectorAll('.mega-dropdown');
      hasDropdowns.forEach((hasDropdown: Element) => {
        // Add force-close class to prevent hover from showing dropdown
        hasDropdown.classList.add('force-close');
      });
      megaDropdowns.forEach((megaDropdown: Element) => {
        // Immediately hide the dropdown via inline style to override hover
        (megaDropdown as HTMLElement).style.visibility = 'hidden';
        (megaDropdown as HTMLElement).style.maxHeight = '0';
      });
      // Remove the class after navigation completes (enough time for page transition)
      setTimeout(() => {
        hasDropdowns.forEach((hasDropdown: Element) => {
          hasDropdown.classList.remove('force-close');
        });
        megaDropdowns.forEach((megaDropdown: Element) => {
          (megaDropdown as HTMLElement).style.visibility = '';
          (megaDropdown as HTMLElement).style.maxHeight = '';
        });
      }, 500);
    }
  }

  // Desktop hover handlers
  showServicesMenu() {
    if (!this.isMobile) {
      this.isServicesMenuOpen = true;
      this.isMoreMenuOpen = false;
    }
  }

  hideServicesMenu() {
    if (!this.isMobile) {
      this.isServicesMenuOpen = false;
      this.isResidentialCleaningSubmenuOpen = false;
    }
  }

  closeServicesMenu() {
    this.isServicesMenuOpen = false;
    this.isResidentialCleaningSubmenuOpen = false;
  }

  showResidentialCleaningSubmenu() {
    if (!this.isMobile) {
      this.isResidentialCleaningSubmenuOpen = true;
    }
  }

  hideResidentialCleaningSubmenu() {
    if (!this.isMobile) {
      this.isResidentialCleaningSubmenuOpen = false;
    }
  }

  // Desktop hover handlers for More menu
  showMoreMenu() {
    if (!this.isMobile) {
      this.isMoreMenuOpen = true;
      this.isServicesMenuOpen = false;
      this.isResidentialCleaningSubmenuOpen = false;
    }
  }

  hideMoreMenu() {
    if (!this.isMobile) {
      this.isMoreMenuOpen = false;
    }
  }

  closeMoreMenu() {
    this.isMoreMenuOpen = false;
  }

  // Mobile-friendly more menu handler (Services and More are mutually exclusive)
  toggleMoreMenu(event?: Event) {
    if (event) {
      event.stopPropagation();
    }
    
    if (this.isMobile) {
      const openingMore = !this.isMoreMenuOpen;
      if (openingMore) {
        this.isServicesMenuOpen = false;
        this.isResidentialCleaningSubmenuOpen = false;
      }
      this.isMoreMenuOpen = !this.isMoreMenuOpen;
    }
  }

  // Handle more link click
  onMoreClick(event: Event) {
    if (this.isMobile) {
      // On mobile, only toggle menu, don't navigate
      event.preventDefault();
      this.toggleMoreMenu(event);
    } else {
      // On desktop, close menu
      this.closeMoreMenu();
    }
  }

  logout() {
    const currentUrl = this.router.url;
    // Clear the user cache on logout
    this.clearUserCache();
    this.authService.logout();
    if (currentUrl.startsWith('/profile')) {
      this.router.navigate(['/']);
    }
  }

  // Check if current route is a service route (excludes borough pages which belong to More menu)
  isServiceRoute(): boolean {
    const currentUrl = this.router.url;
    if (this.isMoreRoute()) return false;
    return currentUrl === '/service-page' || currentUrl.startsWith('/services/');
  }

  get isDark(): boolean {
    return this.themeService.isDark;
  }

  toggleTheme(): void {
    this.themeService.toggle();
  }

  // Check if current route is a more menu route
  isMoreRoute(): boolean {
    const currentUrl = this.router.url;
    return currentUrl === '/about' || currentUrl === '/contact' || currentUrl === '/faq'
      || currentUrl === '/services/brooklyn-cleaning'
      || currentUrl === '/services/manhattan-cleaning'
      || currentUrl === '/services/queens-cleaning';
  }

  openLoginModal(event?: Event) {
    if (event) {
      event.preventDefault();
    }
    this.authModalService.open('login');
  }

  openRegisterModal(event?: Event) {
    if (event) {
      event.preventDefault();
    }
    this.authModalService.open('register');
  }
}