import { Component, OnInit, OnDestroy, Inject, PLATFORM_ID } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { FormsModule, ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { GiftCardService, CreateGiftCard } from '../services/gift-card.service';
import { AuthService } from '../services/auth.service';
import { BubbleFieldComponent } from '../bubble-field/bubble-field.component';

@Component({
  selector: 'app-gift-cards',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule, BubbleFieldComponent],
  templateUrl: './gift-cards.component.html',
  styleUrls: ['./gift-cards.component.scss']
})
export class GiftCardsComponent implements OnInit, OnDestroy {
  giftCardForm: FormGroup;
  previewGiftCard: any = null;
  isLoading = false;
  errorMessage = '';
  successMessage = '';
  isProcessingPayment = false;
  currentUser: any = null;
  giftCardBackgroundPath: string = '';
  isLoadingBackground: boolean = true;
  private isBrowser: boolean;

  // Add billing details getter
  get billingDetails() {
    return {
      name: this.giftCardForm.get('senderName')?.value,
      email: this.giftCardForm.get('senderEmail')?.value
    };
  }
  // Predefined amounts for selection
  predefinedAmounts = [100, 200, 300, 400, 500, 1000];

  constructor(
    private fb: FormBuilder,
    private giftCardService: GiftCardService,
    private authService: AuthService,
    private router: Router,
    private http: HttpClient,
    @Inject(PLATFORM_ID) private platformId: Object
  ) {
    this.isBrowser = isPlatformBrowser(this.platformId);
    
    this.giftCardForm = this.fb.group({
      amount: ['', [Validators.required, Validators.min(50), Validators.max(10000)]],
      recipientName: ['', [Validators.required, Validators.maxLength(15)]],
      recipientEmail: ['', [Validators.required, Validators.email, Validators.maxLength(255)]],
      senderName: ['', [Validators.required, Validators.maxLength(100)]],
      senderEmail: ['', [Validators.required, Validators.email, Validators.maxLength(255)]],
      message: ['', [Validators.required, Validators.maxLength(70)]]
    });

    // Subscribe to form changes to update preview
    this.giftCardForm.valueChanges.subscribe(formValue => {
      this.updatePreview(formValue);
    });
  }

  ngOnInit() {
    // Preload the main image as fallback, but let loadGiftCardBackground handle the actual image
    if (this.isBrowser) {
      this.preloadMainImage();
    }
    this.loadCurrentUser();
    this.prefillUserData();
    this.loadGiftCardBackground();
    this.updatePreview(this.giftCardForm.value);
  }

  ngOnDestroy() {
    // Clean up any preload links created by this component only in browser
    if (this.isBrowser) {
      const giftCardPreloadLinks = document.querySelectorAll('link[rel="preload"][data-gift-card="true"]');
      giftCardPreloadLinks.forEach(link => link.remove());
    }
  }

  updatePreview(formValue: any) {
    this.previewGiftCard = {
      ...formValue,
      code: 'XXXX-XXXX-XXXX', // Placeholder for preview
      createdDate: new Date()
    };
  }

  loadCurrentUser() {
    this.authService.currentUser.subscribe(user => {
      this.currentUser = user;
      this.prefillUserData();
    });
  }

  prefillUserData() {
    if (this.currentUser) {
      this.giftCardForm.patchValue({
        senderName: `${this.currentUser.firstName} ${this.currentUser.lastName}`,
        senderEmail: this.currentUser.email
      });
    } else {
      // Clear any prefilled data if user logs out
      this.giftCardForm.patchValue({
        senderName: '',
        senderEmail: ''
      });
    }
  }



  selectAmount(amount: number) {
    this.giftCardForm.patchValue({ amount });
  }

  onCreateGiftCard() {    
    if (!this.giftCardForm.valid) {
      this.markFormGroupTouched();
      this.errorMessage = 'Please fill in all required fields correctly.';
      return;
    }
  
    this.isLoading = true;
    this.errorMessage = '';
  
    // Get gift card data
    const giftCardData: CreateGiftCard = this.giftCardForm.getRawValue();
    
    // Navigate to confirmation page with gift card data
    this.router.navigate(['/gift-card-confirmation'], {
      state: { giftCardData: giftCardData }
    }).then(success => {
      if (!success) {
        this.isLoading = false;
        this.errorMessage = 'Failed to proceed to payment. Please try again.';
      }
    }).catch(() => {
      this.isLoading = false;
      this.errorMessage = 'Failed to proceed to payment. Please try again.';
    });
  }

  formatCurrency(amount: number): string {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(amount);
  }

  formatDate(date: Date | string): string {
    const d = new Date(date);
    return d.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  }



  private markFormGroupTouched() {
    Object.keys(this.giftCardForm.controls).forEach(key => {
      this.giftCardForm.get(key)?.markAsTouched();
    });
  }

