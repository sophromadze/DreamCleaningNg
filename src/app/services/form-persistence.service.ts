import { Injectable, Inject, PLATFORM_ID } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { isPlatformBrowser } from '@angular/common';

export interface BookingFormData {
  // Service Type and Services
  selectedServiceTypeId?: string;
  selectedServices?: Array<{
    serviceId: string;
    quantity: number;
  }>;
  selectedExtraServices?: Array<{
    extraServiceId: string;
    quantity: number;
    hours: number;
  }>;
  
  // Form Fields
  serviceDate?: string;
  serviceTime?: string;
  entryMethod?: string;
  customEntryMethod?: string;
  specialInstructions?: string;
  contactFirstName?: string;
  contactLastName?: string;
  contactEmail?: string;
  contactPhone?: string;
  selectedApartmentId?: string;
  serviceAddress?: string;
  apartmentName?: string;
  aptSuite?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  promoCode?: string;
  tips?: number;
  companyDevelopmentTips?: number;
  cleaningType?: string;
  floorTypes?: string[];
  floorTypeOther?: string;
  smsConsent?: boolean;
  cancellationConsent?: boolean;
  
  // Selected Subscription
  selectedSubscriptionId?: string;
  
  // Custom Pricing Data
  customAmount?: number;
  customCleaners?: number;
  customDuration?: number;
  bedroomsQuantity?: number;
  bathroomsQuantity?: number;
  
  // Poll Data
  pollAnswers?: { [key: number]: string };
  
  // Timestamp for when form was saved
  savedAt?: number;
  
  // Booking state tracking
  hasStartedBooking?: boolean;
  bookingProgress?: 'started' | 'in_progress' | 'completed';
}

@Injectable({
  providedIn: 'root'
})
export class FormPersistenceService {
  private readonly STORAGE_KEY = 'booking_form_data';
  private readonly FORM_TTL = 24 * 60 * 60 * 1000; // 24 hours in milliseconds
  
  private formDataSubject = new BehaviorSubject<BookingFormData | null>(null);
  public formData$ = this.formDataSubject.asObservable();
  private isBrowser: boolean;

  constructor(@Inject(PLATFORM_ID) private platformId: Object) {
    this.isBrowser = isPlatformBrowser(this.platformId);
    
    // Only load data and set up listeners in browser environment
    if (this.isBrowser) {
      // Load any existing data on service initialization
      this.loadFormData();
      
      // Listen for storage events to sync across tabs
      window.addEventListener('storage', (event) => {
        if (event.key === this.STORAGE_KEY) {
          this.loadFormData();
        }
      });
    }
  }

  /**
   * Save form data to sessionStorage
   */
  saveFormData(data: BookingFormData): void {
    if (!this.isBrowser) return;
    
    try {
      const dataToSave = {
        ...data,
        savedAt: Date.now()
      };
      
      sessionStorage.setItem(this.STORAGE_KEY, JSON.stringify(dataToSave));
      this.formDataSubject.next(dataToSave);
    } catch (error) {
      console.error('Error saving form data:', error);
    }
  }

  /**
   * Load form data from sessionStorage
   */
  loadFormData(): BookingFormData | null {
    if (!this.isBrowser) return null;
    
    try {
      const savedData = sessionStorage.getItem(this.STORAGE_KEY);
      if (!savedData) return null;
      
      const parsedData = JSON.parse(savedData) as BookingFormData;
      
      // Check if data is expired (older than 24 hours)
      if (parsedData.savedAt) {
        const age = Date.now() - parsedData.savedAt;
        if (age > this.FORM_TTL) {
          this.clearFormData();
          return null;
        }
      }
      
      this.formDataSubject.next(parsedData);
      return parsedData;
    } catch (error) {
      console.error('Error loading form data:', error);
      return null;
    }
  }

  /**
   * Get current form data
   */
  getFormData(): BookingFormData | null {
    return this.formDataSubject.value;
  }

  /**
   * Clear all saved form data
   */
  clearFormData(): void {
    if (!this.isBrowser) return;
    
    try {
      sessionStorage.removeItem(this.STORAGE_KEY);
      this.formDataSubject.next(null);
    } catch (error) {
      console.error('Error clearing form data:', error);
    }
  }

  /**
   * Update specific fields in the saved data
   */
  updateFormData(updates: Partial<BookingFormData>): void {
    const currentData = this.getFormData() || {};
    const updatedData = {
      ...currentData,
      ...updates,
      savedAt: Date.now()
    };
    this.saveFormData(updatedData);
  }

  /**
   * Check if there's saved form data
   */
  hasSavedData(): boolean {
    return !!this.getFormData();
  }

  /**
   * Get the age of saved data in milliseconds
   */
  getDataAge(): number {
    const data = this.getFormData();
    if (!data || !data.savedAt) return 0;
    return Date.now() - data.savedAt;
  }

  /**
   * Mark that user has started booking
   */
  markBookingStarted(): void {
    const currentData = this.getFormData() || {};
    const updatedData = {
      ...currentData,
      hasStartedBooking: true,
      bookingProgress: 'started' as const,
      savedAt: Date.now()
    };
    this.saveFormData(updatedData);
  }

  /**
   * Mark that booking is in progress
   */
  markBookingInProgress(): void {
    const currentData = this.getFormData() || {};
    const updatedData = {
      ...currentData,
      hasStartedBooking: true,
      bookingProgress: 'in_progress' as const,
      savedAt: Date.now()
    };
    this.saveFormData(updatedData);
  }

  /**
   * Mark that booking is completed
   */
  markBookingCompleted(): void {
    const currentData = this.getFormData() || {};
    const updatedData = {
      ...currentData,
      bookingProgress: 'completed' as const,
      savedAt: Date.now()
    };
    this.saveFormData(updatedData);
  }

  /**
   * Check if user has started booking
   */
  hasStartedBooking(): boolean {
    const data = this.getFormData();
    return !!(data && data.hasStartedBooking);
  }
}