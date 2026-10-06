import { Component, OnInit, ChangeDetectorRef, AfterViewInit, OnDestroy, ElementRef, HostListener, ChangeDetectionStrategy, inject, viewChild, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  AdminService, CreateService, CreateExtraService, UserPermissions,
  SaveServiceThreshold, SaveServiceRateTier,
  PricingConfiguration, PricingConfigurationDiff
} from '../../../services/admin.service';
import { ServiceType, Service, ExtraService, ServiceThreshold, ServiceRateTier } from '../../../services/booking.service';
import { extractApiErrorMessage } from '../../../utils/http-error.utils';
import { DISPLAY_PRICE_UNITS, DisplayPriceUnit } from '../../../shared/pricing/display-price';

export interface PollQuestion {
  id: number;
  question: string;
  questionType: string;
  options?: string;
  isRequired: boolean;
  displayOrder: number;
  isActive: boolean;
  serviceTypeId: number;
}

export interface CreatePollQuestion {
  question: string;
  questionType: string;
  options?: string;
  isRequired: boolean;
  displayOrder: number;
  serviceTypeId: number;
}

@Component({
  selector: 'app-booking-services',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './booking-services.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ['./booking-services.component.scss']
})
export class BookingServicesComponent implements OnInit, AfterViewInit, OnDestroy {
  private adminService = inject(AdminService);
  private cdr = inject(ChangeDetectorRef);

  readonly serviceTypesTableWrapper = viewChild<ElementRef<HTMLDivElement>>('serviceTypesTableWrapper');
  readonly serviceTypesTableHeader = viewChild<ElementRef<HTMLTableSectionElement>>('serviceTypesTableHeader');
  readonly pollTableWrapper = viewChild<ElementRef<HTMLDivElement>>('pollTableWrapper');
  readonly pollTableHeader = viewChild<ElementRef<HTMLTableSectionElement>>('pollTableHeader');
  readonly servicesTableWrapper = viewChild<ElementRef<HTMLDivElement>>('servicesTableWrapper');
  readonly servicesTableHeader = viewChild<ElementRef<HTMLTableSectionElement>>('servicesTableHeader');
  readonly extraServicesTableWrapper = viewChild<ElementRef<HTMLDivElement>>('extraServicesTableWrapper');
  readonly extraServicesTableHeader = viewChild<ElementRef<HTMLTableSectionElement>>('extraServicesTableHeader');
  
  // Sticky header management
  private scrollListener?: () => void;
  private horizontalScrollListeners = new Map<HTMLElement, () => void>();
  private stickyHeadersInitialized = new Set<string>();
  private initializationRetries = 0;
  private readonly maxRetries = 20;
  
  get headerStickyOffset(): number {
    if (window.innerWidth <= 768) {
      return 60;
    }
    return 80;
  }
  // Service Types
  readonly serviceTypes = signal<ServiceType[]>([], { equal: () => false });
  readonly allServices = signal<Service[]>([]);
  readonly allExtraServices = signal<ExtraService[]>([]);
  readonly selectedServiceType = signal<ServiceType | null>(null, { equal: () => false });
  readonly isEditingServiceType = signal(false);
  readonly isAddingServiceType = signal(false);
  readonly displayPriceUnits = DISPLAY_PRICE_UNITS;
  readonly newServiceType = signal({
    name: '',
    basePrice: 0,
    description: '',
    displayOrder: 1,
    timeDuration: 90,
    hasPoll: false,
    isCustom: false,
    // Defaults true, matching the NOT NULL column default: a new type asks apartment vs house
    // unless an admin turns it off.
    collectsPropertyType: true,
    minimumPrice: 0,
    serviceKey: '',
    displayPrice: null as number | null,
    displayPriceUnit: null as DisplayPriceUnit | null
  });

  // Services
  readonly isAddingService = signal(false);
  readonly editingServiceId = signal<number | null>(null);
  readonly newService = signal<CreateService>({
    name: '',
    serviceKey: '',
    cost: 0,
    timeDuration: 0,
    serviceTypeId: 0,
    inputType: 'dropdown',
    minValue: 0,
    maxValue: 10,
    stepValue: 1,
    isRangeInput: false,
    unit: '',
    serviceRelationType: '',
    displayOrder: 1,
    chargeAboveThreshold: false,
    zeroQuantityCost: null,
    zeroQuantityDuration: null
  }, { equal: () => false });
  readonly selectedExistingServiceId = signal<number | null>(null);
  readonly showExistingServices = signal(false);

  // ===== Pricing configuration: included amounts + rate tiers =====
  // One service row expands at a time; its threshold and tier editors live inside that row.
  readonly expandedPricingServiceId = signal<number | null>(null);
  readonly pricingRowMessage = signal<{ error: string; success: string }>({ error: '', success: '' }, { equal: () => false });

  readonly editingThresholdId = signal<number | null>(null);
  readonly newThreshold = signal<SaveServiceThreshold>({ sourceServiceId: 0, sourceQuantity: 0, includedQuantity: 0 });
  readonly isAddingThreshold = signal(false);

  readonly editingRateTierId = signal<number | null>(null);
  readonly newRateTier = signal<SaveServiceRateTier>({ fromQuantity: 0, cost: 0, timeDuration: 0, displayOrder: 0 });
  readonly isAddingRateTier = signal(false);

  // ===== Export / import =====
  readonly showPricingConfigPanel = signal(false);
  readonly pricingConfigJson = signal('');
  readonly pricingConfigDiff = signal<PricingConfigurationDiff | null>(null);
  readonly pricingConfigBusy = signal(false);
  readonly pricingConfigMessage = signal<{ error: string; success: string }>({ error: '', success: '' }, { equal: () => false });
  private pendingPricingConfig: PricingConfiguration | null = null;
  
  // Extra Services  
  readonly isAddingExtraService = signal(false);
  readonly editingExtraServiceId = signal<number | null>(null);
  readonly newExtraService = signal<CreateExtraService>({
    name: '',
    description: '',
    price: 0,
    duration: 0,
    icon: '',
    hasQuantity: false,
    hasHours: false,
    isDeepCleaning: false,
    isSuperDeepCleaning: false,
    isSameDayService: false,
    priceMultiplier: 1.0,
    serviceTypeId: undefined,
    isAvailableForAll: true,
    displayOrder: 1,
    extraServiceKey: ''
  }, { equal: () => false });
  readonly selectedExistingExtraServiceId = signal<number | null>(null);
  readonly showExistingExtraServices = signal(false);

  // Permissions
  readonly userRole = signal<string>('');
  readonly userPermissions = signal<UserPermissions>({
    role: '',
    permissions: {
      canView: false,
      canCreate: false,
      canUpdate: false,
      canDelete: false,
      canActivate: false,
      canDeactivate: false
    }
  }, { equal: () => false });

  // Messages for each section
  readonly serviceTypeMessage = signal({ error: '', success: '' }, { equal: () => false });
  readonly serviceMessage = signal({ error: '', success: '' }, { equal: () => false });
  readonly extraServiceMessage = signal({ error: '', success: '' }, { equal: () => false });

  // Poll Questions
  readonly pollQuestions = signal<PollQuestion[]>([], { equal: () => false });
  readonly isAddingPollQuestion = signal(false);
  readonly editingPollQuestionId = signal<number | null>(null);
  readonly newPollQuestion = signal<CreatePollQuestion>({
    question: '',
    questionType: 'text',
    options: '',
    isRequired: false,
    displayOrder: 1,
    serviceTypeId: 0
  });

  // Question types
  questionTypes = [
    { value: 'text', label: 'Text Input' },
    { value: 'textarea', label: 'Textarea' },
    { value: 'dropdown', label: 'Dropdown' },
    { value: 'radio', label: 'Radio Buttons' },
    { value: 'checkbox', label: 'Checkboxes' }
  ];

  // Messages for poll questions
  readonly pollQuestionMessage = signal({ success: '', error: '' }, { equal: () => false });

  // Helper method to clear messages
  private clearMessages() {
    this.serviceTypeMessage.set({ error: '', success: '' });
    this.serviceMessage.set({ error: '', success: '' });
    this.extraServiceMessage.set({ error: '', success: '' });
  }

  ngOnInit() {
    this.loadUserPermissions();
    this.loadServiceTypes();
    this.loadAllServices();
    this.loadAllExtraServices();
  }

  ngAfterViewInit() {
    // Initialize sticky headers after view is ready
    setTimeout(() => {
      this.initializeAllStickyHeaders();
    }, 100);
  }

  ngOnDestroy() {
    // Clean up scroll listeners
    if (this.scrollListener) {
      window.removeEventListener('scroll', this.scrollListener, true);
    }
    
    // Clean up horizontal scroll listeners
    this.horizontalScrollListeners.forEach((listener, element) => {
      element.removeEventListener('scroll', listener);
      element.removeEventListener('touchmove', listener);
      element.removeEventListener('wheel', listener);
    });
    this.horizontalScrollListeners.clear();
  }

