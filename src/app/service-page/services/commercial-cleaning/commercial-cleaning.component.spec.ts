import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpTestingController } from '@angular/common/http/testing';

import { CommercialCleaningComponent } from './commercial-cleaning.component';
import { AnalyticsService } from '../../../services/analytics.service';
import { environment } from '../../../../environments/environment';
import { testProviders } from '../../../../testing/test-providers';

describe('CommercialCleaningComponent', () => {
  let component: CommercialCleaningComponent;
  let fixture: ComponentFixture<CommercialCleaningComponent>;
  let http: HttpTestingController;
  let analytics: jasmine.SpyObj<AnalyticsService>;

  const VALID = {
    businessName: 'Hudson Dental Group',
    contactName: 'Alex Rivera',
    phone: '2125550147',
    email: 'alex@hudsondental.com',
    businessAddress: '120 W 45th St, Manhattan',
    facilityType: 'Medical / dental',
    squareFootage: '2400',
    frequency: '5-7 nights a week',
    notes: 'Building requires a COI.'
  };

  beforeEach(async () => {
    analytics = jasmine.createSpyObj<AnalyticsService>('AnalyticsService', ['pushEvent']);

    await TestBed.configureTestingModule({
      imports: [CommercialCleaningComponent],
      providers: [...testProviders, { provide: AnalyticsService, useValue: analytics }]
    }).compileComponents();

    fixture = TestBed.createComponent(CommercialCleaningComponent);
    component = fixture.componentInstance;
    http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
  });

  afterEach(() => {
    http.verify();
    fixture.destroy();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('does not submit an incomplete form', () => {
    component.onSubmit();
    http.expectNone(`${environment.apiUrl}/contact/quote-request`);
    expect(component.isSubmitting).toBeFalse();
  });

  // The commercial fields have no columns of their own on QuoteRequestDto — a DTO other
  // callers share. If this mapping drifts, an admin reads a lead with no company on it.
  it('maps the commercial fields onto the shared quote-request DTO', () => {
    component.quoteForm.setValue(VALID);
    component.onSubmit();

    const req = http.expectOne(`${environment.apiUrl}/contact/quote-request`);
    const body = req.request.body;

    expect(body.firstName).toBe('Hudson Dental Group');
    expect(body.lastName).toBe('Alex Rivera');
    expect(body.phone).toBe('2125550147');
    expect(body.email).toBe('alex@hudsondental.com');
    expect(body.homeAddress).toBe('120 W 45th St, Manhattan');
    expect(body.cleaningType).toContain('Commercial');
    expect(body.cleaningType).toContain('Medical / dental');

    // Everything with nowhere else to go has to survive in Message.
    expect(body.message).toContain('Requested frequency: 5-7 nights a week');
    expect(body.message).toContain('2400 sq ft');
    expect(body.message).toContain('Building requires a COI.');

    req.flush({});
  });

  // The notification email prints these as labelled rows of its own; repeating them in
  // Message printed each one twice in the same email.
  it('keeps out of Message anything the email already has a row for', () => {
    component.quoteForm.setValue(VALID);
    component.onSubmit();

    const req = http.expectOne(`${environment.apiUrl}/contact/quote-request`);
    const message: string = req.request.body.message;

    expect(message).not.toContain('Hudson Dental Group');   // First Name row
    expect(message).not.toContain('Alex Rivera');           // Last Name row
    expect(message).not.toContain('120 W 45th St');         // Home Address row
    expect(message).not.toContain('Medical / dental');      // Cleaning Type row

    req.flush({});
  });

  it('omits the optional lines when they are blank', () => {
    component.quoteForm.setValue({ ...VALID, squareFootage: '  ', notes: '' });
    component.onSubmit();

    const req = http.expectOne(`${environment.apiUrl}/contact/quote-request`);
    expect(req.request.body.message).not.toContain('sq ft');
    expect(req.request.body.message).not.toContain('Notes:');
    req.flush({});
  });

  // The GTM container already fires the Google Ads conversion on `quote_form_submit`
  // (from /free-quote). Renaming the event here would silently stop counting these leads.
  it('fires the quote_form_submit conversion event on success', () => {
    component.quoteForm.setValue(VALID);
    component.onSubmit();
    http.expectOne(`${environment.apiUrl}/contact/quote-request`).flush({});

    expect(analytics.pushEvent).toHaveBeenCalledWith('quote_form_submit', jasmine.objectContaining({
      event_label: 'commercial_quote_request'
    }));
    expect(component.showSuccess).toBeTrue();
    expect(component.isSubmitting).toBeFalse();
  });

  it('releases the button and shows a message when the request fails', () => {
    component.quoteForm.setValue(VALID);
    component.onSubmit();
    http.expectOne(`${environment.apiUrl}/contact/quote-request`)
      .flush({ message: 'Email service is not configured.' }, { status: 500, statusText: 'Server Error' });

    expect(component.isSubmitting).toBeFalse();
    expect(component.showError).toBeTrue();
    expect(component.errorMessage).toContain('Email service is not configured.');
    expect(analytics.pushEvent).not.toHaveBeenCalled();
  });

  it('strips non-digits from the phone field', () => {
    const input = document.createElement('input');
    input.value = '(212) 555-0147 ext 9';
    component.onPhoneInput({ target: input } as unknown as Event);

    expect(component.quoteForm.get('phone')!.value).toBe('2125550147');
  });

  // The FAQ list and the FAQPage JSON-LD are rendered from the same array; a Q&A visible on
  // the page but missing from the schema (or the reverse) is what this guards against.
  it('emits FAQPage structured data matching the rendered FAQ list', () => {
    const scripts = Array.from(document.head.querySelectorAll('script[type="application/ld+json"]'))
      .map(el => JSON.parse(el.textContent || '{}'));
    const faqSchema = scripts.find(s => s['@type'] === 'FAQPage');

    expect(faqSchema).toBeTruthy();
    expect(faqSchema.mainEntity.length).toBe(component.faqs.length);
    expect(faqSchema.mainEntity[0].name).toBe(component.faqs[0].q);

    const rendered = fixture.nativeElement.querySelectorAll('.faq-item');
    expect(rendered.length).toBe(component.faqs.length);
  });

  // The five client benefits the owner sells on. The discount appears in four places (the
  // offer card, the hero coupon, the closing CTA and an FAQ answer) and all four
  // read `firstMonthDiscountPercent` — a hardcoded number in any one of them is the drift
  // this guards against.
  describe('commercial client benefits', () => {
    it('renders all five benefits, with the offer highlighted', () => {
      const cards = Array.from(
        fixture.nativeElement.querySelectorAll('.benefits-grid .benefit-card')
      ) as HTMLElement[];

      expect(cards.length).toBe(5);
      const headings = cards.map(c => c.querySelector('h3')!.textContent!.trim());
      expect(headings).toEqual([
        'Free On-Site Assessment',
        'Customized Cleaning Plan',
        'Same-Day Quote',
        `${component.firstMonthDiscountPercent}% Off Your First Month`,
        '100% Satisfaction Guarantee'
      ]);

      expect(fixture.nativeElement.querySelectorAll('.benefit-card--featured').length).toBe(1);
    });

    // The coupon is the homepage's ticket, reused. It scrolls to the form rather than
    // linking to /booking, so it has to stay a <button> — an <a routerLink> copied over
    // from the homepage would navigate away from the only place a commercial lead converts.
    it('shows the offer as the homepage hero coupon, wired to the quote form', () => {
      const coupon = fixture.nativeElement.querySelector('.hero-offer-coupon') as HTMLElement;

      expect(coupon).toBeTruthy();
      expect(coupon.tagName).toBe('BUTTON');
      expect(coupon.querySelector('.hero-offer-coupon__percent')!.textContent!.trim())
        .toBe(`${component.firstMonthDiscountPercent}%`);

      const scrolled = spyOn(component, 'scrollToQuoteForm');
      coupon.click();
      expect(scrolled).toHaveBeenCalled();
    });

    it('quotes the same discount in the coupon, the benefits card and the closing CTA', () => {
      const text: string = fixture.nativeElement.textContent;
      const percent = `${component.firstMonthDiscountPercent}%`;

      expect(text.split(percent).length - 1).toBeGreaterThanOrEqual(3);
    });

    // The offer is a real commitment to a customer, so it has to be findable in search too.
    it('names the offer and the assessment in the Service structured data', () => {
      const scripts = Array.from(document.head.querySelectorAll('script[type="application/ld+json"]'))
        .map(el => JSON.parse(el.textContent || '{}'));
      const service = scripts.find(s => s['@type'] === 'Service');

      expect(service.description).toContain(`${component.firstMonthDiscountPercent}% off the first month`);
      expect(service.description).toContain('Free on-site assessment');
    });
  });

  it('removes its structured data on destroy', () => {
    const before = document.head.querySelectorAll('script[type="application/ld+json"]').length;
    fixture.destroy();
    const after = document.head.querySelectorAll('script[type="application/ld+json"]').length;

    expect(after).toBe(before - 2);
  });
});
