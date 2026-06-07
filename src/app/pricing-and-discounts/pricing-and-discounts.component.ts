import { Component, OnInit, OnDestroy, Inject, PLATFORM_ID } from '@angular/core';
import { CommonModule, DOCUMENT, isPlatformBrowser } from '@angular/common';
import { RouterModule } from '@angular/router';
import { Subscription } from 'rxjs';
import { SERVICE_PRICING } from '../shared/service-pricing.data';
import { SpecialOfferService, PublicSpecialOffer } from '../services/special-offer.service';
import { BookingService } from '../services/booking.service';
import { AuthService } from '../services/auth.service';
import { AuthModalService } from '../services/auth-modal.service';

interface RecurringPlan {
  name: string;
  /** Display label for the discount, e.g. "15%". */
  label: string;
  days: number;
}

@Component({
  selector: 'app-pricing-and-discounts',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './pricing-and-discounts.component.html',
  styleUrl: './pricing-and-discounts.component.scss'
})
export class PricingAndDiscountsComponent implements OnInit, OnDestroy {
  /** Centralized marketing prices (single source of truth). */
  readonly pricing = SERVICE_PRICING;

  /** First-time discount label, e.g. "10%" or "$20". Loaded from the DB — never hardcoded. */
  firstTimeLabel = '';
  /** Active recurring/subscription plans with their discounts, loaded from the DB. */
  recurringPlans: RecurringPlan[] = [];
  /** Any currently-active seasonal / holiday / custom specials, loaded from the DB. */
  seasonalOffers: PublicSpecialOffer[] = [];

  /** Whether the visitor is signed in — drives the "log in for more benefits" callout. */
  isLoggedIn = false;

  private isBrowser: boolean;
  private schemaElement: HTMLScriptElement | null = null;
  private authSub?: Subscription;

  constructor(
    private specialOfferService: SpecialOfferService,
    private bookingService: BookingService,
    private authService: AuthService,
    private authModalService: AuthModalService,
    @Inject(PLATFORM_ID) private platformId: Object,
    @Inject(DOCUMENT) private document: Document
  ) {
    this.isBrowser = isPlatformBrowser(this.platformId);
  }

  ngOnInit(): void {
    // Schema uses static SERVICE_PRICING values, so inject on SSR too (good for SEO).
    this.injectSchema();

    // Live discount figures are admin-configurable; fetch them in the browser.
    // (The descriptive copy is static and prerendered, so the page is never empty.)
    if (!this.isBrowser) return;
    this.loadOffers();
    this.loadRecurringPlans();
    this.authSub = this.authService.currentUser.subscribe(user => {
      this.isLoggedIn = !!user;
    });
  }

  ngOnDestroy(): void {
    if (this.schemaElement && this.schemaElement.parentNode) {
      this.schemaElement.parentNode.removeChild(this.schemaElement);
    }
    this.authSub?.unsubscribe();
  }

  /** Opens the login modal (with register toggle) so visitors can unlock rewards/referrals. */
  openRewardsLogin(): void {
    this.authModalService.open('login', '/rewards');
  }

  offerLabel(o: PublicSpecialOffer): string {
    return o.isPercentage ? `${o.discountValue}%` : `$${o.discountValue}`;
  }

  /** Loads the first-time discount and any active seasonal/holiday specials. */
  private loadOffers(): void {
    this.specialOfferService.getPublicSpecialOffers().subscribe({
      next: (offers) => {
        const list = offers || [];
        const firstTime = list.find(o =>
          o.requiresFirstTimeCustomer ||
          o.type === 'FirstTime' ||
          (o.name?.toLowerCase().includes('first time') ?? false) ||
          (o.name?.toLowerCase().includes('first-time') ?? false)
        );
        this.firstTimeLabel = firstTime ? this.offerLabel(firstTime) : '';
        // Everything that isn't the first-time offer is a seasonal/holiday/event special.
        this.seasonalOffers = list.filter(o =>
          o !== firstTime && !o.requiresFirstTimeCustomer && o.type !== 'FirstTime'
        );
      },
      error: () => { /* leave copy in its number-agnostic fallback state */ }
    });
  }

  /** Loads active recurring plans (weekly / bi-weekly / monthly) and their discounts. */
  private loadRecurringPlans(): void {
    this.bookingService.getSubscriptions().subscribe({
      next: (subs) => {
        this.recurringPlans = (subs || [])
          // The endpoint only returns active plans; keep the ones that actually discount.
          .filter(s => s.discountPercentage > 0)
          .sort((a, b) => a.subscriptionDays - b.subscriptionDays)
          .map(s => ({
            name: s.name,
            label: `${s.discountPercentage}%`,
            days: s.subscriptionDays
          }));
      },
      error: () => { /* fallback copy describes the plans without exact figures */ }
    });
  }

