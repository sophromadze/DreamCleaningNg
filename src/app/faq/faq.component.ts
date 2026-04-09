import { Component, OnInit, OnDestroy, Inject, PLATFORM_ID } from '@angular/core';
import { CommonModule, isPlatformBrowser, DOCUMENT } from '@angular/common';
import { BubbleFieldComponent } from '../bubble-field/bubble-field.component';

@Component({
  selector: 'app-faq',
  standalone: true,
  imports: [CommonModule, BubbleFieldComponent],
  templateUrl: './faq.component.html',
  styleUrls: ['./faq.component.scss']
})
export class FaqComponent implements OnInit, OnDestroy {
  openItems: Set<number> = new Set();
  private schemaElement: HTMLScriptElement | null = null;

  constructor(
    @Inject(PLATFORM_ID) private platformId: Object,
    @Inject(DOCUMENT) private document: Document
  ) { }

  ngOnInit(): void {
    if (isPlatformBrowser(this.platformId)) {
      window.scrollTo(0, 0);
    }
    this.injectFaqSchema();
  }

  ngOnDestroy(): void {
    if (this.schemaElement && this.schemaElement.parentNode) {
      this.schemaElement.parentNode.removeChild(this.schemaElement);
    }
  }

  toggleItem(index: number): void {
    if (this.openItems.has(index)) {
      this.openItems.delete(index);
    } else {
      this.openItems.add(index);
    }
  }

  isOpen(index: number): boolean {
    return this.openItems.has(index);
  }