  @HostListener('window:resize')
  onResize() {
    // Update all sticky headers on window resize
    this.updateAllStickyHeaders();
  }

  private initializeAllStickyHeaders() {
    const tables = [
      { key: 'serviceTypes', wrapper: this.serviceTypesTableWrapper(), header: this.serviceTypesTableHeader() },
      { key: 'poll', wrapper: this.pollTableWrapper(), header: this.pollTableHeader() },
      { key: 'services', wrapper: this.servicesTableWrapper(), header: this.servicesTableHeader() },
      { key: 'extraServices', wrapper: this.extraServicesTableWrapper(), header: this.extraServicesTableHeader() }
    ];

    tables.forEach(({ key, wrapper, header }) => {
      if (wrapper && header) {
        this.initializeStickyHeader(key, wrapper, header);
      }
    });
  }

  private initializeStickyHeader(key: string, wrapper: ElementRef<HTMLDivElement>, header: ElementRef<HTMLTableSectionElement>) {
    if (!wrapper || !header || !wrapper.nativeElement || !header.nativeElement) {
      if (this.initializationRetries < this.maxRetries) {
        this.initializationRetries++;
        setTimeout(() => this.initializeStickyHeader(key, wrapper, header), 50);
      }
      return;
    }

    if (this.stickyHeadersInitialized.has(key)) {
      this.updateStickyHeader(wrapper, header);
      return;
    }

    // Set up vertical scroll listener (only once for all tables)
    if (!this.scrollListener) {
      this.scrollListener = () => {
        this.updateAllStickyHeaders();
      };
      window.addEventListener('scroll', this.scrollListener, true);
    }

    // Set up horizontal scroll listener for this specific table
    const horizontalListener = () => {
      this.syncHorizontalScroll(wrapper, header);
    };
    const wrapperEl = wrapper.nativeElement;
    wrapperEl.addEventListener('scroll', horizontalListener, { passive: true });
    wrapperEl.addEventListener('touchmove', horizontalListener, { passive: true });
    wrapperEl.addEventListener('wheel', horizontalListener, { passive: true });
    this.horizontalScrollListeners.set(wrapperEl, horizontalListener);

    this.stickyHeadersInitialized.add(key);
    this.updateStickyHeader(wrapper, header);
  }

  private updateAllStickyHeaders() {
    const tables = [
      { wrapper: this.serviceTypesTableWrapper(), header: this.serviceTypesTableHeader() },
      { wrapper: this.pollTableWrapper(), header: this.pollTableHeader() },
      { wrapper: this.servicesTableWrapper(), header: this.servicesTableHeader() },
      { wrapper: this.extraServicesTableWrapper(), header: this.extraServicesTableHeader() }
    ];

    tables.forEach(({ wrapper, header }) => {
      if (wrapper?.nativeElement && header?.nativeElement) {
        try {
          this.updateStickyHeader(wrapper, header);
        } catch (error) {
          // Silently ignore errors to prevent blocking rendering
        }
      }
    });
  }

