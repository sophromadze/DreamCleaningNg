import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { Inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import {
  ProfileService, Profile, Apartment, CreateApartment, PlanOption, PlanOverview
} from '../../services/profile.service';
import { AuthService } from '../../services/auth.service';
import { LocationService } from '../../services/location.service';
import { OrderService, OrderList, Order } from '../../services/order.service';
import { Router } from '@angular/router';
import { SpecialOfferService, UserSpecialOffer } from '../../services/special-offer.service';
import { ShimmerDirective } from '../../shared/directives/shimmer.directive';
import { TrustedDevicesComponent } from '../trusted-devices/trusted-devices.component';
import { BillingTabComponent } from './billing/billing-tab.component';
import { BillingService } from '../../services/billing.service';
import { ActivatedRoute } from '@angular/router';
import { InvoiceService } from '../../services/invoice.service';
import { ContractService } from '../../services/contract.service';
import { FormPersistenceService } from '../../services/form-persistence.service';
import { formatNyDate } from '../../shared/ny-time.util';
import { normalizeTipAmount } from '../../shared/booking/tip-amount.utils';
import { extractApiErrorMessage } from '../../utils/http-error.utils';
import {
  UpcomingRecurringOrdersComponent
} from '../../shared/components/upcoming-recurring-orders/upcoming-recurring-orders.component';
import {
  ReferAFriendComponent
} from '../../shared/components/refer-a-friend/refer-a-friend.component';
import { BubbleRewardsService } from '../../services/bubble-rewards.service';

export type ProfileTab = 'overview' | 'personal' | 'plan' | 'addresses' | 'billing' | 'security';

/**
 * How many cleanings one page of the Overview list holds. The owner's figure (10, 2026-09) —
 * the list is a complete history, and a customer with three years of weekly cleanings would
 * otherwise render a hundred and fifty cards in one go.
 */
export const ORDERS_PER_PAGE = 10;

@Component({
  selector: 'app-profile',
  standalone: true,
  imports: [
    CommonModule, FormsModule, RouterModule, ShimmerDirective,
    TrustedDevicesComponent, BillingTabComponent, UpcomingRecurringOrdersComponent,
    ReferAFriendComponent
  ],
  templateUrl: './profile.component.html',
  styleUrls: ['./profile.component.scss']
})

export class ProfileComponent implements OnInit {
  // ── Tabs (2026-09 redesign) — every section that used to stack on one page, one tab each. ──
  //
  // There is deliberately NO "Orders" tab. The customer's cleanings live on Overview, which is
  // the page they land on, because "where are my cleanings?" is the question that brings almost
  // everybody here — a tab made them ask it twice. /profile/orders is gone with it.
  readonly tabs: { key: ProfileTab; label: string; icon: string }[] = [
    { key: 'overview', label: 'Overview', icon: 'fas fa-home' },
    { key: 'personal', label: 'Personal info', icon: 'fas fa-user' },
    { key: 'plan', label: 'Plan', icon: 'fas fa-calendar-check' },
    { key: 'addresses', label: 'Addresses', icon: 'fas fa-map-marker-alt' },
    { key: 'billing', label: 'Billing', icon: 'fas fa-credit-card' },
    { key: 'security', label: 'Security', icon: 'fas fa-shield-alt' }
  ];
  activeTab: ProfileTab = 'overview';
  /** Unresolved payment problems — the Billing tab's badge and the Overview banner. */
  billingIssueCount = 0;

  profile: Profile | null = null;
  isLoading = true;
  isEditingProfile = false;
  isAddingApartment = false;
  editingApartmentId: number | null = null;
  errorMessage = '';
  successMessage = '';
  updatingComms = false;
  specialOffers: UserSpecialOffer[] | null = null; // null = loading, [] = none, [...] = has offers

  // ── The customer's cleanings, on Overview ────────────────────────────────────────────
  orders: OrderList[] | null = null;   // null = not loaded yet, [] = loaded and empty
  ordersError = '';
  ordersPage = 1;
  readonly ordersPerPage = ORDERS_PER_PAGE;

  // ── "My invoices" / "My contracts" ───────────────────────────────────────────────────
  // Both are business-customer areas. A residential customer has neither, and a link to an
  // empty page reads as something broken, so each one is drawn only once the cheap boolean
  // behind it comes back true. Same two endpoints the header menu uses.
  hasInvoices = false;
  hasContracts = false;

  // ── Refer a Friend (Overview) ────────────────────────────────────────────────────────
  // Empty until `GET api/referral/my-code` answers; the shared card hides itself while so.
  referralCode = '';
  referralShareUrl = '';

  // ── Plan tab ─────────────────────────────────────────────────────────────────────────
  plan: PlanOverview | null = null;
  planLoading = false;
  planError = '';
  planSavingId: number | null | undefined = undefined;  // undefined = idle, null = clearing

  get hasActiveSubscription(): boolean {
    if (!this.profile?.subscriptionId) return false;

    // Backend may return `subscriptionExpiryDate` as string; normalize to Date.
    const rawExpiry = this.profile.subscriptionExpiryDate as any;
    if (!rawExpiry) return true; // If no expiry is provided, assume active.

    const expiryMs = new Date(rawExpiry).getTime();
    if (Number.isNaN(expiryMs)) return true;

    return expiryMs > Date.now();
  }

  /**
   * Email changes are a Local-account feature server-side (`AuthService.InitiateEmailChange`
   * refuses anything else). Reading the provider here is what stops the Security tab offering a
   * Google/Apple customer a form that can only ever end in a refusal — after they have typed a
   * password they do not have.
   */
  get canChangeEmail(): boolean {
    const provider = this.authService.currentUserValue?.authProvider;
    return !provider || provider === 'Local';
  }

  // Profile edit form
  editProfileForm = {
    firstName: '',
    lastName: '',
    email: '',
    phone: ''
  };

  // Location data
  states: string[] = [];
  cities: string[] = [];

  // New apartment form
  newApartment: CreateApartment = {
    name: '',
    address: '',
    aptSuite: '',
    city: '',
    state: '',
    postalCode: '',
    specialInstructions: ''
  };

  // Edit apartment form
  editingApartment: Apartment | null = null;

  constructor(
    private profileService: ProfileService,
    private authService: AuthService,
    private locationService: LocationService,
    private orderService: OrderService,
    private router: Router,
    private specialOfferService: SpecialOfferService,
    @Inject(PLATFORM_ID) private platformId: Object,
    private route: ActivatedRoute,
    private billingService: BillingService,
    private invoiceService: InvoiceService,
    private contractService: ContractService,
    private formPersistenceService: FormPersistenceService,
    private bubbleRewardsService: BubbleRewardsService
  ) {}

  ngOnInit() {
    // ?tab=billing (from a billing email / notice) opens that tab directly; the query param also
    // follows the open tab, so a refresh or a shared link lands in the same place.
    this.route.queryParamMap.subscribe(params => {
      const requested = params.get('tab') as ProfileTab | null;
      if (requested && this.tabs.some(t => t.key === requested)) {
        this.activeTab = requested;
        if (requested === 'plan') this.loadPlan();
      }
    });

    this.loadProfile();
    this.loadLocationData();
    this.loadOrders();
    this.loadSpecialOffers();
    this.loadBillingIssues();
    this.loadCommercialLinks();
    this.loadReferralCode();
  }

  setTab(tab: ProfileTab): void {
    if (this.activeTab === tab) return;
    this.activeTab = tab;
    this.errorMessage = '';
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { tab: tab === 'overview' ? null : tab },
      queryParamsHandling: 'merge',
      replaceUrl: true
    });
    if (tab !== 'billing') this.loadBillingIssues();
    if (tab === 'plan') this.loadPlan();
  }

  /** WAI-ARIA tabs: arrow keys / Home / End move between tabs and focus the new one. */
  onTabKeydown(event: KeyboardEvent): void {
    const keys = ['ArrowRight', 'ArrowLeft', 'Home', 'End'];
    if (!keys.includes(event.key)) return;
    event.preventDefault();
    const index = this.tabs.findIndex(t => t.key === this.activeTab);
    const next = event.key === 'Home' ? 0
      : event.key === 'End' ? this.tabs.length - 1
      : (index + (event.key === 'ArrowRight' ? 1 : -1) + this.tabs.length) % this.tabs.length;
    this.setTab(this.tabs[next].key);
    if (isPlatformBrowser(this.platformId)) {
      setTimeout(() => document.getElementById('profile-tab-' + this.tabs[next].key)?.focus());
    }
  }

  /** Payment problems still open — a small, best-effort read for the badge. */
  private loadBillingIssues(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    this.billingService.savedCardsEnabled().subscribe(enabled => {
      if (!enabled) { this.billingIssueCount = 0; return; }
      this.billingService.getNotifications().subscribe({
        next: (notices) => this.billingIssueCount = notices.filter(n => !n.isResolved && n.severity === 'critical').length,
        error: () => this.billingIssueCount = 0
      });
    });
  }

  /**
   * Whether to draw the invoices / contracts links at all. Best-effort on purpose: a failed
   * probe hides the link rather than showing one that might lead nowhere, and the header menu
   * still carries both for anyone who has them.
   */
  private loadCommercialLinks(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    this.invoiceService.hasMyInvoices().subscribe({
      next: res => this.hasInvoices = res?.hasInvoices ?? false,
      error: () => this.hasInvoices = false
    });
    this.contractService.hasMyContracts().subscribe({
      next: res => this.hasContracts = res?.hasContracts ?? false,
      error: () => this.hasContracts = false
    });
  }

  /**
   * The customer's referral code, for the Refer a Friend card on Overview. Best-effort like the
   * commercial links above: the card renders nothing without a code, so a failed read (or the
   * rewards system being off) simply leaves that space empty instead of showing a broken box.
   */
  private loadReferralCode(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    this.bubbleRewardsService.getMyReferralCode().subscribe({
      next: res => {
        this.referralCode = res?.code ?? '';
        this.referralShareUrl = res?.shareUrl ?? '';
      },
      error: () => {
        this.referralCode = '';
        this.referralShareUrl = '';
      }
    });
  }

  loadLocationData() {
    this.locationService.getStates().subscribe({
      next: (states) => {
        this.states = states;
        if (states.length > 0) {
          this.loadCities(states[0]);
        }
      }
    });
  }

  loadCities(state: string) {
    this.locationService.getCities(state).subscribe({
      next: (cities) => {
        this.cities = cities;
      }
    });
  }

  onStateChange(state: string) {
    this.loadCities(state);
    // Only reset city if we're adding a new apartment
    if (this.isAddingApartment) {
      this.newApartment.city = '';
    }
    // Don't reset city when editing - it should keep its value
  }

  loadProfile() {
    this.isLoading = true;
    this.profileService.getProfile().subscribe({
      next: (profile) => {
        this.profile = profile;
        this.isLoading = false;
      },
      error: (error) => {
        this.errorMessage = 'Failed to load profile';
        this.isLoading = false;
      }
    });
  }

  startEditProfile() {
    if (this.profile) {
      this.editProfileForm = {
        firstName: this.profile.firstName,
        lastName: this.profile.lastName,
        email: this.profile.email,
        phone: this.profile.phone || ''
      };
      this.isEditingProfile = true;
    }
  }

  cancelEditProfile() {
    this.isEditingProfile = false;
    this.errorMessage = '';
  }

  /** Current email preference (falls back to canReceiveCommunications if backend omits it). */
  get canReceiveEmails(): boolean {
    if (!this.profile) return true;
    return this.profile.canReceiveEmails ?? this.profile.canReceiveCommunications;
  }

  /** Current messages preference (falls back to canReceiveCommunications if backend omits it). */
  get canReceiveMessages(): boolean {
    if (!this.profile) return true;
    return this.profile.canReceiveMessages ?? this.profile.canReceiveCommunications;
  }

  setEmailsPreference(checked: boolean): void {
    if (!this.profile) return;
    this.updatingComms = true;
    this.errorMessage = '';
    this.profileService.updateProfile({
      firstName: this.profile.firstName,
      lastName: this.profile.lastName,
      email: this.profile.email,
      phone: this.profile.phone ?? '',
      canReceiveEmails: checked
    }).subscribe({
      next: (updated) => {
        this.profile = updated;
        this.updatingComms = false;
        this.successMessage = checked ? 'You will receive our emails.' : 'You will not receive our emails.';
        setTimeout(() => this.successMessage = '', 3000);
      },
      error: () => {
        this.updatingComms = false;
        this.errorMessage = 'Failed to update email preference. Please try again.';
      }
    });
  }

  setMessagesPreference(checked: boolean): void {
    if (!this.profile) return;
    this.updatingComms = true;
    this.errorMessage = '';
    this.profileService.updateProfile({
      firstName: this.profile.firstName,
      lastName: this.profile.lastName,
      email: this.profile.email,
      phone: this.profile.phone ?? '',
      canReceiveMessages: checked
    }).subscribe({
      next: (updated) => {
        this.profile = updated;
        this.updatingComms = false;
        this.successMessage = checked ? 'You will receive our messages.' : 'You will not receive our messages.';
        setTimeout(() => this.successMessage = '', 3000);
      },
      error: () => {
        this.updatingComms = false;
        this.errorMessage = 'Failed to update messages preference. Please try again.';
      }
    });
  }

  capitalizeName(name: string): string {
    if (!name) return name;
    return name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();
  }

  // Getters for displaying capitalized names in profile
  get displayFirstName(): string {
    return this.profile ? this.capitalizeName(this.profile.firstName) : '';
  }

  get displayLastName(): string {
    return this.profile ? this.capitalizeName(this.profile.lastName) : '';
  }

  onNameBlur(fieldName: 'firstName' | 'lastName') {
    if (fieldName === 'firstName' && this.editProfileForm.firstName) {
      this.editProfileForm.firstName = this.capitalizeName(this.editProfileForm.firstName);
    } else if (fieldName === 'lastName' && this.editProfileForm.lastName) {
      this.editProfileForm.lastName = this.capitalizeName(this.editProfileForm.lastName);
    }
  }

  saveProfile() {
    // Capitalize names before saving
    if (this.editProfileForm.firstName) {
      this.editProfileForm.firstName = this.capitalizeName(this.editProfileForm.firstName);
    }
    if (this.editProfileForm.lastName) {
      this.editProfileForm.lastName = this.capitalizeName(this.editProfileForm.lastName);
    }

    // Validate phone number format
    if (this.editProfileForm.phone && !/^\d{10}$/.test(this.editProfileForm.phone)) {
      this.errorMessage = 'Please enter a valid 10-digit phone number';
      return;
    }

    this.profileService.updateProfile(this.editProfileForm).subscribe({
      next: (updatedProfile) => {
        this.profile = updatedProfile;
        this.isEditingProfile = false;
        this.successMessage = 'Profile updated successfully';
        setTimeout(() => this.successMessage = '', 3000);
      },
      error: (error) => {
        this.errorMessage = 'Failed to update profile';
      }
    });
  }

  startAddApartment() {
    if (this.profile && this.profile.apartments.length >= 10) {
      this.errorMessage = 'You have reached the maximum limit of 10 saved addresses';
      setTimeout(() => this.errorMessage = '', 3000);
      return;
    }

    this.isAddingApartment = true;
    this.newApartment = {
      name: '',
      address: '',
      aptSuite: '',
      city: '',
      state: this.states.length > 0 ? this.states[0] : '',
      postalCode: '',
      specialInstructions: ''
    };
    if (this.newApartment.state) {
      this.onStateChange(this.newApartment.state);
    }
  }

  addApartment() {
    // Clear any previous error messages
    this.errorMessage = '';

    // Validate for duplicates
    const validationError = this.validateApartment(this.newApartment);
    if (validationError) {
      this.errorMessage = validationError;
      return;
    }

    this.profileService.addApartment(this.newApartment).subscribe({
      next: (apartment) => {
        if (this.profile) {
          this.profile.apartments.push(apartment);
        }
        this.isAddingApartment = false;
        this.successMessage = 'Apartment added successfully';
        setTimeout(() => this.successMessage = '', 3000);
      },
      error: (error) => {
        this.errorMessage = extractApiErrorMessage(error, 'Failed to add apartment');
      }
    });
  }


  // Add this method to check for duplicate apartments
  validateApartment(apartment: CreateApartment | Apartment, excludeId?: number): string | null {
    if (!this.profile || !this.profile.apartments) return null;

    // Check only active apartments
    const activeApartments = this.profile.apartments.filter(a => a.id !== excludeId);

    // Check for duplicate name (case-insensitive)
    const duplicateName = activeApartments.find(a =>
      a.name.toLowerCase() === apartment.name.toLowerCase()
    );

    if (duplicateName) {
      return `An apartment with the name '${apartment.name}' already exists`;
    }

    // Check for duplicate address (case-insensitive) - just the address field
    const duplicateAddress = activeApartments.find(a =>
      a.address.toLowerCase() === apartment.address.toLowerCase()
    );

    if (duplicateAddress) {
      return `An apartment with the address '${apartment.address}' already exists`;
    }

    return null;
  }


  startEditApartment(apartment: Apartment) {
    this.editingApartmentId = apartment.id;
    this.editingApartment = { ...apartment };
    // Load cities for the current state without resetting the city
    if (this.editingApartment.state) {
      this.loadCities(this.editingApartment.state);
    }
  }

  saveApartment() {
    if (this.editingApartment && this.editingApartmentId) {
      // Validate required fields
      if (!this.editingApartment.name || !this.editingApartment.address ||
          !this.editingApartment.city || !this.editingApartment.state ||
          !this.editingApartment.postalCode) {
        this.errorMessage = 'Please fill in all required fields';
        return;
      }

      // Validate for duplicates before making the API call
      const validationError = this.validateApartment(this.editingApartment, this.editingApartmentId);
      if (validationError) {
        this.errorMessage = validationError;
        return;
      }

      this.profileService.updateApartment(this.editingApartmentId, this.editingApartment).subscribe({
        next: (updatedApartment) => {
          if (this.profile) {
            const index = this.profile.apartments.findIndex(a => a.id === updatedApartment.id);
            if (index !== -1) {
              this.profile.apartments[index] = updatedApartment;
            }
          }
          this.editingApartmentId = null;
          this.editingApartment = null;
          this.successMessage = 'Apartment updated successfully';
          setTimeout(() => this.successMessage = '', 3000);
        },
        error: (error) => {
          this.errorMessage = extractApiErrorMessage(
            error, 'Failed to update apartment. Please try again.');
        }
      });
    }
  }

  // Optional: Add real-time validation on form input
  onApartmentNameChange() {
    // Clear error first
    this.errorMessage = '';

    if (this.isAddingApartment && this.newApartment.name) {
      const duplicateName = this.profile?.apartments.find(a =>
        a.name.toLowerCase() === this.newApartment.name.toLowerCase()
      );
      if (duplicateName) {
        this.errorMessage = `An apartment with the name '${this.newApartment.name}' already exists`;
        return;
      }
    }
  }

  // Add the cancel methods to clear errors
  cancelAddApartment() {
    this.isAddingApartment = false;
    this.errorMessage = '';
    // Reset the form
    this.newApartment = {
      name: '',
      address: '',
      aptSuite: '',
      city: '',
      state: this.states.length > 0 ? this.states[0] : '',
      postalCode: '',
      specialInstructions: ''
    };
  }

  cancelEditApartment() {
    this.editingApartmentId = null;
    this.editingApartment = null;
    this.errorMessage = '';
  }

  onApartmentAddressChange() {
    // Clear error first
    this.errorMessage = '';

    // Check for duplicate name first
    if (this.isAddingApartment && this.newApartment.address) {
      const duplicateName = this.profile?.apartments.find(a =>
        a.address.toLowerCase() === this.newApartment.address.toLowerCase()
      );
      if (duplicateName) {
        this.errorMessage = `An apartment with the address '${this.newApartment.address}' already exists`;
        return;
      }
    }
  }

  deleteApartment(apartment: Apartment) {
    if (confirm(`Are you sure you want to delete "${apartment.name}"?`)) {
      this.profileService.deleteApartment(apartment.id).subscribe({
        next: () => {
          if (this.profile) {
            this.profile.apartments = this.profile.apartments.filter(a => a.id !== apartment.id);
          }
          this.successMessage = 'Apartment deleted successfully';
          setTimeout(() => this.successMessage = '', 3000);
        },
        error: (error) => {
          this.errorMessage = 'Failed to delete apartment';
        }
      });
    }
  }

  logout() {
    this.authService.logout();
  }

  loadSpecialOffers() {
    this.specialOfferService.getMySpecialOffers().subscribe({
      next: (offers) => {
        this.specialOffers = offers ?? [];
      },
      error: (error) => {
        console.error('Error loading special offers:', error);
        this.specialOffers = [];
      }
    });
  }

  // ══ The Plan tab ═══════════════════════════════════════════════════════════════════════
  //
  // Read DreamCleaningBackend/Helpers/PlanSelectionPolicy before changing anything here.
  // Choosing a plan records a PREFERENCE: it pre-selects the tier on the booking page and does
  // nothing else. It never activates a subscription, never grants a discount and never charges.
  // The discount still begins on the SECOND cleaning in a row, decided server-side by
  // BookingCreationService.ResolveDiscountsAsync.

  loadPlan(force = false): void {
    if (this.planLoading) return;
    if (this.plan && !force) return;
    this.planLoading = true;
    this.planError = '';
    this.profileService.getPlan().subscribe({
      next: overview => { this.plan = overview; this.planLoading = false; },
      error: err => {
        this.planError = extractApiErrorMessage(err, 'We could not load the plans right now.');
        this.planLoading = false;
      }
    });
  }

  choosePlan(plan: PlanOption): void {
    if (this.planSavingId !== undefined) return;
    // Tapping the plan you already prefer clears it, so "no plan" is reachable without a
    // separate control the rest of the time.
    const target = plan.isPreferred ? null : plan.id;
    this.planSavingId = target;
    this.planError = '';
    this.profileService.selectPlan(target).subscribe({
      next: overview => {
        this.plan = overview;
        this.planSavingId = undefined;
        this.successMessage = target === null
          ? 'Plan preference cleared.'
          : `${plan.name} saved. We will pre-select it when you book — nothing has been charged.`;
        setTimeout(() => this.successMessage = '', 4000);
      },
      error: err => {
        this.planSavingId = undefined;
        this.planError = extractApiErrorMessage(err, 'We could not save that. Please try again.');
      }
    });
  }

  isPlanSaving(plan: PlanOption): boolean {
    return this.planSavingId === plan.id;
  }

  /** "Every 2 weeks" from the configured cadence, so the copy follows the admin's own tiers. */
  planCadence(plan: PlanOption): string {
    if (plan.subscriptionDays === 7) return 'Every week';
    if (plan.subscriptionDays === 14) return 'Every 2 weeks';
    if (plan.subscriptionDays >= 28 && plan.subscriptionDays <= 31) return 'Every month';
    return `Every ${plan.subscriptionDays} days`;
  }

  // ══ The customer's cleanings ═══════════════════════════════════════════════════════════

  loadOrders() {
    this.ordersError = '';
    this.orderService.getUserOrders().subscribe({
      next: (orders: OrderList[]) => {
        this.orders = orders;
        // A cancellation can empty the last page. Step back rather than showing a blank list.
        if (this.ordersPage > this.orderPageCount) this.ordersPage = this.orderPageCount;
      },
      error: (error: any) => {
        this.ordersError = extractApiErrorMessage(error, 'Failed to load your cleanings.');
        this.orders = [];
      }
    });
  }

  get orderPageCount(): number {
    const total = this.orders?.length ?? 0;
    return Math.max(1, Math.ceil(total / this.ordersPerPage));
  }

  /** The slice on screen. A pure getter — nothing here may assign component state (NG0100). */
  get pagedOrders(): OrderList[] {
    if (!this.orders) return [];
    const start = (this.ordersPage - 1) * this.ordersPerPage;
    return this.orders.slice(start, start + this.ordersPerPage);
  }

  /** Page numbers to draw: a window around the current page, never the whole run. */
  get orderPageNumbers(): number[] {
    const count = this.orderPageCount;
    const window = 5;
    let first = Math.max(1, this.ordersPage - Math.floor(window / 2));
    const last = Math.min(count, first + window - 1);
    first = Math.max(1, last - window + 1);
    const pages: number[] = [];
    for (let p = first; p <= last; p++) pages.push(p);
    return pages;
  }

  goToOrderPage(page: number): void {
    const target = Math.min(Math.max(1, page), this.orderPageCount);
    if (target === this.ordersPage) return;
    this.ordersPage = target;
    if (isPlatformBrowser(this.platformId)) {
      document.getElementById('profile-orders')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  viewOrderDetails(orderId: number) {
    this.router.navigate(['/order', orderId]);
  }

  payOrder(orderId: number) {
    this.router.navigate(['/order', orderId, 'pay']);
  }

  /**
   * An order needs no payment from the website when it's Stripe-paid (isPaid) OR was settled
   * outside Stripe — Cash/Zelle/Check/Other. Those keep isPaid=false by backend design, so they
   * have to be treated as paid here to suppress the Unpaid badge and the Pay button.
   *
   * INVOICE IS THE EXCEPTION (2026-09). It is handled outside Stripe like the others, but
   * choosing it settles nothing: the customer's commercial client pays an invoice later, and
   * `invoicePaidAt` is stamped when that invoice reaches a zero balance. Without this clause an
   * unpaid commercial cleaning would show a green "Paid" badge from the day it was booked.
   * Mirrors Helpers/OrderPaymentFilter on the backend.
   */
  isEffectivelyPaid(order: OrderList): boolean {
    if (order.isPaid) return true;
    if (!order.paymentMethod || order.paymentMethod === 'Normal') return false;
    if (order.paymentMethod === 'Invoice') return !!order.invoicePaidAt;
    return true;
  }

  /** Additional amount to pay. Backend sends the correct difference (current − tips) − (original − tips). Show it as-is; do not add tips. */
  getEffectivePendingUpdateAmount(order: OrderList): number {
    const pending = order.pendingUpdateAmount ?? 0;
    if (pending <= 0.01) return 0;
    const hasInitial = (order.initialTotal ?? 0) > 0;
    if (hasInitial) {
      const currentWithoutTips = (order.total ?? 0) - (order.tips ?? 0) - (order.companyDevelopmentTips ?? 0);
      const originalWithoutTips = (order.initialTotal ?? 0) - (order.initialTips ?? 0) - (order.initialCompanyDevelopmentTips ?? 0);
      return Math.max(0, Math.round((currentWithoutTips - originalWithoutTips) * 100) / 100);
    }
    return Math.round(pending * 100) / 100;
  }

  getStatusClass(status: string): string {
    switch ((status || '').toLowerCase()) {
      case 'active': return 'status-active';
      case 'done': return 'status-done';
      case 'cancelled': return 'status-cancelled';
      case 'pending': return 'status-pending';
      default: return 'status-pending';
    }
  }

  canEditOrder(order: OrderList): boolean {
    if (order.recurringSeriesId) return false;
    if (order.isCustomServiceType) return false;
    if (order.status !== 'Active') return false;

    // More than 48 hours before the service date.
    const serviceDate = new Date(order.serviceDate);
    const hoursUntilService = (serviceDate.getTime() - Date.now()) / (1000 * 60 * 60);
    return hoursUntilService > 48;
  }

  canCancelOrder(order: OrderList): boolean {
    if (order.recurringSeriesId) return false;
    return order.status === 'Active' && !!order.isPaid;
  }

  isLateCancellation(order: OrderList): boolean {
    if (!order.isPaid) return false;
    const serviceDate = new Date(order.serviceDate);
    const hoursUntilService = (serviceDate.getTime() - Date.now()) / (1000 * 60 * 60);
    return hoursUntilService <= 48;
  }

  // ── Reorder ────────────────────────────────────────────────────────────────────────────
  reorderingOrderId: number | null = null;

  isReordering(orderId: number): boolean {
    return this.reorderingOrderId === orderId;
  }

  reorder(orderId: number) {
    this.reorderingOrderId = orderId;
    this.ordersError = '';

    this.orderService.getOrderById(orderId).subscribe({
      next: (order: Order) => {
        const formData = {
          selectedServiceTypeId: order.serviceTypeId.toString(),
          selectedServices: order.services.map(service => ({
            serviceId: service.serviceId.toString(),
            quantity: service.quantity
          })),
          selectedExtraServices: order.extraServices.map(extraService => ({
            extraServiceId: extraService.extraServiceId.toString(),
            quantity: extraService.quantity,
            hours: extraService.hours
          })),
          cleaningType: 'normal',
          contactFirstName: order.contactFirstName || '',
          contactLastName: order.contactLastName || '',
          contactEmail: order.contactEmail || '',
          contactPhone: order.contactPhone || '',
          serviceAddress: order.serviceAddress || '',
          aptSuite: order.aptSuite || '',
          apartmentName: '',
          city: order.city || '',
          state: order.state || '',
          zipCode: order.zipCode || '',
          entryMethod: order.entryMethod || '',
          specialInstructions: order.specialInstructions || '',
          tips: normalizeTipAmount(order.tips),
          promoCode: order.promoCode || '',
          hasStartedBooking: true,
          bookingProgress: 'started' as const
        };

        this.formPersistenceService.saveFormData(formData);
        this.formPersistenceService.markBookingStarted();
        this.router.navigate(['/booking']);
      },
      error: (error) => {
        this.ordersError = extractApiErrorMessage(
          error, 'Failed to load order details. Please try again.');
        this.reorderingOrderId = null;
      }
    });
  }

  // ── Cancelling ─────────────────────────────────────────────────────────────────────────
  cancellingOrderId: number | null = null;
  showCancelModal = false;
  cancelModalOrderId: number | null = null;
  cancelReason = '';

  openCancelModal(orderId: number) {
    this.cancelModalOrderId = orderId;
    this.showCancelModal = true;
    this.cancelReason = '';
  }

  closeCancelModal() {
    this.showCancelModal = false;
    this.cancelModalOrderId = null;
    this.cancelReason = '';
  }

  getCancelModalOrder(): OrderList | undefined {
    return this.orders?.find(o => o.id === this.cancelModalOrderId);
  }

  confirmCancelOrder() {
    if (!this.cancelModalOrderId || !this.cancelReason.trim()) return;

    this.cancellingOrderId = this.cancelModalOrderId;
    this.ordersError = '';

    this.orderService.cancelOrder(this.cancelModalOrderId, { reason: this.cancelReason }).subscribe({
      next: () => {
        this.cancellingOrderId = null;
        this.closeCancelModal();
        this.loadOrders();
        this.notifyOrdersChanged();
      },
      error: (error) => {
        this.cancellingOrderId = null;
        this.ordersError = extractApiErrorMessage(
          error, 'Failed to cancel order. Please try again.');
      }
    });
  }

  cancelUnpaidOrder(orderId: number) {
    if (!confirm('Are you sure you want to cancel this unpaid order? This action cannot be undone.')) {
      return;
    }

    this.cancellingOrderId = orderId;
    this.ordersError = '';

    this.orderService.cancelOrder(orderId, { reason: 'Customer cancelled unpaid order' }).subscribe({
      next: () => {
        this.cancellingOrderId = null;
        this.loadOrders();
        this.notifyOrdersChanged();
      },
      error: (error) => {
        this.cancellingOrderId = null;
        this.ordersError = extractApiErrorMessage(
          error, 'Failed to cancel order. Please try again.');
      }
    });
  }

  isCancellingOrder(orderId: number): boolean {
    return this.cancellingOrderId === orderId;
  }

  /** Tells the header to re-check for unpaid orders. */
  private notifyOrdersChanged(): void {
    if (isPlatformBrowser(this.platformId)) {
      window.dispatchEvent(new Event('ordersUpdated'));
    }
  }

  formatDate(date: any): string {
    return new Date(date).toLocaleDateString();
  }

  /** orderDate is a UTC timestamp (unlike serviceDate, which is NY wall-clock) — show it in NY time. */
  formatOrderDate(date: any): string {
    return formatNyDate(date);
  }

  formatTime(time: string): string {
    if (!time) return '';
    const [hours, minutes] = time.split(':');
    const hour = parseInt(hours, 10);
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const displayHour = hour % 12 || 12;
    return `${displayHour}:${minutes} ${ampm}`;
  }

  // Add method to handle phone input
  onPhoneInput(event: Event) {
    const input = event.target as HTMLInputElement;
    // Remove any non-digit characters
    input.value = input.value.replace(/\D/g, '');
    // Update the model
    this.editProfileForm.phone = input.value;
  }
}
