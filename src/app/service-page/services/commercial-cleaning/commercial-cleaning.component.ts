import {
  Component,
  OnInit,
  OnDestroy,
  Inject,
  PLATFORM_ID,
  inject
} from '@angular/core';
import { CommonModule, DOCUMENT, isPlatformBrowser } from '@angular/common';
import { RouterLink } from '@angular/router';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../../environments/environment';
import { TestimonialSectionComponent } from '../../../shared/components/testimonial-section/testimonial-section.component';
import { PhoneNumberService } from '../../../services/phone-number.service';
import { AnalyticsService } from '../../../services/analytics.service';
import { OrderSoundService } from '../../../services/order-sound.service';
import { extractApiErrorMessage } from '../../../utils/http-error.utils';

/**
 * Commercial cleaning landing page — the destination for the commercial Google Ads
 * campaign, laid out like the homepage (hero + form card, testimonials, services,
 * why-choose, areas, final CTA) with every section written for businesses.
 *
 * Two deliberate differences from the homepage:
 *
 *  1. THE HERO CARD IS A QUOTE FORM, NOT THE BOOKING WIDGET. `app-home-hero`'s form asks
 *     bedrooms/bathrooms/sq.ft and prices a residential job from the catalogue; a commercial
 *     buyer has no bedroom count and buys on a walkthrough and a proposal. So the hero card
 *     collects a lead and posts it to the same `contact/quote-request` endpoint the
 *     /free-quote page uses — which also means these leads land in the CRM through the
 *     existing LeadCaptureService with no backend change.
 *  2. Its styles come from the homepage stylesheets rather than a copy of them — see the
 *     styleUrls note below.
 *
 * The submit fires the SAME `quote_form_submit` dataLayer event as /free-quote, so the Google
 * Ads conversion action already configured in GTM counts these without a new tag. `event_label`
 * is what separates the two in reporting.
 */
@Component({
  selector: 'app-commercial-cleaning',
  standalone: true,
  imports: [CommonModule, RouterLink, ReactiveFormsModule, TestimonialSectionComponent],
  templateUrl: './commercial-cleaning.component.html',
  // Order matters. The homepage's two stylesheets are listed FIRST and own the shared look
  // (hero grid, form card, section headers, feature/offer/area cards, CTA buttons); the page's
  // own sheet holds only what is specific to it and must win ties by coming last. Same pattern
  // as order-edit listing booking.component.scss first. Neither homepage sheet uses :host and
  // the handful of selectors they both define (.badge, .btn-cta-secondary) are byte-identical,
  // so loading both into one component is safe.
  styleUrls: [
    '../../../shared/components/home-hero/home-hero.component.scss',
    '../../../main/main.component.scss',
    './commercial-cleaning.component.scss'
  ]
})
export class CommercialCleaningComponent implements OnInit, OnDestroy {
  protected readonly phoneNumber = inject(PhoneNumberService);
  private readonly analytics = inject(AnalyticsService);

  /**
   * New commercial client offer: 20% off the first month of a recurring plan.
   *
   * Lives here rather than in `service-pricing.data.ts` because that file holds marketing
   * PRICES shared across many pages, while this is a promotion that appears only on this one —
   * in the benefits card, the hero coupon, the closing CTA and the FAQ answer.
   * Binding all four to one field is what keeps them from drifting apart.
   *
   * Unrelated to the residential recurring discounts (weekly / bi-weekly / monthly), which are
   * admin-configurable in the database and must never be hardcoded: commercial work is quoted
   * from a walkthrough and never priced through the booking flow, so there is no DB value to read.
   */
  readonly firstMonthDiscountPercent = 20;

  quoteForm: FormGroup;
  isSubmitting = false;
  showSuccess = false;
  showError = false;
  errorMessage = '';

  private readonly isBrowser: boolean;
  private schemaElements: HTMLScriptElement[] = [];

  constructor(
    private fb: FormBuilder,
    private http: HttpClient,
    private orderSound: OrderSoundService,
    @Inject(DOCUMENT) private document: Document,
    @Inject(PLATFORM_ID) platformId: Object
  ) {
    this.isBrowser = isPlatformBrowser(platformId);
    this.quoteForm = this.fb.group({
      businessName: ['', [Validators.required]],
      contactName: ['', [Validators.required]],
      phone: ['', [Validators.required, Validators.pattern(/^\d{10}$/)]],
      email: ['', [Validators.required, Validators.email]],
      businessAddress: ['', [Validators.required]],
      facilityType: ['', [Validators.required]],
      squareFootage: [''],
      frequency: ['', [Validators.required]],
      notes: ['']
    });
  }

  ngOnInit(): void {
    this.injectSchema();
  }

  ngOnDestroy(): void {
    for (const el of this.schemaElements) {
      el.parentNode?.removeChild(el);
    }
    this.schemaElements = [];
  }