  private injectFaqSchema(): void {
    const schema = {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      'dateModified': '2026-03-22',
      'mainEntity': [
        {
          '@type': 'Question',
          'name': 'Do I need to be home during the cleaning?',
          'acceptedAnswer': {
            '@type': 'Answer',
            'text': 'No. Many clients prefer no-contact service. You can leave a key, door code, or keep the door open. Our cleaners are fully background-checked and insured.'
          }
        },
        {
          '@type': 'Question',
          'name': 'Is fridge interior cleaning included?',
          'acceptedAnswer': {
            '@type': 'Answer',
            'text': 'Deep Cleaning, Move-In/Out, and Heavy Condition Cleaning include interior fridge cleaning. For Standard Cleaning, it can be added as an extra.'
          }
        },
        {
          '@type': 'Question',
          'name': 'Do you bring your own cleaning supplies?',
          'acceptedAnswer': {
            '@type': 'Answer',
            'text': 'Dream Cleaning can bring cleaning solutions for $35 and a vacuum for $100. Please let us know in advance which supplies you may need.'
          }
        },
        {
          '@type': 'Question',
          'name': "What's the difference between deep cleaning and heavy condition cleaning?",
          'acceptedAnswer': {
            '@type': 'Answer',
            'text': 'Deep cleaning includes baseboards, hard-to-reach areas, and dusting above head level. Heavy condition cleaning goes further with wall washing, cabinet interiors, under sinks, and more — designed for homes that haven\'t been cleaned in 6+ months or have significant buildup. Heavy condition cleaning is $55 per hour per cleaner.'
          }
        },
        {
          '@type': 'Question',
          'name': "What's included in Move-In/Move-Out cleaning?",
          'acceptedAnswer': {
            '@type': 'Answer',
            'text': 'Move in/out cleaning includes baseboards, outside kitchen cabinets, fridge interior, light wall spot cleaning, and oven and dishwasher cleaning (can be added if not selected). Starting from $200.'
          }
        },
        {
          '@type': 'Question',
          'name': 'How is the price calculated?',
          'acceptedAnswer': {
            '@type': 'Answer',
            'text': 'Pricing is based on the size of your home, level of dirt, and selected services. You\'ll get the most accurate quote through our booking form or by requesting a custom estimate.'
          }
        },
        {
          '@type': 'Question',
          'name': 'Can I book recurring cleaning services?',
          'acceptedAnswer': {
            '@type': 'Answer',
            'text': 'Yes. Weekly, biweekly, and monthly plans are available with special rates for regular clients. We assign the same cleaner whenever possible for consistency.'
          }
        },
        {
          '@type': 'Question',
          'name': "What's your cancellation or rescheduling policy?",
          'acceptedAnswer': {
            '@type': 'Answer',
            'text': 'We kindly ask for a minimum of 48 hours\' notice. Late cancellations may incur a small fee due to the short notice.'
          }
        },
        {
          '@type': 'Question',
          'name': 'Are your cleaners insured and background-checked?',
          'acceptedAnswer': {
            '@type': 'Answer',
            'text': 'Yes. Dream Cleaning carries liability insurance, and all cleaners are thoroughly background-checked, reference-checked, and trained to deliver safe, professional service.'
          }
        },
        {
          '@type': 'Question',
          'name': "What if I'm not satisfied with the cleaning?",
          'acceptedAnswer': {
            '@type': 'Answer',
            'text': 'Dream Cleaning offers a 100% satisfaction guarantee. If you\'re not fully happy, let us know within 24 hours and we\'ll return to make it right — no questions asked.'
          }
        },
        {
          '@type': 'Question',
          'name': 'When do I pay for the service?',
          'acceptedAnswer': {
            '@type': 'Answer',
            'text': 'We accept credit and debit cards only. All payments are securely processed through Stripe. Your card will only be charged after the cleaning has been completed.'
          }
        },
        {
          '@type': 'Question',
          'name': 'Can I place an order by phone?',
          'acceptedAnswer': {
            '@type': 'Answer',
            'text': 'Yes, phone bookings are possible at (929) 930-1525. However, we recommend creating your own profile online for easier customization and booking management.'
          }
        },
        {
          '@type': 'Question',
          'name': 'Can I request the same cleaner or choose a different one?',
          'acceptedAnswer': {
            '@type': 'Answer',
            'text': 'Yes. Mention your preferred cleaner in the comment section when booking. For recurring cleanings, we assign the same cleaner every time whenever possible.'
          }
        },
        {
          '@type': 'Question',
          'name': 'How much does apartment cleaning cost in NYC?',
          'acceptedAnswer': {
            '@type': 'Answer',
            'text': "Dream Cleaning's standard residential cleaning starts from $110, deep cleaning from $190, and move in/out cleaning from $200. Pricing depends on home size, condition, and selected services."
          }
        },
        {
          '@type': 'Question',
          'name': 'What areas do you serve in NYC?',
          'acceptedAnswer': {
            '@type': 'Answer',
            'text': 'Dream Cleaning serves 120 ZIP codes across three NYC boroughs: Brooklyn (38 ZIP codes including Park Slope, Williamsburg, DUMBO, Bay Ridge), Manhattan (24 ZIP codes including Midtown, Chelsea, Lower East Side), and Queens (58 ZIP codes including Astoria, Long Island City, Forest Hills, Flushing).'
          }
        },
        {
          '@type': 'Question',
          'name': 'How often should I get my apartment deep cleaned in NYC?',
          'acceptedAnswer': {
            '@type': 'Answer',
            'text': 'Most NYC apartments benefit from professional deep cleaning every 3-6 months, with standard cleaning every 1-2 weeks for regular maintenance. High-traffic homes or apartments with pets may need deep cleaning more frequently.'
          }
        },
        {
          '@type': 'Question',
          'name': 'How do I book a cleaning service with Dream Cleaning?',
          'acceptedAnswer': {
            '@type': 'Answer',
            'text': 'Book online at dreamcleaningnearme.com/booking in under 2 minutes — select your home size, cleaning type, preferred date and time, and get an instant estimate. You can also call (929) 930-1525. Payment is processed securely through Stripe after service completion.'
          }
        },
        {
          '@type': 'Question',
          'name': 'Can I trust a cleaning service with my apartment keys in NYC?',
          'acceptedAnswer': {
            '@type': 'Answer',
            'text': 'All Dream Cleaning professionals are fully background-checked, reference-checked, and insured. Many of our clients use our no-contact service, leaving a key or door code. We carry full liability insurance for your peace of mind.'
          }
        },
        {
          '@type': 'Question',
          'name': 'How do I tip my house cleaner in NYC?',
          'acceptedAnswer': {
            '@type': 'Answer',
            'text': 'Tipping is not required but always appreciated. The standard tip for cleaning services in NYC is typically 15-20% of the service cost. You can tip your cleaner directly in cash after the service.'
          }
        }
      ]
    };

    this.schemaElement = this.document.createElement('script');
    this.schemaElement.type = 'application/ld+json';
    this.schemaElement.textContent = JSON.stringify(schema);
    this.document.head.appendChild(this.schemaElement);
  }
}