  private updateStickyHeader(wrapper: ElementRef<HTMLDivElement> | undefined, header: ElementRef<HTMLTableSectionElement> | undefined) {
    if (!wrapper || !header || !wrapper.nativeElement || !header.nativeElement) {
      return;
    }

    const wrapperEl = wrapper.nativeElement;
    const headerEl = header.nativeElement;
    const rect = wrapperEl.getBoundingClientRect();
    const offset = this.headerStickyOffset;
    
    const shouldBeSticky = rect.top <= offset;
    
    if (shouldBeSticky) {
      const table = headerEl.closest('table') as HTMLTableElement;
      if (!table) return;
      
      const headerCells = headerEl.querySelectorAll('th');
      const firstDataRow = table.querySelector('tbody tr') as HTMLTableRowElement;
      
      // Capture widths BEFORE making header sticky
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
      
      const wrapperLeft = rect.left;
      const tableRect = table.getBoundingClientRect();
      const tableWidth = tableRect.width;
      
      // Make header sticky
      headerEl.style.position = 'fixed';
      headerEl.style.top = `${offset}px`;
      headerEl.style.left = `${wrapperLeft}px`;
      headerEl.style.width = `${tableWidth}px`;
      headerEl.style.zIndex = '100';
      headerEl.style.backgroundColor = '#f8f9fa';
      headerEl.style.display = 'table-header-group';
      headerEl.style.tableLayout = 'fixed';
      headerEl.style.overflow = 'hidden';
      
      const initialScrollLeft = wrapperEl.scrollLeft;
      headerEl.style.transform = `translate3d(-${initialScrollLeft}px, 0, 0)`;
      headerEl.style.webkitTransform = `translate3d(-${initialScrollLeft}px, 0, 0)`;
      
      const headerRow = headerEl.querySelector('tr') as HTMLTableRowElement;
      if (headerRow) {
        headerRow.style.overflow = 'visible';
        headerRow.style.width = `${tableWidth}px`;
      }
      
      // Apply captured widths to header cells
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
      
      // Preserve widths on data cells
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
        this.syncHorizontalScroll(wrapper, header);
      }, 0);
    } else {
      // Reset to normal positioning
      headerEl.style.position = '';
      headerEl.style.top = '';
      headerEl.style.left = '';
      headerEl.style.width = '';
      headerEl.style.zIndex = '';
      headerEl.style.transform = '';
      headerEl.style.webkitTransform = '';
      headerEl.style.display = '';
      headerEl.style.tableLayout = '';
      headerEl.style.overflow = '';
      
      const headerRow = headerEl.querySelector('tr') as HTMLTableRowElement;
      if (headerRow) {
        headerRow.style.overflow = '';
        headerRow.style.width = '';
      }
      
      const headerCells = headerEl.querySelectorAll('th');
      headerCells.forEach((cell: Element) => {
        const cellElement = cell as HTMLElement;
        cellElement.style.width = '';
        cellElement.style.minWidth = '';
        cellElement.style.maxWidth = '';
        cellElement.style.display = '';
        cellElement.style.overflow = '';
        cellElement.style.textOverflow = '';
      });
      
      const table = headerEl.closest('table') as HTMLTableElement;
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

  private syncHorizontalScroll(wrapper: ElementRef<HTMLDivElement>, header: ElementRef<HTMLTableSectionElement>) {
    if (!wrapper || !header) {
      return;
    }

    const wrapperEl = wrapper.nativeElement;
    const headerEl = header.nativeElement;
    
    if (headerEl.style.position === 'fixed') {
      const scrollLeft = wrapperEl.scrollLeft;
      const wrapperRect = wrapperEl.getBoundingClientRect();
      const wrapperLeft = wrapperRect.left;
      
      headerEl.style.left = `${wrapperLeft}px`;
      headerEl.style.transform = `translate3d(-${scrollLeft}px, 0, 0)`;
      headerEl.style.webkitTransform = `translate3d(-${scrollLeft}px, 0, 0)`;
      headerEl.style.willChange = 'transform';
    }
  }

  loadUserPermissions() {
    this.adminService.getUserPermissions().subscribe({
      next: (response) => {
        this.userRole.set(response.role);
        this.userPermissions.set(response);
      },
      error: (error) => {
        console.error('Error loading permissions:', error);
        this.serviceTypeMessage().error = 'Failed to load permissions. Please try again.';
        this.serviceTypeMessage.set(this.serviceTypeMessage());
      }
    });
  }

  // Service Types Methods
  loadServiceTypes() {
    const previouslySelectedId = this.selectedServiceType()?.id ?? null;
    this.adminService.getServiceTypes().subscribe({
      next: (types) => {       
        // Sort by displayOrder
        this.serviceTypes.set(types.sort((a, b) => 
          (a.displayOrder || 0) - (b.displayOrder || 0)
        ));
        
        // Also sort services within each type
        this.serviceTypes().forEach(type => {
          if (type.services) {
            type.services.sort((a, b) => 
              (a.displayOrder || 0) - (b.displayOrder || 0)
            );
          }

          if (type.extraServices) {
            type.extraServices.sort((a, b) => 
              (a.displayOrder || 0) - (b.displayOrder || 0)
            );
          }
        });

        // Keep selection stable across reloads so we always reflect backend state
        if (previouslySelectedId) {
          const refreshed = this.serviceTypes().find(t => t.id === previouslySelectedId) || null;
          this.selectedServiceType.set(refreshed);
          // Load poll questions when restoring selection so they are visible after refresh (e.g. when service type is inactive)
          if (refreshed?.hasPoll) {
            this.loadPollQuestions();
          }
        }
      },
      error: (error) => {
        console.error('Error loading service types:', error);
        this.serviceTypeMessage().error = 'Failed to load service types. Please try again.';
        this.serviceTypeMessage.set(this.serviceTypeMessage());
      }
    });
  }

  loadAllServices() {
    if (this.serviceTypes().length === 0) {
      this.adminService.getServiceTypes().subscribe({
        next: (types) => {
          this.serviceTypes.set(types);
          this.adminService.getServices().subscribe({
            next: (services) => {
              this.allServices.set(services);
            },
            error: (error) => {
              console.error('Error loading services:', error);
              this.serviceMessage().error = 'Failed to load services. Please try again.';
              this.serviceMessage.set(this.serviceMessage());
            }
          });
        },
        error: (error) => {
          console.error('Error loading service types:', error);
          this.serviceTypeMessage().error = 'Failed to load service types. Please try again.';
          this.serviceTypeMessage.set(this.serviceTypeMessage());
        }
      });
    } else {
      this.adminService.getServices().subscribe({
        next: (services) => {
          this.allServices.set(services);
        },
        error: (error) => {
          console.error('Error loading services:', error);
          this.serviceMessage().error = 'Failed to load services. Please try again.';
          this.serviceMessage.set(this.serviceMessage());
        }
      });
    }
  }

  loadAllExtraServices() {
    this.adminService.getExtraServices().subscribe({
      next: (services) => {
        this.allExtraServices.set(services);
      },
      error: (error) => {
        console.error('Error loading extra services:', error);
        this.extraServiceMessage().error = 'Failed to load extra services. Please try again.';
        this.extraServiceMessage.set(this.extraServiceMessage());
      }
    });
  }

  getServiceTypeNameById(serviceTypeId: number | undefined | null): string {
    if (!serviceTypeId) return 'Unknown';
    const serviceType = this.serviceTypes().find(t => t.id === serviceTypeId);
    return serviceType ? serviceType.name : 'Unknown';
  }

  selectServiceType(type: ServiceType) {
    this.selectedServiceType.set(type);
    this.isAddingServiceType.set(false);
    this.isAddingService.set(false);
    this.isAddingExtraService.set(false);
    this.isAddingPollQuestion.set(false);
    this.editingPollQuestionId.set(null);

    if (type.hasPoll) {
      this.loadPollQuestions();
    }
  }

  startAddingServiceType() {
    this.isAddingServiceType.set(true);
    this.isEditingServiceType.set(false);
    this.selectedServiceType.set(null);
    this.newServiceType.set({
      name: '',
      basePrice: 0,
      description: '',
      displayOrder: this.serviceTypes().length + 1,
      timeDuration: 90,
      hasPoll: false,
      isCustom: false,
      collectsPropertyType: true,
      minimumPrice: 0,
      serviceKey: '',
      displayPrice: null,
      displayPriceUnit: null
    });
  }

  cancelAddServiceType() {
    this.isAddingServiceType.set(false);
    this.newServiceType.set({
      name: '',
      basePrice: 0,
      description: '',
      displayOrder: 1,
      timeDuration: 90,
      hasPoll: false,
      isCustom: false,
      collectsPropertyType: true,
      minimumPrice: 0,
      serviceKey: '',
      displayPrice: null,
      displayPriceUnit: null
    });
  }

  addServiceType() {
    this.adminService.createServiceType(this.newServiceType()).subscribe({
      next: (response) => {
        this.serviceTypes().push(response);
        this.serviceTypes.set(this.serviceTypes());
        this.isAddingServiceType.set(false);
        this.newServiceType.set({
          name: '',
          basePrice: 0,
          description: '',
          displayOrder: 1,
          timeDuration: 90,
          hasPoll: false,
          isCustom: false,
          collectsPropertyType: true,
          minimumPrice: 0,
          serviceKey: '',
          displayPrice: null,
          displayPriceUnit: null
        });
        this.serviceTypeMessage().success = 'Service type added successfully.';
        this.serviceTypeMessage.set(this.serviceTypeMessage());
      },
      error: (error) => {
        console.error('Error creating service type:', error);
        // Names the actual problem (e.g. a duplicate or badly formatted service key).
        this.serviceTypeMessage().error = extractApiErrorMessage(error, 'Failed to create service type. Please try again.');
        this.serviceTypeMessage.set(this.serviceTypeMessage());
      }
    });
  }

  displayPriceUnitLabel(unit: string | null | undefined): string {
    return DISPLAY_PRICE_UNITS.find(u => u.value === unit)?.label ?? '';
  }

  editServiceType() {
    this.isEditingServiceType.set(true);
  }

  cancelEditServiceType() {
    this.isEditingServiceType.set(false);
  }

  /**
   * Toggles whether this service type asks apartment vs house.
   *
   * Independent of the regular/poll/custom mode: the two answer different questions, and the flag
   * exists precisely because two types with identical mode and identical structure (Office and
   * Heavy Conditional) need different answers here.
   */
  setCollectsPropertyType(collects: boolean) {
    if (!this.selectedServiceType()) return;
    this.selectedServiceType()!.collectsPropertyType = collects;
    this.selectedServiceType.set(this.selectedServiceType());
  }

  setServiceTypeMode(mode: 'regular' | 'poll' | 'custom') {
    if (!this.selectedServiceType()) return;
    
    switch(mode) {
      case 'regular':
        this.selectedServiceType()!.hasPoll = false;
        this.selectedServiceType.set(this.selectedServiceType());
        this.selectedServiceType()!.isCustom = false;
        this.selectedServiceType.set(this.selectedServiceType());
        break;
      case 'poll':
        this.selectedServiceType()!.hasPoll = true;
        this.selectedServiceType.set(this.selectedServiceType());
        this.selectedServiceType()!.isCustom = false;
        this.selectedServiceType.set(this.selectedServiceType());
        break;
      case 'custom':
        this.selectedServiceType()!.hasPoll = false;
        this.selectedServiceType.set(this.selectedServiceType());
        this.selectedServiceType()!.isCustom = true;
        this.selectedServiceType.set(this.selectedServiceType());
        break;
    }
  }

  saveServiceType() {
    if (this.selectedServiceType()) {
      const updateData = {
        name: this.selectedServiceType()!.name,
        basePrice: this.selectedServiceType()!.basePrice,
        description: this.selectedServiceType()!.description,
        displayOrder: this.selectedServiceType()!.displayOrder || 1,
        timeDuration: this.selectedServiceType()!.timeDuration,
        hasPoll: this.selectedServiceType()!.hasPoll,
        isCustom: this.selectedServiceType()!.isCustom,
        // Must be sent: the update DTO defaults it to true, so leaving it out re-ticked
        // "Ask apartment / house" on every save. Absent on the row still means true.
        collectsPropertyType: this.selectedServiceType()!.collectsPropertyType !== false,
        minimumPrice: this.selectedServiceType()!.minimumPrice ?? 0,
        // Always sent: the endpoint treats the value as the full intended key, so leaving it
        // out of an ordinary name/price edit would clear it.
        serviceKey: this.selectedServiceType()!.serviceKey ?? null,
        // Same "full intended value" contract as the key. An emptied number input binds as null
        // (or '' on some browsers), both meaning "no display price".
        displayPrice: typeof this.selectedServiceType()!.displayPrice === 'number' ? this.selectedServiceType()!.displayPrice : null,
        displayPriceUnit: this.selectedServiceType()!.displayPriceUnit ?? null
      };
      this.adminService.updateServiceType(this.selectedServiceType()!.id, updateData).subscribe({
        next: (response) => {
          const index = this.serviceTypes().findIndex(t => t.id === response.id);
          if (index !== -1) {
            this.serviceTypes()[index] = response;
            this.serviceTypes.set(this.serviceTypes());
          }
          this.loadServiceTypes();
          this.isEditingServiceType.set(false);
          this.serviceTypeMessage().success = 'Service type updated successfully.';
          this.serviceTypeMessage.set(this.serviceTypeMessage());
        },
        error: (error) => {
          console.error('Error updating service type:', error);
          this.serviceTypeMessage().error = extractApiErrorMessage(error, 'Failed to update service type. Please try again.');
          this.serviceTypeMessage.set(this.serviceTypeMessage());
        }
      });
    }
  }

  deleteServiceType(type: ServiceType) {
    if (confirm('Are you sure you want to delete this service type?')) {
      this.adminService.deleteServiceType(type.id).subscribe({
        next: () => {
          this.serviceTypes.set(this.serviceTypes().filter(t => t.id !== type.id));
          if (this.selectedServiceType()?.id === type.id) {
            this.selectedServiceType.set(null);
          }
          this.serviceTypeMessage().success = 'Service type deleted successfully.';
          this.serviceTypeMessage.set(this.serviceTypeMessage());
        },
        error: (error) => {
          console.error('Error deleting service type:', error);
          this.serviceTypeMessage().error = 'Failed to delete service type. Please try again.';
          this.serviceTypeMessage.set(this.serviceTypeMessage());
        }
      });
    }
  }

  deactivateServiceType(type: ServiceType) {
    this.adminService.deactivateServiceType(type.id).subscribe({
      next: (response) => {
        const index = this.serviceTypes().findIndex(t => t.id === type.id);
        if (index !== -1) {
          this.serviceTypes()[index] = { ...this.serviceTypes()[index], isActive: false };
          this.serviceTypes.set(this.serviceTypes());
        }
        this.serviceTypeMessage().success = 'Service type deactivated successfully.';
        this.serviceTypeMessage.set(this.serviceTypeMessage());
      },
      error: (error) => {
        console.error('Error deactivating service type:', error);
        this.serviceTypeMessage().error = 'Failed to deactivate service type. Please try again.';
        this.serviceTypeMessage.set(this.serviceTypeMessage());
      }
    });
  }

  activateServiceType(type: ServiceType) {
    this.adminService.activateServiceType(type.id).subscribe({
      next: (response) => {
        const index = this.serviceTypes().findIndex(t => t.id === type.id);
        if (index !== -1) {
          this.serviceTypes()[index] = { ...this.serviceTypes()[index], isActive: true };
          this.serviceTypes.set(this.serviceTypes());
        }
        this.serviceTypeMessage().success = 'Service type activated successfully.';
        this.serviceTypeMessage.set(this.serviceTypeMessage());
      },
      error: (error) => {
        console.error('Error activating service type:', error);
        this.serviceTypeMessage().error = 'Failed to activate service type. Please try again.';
        this.serviceTypeMessage.set(this.serviceTypeMessage());
      }
    });
  }

  // Services Methods
  startAddingService() {
    if (!this.userPermissions().permissions.canCreate) {
      this.serviceMessage().error = 'You do not have permission to create services';
      this.serviceMessage.set(this.serviceMessage());
      return;
    }
    if (!this.selectedServiceType()) return;
    
    this.isAddingService.set(true);
    this.showExistingServices.set(false);
    this.selectedExistingServiceId.set(null);
    this.newService.set({
      name: '',
      serviceKey: '',
      cost: 0,
      timeDuration: 0,
      serviceTypeId: this.selectedServiceType()!.id,
      inputType: 'dropdown',
      minValue: 0,
      maxValue: 10,
      stepValue: 1,
      isRangeInput: false,
      unit: '',
      displayOrder: this.selectedServiceType()!.services.length + 1
    });
  }

  toggleExistingServices() {
    this.showExistingServices.set(!this.showExistingServices());
  }

  onServiceSelectionChange(event: any) {
    // Convert string to number if needed
    if (event.target.value && event.target.value !== '') {
      this.selectedExistingServiceId.set(parseInt(event.target.value));
    } else {
      this.selectedExistingServiceId.set(null);
    }
  }

  copyExistingService() {
    if (!this.userPermissions().permissions.canCreate) {
      this.serviceMessage().error = 'You do not have permission to copy services';
      this.serviceMessage.set(this.serviceMessage());
      return;
    }
    if (!this.selectedExistingServiceId() || !this.selectedServiceType()) return;
    
    this.adminService.copyService({
      sourceServiceId: this.selectedExistingServiceId()!,
      targetServiceTypeId: this.selectedServiceType()!.id
    }).subscribe({
      next: (response) => {
        if (this.selectedServiceType()) {
          this.selectedServiceType()!.services.push(response);
          this.selectedServiceType.set(this.selectedServiceType());
        }
        this.serviceMessage().success = 'Service copied successfully';
        this.serviceMessage.set(this.serviceMessage());
        this.isAddingService.set(false);
        this.loadServiceTypes();
        this.loadAllServices();
      },
      error: () => {
        this.serviceMessage().error = 'Failed to copy service';
        this.serviceMessage.set(this.serviceMessage());
      }
    });
  }

  cancelAddService() {
    this.isAddingService.set(false);
    this.showExistingServices.set(false);
    this.selectedExistingServiceId.set(null);
  }

  addService() {
    if (!this.userPermissions().permissions.canCreate) {
      this.serviceMessage().error = 'You do not have permission to create services';
      this.serviceMessage.set(this.serviceMessage());
      return;
    }
    // Blank zero-quantity inputs must travel as null, not 0 — "leave blank" and "costs 0"
    // are different settings.
    this.newService().zeroQuantityCost = this.emptyToNull(this.newService().zeroQuantityCost);
    this.newService.set(this.newService());
    this.newService().zeroQuantityDuration = this.emptyToNull(this.newService().zeroQuantityDuration);
    this.newService.set(this.newService());

    this.adminService.createService(this.newService()).subscribe({
      next: (response) => {
        if (this.selectedServiceType()) {
          this.selectedServiceType()!.services.push(response);
          this.selectedServiceType.set(this.selectedServiceType());
        }
        this.serviceMessage().success = 'Service created successfully';
        this.serviceMessage.set(this.serviceMessage());
        this.isAddingService.set(false);
        this.loadServiceTypes();
        this.loadAllServices();
      },
      error: () => {
        this.serviceMessage().error = 'Failed to create service';
        this.serviceMessage.set(this.serviceMessage());
      }
    });
  }

  editService(service: Service) {
    if (!this.userPermissions().permissions.canUpdate) {
      this.serviceMessage().error = 'You do not have permission to edit service';
      this.serviceMessage.set(this.serviceMessage());
      return;
    }
    this.editingServiceId.set(service.id);
  }

  cancelEditService() {
    this.editingServiceId.set(null);
    this.loadServiceTypes();
  }

  saveService(service: Service) {
    this.adminService.updateService(service.id, {
      name: service.name,
      serviceKey: service.serviceKey,
      cost: service.cost,
      timeDuration: service.timeDuration,
      serviceTypeId: service.serviceTypeId,
      inputType: service.inputType,
      minValue: service.minValue,
      maxValue: service.maxValue,
      stepValue: service.stepValue,
      isRangeInput: service.isRangeInput,
      unit: service.unit,
      serviceRelationType: service.serviceRelationType,
      displayOrder: service.displayOrder || 1,
      chargeAboveThreshold: service.chargeAboveThreshold ?? false,
      zeroQuantityCost: this.emptyToNull(service.zeroQuantityCost),
      zeroQuantityDuration: this.emptyToNull(service.zeroQuantityDuration)
    }).subscribe({
      next: (response) => {
        if (this.selectedServiceType()) {
          const index = this.selectedServiceType()!.services.findIndex(s => s.id === response.id);
          if (index !== -1) {
            this.selectedServiceType()!.services[index] = response;
            this.selectedServiceType.set(this.selectedServiceType());
          }
        }
        this.serviceMessage().success = 'Service updated successfully';
        this.serviceMessage.set(this.serviceMessage());
        this.editingServiceId.set(null);
        this.loadServiceTypes();
        this.loadAllServices();
      },
      error: () => {
        this.serviceMessage().error = 'Failed to update service';
        this.serviceMessage.set(this.serviceMessage());
      }
    });
  }

  /**
   * An emptied number input yields '' or null, which must reach the API as null (meaning
   * "not applicable") rather than 0 — a zero-quantity cost of 0 is a real, different setting
   * from leaving it blank.
   */
  private emptyToNull(value: number | null | undefined): number | null {
    if (value === null || value === undefined) return null;
    const asString = String(value).trim();
    if (asString === '') return null;
    const parsed = Number(value);
    return isNaN(parsed) ? null : parsed;
  }

  deleteService(service: Service) {
    if (!this.userPermissions().permissions.canDelete) {
      this.serviceMessage().error = 'You do not have permission to delete services';
      this.serviceMessage.set(this.serviceMessage());
      return;
    }
    if (confirm(`Are you sure you want to permanently delete "${service.name}"? This cannot be undone.`)) {
      this.adminService.deleteService(service.id).subscribe({
        next: () => {
          if (this.selectedServiceType()) {
            this.selectedServiceType()!.services = this.selectedServiceType()!.services.filter(s => s.id !== service.id);
            this.selectedServiceType.set(this.selectedServiceType());
          }
          this.serviceMessage().success = 'Service deleted successfully';
          this.serviceMessage.set(this.serviceMessage());
          this.loadServiceTypes();
          this.loadAllServices();
        },
        error: (error) => {
          if (error.error?.message) {
            this.serviceMessage().error = error.error.message;
            this.serviceMessage.set(this.serviceMessage());
          } else {
            this.serviceMessage().error = 'Failed to delete service';
            this.serviceMessage.set(this.serviceMessage());
          }
        }
      });
    }
  }

  // ==========================================================================
  // Included amounts (thresholds) and rate tiers
  // ==========================================================================

  togglePricingRow(service: Service) {
    this.expandedPricingServiceId.set(this.expandedPricingServiceId() === service.id ? null : service.id);
    this.resetPricingRowEditors();
    this.pricingRowMessage.set({ error: '', success: '' });
  }

  private resetPricingRowEditors() {
    this.isAddingThreshold.set(false);
    this.editingThresholdId.set(null);
    this.isAddingRateTier.set(false);
    this.editingRateTierId.set(null);
    this.newThreshold.set({ sourceServiceId: 0, sourceQuantity: 0, includedQuantity: 0 });
    this.newRateTier.set({ fromQuantity: 0, cost: 0, timeDuration: 0, displayOrder: 0 });
  }

  /** Services that may act as an allowance source — same service type, and not the service itself. */
  getThresholdSourceCandidates(service: Service): Service[] {
    if (!this.selectedServiceType()) return [];
    return this.selectedServiceType()!.services.filter(s => s.id !== service.id);
  }

  /** Reloads one service's rows in place so the row doesn't collapse on every change. */
  private refreshPricingRow(service: Service) {
    this.adminService.getServiceThresholds(service.id).subscribe({
      next: rows => { service.thresholds = rows; this.selectedServiceType.set(this.selectedServiceType()); }
    });
    this.adminService.getServiceRateTiers(service.id).subscribe({
      next: rows => { service.rateTiers = rows; this.selectedServiceType.set(this.selectedServiceType()); }
    });
  }

  private handlePricingRowError(error: any, fallback: string) {
    this.pricingRowMessage().error = error?.error?.message || fallback;
    this.pricingRowMessage.set(this.pricingRowMessage());
    this.pricingRowMessage().success = '';
    this.pricingRowMessage.set(this.pricingRowMessage());
  }

  // ----- Thresholds -----

  startAddingThreshold(service: Service) {
    this.isAddingThreshold.set(true);
    this.editingThresholdId.set(null);
    const candidates = this.getThresholdSourceCandidates(service);
    this.newThreshold.set({
      sourceServiceId: candidates.length ? candidates[0].id : 0,
      sourceQuantity: 0,
      includedQuantity: 0
    });
  }

  cancelAddingThreshold() {
    this.isAddingThreshold.set(false);
  }

  addThreshold(service: Service) {
    if (!this.newThreshold().sourceServiceId) {
      this.pricingRowMessage().error = 'Choose which service the included amount is based on.';
      this.pricingRowMessage.set(this.pricingRowMessage());
      return;
    }
    this.adminService.createServiceThreshold(service.id, this.newThreshold()).subscribe({
      next: () => {
        this.pricingRowMessage.set({ error: '', success: 'Included amount added.' });
        this.isAddingThreshold.set(false);
        this.refreshPricingRow(service);
      },
      error: err => this.handlePricingRowError(err, 'Failed to add the included amount.')
    });
  }

  startEditingThreshold(row: ServiceThreshold) {
    this.editingThresholdId.set(row.id);
    this.isAddingThreshold.set(false);
  }

  saveThreshold(service: Service, row: ServiceThreshold) {
    this.adminService.updateServiceThreshold(service.id, row.id, {
      sourceServiceId: row.sourceServiceId,
      sourceQuantity: row.sourceQuantity,
      includedQuantity: row.includedQuantity
    }).subscribe({
      next: () => {
        this.pricingRowMessage.set({ error: '', success: 'Included amount updated.' });
        this.editingThresholdId.set(null);
        this.refreshPricingRow(service);
      },
      error: err => {
        this.handlePricingRowError(err, 'Failed to update the included amount.');
        this.refreshPricingRow(service); // discard the rejected edit
      }
    });
  }

  cancelEditingThreshold(service: Service) {
    this.editingThresholdId.set(null);
    this.refreshPricingRow(service);
  }

  deleteThreshold(service: Service, row: ServiceThreshold) {
    const label = row.sourceServiceName || row.sourceServiceKey || 'this source';
    if (!confirm(`Remove the included amount for ${label} = ${row.sourceQuantity}?`)) return;

    this.adminService.deleteServiceThreshold(service.id, row.id).subscribe({
      next: () => {
        this.pricingRowMessage.set({ error: '', success: 'Included amount removed.' });
        this.refreshPricingRow(service);
      },
      error: err => this.handlePricingRowError(err, 'Failed to remove the included amount.')
    });
  }

  // ----- Rate tiers -----

  startAddingRateTier(service: Service) {
    this.isAddingRateTier.set(true);
    this.editingRateTierId.set(null);
    const tiers = service.rateTiers || [];
    this.newRateTier.set({
      // First tier must anchor at 0; afterwards default to just past the current top band.
      fromQuantity: tiers.length === 0 ? 0 : Math.max(...tiers.map(t => t.fromQuantity)) + 100,
      cost: service.cost || 0,
      timeDuration: service.timeDuration || 0,
      displayOrder: tiers.length + 1
    });
  }

  cancelAddingRateTier() {
    this.isAddingRateTier.set(false);
  }

  addRateTier(service: Service) {
    this.adminService.createServiceRateTier(service.id, this.newRateTier()).subscribe({
      next: () => {
        this.pricingRowMessage.set({ error: '', success: 'Rate tier added.' });
        this.isAddingRateTier.set(false);
        this.refreshPricingRow(service);
      },
      error: err => this.handlePricingRowError(err, 'Failed to add the rate tier.')
    });
  }

  startEditingRateTier(row: ServiceRateTier) {
    this.editingRateTierId.set(row.id);
    this.isAddingRateTier.set(false);
  }

  saveRateTier(service: Service, row: ServiceRateTier) {
    this.adminService.updateServiceRateTier(service.id, row.id, {
      fromQuantity: row.fromQuantity,
      cost: row.cost,
      timeDuration: row.timeDuration,
      displayOrder: row.displayOrder
    }).subscribe({
      next: () => {
        this.pricingRowMessage.set({ error: '', success: 'Rate tier updated.' });
        this.editingRateTierId.set(null);
        this.refreshPricingRow(service);
      },
      error: err => {
        this.handlePricingRowError(err, 'Failed to update the rate tier.');
        this.refreshPricingRow(service); // discard the rejected edit
      }
    });
  }

  cancelEditingRateTier(service: Service) {
    this.editingRateTierId.set(null);
    this.refreshPricingRow(service);
  }

  deleteRateTier(service: Service, row: ServiceRateTier) {
    if (!confirm(`Remove the rate tier starting at ${row.fromQuantity}?`)) return;

    this.adminService.deleteServiceRateTier(service.id, row.id).subscribe({
      next: () => {
        this.pricingRowMessage.set({ error: '', success: 'Rate tier removed.' });
        this.refreshPricingRow(service);
      },
      error: err => this.handlePricingRowError(err, 'Failed to remove the rate tier.')
    });
  }

  /** Sorted ascending — the tier bands only make sense read in order. */
  getSortedRateTiers(service: Service): ServiceRateTier[] {
    return [...(service.rateTiers || [])].sort((a, b) => a.fromQuantity - b.fromQuantity);
  }

  getSortedThresholds(service: Service): ServiceThreshold[] {
    return [...(service.thresholds || [])].sort((a, b) => a.sourceQuantity - b.sourceQuantity);
  }

  /**
   * Plain-language range for one tier, e.g. "first 400 above included" / "next 800 above
   * included" / "everything past 1,200 above included". The "above included" wording is the
   * whole point: a bare "From 1200" reads as absolute square footage, which is the wrong base.
   */
  getRateTierAppliesTo(service: Service, tier: ServiceRateTier): string {
    const tiers = this.getSortedRateTiers(service);
    const index = tiers.findIndex(t => t.id === tier.id);
    const unit = service.unit?.replace(/^per\s+/i, '') || 'units';
    const next = index >= 0 && index + 1 < tiers.length ? tiers[index + 1] : null;

    if (!next) {
      return tier.fromQuantity === 0
        ? `all ${unit} above the included amount`
        : `everything past ${tier.fromQuantity.toLocaleString()} above included`;
    }
    const width = next.fromQuantity - tier.fromQuantity;
    return tier.fromQuantity === 0
      ? `first ${width.toLocaleString()} ${unit} above included`
      : `next ${width.toLocaleString()} (${tier.fromQuantity.toLocaleString()}–${next.fromQuantity.toLocaleString()} above included)`;
  }

  /** Shown as a caution, not an error — the service still prices, just from zero. */
  hasThresholdWarning(service: Service): boolean {
    return !!service.chargeAboveThreshold && (service.thresholds?.length ?? 0) === 0;
  }

  // ==========================================================================
  // Pricing configuration export / import
  //
  // The payload resolves by (service type NAME, service KEY) — never by Id — because this
  // environment's Ids differ from production's. Import is SuperAdmin-only and always shows a
  // diff before writing anything.
  // ==========================================================================

  togglePricingConfigPanel() {
    this.showPricingConfigPanel.set(!this.showPricingConfigPanel());
    if (!this.showPricingConfigPanel()) this.resetPricingConfigPanel();
  }

  private resetPricingConfigPanel() {
    this.pricingConfigJson.set('');
    this.pricingConfigDiff.set(null);
    this.pendingPricingConfig = null;
    this.pricingConfigMessage.set({ error: '', success: '' });
  }

  readonly isSuperAdmin = computed<boolean>(() => this.userRole() === 'SuperAdmin');

  exportPricingConfiguration(allTypes: boolean) {
    this.pricingConfigBusy.set(true);
    this.pricingConfigMessage.set({ error: '', success: '' });

    const scope = allTypes ? undefined : (this.selectedServiceType()?.id ?? undefined);
    this.adminService.exportPricingConfiguration(scope).subscribe({
      next: config => {
        this.pricingConfigJson.set(JSON.stringify(config, null, 2));
        this.pricingConfigDiff.set(null);
        this.pendingPricingConfig = null;
        this.pricingConfigBusy.set(false);
        this.pricingConfigMessage().success = allTypes
          ? `Exported ${config.serviceTypes.length} service type(s). Copy the JSON below, or download it.`
          : `Exported "${this.selectedServiceType()?.name}". Copy the JSON below, or download it.`;
        this.pricingConfigMessage.set(this.pricingConfigMessage());
      },
      error: () => {
        this.pricingConfigBusy.set(false);
        this.pricingConfigMessage().error = 'Failed to export the configuration.';
        this.pricingConfigMessage.set(this.pricingConfigMessage());
      }
    });
  }

  downloadPricingConfiguration() {
    if (!this.pricingConfigJson()) return;
    const blob = new Blob([this.pricingConfigJson()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `pricing-configuration-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  onPricingConfigFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      this.pricingConfigJson.set(String(reader.result ?? ''));
      this.pricingConfigDiff.set(null);
      this.pendingPricingConfig = null;
      this.pricingConfigMessage.set({ error: '', success: '' });
    };
    reader.readAsText(file);
    input.value = ''; // allow re-selecting the same file
  }

  previewPricingConfiguration() {
    this.pricingConfigMessage.set({ error: '', success: '' });
    this.pricingConfigDiff.set(null);

    let parsed: PricingConfiguration;
    try {
      parsed = JSON.parse(this.pricingConfigJson());
    } catch {
      this.pricingConfigMessage().error = 'That is not valid JSON. Paste the exported file exactly as it was produced.';
      this.pricingConfigMessage.set(this.pricingConfigMessage());
      return;
    }

    this.pricingConfigBusy.set(true);
    this.adminService.previewPricingConfiguration(parsed).subscribe({
      next: diff => {
        this.pricingConfigDiff.set(diff);
        this.pendingPricingConfig = diff.canApply ? parsed : null;
        this.pricingConfigBusy.set(false);
        if (diff.isNoOp) {
          this.pricingConfigMessage().success = 'This configuration matches what is already here — nothing would change.';
          this.pricingConfigMessage.set(this.pricingConfigMessage());
        }
      },
      error: err => {
        this.pricingConfigBusy.set(false);
        this.pricingConfigMessage().error = err?.error?.message || 'Failed to preview the configuration.';
        this.pricingConfigMessage.set(this.pricingConfigMessage());
      }
    });
  }

  applyPricingConfiguration() {
    if (!this.pendingPricingConfig || !this.pricingConfigDiff()?.canApply) return;

    const typeCount = this.pricingConfigDiff()!.serviceTypes.length;
    if (!confirm(
      `Apply this configuration to ${typeCount} service type(s)?\n\n` +
      'Prices, durations, included amounts and rate tiers will be overwritten with the values shown in the preview.'
    )) return;

    this.pricingConfigBusy.set(true);
    this.adminService.applyPricingConfiguration(this.pendingPricingConfig).subscribe({
      next: result => {
        this.pricingConfigBusy.set(false);
        this.pricingConfigMessage.set({ error: '', success: result.message });
        this.pricingConfigDiff.set(null);
        this.pendingPricingConfig = null;
        this.loadServiceTypes();
        this.loadAllServices();
      },
      error: err => {
        this.pricingConfigBusy.set(false);
        this.pricingConfigMessage().error = err?.error?.message || 'Failed to apply the configuration. Nothing was changed.';
        this.pricingConfigMessage.set(this.pricingConfigMessage());
      }
    });
  }

  /** Only fields that actually differ — the preview is for spotting changes, not reading a dump. */
  getChangedFields(changes: { isChanged: boolean }[]): any[] {
    return (changes || []).filter(c => c.isChanged);
  }

  serviceDiffHasChanges(serviceDiff: { changes: { isChanged: boolean }[]; thresholdChanges: string[]; rateTierChanges: string[] }): boolean {
    return this.getChangedFields(serviceDiff.changes).length > 0
      || (serviceDiff.thresholdChanges?.length ?? 0) > 0
      || (serviceDiff.rateTierChanges?.length ?? 0) > 0;
  }

  /** A worked example so the "above included" base is unmistakable. */
  getTierExample(service: Service): string | null {
    const thresholds = this.getSortedThresholds(service);
    const tiers = this.getSortedRateTiers(service);
    if (!service.chargeAboveThreshold || thresholds.length === 0 || tiers.length === 0) return null;

    const sample = thresholds[Math.min(2, thresholds.length - 1)];
    const included = sample.includedQuantity;
    const total = included + (tiers.length > 1 ? tiers[1].fromQuantity + 100 : 200);
    const billable = total - included;
    const sourceLabel = sample.sourceServiceName || sample.sourceServiceKey || 'source';

    return `Example: ${sourceLabel} = ${sample.sourceQuantity} includes ${included.toLocaleString()}. `
      + `A booking at ${total.toLocaleString()} therefore bills ${billable.toLocaleString()}, `
      + `and the tiers below apply to that ${billable.toLocaleString()} — not to ${total.toLocaleString()}.`;
  }

  deactivateService(service: Service) {
    if (!this.userPermissions().permissions.canDeactivate) {
      this.serviceMessage().error = 'You do not have permission to deactivate services';
      this.serviceMessage.set(this.serviceMessage());
      return;
    }
    this.adminService.deactivateService(service.id).subscribe({
      next: (response) => {
        if (this.selectedServiceType()) {
          const index = this.selectedServiceType()!.services.findIndex(s => s.id === service.id);
          if (index !== -1) {
            this.selectedServiceType()!.services[index] = { ...this.selectedServiceType()!.services[index], isActive: false };
            this.selectedServiceType.set(this.selectedServiceType());
          }
        }
        this.serviceMessage().success = 'Service deactivated successfully';
        this.serviceMessage.set(this.serviceMessage());
        this.loadServiceTypes();
        this.loadAllServices();
      },
      error: () => {
        this.serviceMessage().error = 'Failed to deactivate service';
        this.serviceMessage.set(this.serviceMessage());
      }
    });
  }

  activateService(service: Service) {
    if (!this.userPermissions().permissions.canActivate) {
      this.serviceMessage().error = 'You do not have permission to activate services';
      this.serviceMessage.set(this.serviceMessage());
      return;
    }
    this.adminService.activateService(service.id).subscribe({
      next: (response) => {
        if (this.selectedServiceType()) {
          const index = this.selectedServiceType()!.services.findIndex(s => s.id === service.id);
          if (index !== -1) {
            this.selectedServiceType()!.services[index] = { ...this.selectedServiceType()!.services[index], isActive: true };
            this.selectedServiceType.set(this.selectedServiceType());
          }
        }
        this.serviceMessage().success = 'Service activated successfully';
        this.serviceMessage.set(this.serviceMessage());
        this.loadServiceTypes();
        this.loadAllServices();
      },
      error: () => {
        this.serviceMessage().error = 'Failed to activate service';
        this.serviceMessage.set(this.serviceMessage());
      }
    });
  }

  // Extra Services Methods
  startAddingExtraService() {
    if (!this.userPermissions().permissions.canCreate) {
      this.extraServiceMessage().error = 'You do not have permission to create extra services';
      this.extraServiceMessage.set(this.extraServiceMessage());
      return;
    }
    if (!this.selectedServiceType()) return;
    
    this.isAddingExtraService.set(true);
    this.showExistingExtraServices.set(false);
    this.selectedExistingExtraServiceId.set(null);
    this.newExtraService.set({
      name: '',
      description: '',
      price: 0,
      duration: 0,
      icon: '',
      hasQuantity: false,
      hasHours: false,
      isDeepCleaning: false,
      isSuperDeepCleaning: false,
      isSameDayService: false,
      priceMultiplier: 1.0,
      serviceTypeId: this.selectedServiceType()!.id,
      isAvailableForAll: true,
      displayOrder: this.selectedServiceType()!.extraServices.length + 1,
      extraServiceKey: ''
    });
  }

  toggleExistingExtraServices() {
    this.showExistingExtraServices.set(!this.showExistingExtraServices());
  }

  onExtraServiceSelectionChange(event: any) {
    // Convert string to number if needed
    if (event.target.value && event.target.value !== '') {
      this.selectedExistingExtraServiceId.set(parseInt(event.target.value));
    } else {
      this.selectedExistingExtraServiceId.set(null);
    }
  }

  getAvailableExtraServicesForCopy(): ExtraService[] {
    if (!this.selectedServiceType() || !this.allExtraServices()) {
      return [];
    }

    // Offer only extras the selected type does not already have: matched on the KEY when the
    // candidate carries one (a renamed copy is still the same extra), otherwise on the name as before.
    const existing = this.selectedServiceType()!.extraServices;
    const existingKeys = new Set(existing.map(s => s.extraServiceKey).filter((k): k is string => !!k));
    const existingNames = new Set(existing.map(s => s.name));
    return this.allExtraServices().filter(service =>
      service.extraServiceKey ? !existingKeys.has(service.extraServiceKey) : !existingNames.has(service.name));
  }

  copyExistingExtraService() {
    if (!this.userPermissions().permissions.canCreate) {
      this.extraServiceMessage().error = 'You do not have permission to copy extra services';
      this.extraServiceMessage.set(this.extraServiceMessage());
      return;
    }
    if (!this.selectedExistingExtraServiceId() || !this.selectedServiceType()) {
      return;
    }
    
    // Use the API to copy the extra service (like the regular service copy)
    this.adminService.copyExtraService({
      sourceExtraServiceId: this.selectedExistingExtraServiceId()!,
      targetServiceTypeId: this.selectedServiceType()!.id
    }).subscribe({
      next: (response) => {
        // Add the copied service to the selected service type
        if (this.selectedServiceType()) {
          this.selectedServiceType()!.extraServices.push(response);
          this.selectedServiceType.set(this.selectedServiceType());
        }
        
        // Reset the form
        this.isAddingExtraService.set(false);
        this.showExistingExtraServices.set(false);
        this.selectedExistingExtraServiceId.set(null);
        
        // Show success message
        this.extraServiceMessage().success = 'Extra service copied successfully';
        this.extraServiceMessage.set(this.extraServiceMessage());
        
        // Reload data to ensure consistency
        this.loadServiceTypes();
        this.loadAllExtraServices();
      },
      error: (error) => {
        console.error('Error copying extra service:', error);
        this.extraServiceMessage().error = 'Failed to copy extra service. Please try again.';
        this.extraServiceMessage.set(this.extraServiceMessage());
      }
    });
  }

  cancelAddExtraService() {
    this.isAddingExtraService.set(false);
    this.showExistingExtraServices.set(false);
    this.selectedExistingExtraServiceId.set(null);
  }

  addExtraService() {
    if (!this.userPermissions().permissions.canCreate) {
      this.extraServiceMessage().error = 'You do not have permission to create extra services';
      this.extraServiceMessage.set(this.extraServiceMessage());
      return;
    }
    if (!this.selectedServiceType()) return;

    const extraServiceData = {
      ...this.newExtraService(),
      serviceTypeId: this.newExtraService().isAvailableForAll ? undefined : this.selectedServiceType()!.id
    };
    this.adminService.createExtraService(extraServiceData).subscribe({
      next: (response) => {
        if (this.selectedServiceType()) {
          this.selectedServiceType()!.extraServices.push(response);
          this.selectedServiceType.set(this.selectedServiceType());
        }
        this.isAddingExtraService.set(false);
        this.newExtraService.set({
          name: '',
          description: '',
          price: 0,
          duration: 0,
          icon: '',
          hasQuantity: false,
          hasHours: false,
          isDeepCleaning: false,
          isSuperDeepCleaning: false,
          isSameDayService: false,
          priceMultiplier: 1.0,
          serviceTypeId: undefined,
          isAvailableForAll: true,
          displayOrder: 1,
          extraServiceKey: ''
        });
        this.extraServiceMessage().success = 'Extra service added successfully.';
        this.extraServiceMessage.set(this.extraServiceMessage());
      },
      error: (error) => {
        console.error('Error creating extra service:', error);
        this.extraServiceMessage().error = extractApiErrorMessage(error, 'Failed to create extra service. Please try again.');
        this.extraServiceMessage.set(this.extraServiceMessage());
      }
    });
  }

  editExtraService(extraService: ExtraService) {
    if (!this.userPermissions().permissions.canUpdate) {
      this.extraServiceMessage().error = 'You do not have permission to edit extra services';
      this.extraServiceMessage.set(this.extraServiceMessage());
      return;
    }
    this.editingExtraServiceId.set(extraService.id);
  }

  cancelEditExtraService() {
    this.editingExtraServiceId.set(null);
    this.loadServiceTypes();
  }

  saveExtraService(extraService: ExtraService) {
    if (!this.userPermissions().permissions.canUpdate) {
      this.extraServiceMessage().error = 'You do not have permission to update extra services';
      this.extraServiceMessage.set(this.extraServiceMessage());
      return;
    }

    const updateData = {
      name: extraService.name,
      description: extraService.description,
      price: extraService.price,
      duration: extraService.duration,
      icon: extraService.icon,
      hasQuantity: extraService.hasQuantity,
      hasHours: extraService.hasHours,
      isDeepCleaning: extraService.isDeepCleaning,
      isSuperDeepCleaning: extraService.isSuperDeepCleaning,
      isSameDayService: extraService.isSameDayService,
      priceMultiplier: extraService.priceMultiplier,
      serviceTypeId: extraService.isAvailableForAll ? undefined : this.selectedServiceType()?.id,
      isAvailableForAll: extraService.isAvailableForAll,
      displayOrder: extraService.displayOrder || 1,
      // Blank saves as "no key"; format and uniqueness come back from the server as the message.
      extraServiceKey: extraService.extraServiceKey ?? null
    };
    this.adminService.updateExtraService(extraService.id, updateData).subscribe({
      next: (response) => {
        if (this.selectedServiceType()) {
          const index = this.selectedServiceType()!.extraServices.findIndex(s => s.id === response.id);
          if (index !== -1) {
            this.selectedServiceType()!.extraServices[index] = response;
            this.selectedServiceType.set(this.selectedServiceType());
          }
        }
        this.loadServiceTypes();
        this.editingExtraServiceId.set(null);
        this.extraServiceMessage().success = 'Extra service updated successfully.';
        this.extraServiceMessage.set(this.extraServiceMessage());
      },
      error: (error) => {
        console.error('Error updating extra service:', error);
        this.extraServiceMessage().error = extractApiErrorMessage(error, 'Failed to update extra service. Please try again.');
        this.extraServiceMessage.set(this.extraServiceMessage());
      }
    });
  }

  deleteExtraService(extraService: ExtraService) {
    if (!this.userPermissions().permissions.canDelete) {
      this.extraServiceMessage().error = 'You do not have permission to delete extra services';
      this.extraServiceMessage.set(this.extraServiceMessage());
      return;
    }
    if (confirm(`Are you sure you want to permanently delete "${extraService.name}"? This cannot be undone.`)) {
      this.adminService.deleteExtraService(extraService.id).subscribe({
        next: () => {
          if (this.selectedServiceType()) {
            this.selectedServiceType()!.extraServices = this.selectedServiceType()!.extraServices.filter(s => s.id !== extraService.id);
            this.selectedServiceType.set(this.selectedServiceType());
          }
          this.extraServiceMessage().success = 'Extra service deleted successfully.';
          this.extraServiceMessage.set(this.extraServiceMessage());
        },
        error: (error) => {
          console.error('Error deleting extra service:', error);
          this.extraServiceMessage().error = 'Failed to delete extra service. Please try again.';
          this.extraServiceMessage.set(this.extraServiceMessage());
        }
      });
    }
  }

  deactivateExtraService(extraService: ExtraService) {
    if (!this.userPermissions().permissions.canDeactivate) {
      this.extraServiceMessage().error = 'You do not have permission to deactivate extra services';
      this.extraServiceMessage.set(this.extraServiceMessage());
      return;
    }
    this.adminService.deactivateExtraService(extraService.id).subscribe({
      next: (response) => {
        // Update allExtraServices
        this.allExtraServices.set(this.allExtraServices().map(service => 
          service.id === extraService.id 
            ? { ...service, isActive: false }
            : service
        ));
        
        // Update selectedServiceType.extraServices if it exists
        if (this.selectedServiceType()) {
          this.selectedServiceType()!.extraServices = this.selectedServiceType()!.extraServices.map(service =>
            service.id === extraService.id
              ? { ...service, isActive: false }
              : service
          );
          this.selectedServiceType.set(this.selectedServiceType());
        }
        
        this.extraServiceMessage().success = 'Extra service deactivated successfully.';
        this.extraServiceMessage.set(this.extraServiceMessage());

        // Re-fetch from backend so admin UI matches booking endpoint
        this.loadServiceTypes();
        this.loadAllExtraServices();
      },
      error: (error) => {
        console.error('Error deactivating extra service:', error);
        this.extraServiceMessage().error = 'Failed to deactivate extra service. Please try again.';
        this.extraServiceMessage.set(this.extraServiceMessage());
      }
    });
  }

  activateExtraService(extraService: ExtraService) {
    if (!this.userPermissions().permissions.canActivate) {
      this.extraServiceMessage().error = 'You do not have permission to activate extra services';
      this.extraServiceMessage.set(this.extraServiceMessage());
      return;
    }
    this.adminService.activateExtraService(extraService.id).subscribe({
      next: (response) => {
        // Update allExtraServices
        this.allExtraServices.set(this.allExtraServices().map(service => 
          service.id === extraService.id 
            ? { ...service, isActive: true }
            : service
        ));
        
        // Update selectedServiceType.extraServices if it exists
        if (this.selectedServiceType()) {
          this.selectedServiceType()!.extraServices = this.selectedServiceType()!.extraServices.map(service =>
            service.id === extraService.id
              ? { ...service, isActive: true }
              : service
          );
          this.selectedServiceType.set(this.selectedServiceType());
        }
        
        this.extraServiceMessage().success = 'Extra service activated successfully.';
        this.extraServiceMessage.set(this.extraServiceMessage());

        // Re-fetch from backend so admin UI matches booking endpoint
        this.loadServiceTypes();
        this.loadAllExtraServices();
      },
      error: (error) => {
        console.error('Error activating extra service:', error);
        this.extraServiceMessage().error = 'Failed to activate extra service. Please try again.';
        this.extraServiceMessage.set(this.extraServiceMessage());
      }
    });
  }

  getQuestionTypeLabel(questionType: string): string {
    const type = this.questionTypes.find(t => t.value === questionType);
    return type ? type.label : questionType;
  }

  // Poll Question Methods
  loadPollQuestions() {
    if (!this.selectedServiceType()) return;

    this.adminService.getPollQuestions(this.selectedServiceType()!.id).subscribe({
      next: (questions) => {
        this.pollQuestions.set(this.sortPollQuestionsByOrder(questions));
        // Initialize sticky headers after poll questions load
        setTimeout(() => {
          this.updateAllStickyHeaders();
        }, 150);
      },
      error: (error) => {
        console.error('Error loading poll questions:', error);
        this.pollQuestionMessage().error = 'Failed to load poll questions';
        this.pollQuestionMessage.set(this.pollQuestionMessage());
      }
    });
  }

  startAddingPollQuestion() {
    if (!this.userPermissions().permissions.canCreate) {
      this.pollQuestionMessage().error = 'You do not have permission to create poll questions';
      this.pollQuestionMessage.set(this.pollQuestionMessage());
      return;
    }
    if (!this.selectedServiceType()) return;

    this.isAddingPollQuestion.set(true);
    this.editingPollQuestionId.set(null);
    this.newPollQuestion.set({
      question: '',
      questionType: 'text',
      options: '',
      isRequired: false,
      displayOrder: this.getNextPollQuestionDisplayOrder(),
      serviceTypeId: this.selectedServiceType()!.id
    });
  }

  cancelAddPollQuestion() {
    this.isAddingPollQuestion.set(false);
    this.newPollQuestion.set({
      question: '',
      questionType: 'text',
      options: '',
      isRequired: false,
      displayOrder: 1,
      serviceTypeId: 0
    });
    this.clearPollQuestionMessages();
  }

  addPollQuestion() {
    if (!this.newPollQuestion().question) {
      this.pollQuestionMessage().error = 'Please enter a question';
      this.pollQuestionMessage.set(this.pollQuestionMessage());
      return;
    }

    if ((this.newPollQuestion().questionType === 'dropdown' || this.newPollQuestion().questionType === 'radio' || this.newPollQuestion().questionType === 'checkbox') && !this.newPollQuestion().options) {
      this.pollQuestionMessage().error = 'Please enter options for dropdown/radio/checkbox questions (comma-separated)';
      this.pollQuestionMessage.set(this.pollQuestionMessage());
      return;
    }

    this.adminService.createPollQuestion(this.newPollQuestion()).subscribe({
      next: (question) => {
        this.pollQuestions().push(question);
        this.pollQuestions.set(this.pollQuestions());
        this.pollQuestions.set(this.sortPollQuestionsByOrder(this.pollQuestions()));
        this.isAddingPollQuestion.set(false);
        this.newPollQuestion.set({
          question: '',
          questionType: 'text',
          options: '',
          isRequired: false,
          displayOrder: 1,
          serviceTypeId: 0
        });
        this.pollQuestionMessage().success = 'Question added successfully';
        this.pollQuestionMessage.set(this.pollQuestionMessage());
        this.clearPollQuestionMessagesAfterDelay();
      },
      error: (error) => {
        console.error('Error adding poll question:', error);
        this.pollQuestionMessage().error = 'Failed to add question';
        this.pollQuestionMessage.set(this.pollQuestionMessage());
      }
    });
  }

  editPollQuestion(question: PollQuestion) {
    this.editingPollQuestionId.set(question.id);
    this.isAddingPollQuestion.set(false);
  }

  cancelEditPollQuestion() {
    this.editingPollQuestionId.set(null);
  }

  savePollQuestion(question: PollQuestion) {
    if (!question.question) {
      this.pollQuestionMessage().error = 'Please enter a question';
      this.pollQuestionMessage.set(this.pollQuestionMessage());
      return;
    }

    if ((question.questionType === 'dropdown' || question.questionType === 'radio' || question.questionType === 'checkbox') && !question.options) {
      this.pollQuestionMessage().error = 'Please enter options for dropdown/radio/checkbox questions (comma-separated)';
      this.pollQuestionMessage.set(this.pollQuestionMessage());
      return;
    }

    // Persist unique display order: use current position in sorted list (1-based)
    question.displayOrder = this.getPollQuestionDisplayPosition(question);

    this.adminService.updatePollQuestion(question.id, question).subscribe({
      next: () => {
        this.editingPollQuestionId.set(null);
        this.pollQuestions.set(this.sortPollQuestionsByOrder(this.pollQuestions()));
        this.pollQuestionMessage().success = 'Question updated successfully';
        this.pollQuestionMessage.set(this.pollQuestionMessage());
        this.clearPollQuestionMessagesAfterDelay();
      },
      error: (error) => {
        console.error('Error updating poll question:', error);
        this.pollQuestionMessage().error = 'Failed to update question';
        this.pollQuestionMessage.set(this.pollQuestionMessage());
      }
    });
  }

  deletePollQuestion(questionId: number) {
    if (!this.userPermissions().permissions.canDelete) {
      this.pollQuestionMessage().error = 'You do not have permission to delete poll questions';
      this.pollQuestionMessage.set(this.pollQuestionMessage());
      return;
    }

    if (!confirm('Are you sure you want to delete this question?')) {
      return;
    }

    this.adminService.deletePollQuestion(questionId).subscribe({
      next: () => {
        this.pollQuestions.set(this.pollQuestions().filter(q => q.id !== questionId));
        this.pollQuestionMessage().success = 'Question deleted successfully';
        this.pollQuestionMessage.set(this.pollQuestionMessage());
        this.clearPollQuestionMessagesAfterDelay();
      },
      error: (error) => {
        console.error('Error deleting poll question:', error);
        this.pollQuestionMessage().error = 'Failed to delete question';
        this.pollQuestionMessage.set(this.pollQuestionMessage());
      }
    });
  }

  getNextPollQuestionDisplayOrder(): number {
    if (this.pollQuestions().length === 0) return 1;
    return this.pollQuestions().length + 1;
  }

  /** Sort poll questions by display order then id for stable unique ordering. */
  sortPollQuestionsByOrder(questions: PollQuestion[]): PollQuestion[] {
    return [...questions].sort((a, b) => {
      const orderA = a.displayOrder ?? 999;
      const orderB = b.displayOrder ?? 999;
      if (orderA !== orderB) return orderA - orderB;
      return a.id - b.id;
    });
  }

  /** Get 1-based display position for a question (unique per list). Used for Order column and when saving. */
  getPollQuestionDisplayPosition(question: PollQuestion): number {
    const sorted = this.sortPollQuestionsByOrder(this.pollQuestions());
    const idx = sorted.findIndex(q => q.id === question.id);
    return idx >= 0 ? idx + 1 : (question.displayOrder ?? 1);
  }

  clearPollQuestionMessages() {
    this.pollQuestionMessage.set({ success: '', error: '' });
  }

  clearPollQuestionMessagesAfterDelay() {
    setTimeout(() => {
      this.clearPollQuestionMessages();
    }, 3000);
  }
}
