// src/app/auth/profile/order-edit/order-edit.component.ts
import { Component, OnDestroy, OnInit, Inject, PLATFORM_ID } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { FormsModule, ReactiveFormsModule, FormBuilder, FormGroup, FormArray, FormControl, Validators } from '@angular/forms';
import { RouterModule, ActivatedRoute, Router } from '@angular/router';
import { OrderService, Order, UpdateOrder } from '../../../services/order.service';
import { BookingService, ServiceType, Service, ExtraService, Subscription } from '../../../services/booking.service';
import { BubbleRewardsService } from '../../../services/bubble-rewards.service';
import { LocationService } from '../../../services/location.service';
import { AuthService } from '../../../services/auth.service';
import { DurationUtils } from '../../../utils/duration.utils';
import { DateSelectorComponent } from '../../../booking/date-selector/date-selector.component';
import { TimeSelectorComponent } from '../../../booking/time-selector/time-selector.component';
import { StripeService } from '../../../services/stripe.service';
import { FloorTypeSelectorComponent, FloorTypeSelection } from '../../../shared/components/floor-type-selector/floor-type-selector.component';

interface SelectedService {
  service: Service;
  quantity: number;
}

interface SelectedExtraService {
  extraService: ExtraService;
  quantity: number;
  hours: number;
}

@Component({
  selector: 'app-order-edit',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule, RouterModule, DateSelectorComponent, TimeSelectorComponent, FloorTypeSelectorComponent],
  templateUrl: './order-edit.component.html',
  styleUrls: ['./order-edit.component.scss']
})
export class OrderEditComponent implements OnInit, OnDestroy {
  order: Order | null = null;
  orderForm: FormGroup;
  private isBrowser: boolean;
  
  // Service data
  serviceType: ServiceType | null = null;
  selectedServices: SelectedService[] = [];
  selectedExtraServices: SelectedExtraService[] = [];
  
  // Location data
  states: string[] = [];
  cities: string[] = [];
  
  // UI state
  isLoading = true;
  isSaving = false;
  errorMessage = '';
  successMessage = '';
  additionalAmount = 0;
  showPaymentModal = false;
  isSameDaySelected = false;
  
  // Entry methods
  entryMethods = [
    'I will be home',
    'Doorman',
    'Hidden key',
    'Office reception',
    'Other'
  ];
  
  // Floor types
  floorTypes: string[] = [];
  floorTypeOther: string = '';

  // Original values for comparison
  originalTotal = 0;
  originalDiscountAmount = 0;
  originalSubscriptionDiscountAmount = 0;
  /** Raw subtotal from order (before discount). Used to compute discount ratio. */
  originalRawSubTotal = 0;
  /** Discount as ratio of raw subtotal (0..1). Applied to new raw subtotal when recalculating. */
  discountRatio = 0;
  /** Recalculated discount amount (from discountRatio * new raw subtotal). */
  appliedDiscountAmount = 0;
  appliedSubscriptionDiscountAmount = 0;
  /** Bubble points discount already applied to this order (must be subtracted from new total). */
  originalPointsRedeemedDiscount = 0;
  originalPointsRedeemed = 0;
  /** Reward balance (credits) already applied to this order. */
  originalRewardBalanceUsed = 0;
  
  // Calculated values
  newSubTotal = 0;
  newTotal = 0;
  newTax = 0;
  totalDuration: number = 0;
  actualTotalDuration: number = 0;

  // Points preview
  pointsPerDollar = 0;
  pointsEnabled = false;
  estimatedPoints = 0;

  // Gift card specific properties
  giftCardApplied = false;
  giftCardBalance = 0;
  giftCardAmountToUse = 0;
  isGiftCard = false;
  originalGiftCardCode: string | null = null;
  originalGiftCardAmountUsed = 0;
  
  // Mobile tooltip management
  mobileTooltipTimeouts: { [key: number]: any } = {};
  mobileTooltipStates: { [key: number]: boolean } = {};
  isMobileDevice = false; // Will be updated in ngOnInit
  
  // Order summary collapse state
  isSummaryCollapsed = false;
  
  // Tip dropdown state
  tipDropdownOpen = false;

  // If the order was originally deep cleaned, keep option visible even if later deactivated
  private originallyHadDeepCleaning = false;
  
  // Constants
  salesTaxRate = 0.08875; // 8.875%

  calculatedMaidsCount = 1;
  originalMaidsCount = 1;

  originalServiceQuantities: Map<number, number> = new Map();
  serviceControls: FormArray;

  // Payment related properties
  isProcessingPayment = false;
  paymentClientSecret: string | null = null;
  cardError: string | null = null;
  paymentErrorMessage: string = '';
  private updateData: UpdateOrder | null = null;


  constructor(
    private fb: FormBuilder,
    private orderService: OrderService,
    private bookingService: BookingService,
    private locationService: LocationService,
    private route: ActivatedRoute,
    private router: Router,
    private authService: AuthService,
    private stripeService: StripeService,
    private bubbleRewardsService: BubbleRewardsService,
    @Inject(PLATFORM_ID) private platformId: Object
  ) {
    this.isBrowser = isPlatformBrowser(this.platformId);
    
    // Initialize form
    this.orderForm = this.fb.group({
      serviceDate: ['', Validators.required],
      serviceTime: ['', Validators.required],
      entryMethod: ['', Validators.required],
      customEntryMethod: [''],
      specialInstructions: [''],
      contactFirstName: ['', Validators.required],
      contactLastName: ['', Validators.required],
      contactEmail: ['', [Validators.required, Validators.email]],
      contactPhone: ['', Validators.required],
      serviceAddress: ['', Validators.required],
      aptSuite: [''],
      city: ['', Validators.required],
      state: ['', Validators.required],
      zipCode: ['', Validators.required],
      tips: [0],
      companyDevelopmentTips: [0],
      cleaningType: ['normal', Validators.required]
    });

    // Initialize service controls array
    this.serviceControls = this.fb.array([]);
  }

  private getNowInNewYork(): Date {
    const nowUtc = new Date();
    const nyString = nowUtc.toLocaleString('en-US', { timeZone: 'America/New_York' });
    return new Date(nyString);
  }

  ngOnInit() {
    // Set mobile device detection only in browser
    if (this.isBrowser) {
      this.isMobileDevice = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || window.innerWidth <= 768;
    }
    
    // Load points-per-dollar for the earn preview
    this.bubbleRewardsService.getSummary().subscribe({
      next: (s) => {
        this.pointsEnabled = !!s.pointsSystemEnabled;
        this.pointsPerDollar = s.guide?.pointsPerDollar ?? 0;
        this.updateEstimatedPoints();
      },
      error: () => {}
    });

    // Load location data
    this.loadLocationData();
    
    // Load order data
    this.route.params.subscribe(params => {
      const orderId = +params['id'];
      if (orderId) {
        this.loadOrder(orderId);
      }
    });
    
    // Auto-collapse summary on mobile devices (≤1200px)
    this.updateSummaryCollapseState();
    
    // Listen to window resize events
    if (this.isBrowser) {
      window.addEventListener('resize', () => {
        this.updateSummaryCollapseState();
      });
    }
    
    // Listen to tips changes
    this.orderForm.get('tips')?.valueChanges.subscribe(() => {
      this.calculateNewTotal();
    });

    // Listen to company development tips changes
    this.orderForm.get('companyDevelopmentTips')?.valueChanges.subscribe(() => {
      this.calculateNewTotal();
    });

    // Listen to date changes to unselect same day service
    this.orderForm.get('serviceDate')?.valueChanges.subscribe(value => {
      if (this.isSameDaySelected && value) {
        const today = this.getNowInNewYork();
        const year = today.getFullYear();
        const month = String(today.getMonth() + 1).padStart(2, '0');
        const day = String(today.getDate()).padStart(2, '0');
        const todayFormatted = `${year}-${month}-${day}`;
        
        // If the selected date is not today, unselect same day service
        if (value !== todayFormatted) {
          const sameDayService = this.selectedExtraServices.find(s => s.extraService.isSameDayService);
          if (sameDayService) {
            // Remove same day service from selected extra services
            this.selectedExtraServices = this.selectedExtraServices.filter(
              s => !s.extraService.isSameDayService
            );
            this.isSameDaySelected = false;
            this.calculateNewTotal();
          }
        }
      }
    });

    // Setup click outside listener for tip dropdown only in browser
    if (this.isBrowser) {
      this.setupDropdownClickOutside();
    }
  }