  /** Injects Service (with priced offers) + FAQPage structured data for SEO/GEO. */
  private injectSchema(): void {
    const base = 'https://dreamcleaningnyc.com';
    const p = SERVICE_PRICING;

    const serviceSchema = {
      '@type': 'Service',
      'name': 'Cleaning Services in NYC',
      'serviceType': 'House Cleaning Service',
      'description':
        `Transparent, flat-rate and hourly cleaning prices from Dream Cleaning in Brooklyn, Manhattan and Queens. ` +
        `Standard cleaning from $${p.residentialFrom}, deep cleaning from $${p.deepFrom}, move in/out from $${p.moveInOutFrom}, ` +
        `plus first-time, recurring, loyalty (Bubble Rewards), referral and seasonal discounts.`,
      'provider': { '@type': 'LocalBusiness', 'name': 'Dream Cleaning', '@id': `${base}/#business` },
      'areaServed': [
        { '@type': 'City', 'name': 'Brooklyn' },
        { '@type': 'City', 'name': 'Manhattan' },
        { '@type': 'City', 'name': 'Queens' }
      ],
      'offers': [
        { '@type': 'Offer', 'name': 'Standard Cleaning', 'priceCurrency': 'USD', 'price': p.residentialFrom, 'description': 'Flat-rate standard residential cleaning, starting price.' },
        { '@type': 'Offer', 'name': 'Deep Cleaning', 'priceCurrency': 'USD', 'price': p.deepFrom, 'description': 'Flat-rate deep cleaning, starting price.' },
        { '@type': 'Offer', 'name': 'Move In / Move Out Cleaning', 'priceCurrency': 'USD', 'price': p.moveInOutFrom, 'description': 'Flat-rate move in/out cleaning, starting price.' },
        { '@type': 'Offer', 'name': 'Custom Cleaning', 'priceCurrency': 'USD', 'price': p.customPerHour, 'description': 'Custom hourly cleaning, per hour.', 'unitText': 'HUR' },
        { '@type': 'Offer', 'name': 'Heavy Condition Cleaning', 'priceCurrency': 'USD', 'price': p.heavyConditionPerHour, 'description': 'Heavy condition cleaning, per hour per cleaner.', 'unitText': 'HUR' },
        { '@type': 'Offer', 'name': 'Filthy Cleaning', 'priceCurrency': 'USD', 'price': p.filthyPerHour, 'description': 'Filthy / extreme cleaning, per hour per cleaner.', 'unitText': 'HUR' }
      ]
    };

    const faqSchema = {
      '@type': 'FAQPage',
      'mainEntity': [
        {
          '@type': 'Question',
          'name': 'How much does house cleaning cost in NYC?',
          'acceptedAnswer': {
            '@type': 'Answer',
            'text': `Dream Cleaning offers flat-rate pricing starting from $${p.residentialFrom} for standard cleaning, $${p.deepFrom} for deep cleaning, and $${p.moveInOutFrom} for move in/out cleaning in Brooklyn, Manhattan and Queens. Hourly options include custom cleaning at $${p.customPerHour}/hour, heavy condition cleaning at $${p.heavyConditionPerHour}/hour per cleaner, and filthy cleaning at $${p.filthyPerHour}/hour per cleaner.`
          }
        },
        {
          '@type': 'Question',
          'name': 'Do you offer a first-time customer discount?',
          'acceptedAnswer': {
            '@type': 'Answer',
            'text': 'Yes. New customers receive a first-time discount on their first cleaning, applied automatically at checkout. We also offer recurring discounts for weekly, bi-weekly and monthly plans.'
          }
        },
        {
          '@type': 'Question',
          'name': 'How can I save money on regular cleaning?',
          'acceptedAnswer': {
            '@type': 'Answer',
            'text': 'Book a recurring plan to save more the more often we clean, earn Bubble Rewards points on every booking that you can redeem for money off, and refer friends so you both get rewarded. We also run seasonal and holiday specials around Black Friday, Christmas and other events.'
          }
        },
        {
          '@type': 'Question',
          'name': 'Do you have a loyalty or referral program?',
          'acceptedAnswer': {
            '@type': 'Answer',
            'text': 'Yes. Our Bubble Rewards program earns points on every dollar you spend, redeemable for discounts on future cleanings, with tiers that multiply your points. Our referral program rewards both you and the friend you refer.'
          }
        }
      ]
    };

    const schema = {
      '@context': 'https://schema.org',
      '@graph': [serviceSchema, faqSchema]
    };

    this.schemaElement = this.document.createElement('script');
    this.schemaElement.type = 'application/ld+json';
    this.schemaElement.textContent = JSON.stringify(schema);
    this.document.head.appendChild(this.schemaElement);
  }
}