  loadGiftCardBackground() {
    // Only execute in browser environment
    if (!this.isBrowser) return;
    
    // Step 1: Check cache first for instant display
    const cachedPath = localStorage.getItem('giftCardBackground');
    const cachedTimestamp = localStorage.getItem('giftCardBackgroundTimestamp');
    if (cachedPath) {
      this.giftCardBackgroundPath = cachedPath;
      this.isLoadingBackground = false;
    }
    
    // Step 2: Always fetch latest from API to check for updates (now public endpoint)
    this.http.get<any>('/api/admin/gift-card-config').subscribe({
      next: (response) => {
        const newPath = response.backgroundImagePath || '/images/mainImage.webp';
        // Convert timestamp to string for comparison (handle both Date objects and strings)
        const newTimestamp = response.lastUpdated 
          ? (typeof response.lastUpdated === 'string' 
              ? response.lastUpdated 
              : new Date(response.lastUpdated).toISOString())
          : new Date().toISOString();
        
        // Check if image has changed by comparing path or timestamp
        const pathChanged = newPath !== this.giftCardBackgroundPath;
        const timestampChanged = cachedTimestamp !== newTimestamp;
        
        // Always preload if path changed, timestamp changed, or no cache
        // This ensures we always get the latest image
        if (pathChanged || timestampChanged || !cachedPath || !cachedTimestamp) {
          // Clear old cache before loading new image
          if (pathChanged || timestampChanged) {
            localStorage.removeItem('giftCardBackground');
            localStorage.removeItem('giftCardBackgroundTimestamp');
          }
          this.preloadImage(newPath, newTimestamp);
        } else {
          // Path and timestamp match cache, we're showing the right image
          this.isLoadingBackground = false;
        }
      },
      error: (_error: any) => {
        // Silently handle error - use cached or fallback
        if (!this.giftCardBackgroundPath) {
          this.giftCardBackgroundPath = '/images/mainImage.webp';
          this.isLoadingBackground = false;
        }
      }
    });
  }

  private preloadImage(imagePath: string, timestamp?: string) {
    // Only execute in browser environment
    if (!this.isBrowser) return;
    
    // Create a preload link for the dynamic image if it's different from mainImage
    if (imagePath !== '/images/mainImage.webp') {
      this.createPreloadLink(imagePath);
    }
    
    const img = new Image();
    
    img.onload = () => {
      this.giftCardBackgroundPath = imagePath;
      this.isLoadingBackground = false;
      
      // Update cache with new path and timestamp
      localStorage.setItem('giftCardBackground', imagePath);
      if (timestamp) {
        localStorage.setItem('giftCardBackgroundTimestamp', timestamp);
      }
    };
    
    img.onerror = () => {
      this.giftCardBackgroundPath = '/images/mainImage.webp';
      this.isLoadingBackground = false;
      
      // Don't cache failed image
      localStorage.removeItem('giftCardBackground');
      localStorage.removeItem('giftCardBackgroundTimestamp');
    };
    
    // Start loading the image (add cache busting if timestamp provided)
    // Use timestamp or current time to force browser to reload
    const cacheBuster = timestamp 
      ? `?t=${encodeURIComponent(timestamp)}` 
      : `?t=${Date.now()}`;
    const fullImagePath = imagePath + cacheBuster;
    img.src = fullImagePath;
  }

  getGiftCardBackground(): string {
    return this.giftCardBackgroundPath;
  }

  private preloadMainImage() {
    // Only execute in browser environment
    if (!this.isBrowser) return;
    
    // Create a link element to preload the main image as fallback
    const link = document.createElement('link');
    link.rel = 'preload';
    link.as = 'image';
    link.href = '/images/mainImage.webp';
    document.head.appendChild(link);
  }

  private createPreloadLink(imagePath: string) {
    // Only execute in browser environment
    if (!this.isBrowser) return;
    
    // Remove any existing preload links for gift card backgrounds to avoid duplicates
    const existingLinks = document.querySelectorAll('link[rel="preload"][data-gift-card="true"]');
    existingLinks.forEach(link => link.remove());
    
    // Create a new preload link for the dynamic image
    const link = document.createElement('link');
    link.rel = 'preload';
    link.as = 'image';
    link.href = imagePath;
    link.setAttribute('data-gift-card', 'true'); // Mark it for easy removal
    document.head.appendChild(link);
  }


  // Form getters for template
  get amount() { return this.giftCardForm.get('amount'); }
  get recipientName() { return this.giftCardForm.get('recipientName'); }
  get recipientEmail() { return this.giftCardForm.get('recipientEmail'); }
  get senderName() { return this.giftCardForm.get('senderName'); }
  get senderEmail() { return this.giftCardForm.get('senderEmail'); }
  get message() { return this.giftCardForm.get('message'); }
}