  loadLocationData() {
    this.locationService.getStates().subscribe({
      next: (states) => {
        this.states = states;
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
    this.orderForm.patchValue({ city: '' });
  }

  loadOrder(orderId: number) {
    this.isLoading = true;
    this.orderService.getOrderById(orderId).subscribe({
      next: (order) => {
        this.order = order;
        this.originalTotal = order.total;
        this.originalDiscountAmount = order.discountAmount;
        this.originalSubscriptionDiscountAmount = order.subscriptionDiscountAmount || 0;
        this.originalMaidsCount = order.maidsCount;
        this.originalRawSubTotal = order.subTotal;
        this.originalPointsRedeemed = order.pointsRedeemed || 0;
        this.originalPointsRedeemedDiscount = order.pointsRedeemedDiscount || 0;
        this.originalRewardBalanceUsed = order.rewardBalanceUsed || 0;
        if (order.subTotal > 0) {
          this.discountRatio = (order.discountAmount + (order.subscriptionDiscountAmount || 0)) / order.subTotal;
        } else {
          this.discountRatio = 0;
        }
        this.populateForm(order);
        this.loadServiceType(order.serviceTypeId);
      },
      error: (error) => {
        this.errorMessage = 'Failed to load order';
        this.isLoading = false;
      }
    });
  }

  populateForm(order: Order) {
    // Use calendar date only to avoid timezone shifting (e.g. 22nd becoming 21st)
    const formattedDate = this.getOrderServiceDateString(order.serviceDate);

    this.orderForm.patchValue({
      serviceDate: formattedDate,
      serviceTime: order.serviceTime.substring(0, 5), // HH:mm format
      entryMethod: order.entryMethod === 'Other' ? 'Other' : order.entryMethod,
      customEntryMethod: order.entryMethod === 'Other' ? order.entryMethod : '',
      specialInstructions: order.specialInstructions || '',
      contactFirstName: order.contactFirstName,
      contactLastName: order.contactLastName,
      contactEmail: order.contactEmail,
      contactPhone: order.contactPhone,
      serviceAddress: order.serviceAddress,
      aptSuite: order.aptSuite || '',
      city: order.city,
      state: order.state,
      zipCode: order.zipCode,
      tips: order.tips,
      companyDevelopmentTips: order.companyDevelopmentTips || 0
    });

    // Initialize floor types from order data
    this.parseFloorTypesFromOrder(order);

    // Load cities for the selected state
    if (order.state) {
      this.loadCities(order.state);
    }

    // Initialize gift card data if present
  if (order.giftCardCode) {
    this.originalGiftCardCode = order.giftCardCode;
    this.originalGiftCardAmountUsed = order.giftCardAmountUsed || 0;
    
    // Validate the gift card to get current balance
    this.bookingService.validatePromoCode(order.giftCardCode).subscribe({
      next: (validation) => {
        if (validation.isValid && validation.isGiftCard) {
          this.isGiftCard = true;
          this.giftCardApplied = true;
          this.giftCardBalance = validation.availableBalance || 0;
          // Add back the originally used amount to get total available
          this.giftCardBalance += this.originalGiftCardAmountUsed;
          this.calculateNewTotal();
        }
      }
    });
  }
  }

  loadServiceType(serviceTypeId: number) {
    this.bookingService.getServiceTypes().subscribe({
      next: (serviceTypes) => {
        this.serviceType = serviceTypes.find(st => st.id === serviceTypeId) || null;
        if (this.serviceType && this.order) {
          this.initializeServices();
          this.initializeExtraServices();
          // Calculate initial total
          this.calculateNewTotal();
        }
        this.isLoading = false;
      },
      error: (error) => {
        this.errorMessage = 'Failed to load service details';
        this.isLoading = false;
      }
    });
  }

  initializeServices() {
    if (!this.serviceType || !this.order) return;
  
    // Clear existing controls
    this.serviceControls.clear();
    
    // Initialize selected services with quantities from the order (like booking component)
    this.selectedServices = [];
    
    // Sort services by displayOrder before processing (like booking component)
    const sortedServices = [...this.serviceType.services].sort((a, b) => 
      (a.displayOrder || 999) - (b.displayOrder || 999)
    );
    
    sortedServices.forEach(service => {
      if (service.isActive !== false) {
        const orderService = this.order!.services.find(s => s.serviceId === service.id);
        
        let quantity = orderService ? orderService.quantity : (service.minValue ?? 0);
        
        // Special handling for Hours service when not found in database
        if (service.serviceRelationType === 'hours' && !orderService) {
          // Try to calculate hours from cleaner service duration
          const cleanerService = this.order!.services.find(s => 
            s.serviceName.toLowerCase().includes('cleaner')
          );
          if (cleanerService && cleanerService.duration) {
            // Calculate hours from duration (duration is in minutes)
            quantity = Math.floor(cleanerService.duration / 60);
          } else {
            // Fallback to default hours
            quantity = service.minValue ?? 3;
          }
        }
        
        // Use the actual database value, don't override with defaults
        this.selectedServices.push({
          service: service,
          quantity: quantity
        });
        
        // Store original quantity
        this.originalServiceQuantities.set(service.id, quantity);

        // Add form control for this service
        this.serviceControls.push(this.fb.control(quantity));
      }
    });
  }

  initializeExtraServices() {
    if (!this.serviceType || !this.order) return;
    
    // Initialize selected extra services from the order
    this.selectedExtraServices = [];
    
    this.order.extraServices.forEach(orderExtraService => {
      const extraService = this.serviceType!.extraServices.find(es => es.id === orderExtraService.extraServiceId);
      if (extraService) {
        this.selectedExtraServices.push({
          extraService: extraService,
          quantity: orderExtraService.quantity,
          hours: orderExtraService.hours
        });
      }
    });

    // Sync cleaning type with restored extra services
    const currentCleaningType = this.getCurrentCleaningType();
    this.cleaningType.setValue(currentCleaningType);

    // Remember original state so we don't hide the option mid-edit
    this.originallyHadDeepCleaning = this.selectedExtraServices.some(s => s.extraService.isDeepCleaning);
  }

  getServiceControl(index: number): FormControl {
    return this.serviceControls.at(index) as FormControl;
  }

  updateServiceQuantity(service: Service, quantity: number) {
    const index = this.selectedServices.findIndex(s => s.service.id === service.id);
    if (index !== -1) {
      this.selectedServices[index].quantity = quantity;
      this.serviceControls.at(index).setValue(quantity);
      
      // If this is a cleaner service, we need to update the related hours service
      if (service.serviceRelationType === 'cleaner') {
        const hoursService = this.selectedServices.find(s => 
          s.service.serviceRelationType === 'hours' && 
          s.service.serviceTypeId === service.serviceTypeId
        );
        if (hoursService) {
          // Update the form control for hours service too
          const hoursIndex = this.selectedServices.findIndex(s => s.service.id === hoursService.service.id);
          if (hoursIndex !== -1) {
            this.serviceControls.at(hoursIndex).setValue(hoursService.quantity);
          }
        }
      }
    }
    this.calculateNewTotal();
  }

  incrementServiceQuantity(service: Service) {
    const selectedService = this.selectedServices.find(s => s.service.id === service.id);
    if (selectedService) {
      const maxValue = service.maxValue || 10;
      const stepValue = service.stepValue || 1;
      const newQuantity = Math.min(selectedService.quantity + stepValue, maxValue);
      this.updateServiceQuantity(service, newQuantity);
    }
  }

  decrementServiceQuantity(service: Service) {
    const selectedService = this.selectedServices.find(s => s.service.id === service.id);
    if (selectedService) {
      const minValue = service.minValue || 0;
      const stepValue = service.stepValue || 1;
      const newQuantity = Math.max(selectedService.quantity - stepValue, minValue);
      this.updateServiceQuantity(service, newQuantity);
    }
  }

  toggleExtraService(extraService: ExtraService) {
    const index = this.selectedExtraServices.findIndex(s => s.extraService.id === extraService.id);
    
    if (index > -1) {
      // Remove if already selected
      this.selectedExtraServices.splice(index, 1);
      
      // Clear mobile tooltip for this service immediately
      this.clearMobileTooltip(extraService.id);
      
      if (extraService.isSameDayService) {
        this.isSameDaySelected = false;
        this.updateDateRestrictions();
      }
    } else {
      // Clear all existing tooltips first
      this.clearAllMobileTooltips();
      
      // If selecting a cleaning type, remove other cleaning types
      if (extraService.isDeepCleaning || extraService.isSuperDeepCleaning) {
        // Remove any existing deep cleaning or super deep cleaning
        this.selectedExtraServices = this.selectedExtraServices.filter(
          s => !s.extraService.isDeepCleaning && !s.extraService.isSuperDeepCleaning
        );
      }
      
      // Add new selection
      this.selectedExtraServices.push({
        extraService: extraService,
        quantity: 1,
        hours: extraService.hasHours ? 0.5 : 0
      });
      
      // Show mobile tooltip for this service after a brief delay to ensure state is set
      setTimeout(() => {
        this.showMobileTooltip(extraService.id);
      }, 10);
      
      if (extraService.isSameDayService) {
        this.isSameDaySelected = true;
        this.updateDateRestrictions();
      }
    }
    
    this.calculateNewTotal();
  }

  // Mobile tooltip management methods
  showMobileTooltip(extraServiceId: number) {
    // Only show tooltip on mobile devices
    if (!this.isCurrentlyMobile()) return;
    
    // Clear any existing timeout for this service
    this.clearMobileTooltip(extraServiceId);
    
    // Set tooltip state to visible
    this.mobileTooltipStates[extraServiceId] = true;
    
    // Set timeout to hide tooltip after 5 seconds
    this.mobileTooltipTimeouts[extraServiceId] = setTimeout(() => {
      this.clearMobileTooltip(extraServiceId);
    }, 5000);
  }

  clearMobileTooltip(extraServiceId: number) {
    // Clear the timeout
    if (this.mobileTooltipTimeouts[extraServiceId]) {
      clearTimeout(this.mobileTooltipTimeouts[extraServiceId]);
      delete this.mobileTooltipTimeouts[extraServiceId];
    }
    
    // Set tooltip state to hidden
    this.mobileTooltipStates[extraServiceId] = false;
  }

  // Clear all mobile tooltips
  clearAllMobileTooltips() {
    // Clear all timeouts
    Object.keys(this.mobileTooltipTimeouts).forEach(key => {
      const id = parseInt(key);
      if (this.mobileTooltipTimeouts[id]) {
        clearTimeout(this.mobileTooltipTimeouts[id]);
      }
    });
    
    // Reset all tooltip states
    this.mobileTooltipTimeouts = {};
    this.mobileTooltipStates = {};
  }

  isMobileTooltipVisible(extraServiceId: number): boolean {
    return this.mobileTooltipStates[extraServiceId] || false;
  }

  // Check if currently on mobile
  isCurrentlyMobile(): boolean {
    return window.innerWidth <= 768;
  }

  private updateDateRestrictions() {
    if (this.isSameDaySelected) {
      const today = new Date();
      // Format date properly for HTML date input (YYYY-MM-DD)
      const year = today.getFullYear();
      const month = String(today.getMonth() + 1).padStart(2, '0');
      const day = String(today.getDate()).padStart(2, '0');
      const formattedDate = `${year}-${month}-${day}`;
      
      this.orderForm.patchValue({ serviceDate: formattedDate });
    } else {
      // Set date to tomorrow
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const year = tomorrow.getFullYear();
      const month = String(tomorrow.getMonth() + 1).padStart(2, '0');
      const day = String(tomorrow.getDate()).padStart(2, '0');
      const formattedDate = `${year}-${month}-${day}`;
      
      this.orderForm.patchValue({ serviceDate: formattedDate });
    }
  }

  updateExtraServiceQuantity(extraService: ExtraService, quantity: number) {
    const selected = this.selectedExtraServices.find(s => s.extraService.id === extraService.id);
    if (selected && quantity >= 1) {
      selected.quantity = quantity;
      this.calculateNewTotal();
    }
  }

  updateExtraServiceHours(extraService: ExtraService, hours: number) {
    const selected = this.selectedExtraServices.find(s => s.extraService.id === extraService.id);
    if (selected && hours >= 0.5) {
      selected.hours = hours;
      this.calculateNewTotal();
    }
  }

  isExtraServiceSelected(extraService: ExtraService): boolean {
    return this.selectedExtraServices.some(s => s.extraService.id === extraService.id);
  }

  getExtraServiceQuantity(extraService: ExtraService): number {
    const selected = this.selectedExtraServices.find(s => s.extraService.id === extraService.id);
    return selected ? selected.quantity : 1;
  }

  getExtraServiceHours(extraService: ExtraService): number {
    const selected = this.selectedExtraServices.find(s => s.extraService.id === extraService.id);
    return selected ? selected.hours : 0.5;
  }

  getExtraServicePrice(extraService: ExtraService): number {
    const selected = this.selectedExtraServices.find(s => s.extraService.id === extraService.id);
    
    // Get price multiplier based on cleaning type
    let priceMultiplier = 1;
    const deepCleaning = this.selectedExtraServices.find(s => s.extraService.isDeepCleaning);
    const superDeepCleaning = this.selectedExtraServices.find(s => s.extraService.isSuperDeepCleaning);

    if (superDeepCleaning) {
      priceMultiplier = superDeepCleaning.extraService.priceMultiplier;
    } else if (deepCleaning) {
      priceMultiplier = deepCleaning.extraService.priceMultiplier;
    }

    // Apply multiplier (except for same day service)
    const currentMultiplier = extraService.isSameDayService ? 1 : priceMultiplier;

    // Calculate price based on type
    if (extraService.hasHours) {
      // For hours-based services, use selected hours or default to 0.5
      const hours = selected ? selected.hours : 0.5;
      return extraService.price * hours * currentMultiplier;
    } else if (extraService.hasQuantity) {
      // For quantity-based services, use selected quantity or default to 1
      const quantity = selected ? selected.quantity : 1;
      return extraService.price * quantity * currentMultiplier;
    } else {
      return extraService.price * currentMultiplier;
    }
  }

  getExtraServiceDuration(extraService: ExtraService): number {
    const selected = this.selectedExtraServices.find(s => s.extraService.id === extraService.id);
    
    // Calculate duration based on type
    if (extraService.hasHours) {
      // For hours-based services, use selected hours or default to 0.5
      const hours = selected ? selected.hours : 0.5;
      return extraService.duration * hours;
    } else if (extraService.hasQuantity) {
      // For quantity-based services, use selected quantity or default to 1
      const quantity = selected ? selected.quantity : 1;
      return extraService.duration * quantity;
    } else {
      return extraService.duration;
    }
  }

  getServicePrice(service: Service, quantity: number): number {
    // Get price multiplier based on cleaning type
    let priceMultiplier = 1;
    const deepCleaning = this.selectedExtraServices.find(s => s.extraService.isDeepCleaning);
    const superDeepCleaning = this.selectedExtraServices.find(s => s.extraService.isSuperDeepCleaning);

    if (superDeepCleaning) {
      priceMultiplier = superDeepCleaning.extraService.priceMultiplier;
    } else if (deepCleaning) {
      priceMultiplier = deepCleaning.extraService.priceMultiplier;
    }

    // Special handling for studio apartment (bedrooms = 0)
    if (service.serviceKey === 'bedrooms' && quantity === 0) {
      return 10 * priceMultiplier; // $10 base price for studio, adjusted by cleaning type
    }

    // Apply multiplier to service cost
    return service.cost * quantity * priceMultiplier;
  }

  getServiceQuantity(service: Service): number {
    const selected = this.selectedServices.find(s => s.service.id === service.id);
    return selected ? selected.quantity : (service.minValue || 0);
  }

  getServiceHours(service: Service): number {
    const selected = this.selectedServices.find(s => s.service.id === service.id);
    return selected?.quantity || 0;
  }

  getOriginalServiceQuantity(service: Service): number {
    return this.originalServiceQuantities.get(service.id) ?? 0;
  }

  /** Extra services that belong to this service type (excluding deep/super deep – those are in cleaning type). */
  getFilteredExtraServices(): ExtraService[] {
    if (!this.serviceType || !this.serviceType.extraServices) {
      return [];
    }
    return this.serviceType.extraServices.filter(extra =>
      !extra.isDeepCleaning && !extra.isSuperDeepCleaning
    );
  }

  removeExtraService(extraService: ExtraService) {
    const index = this.selectedExtraServices.findIndex(s => s.extraService.id === extraService.id);
    if (index > -1) {
      this.selectedExtraServices.splice(index, 1);
      if (extraService.isSameDayService) {
        this.isSameDaySelected = false;
        this.updateDateRestrictions();
      }
      this.clearMobileTooltip(extraService.id);
      this.calculateNewTotal();
    }
  }

  getOriginalServiceHours(service: Service): number {
    if (!this.order || service.serviceRelationType !== 'cleaner') return 0;
    
    // Find the hours service for this service type
    const hoursService = this.serviceType?.services.find(s => 
      s.serviceRelationType === 'hours' && s.serviceTypeId === service.serviceTypeId
    );
    
    if (hoursService) {
      const orderHoursService = this.order.services.find(s => s.serviceId === hoursService.id);
      if (orderHoursService) {
        return orderHoursService.quantity;
      }
    }
    
    // Fallback: check if duration is stored with cleaner service
    const orderService = this.order.services.find(s => s.serviceId === service.id);
    if (orderService && orderService.duration) {
      return Math.floor(orderService.duration / 60);
    }
    
    return 0;
  }


  calculateNewTotal() {
    if (!this.serviceType) return;
  
    let subtotal = 0;
    let totalDuration = 0;
    let deepCleaningFee = 0;
    let displayDuration = 0;
    let actualTotalDuration = 0;
    let useExplicitHours = false;
  
    // Check for deep cleaning multipliers
    let priceMultiplier = 1;
    const deepCleaning = this.selectedExtraServices.find(s => s.extraService.isDeepCleaning);
    const superDeepCleaning = this.selectedExtraServices.find(s => s.extraService.isSuperDeepCleaning);
    
    if (superDeepCleaning) {
      priceMultiplier = superDeepCleaning.extraService.priceMultiplier;
      deepCleaningFee = superDeepCleaning.extraService.price;
    } else if (deepCleaning) {
      priceMultiplier = deepCleaning.extraService.priceMultiplier;
      deepCleaningFee = deepCleaning.extraService.price;
    }
    
    // Check if we have cleaner-hours relationship (like booking component)
    const hasCleanerService = this.selectedServices.some(s => 
      s.service.serviceRelationType === 'cleaner'
    );
    const hoursService = this.selectedServices.find(s => 
      s.service.serviceRelationType === 'hours'
    );

    // If we have both cleaner and hours services, use hours as the duration (like booking component)
    if (hasCleanerService && hoursService) {
      useExplicitHours = true;
      actualTotalDuration = hoursService.quantity * 60;
      totalDuration = actualTotalDuration;
    }
    
    // Calculate base price with multiplier (only if not using explicit hours)
    if (this.serviceType && !useExplicitHours) {
      const baseServiceCost = this.serviceType.basePrice * priceMultiplier;
      subtotal += baseServiceCost;
      
      // Add service type duration
      totalDuration += this.serviceType.timeDuration || 0;
      actualTotalDuration += this.serviceType.timeDuration || 0;
    }
  
    // Process regular services (like booking component)
    this.selectedServices.forEach(selected => {
      if (selected.service.serviceRelationType === 'cleaner') {
        if (hoursService) {
          const hours = hoursService.quantity;
          const cleaners = selected.quantity;
          const costPerCleanerPerHour = selected.service.cost * priceMultiplier;
          const cost = costPerCleanerPerHour * cleaners * hours;
          subtotal += cost;
        }
      } else if (selected.service.serviceKey === 'bedrooms' && selected.quantity === 0) {
        const cost = this.getServicePrice(selected.service, 0);
        subtotal += cost;
        if (!useExplicitHours) {
          const studioDuration = this.getServiceDuration(selected.service);
          totalDuration += studioDuration;
          actualTotalDuration += studioDuration;
        }
      } else if (selected.service.serviceRelationType !== 'hours') {
        const cost = selected.service.cost * selected.quantity * priceMultiplier;
        subtotal += cost;
        if (!useExplicitHours) {
          const serviceDuration = selected.service.timeDuration * selected.quantity;
          totalDuration += serviceDuration;
          actualTotalDuration += serviceDuration;
        }
      }
    });
  
    // Process extra services (like booking component)
    this.selectedExtraServices.forEach(selected => {
      if (!selected.extraService.isDeepCleaning && !selected.extraService.isSuperDeepCleaning) {
        const currentMultiplier = selected.extraService.isSameDayService ? 1 : priceMultiplier;
        
        if (selected.extraService.hasHours) {
          subtotal += selected.extraService.price * selected.hours * currentMultiplier;
          if (!useExplicitHours) {
            const extraDuration = selected.extraService.duration * selected.hours;
            totalDuration += extraDuration;
            actualTotalDuration += extraDuration;
          }
        } else if (selected.extraService.hasQuantity) {
          subtotal += selected.extraService.price * selected.quantity * currentMultiplier;
          if (!useExplicitHours) {
            const extraDuration = selected.extraService.duration * selected.quantity;
            totalDuration += extraDuration;
            actualTotalDuration += extraDuration;
          }
        } else {
          subtotal += selected.extraService.price * currentMultiplier;
          if (!useExplicitHours) {
            totalDuration += selected.extraService.duration;
            actualTotalDuration += selected.extraService.duration;
          }
        }
      } else {
        if (!useExplicitHours) {
          totalDuration += selected.extraService.duration;
          actualTotalDuration += selected.extraService.duration;
        }
      }
    });
  
    // Continue with your existing calculation logic...
  
    // Calculate extra cleaners FIRST (like booking component)
    const extraCleaners = this.getExtraCleanersCount();

    // Calculate base maids count (without extra cleaners)
    let baseMaidsCount = 1;

    if (hasCleanerService) {
      const cleanerService = this.selectedServices.find(s => 
        s.service.serviceRelationType === 'cleaner'
      );
      if (cleanerService) {
        baseMaidsCount = cleanerService.quantity;
      }
      // When cleaners are explicitly selected, use actual duration without division initially
      displayDuration = actualTotalDuration;
    } else {
      const totalHours = totalDuration / 60;
      if (totalHours <= 6) {
        baseMaidsCount = 1;
        displayDuration = totalDuration;
      } else {
        baseMaidsCount = Math.ceil(totalHours / 6);
        displayDuration = totalDuration; // Don't divide yet
      }
    }

    // NOW add extra cleaners to get total maid count
    this.calculatedMaidsCount = baseMaidsCount + extraCleaners;
      
    // FINALLY divide duration by TOTAL maid count (including extra cleaners)
    if (this.calculatedMaidsCount > 1 && !hasCleanerService) {
      // Only divide duration when we have multiple maids and no explicit cleaner service
      displayDuration = Math.ceil(totalDuration / this.calculatedMaidsCount);
    } else if (hasCleanerService && this.calculatedMaidsCount > baseMaidsCount) {
      // If we have explicit cleaners AND extra cleaners, divide by total count
      displayDuration = Math.ceil(actualTotalDuration / this.calculatedMaidsCount);
    }
    
    // Ensure display duration never goes below 1 hour (60 minutes)
    displayDuration = Math.max(displayDuration, 60);

    // Store the actual total duration for backend - ensure minimum 1 hour
    this.actualTotalDuration = Math.max(actualTotalDuration, 60);

    // For display, when using explicit hours, show the hours directly (like booking component)
    if (useExplicitHours && hoursService) {
      displayDuration = hoursService.quantity * 60;
    }

    // Set the final total duration for display
    this.totalDuration = displayDuration;
  
    // Add deep cleaning fee AFTER all other calculations
    subtotal += deepCleaningFee;

    const rawSubTotal = subtotal;

    // Apply discount as a percentage of (new) raw subtotal so changing services/extras updates discount too
    if (this.originalRawSubTotal > 0) {
      this.appliedSubscriptionDiscountAmount = Math.round(rawSubTotal * (this.originalSubscriptionDiscountAmount / this.originalRawSubTotal) * 100) / 100;
      this.appliedDiscountAmount = Math.round(rawSubTotal * (this.originalDiscountAmount / this.originalRawSubTotal) * 100) / 100;
    } else {
      this.appliedSubscriptionDiscountAmount = 0;
      this.appliedDiscountAmount = 0;
    }
    const discountedSubTotal = rawSubTotal - this.appliedDiscountAmount - this.appliedSubscriptionDiscountAmount;
  
    // Make sure we don't go negative
    if (discountedSubTotal < 0) {
      this.newSubTotal = 0;
      this.newTax = 0;
    } else {
      this.newSubTotal = discountedSubTotal;
      this.newTax = Math.round(discountedSubTotal * this.salesTaxRate * 100) / 100;
    }
  
    const tips = this.orderForm.get('tips')?.value || 0;
  
    // Calculate new total
    this.newTotal = this.newSubTotal + this.newTax + tips;
  
    // Apply gift card if applicable
    let finalTotal = this.newTotal;
    if (this.giftCardApplied && this.isGiftCard) {
      const maxGiftCardUse = Math.min(this.giftCardBalance, this.newTotal);
      this.giftCardAmountToUse = maxGiftCardUse;
      finalTotal = Math.max(0, this.newTotal - this.giftCardAmountToUse);
    }

    // Subtract bubble points and reward balance already applied to the original order
    finalTotal = Math.max(0, finalTotal - this.originalPointsRedeemedDiscount - this.originalRewardBalanceUsed);

    this.newTotal = Math.round(finalTotal * 100) / 100;

    // Calculate the additional amount needed
    this.additionalAmount = this.newTotal - this.originalTotal;

    if (Math.abs(this.additionalAmount) < 0.01) {
      this.additionalAmount = 0;
    }

    this.updateEstimatedPoints();
  }

  updateEstimatedPoints(): void {
    if (!this.pointsEnabled || this.pointsPerDollar <= 0) { this.estimatedPoints = 0; return; }
    const tips = this.orderForm?.get('tips')?.value ?? 0;
    const companyTips = this.orderForm?.get('companyDevelopmentTips')?.value ?? 0;
    const base = this.newTotal - this.newTax - tips - companyTips;
    this.estimatedPoints = Math.floor(Math.max(0, base) * this.pointsPerDollar);
  }

  prepareUpdateData(): UpdateOrder {
    const formValue = this.orderForm.value;
    
    // Parse the date string and create a proper Date object
    // The date string is in YYYY-MM-DD format
    const dateParts = formValue.serviceDate.split('-');
    const year = parseInt(dateParts[0]);
    const month = parseInt(dateParts[1]) - 1; // JavaScript months are 0-indexed
    const day = parseInt(dateParts[2]);
    
    // Create date at noon to avoid any timezone edge cases
    const serviceDate = new Date(year, month, day, 12, 0, 0);
    
    // Prepare services with special handling for cleaner/hours relationship
    const services: { serviceId: number; quantity: number }[] = [];
    
    this.selectedServices.forEach(selectedService => {
      const { service, quantity } = selectedService;
      
      // Add all services normally (like booking component)
      services.push({
        serviceId: service.id,
        quantity: quantity
      });
    });
    
    return {
      serviceDate: serviceDate, // Use the properly created Date object
      serviceTime: formValue.serviceTime,
      entryMethod: formValue.entryMethod === 'Other' ? 
        formValue.customEntryMethod : formValue.entryMethod,
      specialInstructions: formValue.specialInstructions || '',
      floorTypes: this.buildFloorTypesString(),
      floorTypeOther: this.floorTypeOther || null,
      contactFirstName: formValue.contactFirstName,
      contactLastName: formValue.contactLastName,
      contactEmail: formValue.contactEmail,
      contactPhone: formValue.contactPhone,
      serviceAddress: formValue.serviceAddress,
      aptSuite: formValue.aptSuite || '',
      city: formValue.city,
      state: formValue.state,
      zipCode: formValue.zipCode,
      services: services,
      extraServices: this.selectedExtraServices.map(s => ({
        extraServiceId: s.extraService.id,
        quantity: s.quantity,
        hours: s.hours
      })),
      tips: formValue.tips || 0,
      companyDevelopmentTips: formValue.companyDevelopmentTips || 0,
      totalDuration: this.actualTotalDuration,
      maidsCount: this.calculatedMaidsCount,
      calculatedSubTotal: this.newSubTotal + this.appliedDiscountAmount + this.appliedSubscriptionDiscountAmount,
      calculatedTax: this.newTax,
      calculatedTotal: this.newTotal,
      discountAmount: this.appliedDiscountAmount,
      subscriptionDiscountAmount: this.appliedSubscriptionDiscountAmount
    };
  }

  hasActualChanges(): boolean {
    if (!this.order) return false;
    
    const formValue = this.orderForm.value;
    
    // Format times for comparison
    const orderServiceTime = this.formatTimeForComparison(this.order.serviceTime);
    const formServiceTime = this.formatTimeForComparison(formValue.serviceTime);
    
    // Check if basic fields changed
    const basicFieldsChanged = 
      this.formatDateForComparison(this.order.serviceDate) !== formValue.serviceDate ||
      orderServiceTime !== formServiceTime ||
      this.order.entryMethod !== (formValue.entryMethod === 'Other' ? formValue.customEntryMethod : formValue.entryMethod) ||
      this.order.specialInstructions !== (formValue.specialInstructions || '') ||
      (this.order.floorTypes || null) !== (this.buildFloorTypesString() || null) ||
      this.order.contactFirstName !== formValue.contactFirstName ||
      this.order.contactLastName !== formValue.contactLastName ||
      this.order.contactEmail !== formValue.contactEmail ||
      this.order.contactPhone !== formValue.contactPhone ||
      this.order.serviceAddress !== formValue.serviceAddress ||
      this.order.aptSuite !== (formValue.aptSuite || '') ||
      this.order.city !== formValue.city ||
      this.order.state !== formValue.state ||
      this.order.zipCode !== formValue.zipCode ||
      this.order.tips !== (formValue.tips || 0) ||
      this.order.companyDevelopmentTips !== (formValue.companyDevelopmentTips || 0);
  
    if (basicFieldsChanged) return true;
  
    // Check if services changed
    const currentServiceIds = this.order.services.map(s => s.serviceId).sort();
    const newServiceIds = this.selectedServices
      .filter(s => s.service.serviceRelationType !== 'hours')
      .map(s => s.service.id).sort();
    
    if (JSON.stringify(currentServiceIds) !== JSON.stringify(newServiceIds)) return true;
  
    // Check if extra services changed
    const currentExtraServiceIds = this.order.extraServices.map(s => s.extraServiceId).sort();
    const newExtraServiceIds = this.selectedExtraServices.map(s => s.extraService.id).sort();
    
    if (JSON.stringify(currentExtraServiceIds) !== JSON.stringify(newExtraServiceIds)) return true;
  
    // Check quantities and hours
    for (const service of this.order.services) {
      const selected = this.selectedServices.find(s => s.service.id === service.serviceId);
      if (!selected || selected.quantity !== service.quantity) return true;
    }
  
    for (const extraService of this.order.extraServices) {
      const selected = this.selectedExtraServices.find(s => s.extraService.id === extraService.extraServiceId);
      if (!selected || selected.quantity !== extraService.quantity || selected.hours !== extraService.hours) return true;
    }
  
    return false;
  }
  
  /** Returns YYYY-MM-DD for the order service date without timezone shift (e.g. 22 stays 22). */
  getOrderServiceDateString(serviceDate: any): string {
    if (typeof serviceDate === 'string') {
      if (serviceDate.includes('T')) {
        return serviceDate.split('T')[0];
      }
      return serviceDate;
    }
    const d = new Date(serviceDate);
    const year = d.getUTCFullYear();
    const month = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  formatDateForComparison(date: any): string {
    if (typeof date === 'string') {
      if (date.includes('T')) {
        return date.split('T')[0];
      }
      return date;
    } else {
      const d = new Date(date);
      const year = d.getUTCFullYear();
      const month = String(d.getUTCMonth() + 1).padStart(2, '0');
      const day = String(d.getUTCDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    }
  }
  
  formatTimeForComparison(time: any): string {
    if (!time) return '';
    
    // If it's already a string
    if (typeof time === 'string') {
      // Extract just HH:mm part (ignore seconds if present)
      if (time.includes(':')) {
        const parts = time.split(':');
        return `${parts[0].padStart(2, '0')}:${parts[1].padStart(2, '0')}`;
      }
      return time;
    }
    
    // If it's an object (like TimeSpan from backend)
    if (typeof time === 'object' && time !== null) {
      if (time.Hours !== undefined && time.Minutes !== undefined) {
        return `${String(time.Hours).padStart(2, '0')}:${String(time.Minutes).padStart(2, '0')}`;
      }
    }
    
    return String(time);
  }

  ngOnDestroy() {
    // Clean up Stripe elements when component is destroyed
    this.stripeService.destroyCardElement();
  }

  onSubmit() {
    if (!this.orderForm.valid || !this.order) {
      this.errorMessage = 'Please fill in all required fields';
      return;
    }

    if (!this.hasActualChanges()) {
      return;
    }

    // Check if the total is being reduced
    if (this.additionalAmount < 0) {
      this.errorMessage = `Cannot reduce order total. The new total would be $${Math.abs(this.additionalAmount).toFixed(2)} less than the original amount paid.`;
      window.scrollTo(0, 0);
      return;
    }

    // Store update data for later use
    this.updateData = this.prepareUpdateData();

    // Check if additional payment is needed
    if (this.additionalAmount > 0) {
      this.showPaymentModal = true;
      // Initialize Stripe elements when modal opens
      setTimeout(() => this.initializeStripeElements(), 100);
    } else {
      this.saveOrder();
    }
  }

  private async initializeStripeElements() {
    try {
      await this.stripeService.initializeElements();
      const cardElement = this.stripeService.createCardElement('card-element-order-edit');
      
      if (cardElement) {
        cardElement.on('change', (event: any) => {
          this.cardError = event.error ? event.error.message : null;
        });
      }
    } catch (error) {
      console.error('Failed to initialize Stripe elements:', error);
      this.paymentErrorMessage = 'Failed to initialize payment form';
    }
  }

  saveOrder() {
    if (!this.order) return;

    this.isSaving = true;
    this.errorMessage = '';
    const updateData = this.updateData || this.prepareUpdateData();

    this.orderService.updateOrder(this.order.id, updateData).subscribe({
      next: (updatedOrder) => {
        this.successMessage = 'Order updated successfully';
        
        // Refresh user profile to ensure phone is updated if changed
        this.authService.refreshUserProfile().subscribe({
          next: () => {
          }
        });
        
        setTimeout(() => {
          this.router.navigate(['/order', this.order!.id]);
        }, 1500);
      },
      error: (error) => {
        console.error('Update error:', error);
        this.errorMessage = error.error?.message || error.error || 'Failed to update order';
        this.isSaving = false;
        window.scrollTo(0, 0);
      }
    });
  }

  async processAdditionalPayment() {
    if (!this.order || !this.updateData || this.isProcessingPayment || this.cardError) return;

    this.isProcessingPayment = true;
    this.paymentErrorMessage = '';

    try {
      // Step 1: Create payment intent for the additional amount
      this.orderService.createUpdatePaymentIntent(this.order.id, this.updateData).subscribe({
        next: async (response) => {
          this.paymentClientSecret = response.paymentClientSecret;

          try {
            // Step 2: Confirm the payment with Stripe
            const paymentIntent = await this.stripeService.confirmCardPayment(
              response.paymentClientSecret,
              this.getBillingDetails()
            );

            // Step 3: Confirm with backend and update the order
            this.orderService.confirmUpdatePayment(
              this.order!.id, 
              paymentIntent.id,
              this.updateData!
            ).subscribe({
              next: (updatedOrder) => {
                this.showPaymentModal = false;
                this.successMessage = 'Order updated successfully';
                
                // Refresh user profile to ensure phone is updated if changed
                this.authService.refreshUserProfile().subscribe({
                  next: () => {
                  }
                });
                
                setTimeout(() => {
                  this.router.navigate(['/order', this.order!.id]);
                }, 1500);
              },
              error: (error) => {
                this.paymentErrorMessage = error.error?.message || 'Failed to update order after payment';
                this.isProcessingPayment = false;
              }
            });
          } catch (paymentError: any) {
            // Payment failed
            this.paymentErrorMessage = paymentError.message || 'Payment failed. Please try again.';
            this.isProcessingPayment = false;
          }
        },
        error: (error) => {
          this.paymentErrorMessage = error.error?.message || 'Failed to create payment';
          this.isProcessingPayment = false;
        }
      });
    } catch (error: any) {
      this.paymentErrorMessage = 'An unexpected error occurred';
      this.isProcessingPayment = false;
    }
  }

  private getBillingDetails() {
    const formValue = this.orderForm.value;
    return {
      name: `${formValue.contactFirstName} ${formValue.contactLastName}`,
      email: formValue.contactEmail,
      phone: formValue.contactPhone,
      address: {
        line1: formValue.serviceAddress,
        line2: formValue.aptSuite || '',
        city: formValue.city,
        state: formValue.state,
        postal_code: formValue.zipCode
      }
    };
  }


  closePaymentModal() {
    if (!this.isProcessingPayment) {
      this.showPaymentModal = false;
      this.paymentErrorMessage = '';
      this.cardError = null;
      // Clean up Stripe elements
      this.stripeService.destroyCardElement();
    }
  }

  getServiceOptions(service: Service): number[] {
    const options: number[] = [];
    const min = service.minValue || 0;
    const max = service.maxValue || 10;
    const step = service.stepValue || 1;
    
    for (let i = min; i <= max; i += step) {
      options.push(i);
    }
    
    return options;
  }

  formatDuration(minutes: number): string {
    // Use rounded duration
    const baseFormat = DurationUtils.formatDurationRounded(minutes);
    
    // Add "per maid" logic (like booking component)
    if (this.calculatedMaidsCount > 1) {
      return `${baseFormat}`;
    }
    return baseFormat;
  }

  formatTime(timeString: string): string {
    if (!timeString) return '';
    const [hours, minutes] = timeString.split(':');
    const hour = parseInt(hours);
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const hour12 = hour % 12 || 12;
    return `${hour12}:${minutes} ${ampm}`;
  }

  formatServiceDuration(minutes: number): string {
    // Use actual duration for individual services
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    
    if (hours === 0) {
      return `${mins}m`;
    } else if (mins === 0) {
      return `${hours}h`;
    } else {
      return `${hours}h ${mins}m`;
    }
  }

  get minDate(): string {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const year = tomorrow.getFullYear();
    const month = String(tomorrow.getMonth() + 1).padStart(2, '0');
    const day = String(tomorrow.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  get tips(): FormControl {
    return this.orderForm.get('tips') as FormControl;
  }

  get companyDevelopmentTips(): FormControl {
    return this.orderForm.get('companyDevelopmentTips') as FormControl;
  }
  
  get totalDurationDisplay(): number {
    return this.totalDuration;
  }

  getSelectedServiceQuantity(service: Service): number {
    const selected = this.selectedServices.find(s => s.service.id === service.id);
    return selected ? selected.quantity : 0;
  }

  getCleaningTypeText(): string {
    const deepCleaning = this.selectedExtraServices.find(s => s.extraService.isDeepCleaning);
    const superDeepCleaning = this.selectedExtraServices.find(s => s.extraService.isSuperDeepCleaning);
    
    if (superDeepCleaning) {
      return 'Super Deep Cleaning';
    } else if (deepCleaning) {
      return 'Deep Cleaning';
    }
    return 'Normal Cleaning';
  }

  getServiceDuration(service: Service): number {
    // Get duration multiplier based on cleaning type
    let durationMultiplier = 1;
    const deepCleaning = this.selectedExtraServices.find(s => s.extraService.isDeepCleaning);
    const superDeepCleaning = this.selectedExtraServices.find(s => s.extraService.isSuperDeepCleaning);

    if (superDeepCleaning) {
      durationMultiplier = superDeepCleaning.extraService.priceMultiplier;
    } else if (deepCleaning) {
      durationMultiplier = deepCleaning.extraService.priceMultiplier;
    }

    // Special handling for studio apartment (bedrooms = 0)
    if (service.serviceKey === 'bedrooms' && this.getServiceQuantity(service) === 0) {
      return Math.round(30 * durationMultiplier); // 20 minutes base for studio, adjusted by cleaning type
    }

    // Apply multiplier to service duration
    return Math.round(service.timeDuration * durationMultiplier);
  }

  getAvailableTimeSlots(): string[] {
    const selectedDate = this.orderForm.get('serviceDate')?.value;
    if (!selectedDate) return [];

    // Time slots from 8:00 AM to 6:00 PM (30-minute intervals) for all days
    const timeSlots = [
      '08:00', '08:30', '09:00', '09:30', '10:00', '10:30', '11:00', '11:30',
      '12:00', '12:30', '13:00', '13:30', '14:00', '14:30', '15:00', '15:30',
      '16:00', '16:30', '17:00', '17:30', '18:00'
    ];

    return timeSlots;
  }

  formatTimeSlot(timeSlot: string): string {
    const [hour, minute] = timeSlot.split(':').map(Number);
    const period = hour >= 12 ? 'PM' : 'AM';
    const displayHour = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
    return `${displayHour}:${minute.toString().padStart(2, '0')} ${period}`;
  }

  private getActiveDeepCleaningExtraService(): ExtraService | null {
    if (!this.serviceType?.extraServices) return null;
    return (
      this.serviceType.extraServices.find(
        (extra) => extra.isDeepCleaning && extra.isActive !== false
      ) || null
    );
  }

  get canShowDeepCleaningOption(): boolean {
    return this.originallyHadDeepCleaning || !!this.getActiveDeepCleaningExtraService();
  }

  // Handle cleaning type selection
  onCleaningTypeChange(cleaningType: string) {
    // Remove any existing deep cleaning or super deep cleaning services
    this.selectedExtraServices = this.selectedExtraServices.filter(
      s => !s.extraService.isDeepCleaning && !s.extraService.isSuperDeepCleaning
    );

    // Add the selected cleaning type if not normal
    if (cleaningType !== 'normal' && this.serviceType) {
      let cleaningService: ExtraService | undefined;

      if (cleaningType === 'deep') {
        // Prefer active deep cleaning; if the order originally had deep cleaning, allow re-selecting it
        cleaningService =
          this.getActiveDeepCleaningExtraService() ||
          (this.originallyHadDeepCleaning
            ? this.serviceType.extraServices.find(extra => extra.isDeepCleaning)
            : undefined);
      } else if (cleaningType === 'super-deep') {
        cleaningService = this.serviceType.extraServices.find(extra => extra.isSuperDeepCleaning);
      }

      if (cleaningService) {
        this.selectedExtraServices.push({
          extraService: cleaningService,
          quantity: 1,
          hours: cleaningService.hasHours ? 0.5 : 0
        });
      }
    }

    this.calculateNewTotal();
  }

  // Get current cleaning type from form
  getCurrentCleaningType(): string {
    const deepCleaning = this.selectedExtraServices.find(s => s.extraService.isDeepCleaning);
    const superDeepCleaning = this.selectedExtraServices.find(s => s.extraService.isSuperDeepCleaning);
    
    if (superDeepCleaning) {
      return 'super-deep';
    } else if (deepCleaning) {
      return 'deep';
    }
    return 'normal';
  }

  getExtraCleanersCount(): number {
    const extraCleanersService = this.selectedExtraServices.find(s => 
      s.extraService.name === 'Extra Cleaners' && s.extraService.hasQuantity
    );
    return extraCleanersService ? extraCleanersService.quantity : 0;
  }

  hasCleanerServices(): boolean {
    return this.selectedServices.some(s => s.service.serviceRelationType === 'cleaner');
  }

  getCleanerPricingText(): string {
    const deepCleaning = this.selectedExtraServices.find(s => s.extraService.isDeepCleaning);
    const superDeepCleaning = this.selectedExtraServices.find(s => s.extraService.isSuperDeepCleaning);
    const pricePerHour = this.getCleanerPricePerHour();
    
    if (superDeepCleaning) {
      return `Hourly Service: $${pricePerHour} per hour/per cleaner <span class="cleaning-type-red">(Super Deep Cleaning)</span>`;
    } else if (deepCleaning) {
      return `Hourly Service: $${pricePerHour} per hour/per cleaner <span class="cleaning-type-red">(Deep Cleaning)</span>`;
    }
    return `Hourly Service: $${pricePerHour} per hour/per cleaner`;
  }

  getCleanerPricePerHour(): number {
    const deepCleaning = this.selectedExtraServices.find(s => s.extraService.isDeepCleaning);
    const superDeepCleaning = this.selectedExtraServices.find(s => s.extraService.isSuperDeepCleaning);
    
    // Get the actual cleaner service cost from the selected services
    const cleanerService = this.selectedServices.find(s => s.service.serviceRelationType === 'cleaner');
    const basePrice = cleanerService ? cleanerService.service.cost : 40; // fallback to 40 if no cleaner service found
    
    if (superDeepCleaning) {
      return basePrice * superDeepCleaning.extraService.priceMultiplier;
    } else if (deepCleaning) {
      return basePrice * deepCleaning.extraService.priceMultiplier;
    }
    
    return basePrice; // regular cleaning - no multiplier
  }

  getExtraServiceIcon(extraService: ExtraService): string {
    const serviceName = extraService.name.toLowerCase();
    
    if (serviceName.includes('same day')) return 'fas fa-bolt';
    if (serviceName.includes('extra cleaners')) return 'fas fa-users';
    if (serviceName.includes('extra minutes')) return 'fas fa-clock';
    if (serviceName.includes('cleaning supplies')) return 'fas fa-spray-can';
    if (serviceName.includes('vacuum cleaner')) return 'fas fa-stethoscope fa-flip-vertical';
    if (serviceName.includes('pets')) return 'fas fa-paw';
    if (serviceName.includes('fridge')) return 'fas fa-toilet-portable';
    if (serviceName.includes('oven')) return 'fas fa-pager fa-flip-vertical';
    if (serviceName.includes('kitchen cabinets')) return 'fas fa-box-archive';
    if (serviceName.includes('closets')) return 'fas fa-calendar-week fa-flip-vertical';
    if (serviceName.includes('dishes')) return 'fas fa-utensils';
    if (serviceName.includes('baseboards')) return 'fas fa-ruler-horizontal';
    if (serviceName.includes('windows')) return 'fas fa-table';
    if (serviceName.includes('walls')) return 'fas fa-clapperboard fa-flip-vertical';
    if (serviceName.includes('stairs')) return 'fas fa-stairs';
    if (serviceName.includes('folding') || serviceName.includes('folding / organizing')) return 'fas fa-layer-group';
    if (serviceName.includes('laundry')) return 'fas fa-camera-retro';
    if (serviceName.includes('balcony')) return 'fas fa-store';
    if (serviceName.includes('office')) return 'fas fa-building';
    if (serviceName.includes('couches')) return 'fas fa-couch';
    
    // Default icon for unknown services
    return 'fas fa-plus';
  }

  getExtraServiceImage(extraService: ExtraService, isSelected: boolean): string {
    const serviceName = extraService.name.toLowerCase();
    const suffix = isSelected ? '' : '_disabled';
    
    // Map service names to PNG image paths
    if (serviceName.includes('same day')) return `/images/same_day${suffix}.png`;
    if (serviceName.includes('extra cleaners')) return `/images/extra_cleaners${suffix}.png`;
    if (serviceName.includes('extra minutes')) return `/images/extra_minutes${suffix}.png`;
    if (serviceName.includes('cleaning supplies')) return `/images/cleaning_supplies${suffix}.png`;
    if (serviceName.includes('vacuum cleaner')) return `/images/vacuum_cleaner${suffix}.png`;
    if (serviceName.includes('pets')) return `/images/pets${suffix}.png`;
    if (serviceName.includes('fridge')) return `/images/fridge${suffix}.png`;
    if (serviceName.includes('oven')) return `/images/oven${suffix}.png`;
    if (serviceName.includes('kitchen cabinets')) return `/images/kitchen_cabinets${suffix}.png`;
    if (serviceName.includes('closets')) return `/images/closets${suffix}.png`;
    if (serviceName.includes('dishes')) return `/images/dishes${suffix}.png`;
    if (serviceName.includes('baseboards')) return `/images/baseboards${suffix}.png`;
    if (serviceName.includes('windows')) return `/images/windows${suffix}.png`;
    if (serviceName.includes('walls')) return `/images/walls${suffix}.png`;
    if (serviceName.includes('stairs')) return `/images/stairs${suffix}.png`;
    if (serviceName.includes('folding') || serviceName.includes('folding / organizing')) return `/images/folding${suffix}.png`;
    if (serviceName.includes('laundry')) return `/images/laundry${suffix}.png`;
    if (serviceName.includes('balcony')) return `/images/balcony${suffix}.png`;
    if (serviceName.includes('office')) return `/images/office${suffix}.png`;
    if (serviceName.includes('couches')) return `/images/couches${suffix}.png`;
    if (serviceName.includes('chandelier')) return `/images/chandelier${suffix}.png`;
    
    // Default image for unknown services
    return `/images/default_icon${suffix}.png`;
  }

  getExtraServiceTooltip(extra: ExtraService): string {
    let tooltip = extra.description || '';
    
    // Add additional info for Extra Cleaners
    if (extra.name === 'Extra Cleaners') {
      tooltip += '\n\nEach extra cleaner reduces service duration.';
    }
    
    return tooltip;
  }

  get cleaningType() {
    return this.orderForm.get('cleaningType') as FormControl;
  }

  selectCleaningType(cleaningType: string) {
    // Normalize 'regular' to 'normal' to match booking component
    const normalizedType = cleaningType === 'regular' ? 'normal' : cleaningType;
    const finalType =
      normalizedType === 'deep' && !this.canShowDeepCleaningOption ? 'normal' : normalizedType;
    this.cleaningType.setValue(finalType);
    this.cleaningType.markAsTouched();
    this.onCleaningTypeChange(finalType);
  }

  onDateChange(date: string) {
    this.orderForm.patchValue({ serviceDate: date });
  }

  onTimeChange(time: string) {
    this.orderForm.patchValue({ serviceTime: time });
  }

  toggleOrderSummary() {
    this.isSummaryCollapsed = !this.isSummaryCollapsed;
    
    // Scroll to the order summary only in browser
    if (this.isBrowser) {
      setTimeout(() => {
        const summaryElement = document.querySelector('.order-summary');
        if (summaryElement) {
          summaryElement.scrollIntoView({ 
            behavior: 'smooth', 
            block: 'start' 
          });
        }
      }, 100);
    }
  }

  private updateSummaryCollapseState() {
    if (this.isBrowser && window.innerWidth <= 1200) {
      this.isSummaryCollapsed = true;
    } else {
      this.isSummaryCollapsed = false;
    }
  }

  toggleTipDropdown() {
    this.tipDropdownOpen = !this.tipDropdownOpen;
  }

  selectTipPreset(amount: number) {
    this.tips.setValue(amount);
    this.tipDropdownOpen = false;
    this.calculateNewTotal();
  }

  private setupDropdownClickOutside() {
    // Only execute in browser environment
    if (!this.isBrowser) return;
    
    document.addEventListener('click', (event) => {
      const target = event.target as HTMLElement;
      if (!target.closest('.tip-dropdown')) {
        this.tipDropdownOpen = false;
      }
    });
  }

  parseFloorTypesFromOrder(order: Order): void {
    if (!order.floorTypes) {
      this.floorTypes = [];
      this.floorTypeOther = '';
      return;
    }
    const types: string[] = [];
    let otherText = order.floorTypeOther || '';
    order.floorTypes.split(',').forEach(t => {
      const trimmed = t.trim();
      if (trimmed.startsWith('other:')) {
        types.push('other');
        otherText = trimmed.substring(6).trim();
      } else {
        types.push(trimmed);
      }
    });
    this.floorTypes = types;
    this.floorTypeOther = otherText;
  }

  onFloorTypeSelectionChange(selection: FloorTypeSelection): void {
    this.floorTypes = selection.types;
    this.floorTypeOther = selection.otherText;
  }

  buildFloorTypesString(): string | null {
    if (!this.floorTypes.length) return null;
    return this.floorTypes.map(t => {
      if (t === 'other' && this.floorTypeOther) return `other:${this.floorTypeOther}`;
      return t;
    }).join(',');
  }
}