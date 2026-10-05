/**
 * /llms.txt - the site summary for AI agents (https://llmstxt.org).
 *
 * Generated per request by server.ts, NEVER a file on disk. Its prices are the same MarketingPrices
 * every public page shows (app/shared/pricing/marketing-prices.ts), resolved from the in-memory
 * catalogue server.ts shares with SSR (catalogue-cache.ts), so a price changed in the admin panel
 * reaches this document within the cache TTL. Nothing here is prerendered or written into dist.
 *
 * Anything that did not resolve (key not set yet, two types holding one key, the backend
 * unreachable or still gated) drops that price fragment and nothing else: the document always
 * renders, never errors, never falls back to HTML.
 *
 * Mirrored with the other project: everything below SITE is identical in both; only SITE holds
 * brand, domain, contact and service-area copy.
 */

import {
  formatDisplayPrice,
  formatMarketingMoney as money,
  MarketingPrices,
  NO_MARKETING_PRICES
} from './app/shared/pricing/marketing-prices';

interface SiteLink {
  title: string;
  path: string;
  description: string;
}

const SITE = {
  name: 'Dream Cleaning',
  origin: 'https://dreamcleaningnyc.com',
  summary:
    'Dream Cleaning is a locally owned residential and commercial cleaning company serving Brooklyn, ' +
    'Manhattan and Queens in New York City since 2024. Prices are shown up front and cleanings can ' +
    'be booked online.',
  facts: [
    'Phone: (929) 930-1525',
    'Email: hello@dreamcleaningnyc.com',
    'Hours: daily, 8:00 AM to 8:00 PM',
    'Based in Brooklyn, NY'
  ],
  houseCleaning: 'Multi-floor homes and larger houses',
  condoCleaning: 'High-rise and boutique condos',
  serviceAreas: [
    { title: 'Brooklyn', path: '/services/brooklyn-cleaning', description: 'Cleaning service across Brooklyn ZIP codes' },
    { title: 'Manhattan', path: '/services/manhattan-cleaning', description: 'Cleaning service across Manhattan ZIP codes' },
    { title: 'Queens', path: '/services/queens-cleaning', description: 'Cleaning service across Queens ZIP codes' }
  ] as SiteLink[]
};

