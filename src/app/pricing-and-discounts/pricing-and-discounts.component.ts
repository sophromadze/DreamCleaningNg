import { Component, OnInit, OnDestroy, PLATFORM_ID, computed, inject, ChangeDetectionStrategy, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { RouterModule } from '@angular/router';
import { Subscription } from 'rxjs';
import { MarketingPricingService } from '../shared/pricing/marketing-pricing.service';
import { formatMarketingMoney, joinWithAnd, listStartingPrices } from '../shared/pricing/marketing-price-format';
import { SpecialOfferService, PublicSpecialOffer } from '../services/special-offer.service';
import { BookingService } from '../services/booking.service';
import { AuthService } from '../services/auth.service';
import { AuthModalService } from '../services/auth-modal.service';
import { IconComponent } from '../shared/icons/icon.component';
import { faCalendarCheck } from '../shared/icons/glyphs/faCalendarCheck';
import { faCheck } from '../shared/icons/glyphs/faCheck';
import { faCreditCard } from '../shared/icons/glyphs/faCreditCard';
import { faGift } from '../shared/icons/glyphs/faGift';
import { faStar } from '../shared/icons/glyphs/faStar';
import { faTags } from '../shared/icons/glyphs/faTags';
import { faUnlockKeyhole } from '../shared/icons/glyphs/faUnlockKeyhole';
import { faUserGroup } from '../shared/icons/glyphs/faUserGroup';
import { StructuredDataService } from '../services/structured-data.service';
import { findAdvertisedFirstTimeOffer } from '../shared/booking/special-offer-keys';

interface RecurringPlan {
  name: string;
  /** Display label for the discount, e.g. "15%". */
  label: string;
  days: number;
}

@Component({
  selector: 'app-pricing-and-discounts',
  standalone: true,
  imports: [RouterModule, IconComponent],
  templateUrl: './pricing-and-discounts.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './pricing-and-discounts.component.scss'
})
export class PricingAndDiscountsComponent implements OnInit, OnDestroy {
  private specialOfferService = inject(SpecialOfferService);
  private bookingService = inject(BookingService);
  private authService = inject(AuthService);
  private authModalService = inject(AuthModalService);
  private platformId = inject<Object>(PLATFORM_ID);

  protected readonly icons = { faCalendarCheck, faCheck, faCreditCard, faGift, faStar, faTags, faUnlockKeyhole, faUserGroup };

  /** Prices from the booking catalogue (MarketingPricingService); null = left out / neutral wording. */
  private readonly marketingPricing = inject(MarketingPricingService);
  readonly pricing = this.marketingPricing.text;
  /** Filthy Cleaning's admin-entered display price, split for the price card's amount/unit markup. */
  readonly filthyUnit = computed(() => this.marketingPricing.prices().filthy?.unit ?? null);
  readonly filthyAmount = computed(() => {
    const filthy = this.marketingPricing.prices().filthy;
    return filthy ? formatMarketingMoney(filthy.amount) : '';
  });

  /** First-time discount label, e.g. "10%" or "$20". Loaded from the DB — never hardcoded. */
  readonly firstTimeLabel = signal('');
  /** Active recurring/subscription plans with their discounts, loaded from the DB. */
  readonly recurringPlans = signal<RecurringPlan[]>([]);
  /** Any currently-active seasonal / holiday / custom specials, loaded from the DB. */
  readonly seasonalOffers = signal<PublicSpecialOffer[]>([]);

  /** Whether the visitor is signed in — drives the "log in for more benefits" callout. */
  readonly isLoggedIn = signal(false);

  private isBrowser: boolean;
  private readonly structuredData = inject(StructuredDataService);
  private authSub?: Subscription;

  constructor() {
    this.isBrowser = isPlatformBrowser(this.platformId);
  }

  /**
   * The cost answer, shared word for word by the visible FAQ item and its JSON-LD. Unresolved
   * prices are left out of the lists; filthy cleaning without a display price reads "priced after
   * assessment".
   */
  get costAnswer(): string {
    const t = this.pricing();
    const flat = listStartingPrices([
      ['Standard cleaning', t.standardFrom],
      ['deep cleaning', t.deepFrom],
      ['move in/out cleaning', t.moveInOutFrom]
    ]);
    const hourly = [
      t.customPerHour && `custom cleaning at ${t.customPerHour}/hour per cleaner`,
      t.heavyPerHour && `heavy condition cleaning at ${t.heavyPerHour}/hour per cleaner`,
      t.filthyShort ? `filthy cleaning at ${t.filthyShort}` : 'filthy cleaning priced after assessment'
    ].filter((x): x is string => !!x);
    const flatSentence = flat ? `${flat.charAt(0).toUpperCase()}${flat.slice(1)}. ` : '';
    return `${flatSentence}Hourly services include ${joinWithAnd(hourly)}.`;
  }

  /** Whether the note may say filthy cleaning is billed per hour per cleaner (its display unit). */
  get filthyBilledPerCleanerHour(): boolean {
    return this.filthyUnit() === 'per-hour-per-cleaner';
  }

  ngOnInit(): void {
    // Prices are resolved on the server too, so the schema is complete in the SSR HTML.
    this.injectSchema();

    // Live discount figures are admin-configurable; fetch them in the browser.
    // (The descriptive copy is static and prerendered, so the page is never empty.)
    if (!this.isBrowser) return;
    this.loadOffers();
    this.loadRecurringPlans();
    this.authSub = this.authService.currentUser.subscribe(user => {
      this.isLoggedIn.set(!!user);
    });
  }

  ngOnDestroy(): void {
    this.structuredData.remove('ld-pricing-and-discounts');
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
        const firstTime = findAdvertisedFirstTimeOffer(list);
        this.firstTimeLabel.set(firstTime ? this.offerLabel(firstTime) : '');
        // Everything that isn't the first-time offer is a seasonal/holiday/event special.
        this.seasonalOffers.set(list.filter(o =>
          o !== firstTime && !o.requiresFirstTimeCustomer && o.type !== 'FirstTime'
        ));
      },
      error: () => { /* leave copy in its number-agnostic fallback state */ }
    });
  }

  /** Loads active recurring plans (weekly / bi-weekly / monthly) and their discounts. */
  private loadRecurringPlans(): void {
    this.bookingService.getSubscriptions().subscribe({
      next: (subs) => {
        this.recurringPlans.set((subs || [])
          // The endpoint only returns active plans; keep the ones that actually discount.
          .filter(s => s.discountPercentage > 0)
          .sort((a, b) => a.subscriptionDays - b.subscriptionDays)
          .map(s => ({
            name: s.name,
            label: `${s.discountPercentage}%`,
            days: s.subscriptionDays
          })));
      },
      error: () => { /* fallback copy describes the plans without exact figures */ }
    });
  }

  /** Injects Service (with priced offers) + FAQPage structured data for SEO/GEO. */
  private injectSchema(): void {
    const base = 'https://dreamcleaningnyc.com';
    const p = this.marketingPricing.prices();
    const flatFrom = listStartingPrices([
      ['standard cleaning', this.pricing().standardFrom],
      ['deep cleaning', this.pricing().deepFrom],
      ['move in/out', this.pricing().moveInOutFrom]
    ], 'from');
    type OfferSpec = [name: string, price: number | null, description: string, hourly: boolean];
    const offers = ([
      ['Standard Cleaning', p.standardFrom, 'Flat-rate standard residential cleaning, starting price.', false],
      ['Deep Cleaning', p.deepFrom, 'Flat-rate deep cleaning, starting price.', false],
      ['Move In / Move Out Cleaning', p.moveInOutFrom, 'Flat-rate move in/out cleaning, starting price.', false],
      ['Custom Cleaning', p.customPerHour, 'Custom hourly cleaning, per hour per cleaner.', true],
      ['Heavy Condition Cleaning', p.heavyPerHour, 'Heavy condition cleaning, per hour per cleaner.', true],
      ['Filthy Cleaning', p.filthy?.amount ?? null,
        p.filthy?.unit === 'from' ? 'Filthy / extreme cleaning, starting price.'
          : p.filthy?.unit === 'per-hour' ? 'Filthy / extreme cleaning, per hour.'
          : 'Filthy / extreme cleaning, per hour per cleaner.',
        p.filthy?.unit !== 'from']
    ] as OfferSpec[])
      // An offer without a resolved price is left out rather than published with a guess.
      .filter(([, price]) => price !== null)
      .map(([name, price, description, hourly]) => ({
        '@type': 'Offer', 'name': name, 'priceCurrency': 'USD', 'price': price, 'description': description,
        ...(hourly ? { 'unitText': 'HUR' } : {})
      }));

    const serviceSchema = {
      '@type': 'Service',
      'name': 'Cleaning Services in NYC',
      'serviceType': 'House Cleaning Service',
      'description':
        `Transparent, flat-rate and hourly cleaning prices from Dream Cleaning in Brooklyn, Manhattan and Queens. ` +
        (flatFrom ? `${flatFrom.charAt(0).toUpperCase()}${flatFrom.slice(1)}, plus ` : 'Plus ') +
        `first-time, recurring, loyalty (Bubble Rewards), referral and seasonal discounts.`,
      'provider': { '@type': 'LocalBusiness', 'name': 'Dream Cleaning', '@id': `${base}/#business` },
      'areaServed': [
        { '@type': 'City', 'name': 'Brooklyn' },
        { '@type': 'City', 'name': 'Manhattan' },
        { '@type': 'City', 'name': 'Queens' }
      ],
      ...(offers.length ? { 'offers': offers } : {})
    };

    const faqSchema = {
      '@type': 'FAQPage',
      'mainEntity': [
        {
          '@type': 'Question',
          'name': 'How much does house cleaning cost in NYC?',
          'acceptedAnswer': {
            '@type': 'Answer',
            'text': this.costAnswer
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

    this.structuredData.set('ld-pricing-and-discounts', schema);
  }
}
