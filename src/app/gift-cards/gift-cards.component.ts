import { Component, OnInit, PLATFORM_ID, afterNextRender, ChangeDetectionStrategy, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { FormsModule, ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { GiftCardService, CreateGiftCard } from '../services/gift-card.service';
import { AuthService } from '../services/auth.service';
import { AuthModalService } from '../services/auth-modal.service';
import { BubbleFieldComponent } from '../bubble-field/bubble-field.component';
import { GIFT_CARD_DEFAULT_BACKGROUND } from '../shared/gift-card-background';

/** "Send to someone now" (today's flow) or "Buy for myself - send later" (signed-in only). */
export type GiftCardDeliveryMode = 'now' | 'later';

/** The form survives a login/register round-trip in sessionStorage under this key. */
const GIFT_CARD_DRAFT_KEY = 'giftCardPurchaseDraft';
const GIFT_CARD_DRAFT_TTL_MS = 30 * 60 * 1000;

@Component({
  selector: 'app-gift-cards',
  standalone: true,
  imports: [FormsModule, ReactiveFormsModule, BubbleFieldComponent],
  templateUrl: './gift-cards.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrls: ['./gift-cards.component.scss']
})
export class GiftCardsComponent implements OnInit {
  private fb = inject(FormBuilder);
  private giftCardService = inject(GiftCardService);
  private authService = inject(AuthService);
  private authModalService = inject(AuthModalService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private http = inject(HttpClient);
  private platformId = inject<Object>(PLATFORM_ID);

  giftCardForm: FormGroup;
  previewGiftCard: any = null;
  isLoading = false;
  errorMessage = '';
  successMessage = '';
  isProcessingPayment = false;
  currentUser: any = null;
  giftCardBackgroundPath: string = '';
  isLoadingBackground: boolean = true;
  /** Set once the config endpoint has answered; a slower cache probe must not override it. */
  private backgroundFromServer = false;
  deliveryMode: GiftCardDeliveryMode = 'now';
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

  constructor() {
    this.isBrowser = isPlatformBrowser(this.platformId);

    // The server always renders "send now" (it can't see sessionStorage or the signed-in user), so
    // the restored mode is applied only AFTER hydration - switching before it leaves the server's
    // recipient fields stuck in the DOM next to the client's.
    afterNextRender(() => this.restoreDraft());
    
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
    this.loadCurrentUser();
    this.prefillUserData();
    this.loadGiftCardBackground();
    this.updatePreview(this.giftCardForm.value);
  }

  get isSendLater(): boolean {
    return this.deliveryMode === 'later';
  }

  setDeliveryMode(mode: GiftCardDeliveryMode) {
    if (this.deliveryMode === mode) return;
    this.deliveryMode = mode;
    this.errorMessage = '';
    // Recipient fields are not asked in "send later" mode - disabled controls don't validate.
    const recipientControls = ['recipientName', 'recipientEmail', 'message'];
    recipientControls.forEach(name => {
      const control = this.giftCardForm.get(name);
      if (mode === 'later') control?.disable({ emitEvent: false });
      else control?.enable({ emitEvent: false });
    });
    this.updatePreview(this.giftCardForm.getRawValue());
  }

  /** Saves the form and opens login/register; the page restores the draft on return. */
  promptLoginForSendLater(mode: 'login' | 'register' = 'login') {
    this.saveDraft();
    this.authModalService.open(mode, '/gift-cards?mode=later');
  }

  private saveDraft() {
    if (!this.isBrowser) return;
    try {
      sessionStorage.setItem(GIFT_CARD_DRAFT_KEY, JSON.stringify({
        ...this.giftCardForm.getRawValue(),
        deliveryMode: this.deliveryMode,
        savedAt: Date.now()
      }));
    } catch { /* storage unavailable - the form just isn't restored */ }
  }

  private clearDraft() {
    if (!this.isBrowser) return;
    try { sessionStorage.removeItem(GIFT_CARD_DRAFT_KEY); } catch { /* ignore */ }
  }

  private restoreDraft() {
    if (!this.isBrowser) return;
    let draft: any = null;
    try {
      const raw = sessionStorage.getItem(GIFT_CARD_DRAFT_KEY);
      if (raw) draft = JSON.parse(raw);
    } catch { /* ignore a broken draft */ }
    // A draft is only for the login/register round-trip - an old one is ignored.
    if (draft && !(Date.now() - (draft.savedAt ?? 0) < GIFT_CARD_DRAFT_TTL_MS)) draft = null;
    this.clearDraft();

    const modeFromUrl = this.route.snapshot.queryParamMap.get('mode');
    const mode: GiftCardDeliveryMode =
      draft?.deliveryMode === 'later' || modeFromUrl === 'later' ? 'later' : 'now';

    if (draft) {
      this.giftCardForm.patchValue({
        amount: draft.amount ?? '',
        recipientName: draft.recipientName ?? '',
        recipientEmail: draft.recipientEmail ?? '',
        message: draft.message ?? ''
      });
      // Sender fields come from the signed-in profile when there is one.
      if (!this.currentUser) {
        this.giftCardForm.patchValue({
          senderName: draft.senderName ?? '',
          senderEmail: draft.senderEmail ?? ''
        });
      }
    }
    this.setDeliveryMode(mode);
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
    if (this.isSendLater && !this.currentUser) {
      this.errorMessage = 'Please log in or create an account to buy a gift card for yourself.';
      return;
    }

    if (!this.giftCardForm.valid) {
      this.markFormGroupTouched();
      this.errorMessage = 'Please fill in all required fields correctly.';
      return;
    }

    this.isLoading = true;
    this.errorMessage = '';

    // Get gift card data
    const raw = this.giftCardForm.getRawValue();
    const giftCardData: CreateGiftCard = this.isSendLater
      ? {
          amount: raw.amount,
          senderName: raw.senderName,
          senderEmail: raw.senderEmail,
          sendLater: true
        }
      : raw;
    this.clearDraft();
    
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

    // Last background that loaded, for a fast repeat visit — but probed like any other, so a
    // file that has since disappeared is never painted. The server's answer always wins.
    const cachedPath = localStorage.getItem('giftCardBackground');
    if (cachedPath) this.showBackground(cachedPath, true);

    // The server answers with the background IN EFFECT (2026-10): a missing upload already
    // resolves to the default there, so this is never a path that 404s.
    this.http.get<any>('/api/admin/gift-card-config').subscribe({
      next: (response) => {
        this.backgroundFromServer = true;
        this.showBackground(response?.backgroundImagePath || GIFT_CARD_DEFAULT_BACKGROUND);
      },
      error: () => {
        if (!this.giftCardBackgroundPath) this.showBackground(GIFT_CARD_DEFAULT_BACKGROUND);
      }
    });
  }

  /**
   * Swap to a background only once it has actually loaded, falling back to the default if it
   * cannot — so the card never renders a broken image. No <link rel=preload> and no cache-buster:
   * an uploaded background has a unique name per upload, and a preload of a URL that differs
   * from the one used (the old ?t= query) is exactly the "preloaded but not used" warning.
   */
  private showBackground(imagePath: string, fromCache = false) {
    if (!this.isBrowser) return;

    const img = new Image();
    img.onload = () => {
      if (fromCache && this.backgroundFromServer) return; // the server's answer already won
      this.giftCardBackgroundPath = imagePath;
      this.isLoadingBackground = false;
      localStorage.setItem('giftCardBackground', imagePath);
    };
    img.onerror = () => {
      localStorage.removeItem('giftCardBackground');
      if (fromCache) return; // stale cache: the config response decides what to show
      if (imagePath !== GIFT_CARD_DEFAULT_BACKGROUND) {
        this.showBackground(GIFT_CARD_DEFAULT_BACKGROUND);
      } else {
        this.isLoadingBackground = false;
      }
    };
    img.src = imagePath;
  }

  getGiftCardBackground(): string {
    return this.giftCardBackgroundPath;
  }



  // Form getters for template
  get amount() { return this.giftCardForm.get('amount'); }
  get recipientName() { return this.giftCardForm.get('recipientName'); }
  get recipientEmail() { return this.giftCardForm.get('recipientEmail'); }
  get senderName() { return this.giftCardForm.get('senderName'); }
  get senderEmail() { return this.giftCardForm.get('senderEmail'); }
  get message() { return this.giftCardForm.get('message'); }
}