function joinList(parts: string[]): string {
  if (parts.length <= 1) return parts.join('');
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/** Renders the document. `null` (backend unreachable / refused) renders it with no prices at all. */
export function renderLlmsTxt(prices: MarketingPrices | null): string {
  const p = prices ?? NO_MARKETING_PRICES;
  const link = (title: string, path: string, description: string) =>
    `- [${title}](${SITE.origin}${path}): ${description}`;

  const fromParts: string[] = [];
  if (p.standardFrom !== null) fromParts.push(`${money(p.standardFrom)} (standard)`);
  if (p.deepFrom !== null) fromParts.push(`${money(p.deepFrom)} (deep)`);
  if (p.moveInOutFrom !== null) fromParts.push(`${money(p.moveInOutFrom)} (move in/out)`);
  const summary = fromParts.length
    ? `${SITE.summary} Flat-rate cleanings start at ${joinList(fromParts)}.`
    : SITE.summary;

  const lines: string[] = [
    `# ${SITE.name}`,
    '',
    `> ${summary}`,
    '',
    ...SITE.facts.map(f => `- ${f}`),
    '',
    '## Booking and pricing',
    '',
    link('Book a cleaning', '/booking', 'Online booking with an instant price estimate'),
    link('Free quote', '/free-quote', 'Request a free, no-obligation cleaning quote'),
    link('Pricing and discounts', '/pricing-and-discounts',
      'Flat-rate and hourly prices, first-time, recurring (weekly, bi-weekly, monthly), referral and loyalty discounts'),
    link('Cleaning checklist', '/cleaning-checklist',
      'Room-by-room comparison of standard, deep and move in/out cleaning, with exclusions and add-ons'),
    '',
    '## Residential services',
    '',
    link('All services', '/service-page', 'Overview of every cleaning service'),
    link('Standard residential cleaning', '/services/residential-cleaning',
      p.standardFrom !== null
        ? `One-time or recurring cleaning from ${money(p.standardFrom)}, with weekly, bi-weekly and monthly plans`
        : 'One-time or recurring cleaning, with weekly, bi-weekly and monthly plans'),
    link('Deep cleaning', '/services/deep-cleaning',
      p.deepFrom !== null
        ? `From ${money(p.deepFrom)}; baseboards, inside appliances, behind furniture`
        : 'Baseboards, inside appliances, behind furniture'),
    link('Move in/out cleaning', '/services/move-in-out-cleaning',
      p.moveInOutFrom !== null
        ? `From ${money(p.moveInOutFrom)}; cabinet interiors, appliances, wall spot cleaning`
        : 'Cabinet interiors, appliances, wall spot cleaning'),
    link('House cleaning', '/services/house-cleaning', SITE.houseCleaning),
    link('Condo cleaning', '/services/condo-cleaning', SITE.condoCleaning),
    link('Airbnb and short-term rental cleaning', '/services/airbnb-cleaning',
      'Same-day turnovers, resets and restocking'),
    link('Custom cleaning', '/services/custom-cleaning',
      p.customPerHour !== null
        ? `Choose the rooms, tasks and duration; ${money(p.customPerHour)} per hour per cleaner`
        : 'Choose the rooms, tasks and duration'),
    link('Heavy condition cleaning', '/services/heavy-condition-cleaning',
      p.heavyPerHour !== null
        ? `${money(p.heavyPerHour)} per hour per cleaner, for homes not cleaned in 6+ months`
        : 'For homes not cleaned in 6+ months'),
    link('Filthy cleaning', '/services/filthy-cleaning',
      p.filthy !== null
        ? `Extreme cleaning for hoarding, severe neglect and heavy buildup; ${formatDisplayPrice(p.filthy)}`
        : 'Extreme cleaning for hoarding, severe neglect and heavy buildup; priced after assessment'),
    link('Post-renovation cleaning', '/services/post-renovation-cleaning',
      'Dust and debris removal after home remodels'),
    link('Kitchen cleaning', '/services/residential-cleaning/kitchen',
      'Degreasing, stovetops, countertops, sinks, cabinet exteriors'),
    link('Bathroom cleaning', '/services/residential-cleaning/bathroom',
      'Toilet, sink, shower, tub and tile cleaning'),
    link('Laundry and dishwashing', '/services/laundry-and-dishwashing',
      'Wash, dry, fold and dishwashing add-on services'),
    '',
    '## Commercial services',
    '',
    link('Commercial cleaning', '/services/commercial-cleaning',
      'Offices, retail, medical practices and restaurants, with a free on-site assessment'),
    link('Office cleaning', '/services/office-cleaning',
      p.officePerHour !== null
        ? `Flexible scheduling and high-touch surface sanitizing; ${money(p.officePerHour)} per hour per cleaner`
        : 'Flexible scheduling and high-touch surface sanitizing'),
    link('Post-construction cleaning', '/services/post-construction-cleaning',
      p.postConstructionPerHour !== null
        ? `Commercial build-outs; construction dust, debris and residue removal; ${money(p.postConstructionPerHour)} per hour per cleaner`
        : 'Commercial build-outs; construction dust, debris and residue removal'),
    link('Commercial cleaning policies', '/commercial-cleaning-policies',
      'Scheduling, access, cancellation, invoicing, insurance and liability'),
    '',
    '## Service areas',
    '',
    ...SITE.serviceAreas.map(a => link(a.title, a.path, a.description)),
    '',
    '## About and support',
    '',
    link('About', '/about', 'Company background and background-checked cleaners'),
    link('FAQ', '/faq', 'Pricing, service areas, booking, what is included, satisfaction guarantee'),
    link('Customer reviews', '/reviews', 'Customer reviews'),
    link('Contact', '/contact', 'Phone, email and contact form'),
    '',
    '## Optional',
    '',
    link('Gift cards', '/gift-cards', 'Cleaning gift cards, purchasable online'),
    link('Terms and conditions', '/terms-and-conditions',
      'Booking, cancellation, rescheduling, payment and guarantee terms'),
    link('Privacy policy', '/privacy-policy', 'How personal information is collected and used')
  ];

  return lines.join('\n') + '\n';
}