  // ---------- Quote form ----------

  /** Digits only, capped at 10 — the backend DTO rejects anything else. */
  onPhoneInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    const digits = input.value.replace(/\D/g, '').substring(0, 10);
    this.quoteForm.patchValue({ phone: digits }, { emitEvent: false });
    input.value = digits;
  }

  onSubmit(): void {
    if (this.quoteForm.invalid) {
      this.quoteForm.markAllAsTouched();
      return;
    }

    this.isSubmitting = true;
    this.showError = false;
    this.showSuccess = false;

    const v = this.quoteForm.getRawValue();

    this.http.post(`${environment.apiUrl}/contact/quote-request`, {
      // QuoteRequestDto is shaped for the residential free-quote form. The commercial
      // fields map onto it rather than changing a DTO other callers share: the business
      // name leads the contact name so the notification email's subject line ("New Free
      // Quote Request from …") names the company, and everything with no column of its
      // own is written into Message, which is the field an admin actually reads.
      firstName: v.businessName,
      lastName: v.contactName,
      phone: v.phone,
      email: v.email,
      homeAddress: v.businessAddress,
      cleaningType: `Commercial - ${v.facilityType}`,
      message: this.buildMessage(v)
    }).subscribe({
      next: () => {
        this.isSubmitting = false;
        this.showSuccess = true;
        this.orderSound.playFormSubmit();

        // Same event name as /free-quote so the existing Google Ads conversion counts it.
        this.analytics.pushEvent('quote_form_submit', {
          event_category: 'lead',
          event_label: 'commercial_quote_request',
          service_type: 'commercial',
          value: 30
        });

        this.quoteForm.reset();
        this.quoteForm.markAsUntouched();
      },
      error: (err) => {
        this.isSubmitting = false;
        this.showError = true;
        this.errorMessage = extractApiErrorMessage(
          err,
          'Failed to send your request. Please try again, or call us and we will take the details over the phone.'
        );
      }
    });
  }

  /**
   * ONLY the fields that have no row of their own in the notification email.
   *
   * ContactController's quote-request template already prints First Name, Last Name, Phone,
   * Email, Home Address and Cleaning Type as labelled table rows, and this form maps the
   * business name, contact name, address and facility type onto exactly those. Repeating
   * them here printed each one twice in the same email, so frequency, size and the free-text
   * notes are all that belong in Message.
   *
   * Frequency is a required control, so this can never return the empty string the DTO's
   * [Required] on Message would reject.
   */
  private buildMessage(v: Record<string, string>): string {
    const lines = [`Requested frequency: ${v['frequency']}`];
    const size = (v['squareFootage'] ?? '').trim();
    if (size) {
      lines.push(`Approx. size: ${size} sq ft`);
    }
    const notes = (v['notes'] ?? '').trim();
    if (notes) {
      lines.push('', 'Notes:', notes);
    }
    return lines.join('\n');
  }

  hasError(field: string): boolean {
    const c = this.quoteForm.get(field);
    return !!(c && c.invalid && c.touched);
  }

  getErrorMessage(field: string): string {
    const c = this.quoteForm.get(field);
    if (!c || !c.errors) return '';
    if (c.errors['required']) return `${this.LABELS[field] ?? 'This field'} is required`;
    if (c.errors['email']) return 'Enter a valid email address';
    if (c.errors['pattern']) return 'Enter a 10-digit phone number';
    return 'Please check this field';
  }

  private readonly LABELS: Record<string, string> = {
    businessName: 'Business name',
    contactName: 'Contact name',
    phone: 'Phone number',
    email: 'Email',
    businessAddress: 'Business address',
    facilityType: 'Facility type',
    frequency: 'Cleaning frequency'
  };

  /** Sends the page's secondary CTAs back to the hero form instead of off to /booking. */
  scrollToQuoteForm(): void {
    if (!this.isBrowser) return;
    const el = this.document.getElementById('commercial-quote');
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    // Focus the first field so keyboard and screen-reader users land where the click promised.
    (el.querySelector('input') as HTMLInputElement | null)?.focus({ preventScroll: true });
  }

  // ---------- Structured data ----------

  private injectSchema(): void {
    this.appendSchema({
      '@context': 'https://schema.org',
      '@type': 'Service',
      'name': 'Commercial Cleaning Services in NYC',
      'description':
        'Dream Cleaning provides commercial cleaning for offices, retail, medical practices, ' +
        'restaurants, gyms and building common areas across Manhattan, Brooklyn and Queens. ' +
        'Cleaning outside business hours, background-checked and insured crews, flat monthly ' +
        'pricing. Free on-site assessment, a customized cleaning plan, a same-day quote and ' +
        `${this.firstMonthDiscountPercent}% off the first month of a recurring plan, backed by a ` +
        '100% satisfaction guarantee.',
      'provider': {
        '@type': 'LocalBusiness',
        'name': 'Dream Cleaning',
        '@id': 'https://dreamcleaningnyc.com/#business'
      },
      'areaServed': { '@type': 'City', 'name': 'New York' },
      'serviceType': 'Commercial Cleaning',
      'hasOfferCatalog': {
        '@type': 'OfferCatalog',
        'name': 'Commercial cleaning services',
        'itemListElement': [
          'Office cleaning',
          'Retail and showroom cleaning',
          'Medical and dental office cleaning',
          'Restaurant and cafe cleaning',
          'Gym and fitness studio cleaning',
          'Building common area cleaning',
          'Post-construction cleaning',
          'Post-renovation cleaning'
        ].map(name => ({
          '@type': 'Offer',
          'itemOffered': { '@type': 'Service', 'name': name }
        }))
      }
    });

    this.appendSchema({
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      'mainEntity': this.faqs.map(f => ({
        '@type': 'Question',
        'name': f.q,
        'acceptedAnswer': { '@type': 'Answer', 'text': f.a }
      }))
    });
  }

  private appendSchema(schema: unknown): void {
    const el = this.document.createElement('script');
    el.type = 'application/ld+json';
    el.textContent = JSON.stringify(schema);
    this.document.head.appendChild(el);
    this.schemaElements.push(el);
  }

  /** Rendered in the FAQ section AND emitted as FAQPage JSON-LD — one source, so they can't drift. */
  readonly faqs: ReadonlyArray<{ q: string; a: string }> = [
    {
      q: 'How much does commercial cleaning cost in NYC?',
      a: 'Commercial cleaning is quoted per site rather than from a price list, because the cost ' +
         'depends on square footage, how many nights a week you need us, the number of ' +
         'restrooms, and the floor types. Send the form on this page or call us, and we will ' +
         'walk the space and send a flat monthly price with nothing billed on top of it.'
    },
    {
      q: 'Is there a discount for new commercial clients?',
      a: 'Yes - new commercial clients who start a recurring plan get ' +
         `${this.firstMonthDiscountPercent}% off the first month of service. It comes off the ` +
         'flat monthly price we quote after the walkthrough, so there is nothing to claim and ' +
         'nothing to enter. One-time jobs are quoted at the usual price.'
    },
    {
      q: 'Does the on-site assessment cost anything, and how fast is the quote?',
      a: 'The assessment is free and carries no obligation - we come to you, walk the space and ' +
         'agree the scope on site. The price follows the same business day in most cases, as a ' +
         'flat monthly figure with the task list it covers attached.'
    },
    {
      q: 'Can you clean outside our business hours?',
      a: 'Yes. Most of our commercial clients are cleaned in the evening after the last person ' +
         'leaves, or early in the morning before the office opens. Weekend service is available ' +
         'for spaces that cannot be interrupted at all.'
    },
    {
      q: 'Are your cleaners insured and background-checked?',
      a: 'Every cleaner is background-checked, reference-checked and covered by our liability ' +
         'insurance. We can provide a certificate of insurance naming your building or landlord ' +
         'as additional insured, which most NYC commercial leases require before we can start.'
    },
    {
      q: 'Do we have to sign a contract?',
      a: 'That is your call. We work both ways: a contract when your business, your landlord or ' +
         'your procurement process needs one, and month to month when you would rather stay ' +
         'flexible. Either way the scope and the price are in writing, and if the service is ' +
         'not right we would rather fix the problem than hold you to a term.'
    },
    {
      q: 'Do you supply the cleaning products and equipment?',
      a: 'Yes - commercial-grade products, vacuums and equipment are included in the quoted ' +
         'price. Consumables you want stocked in restrooms and kitchens (paper, soap, liners) ' +
         'can either be supplied by you or added to the plan.'
    },
    {
      q: 'Which parts of NYC do you serve?',
      a: 'Manhattan, Brooklyn and Queens - 120 ZIP codes in total. If your business has more ' +
         'than one location across those boroughs, we can cover all of them on one plan and one ' +
         'invoice.'
    },
    {
      q: 'Can you handle a one-time clean instead of a recurring plan?',
      a: 'Yes. One-time commercial jobs are common - a post-construction or post-renovation ' +
         'clean before you open, an end-of-lease clean, or a deep clean before an inspection ' +
         'or an event. Same quote process, no ongoing commitment.'
    },
    {
      q: 'How fast can you start?',
      a: 'Usually within a few days of the walkthrough, and same-day or next-day for urgent ' +
         'one-time jobs. The slowest step is normally your building requiring a certificate of ' +
         'insurance, so tell us early if yours does.'
    }
  ];
}
