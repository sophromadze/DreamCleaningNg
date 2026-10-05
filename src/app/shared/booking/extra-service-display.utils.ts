/**
 * Display helpers shared by the booking page and the user order-edit page.
 * One definition for the extra-service icon mapping, tooltip text, and the
 * mobile tooltip show/auto-hide machinery — change here, applies to both.
 */

import { EXTRA_SERVICE_KEYS, extraIs, extraServiceKeyOf } from './extra-service-keys';

/**
 * Icon file stem per extraServiceKey (the keys the AddExtraServiceKey migration gives the
 * production extras). A keyed extra found here keeps its icon whatever it is renamed to; any other
 * extra - unkeyed, or keyed with a key not listed - still gets the name-based icon below.
 */
const EXTRA_ICON_BY_KEY: Readonly<Record<string, string>> = {
  'same-day': 'same_day',
  'extra-cleaners': 'extra_cleaners',
  'extra-minutes': 'extra_minutes',
  'cleaning-essentials': 'cleaning_essentials',
  'cleaning-supplies': 'cleaning_supplies',
  'vacuum-cleaner': 'vacuum_cleaner',
  'pets': 'pets',
  'fridge': 'fridge',
  'oven': 'oven',
  'kitchen-cabinets': 'kitchen_cabinets',
  'closets': 'closets',
  'dishes': 'dishes',
  'baseboards': 'baseboards',
  'windows': 'windows',
  'walls': 'walls',
  'stairs': 'stairs',
  'folding-organizing': 'folding',
  'laundry': 'laundry',
  'balcony': 'balcony',
  'home-office': 'office',
  'couches': 'couches',
  'chandelier': 'chandelier',
  'ceiling-fan': 'ceiling_fan'
};

/** Icon path for an extra service card (key first, then the name mapping; _disabled suffix when unselected). */
export function getExtraServiceImage(
  extraService: { name: string; extraServiceKey?: string | null },
  isSelected: boolean
): string {
  const suffix = isSelected ? '' : '_disabled';
  const byKey = EXTRA_ICON_BY_KEY[extraServiceKeyOf(extraService)];
  if (byKey) return `/images/${byKey}${suffix}.png`;

  const serviceName = extraService.name.toLowerCase();

  if (serviceName.includes('same day')) return `/images/same_day${suffix}.png`;
  if (serviceName.includes('extra cleaners')) return `/images/extra_cleaners${suffix}.png`;
  if (serviceName.includes('extra minutes')) return `/images/extra_minutes${suffix}.png`;
  // The two supply extras are DIFFERENT purchases and get different icons — "cleaning
  // essentials" (paper towels, garbage bags, toilet brush, broom) never matches "cleaning
  // supplies" (the products), which is the same non-overlap the checklist relies on. Essentials
  // is tested first only to keep the pair together; neither substring contains the other.
  if (serviceName.includes('cleaning essentials')) return `/images/cleaning_essentials${suffix}.png`;
  if (serviceName.includes('cleaning supplies')) return `/images/cleaning_supplies${suffix}.png`;
  if (serviceName.includes('vacuum cleaner')) return `/images/vacuum_cleaner${suffix}.png`;
  if (serviceName.includes('pets')) return `/images/pets${suffix}.png`;
  if (serviceName.includes('fridge')) return `/images/fridge${suffix}.png`;
  if (serviceName.includes('oven')) return `/images/oven${suffix}.png`;
  if (serviceName.includes('kitchen cabinets')) return `/images/kitchen_cabinets${suffix}.png`;
  if (serviceName.includes('closets')) return `/images/closets${suffix}.png`;
  if (serviceName.includes('dishes')) return `/images/dishes${suffix}.png`;
  if (serviceName.includes('baseboards')) return `/images/baseboards${suffix}.png`;
  if (serviceName.includes('windows')) return `/images/windows${suffix}.png`;
  if (serviceName.includes('walls')) return `/images/walls${suffix}.png`;
  if (serviceName.includes('stairs')) return `/images/stairs${suffix}.png`;
  if (serviceName.includes('folding') || serviceName.includes('folding / organizing')) return `/images/folding${suffix}.png`;
  if (serviceName.includes('laundry')) return `/images/laundry${suffix}.png`;
  if (serviceName.includes('balcony')) return `/images/balcony${suffix}.png`;
  // Home Office. 'cabinet' is the extra's former name, kept as an alias so a
  // catalog row that hasn't been renamed yet still gets the right icon.
  // ('kitchen cabinets' is matched earlier, so it never reaches here.)
  if (serviceName.includes('office') || serviceName.includes('cabinet')) return `/images/office${suffix}.png`;
  if (serviceName.includes('couches')) return `/images/couches${suffix}.png`;
  if (serviceName.includes('chandelier')) return `/images/chandelier${suffix}.png`;
  if (serviceName.includes('ceiling fan')) return `/images/ceiling_fan${suffix}.png`;

  return `/images/default_icon${suffix}.png`;
}

/** Tooltip text for an extra service card. */
export function getExtraServiceTooltip(
  extra: { name: string; description?: string | null; extraServiceKey?: string | null }
): string {
  let tooltip = extra.description || '';
  if (extraIs(extra, EXTRA_SERVICE_KEYS.extraCleaners, (_lower, name) => name === 'Extra Cleaners')) {
    tooltip += '\n\nEach extra cleaner reduces service duration.';
  }
  return tooltip;
}

/** "HH:mm" → "h:mm AM/PM" display format. */
export function formatTime12h(time: string | null | undefined): string {
  if (!time) return '';
  const [hours, minutes] = time.split(':');
  const hour = parseInt(hours);
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const hour12 = hour % 12 || 12;
  return `${hour12}:${minutes} ${ampm}`;
}

/** The 12-hour pieces an AM/PM picker edits. */
export interface Time12hParts {
  hour12: number;      // 1-12
  minute: number;      // 0-59
  meridiem: 'AM' | 'PM';
}

/**
 * "HH:mm" / "HH:mm:ss" -> the 12-hour pieces, or null when there is no usable time.
 * The inverse of `composeTime24h`. Storage stays 24-hour everywhere; only the
 * picker is 12-hour, because admins misread a 24-hour field.
 */
export function parseTime12h(time: string | null | undefined): Time12hParts | null {
  if (!time) return null;
  const match = String(time).trim().match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const hour24 = parseInt(match[1], 10);
  const minute = parseInt(match[2], 10);
  if (isNaN(hour24) || isNaN(minute) || hour24 > 23 || minute > 59) return null;
  return {
    hour12: hour24 % 12 || 12,
    minute,
    meridiem: hour24 >= 12 ? 'PM' : 'AM'
  };
}

/** 12-hour pieces -> the "HH:mm" string the API and every other surface store. */
export function composeTime24h(hour12: number, minute: number, meridiem: 'AM' | 'PM'): string {
  const base = hour12 % 12;                       // 12 AM -> 0, 12 PM -> 12
  const hour24 = meridiem === 'PM' ? base + 12 : base;
  return `${String(hour24).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/**
 * Mobile tooltip show/auto-hide state for the extra-service cards. The host
 * component supplies its own "am I on mobile" check and auto-hide duration.
 */
export class MobileTooltipManager {
  private timeouts: { [key: number]: any } = {};
  private states: { [key: number]: boolean } = {};

  constructor(
    private readonly isMobile: () => boolean,
    private readonly autoHideMs: number = 3000
  ) {}

  show(id: number): void {
    if (!this.isMobile()) return;
    this.clear(id);
    this.states[id] = true;
    this.timeouts[id] = setTimeout(() => this.clear(id), this.autoHideMs);
  }

  clear(id: number): void {
    if (this.timeouts[id]) {
      clearTimeout(this.timeouts[id]);
      delete this.timeouts[id];
    }
    this.states[id] = false;
  }

  clearAll(): void {
    Object.keys(this.timeouts).forEach(key => {
      const id = parseInt(key);
      if (this.timeouts[id]) {
        clearTimeout(this.timeouts[id]);
      }
    });
    this.timeouts = {};
    this.states = {};
  }

  isVisible(id: number): boolean {
    return this.states[id] || false;
  }
}
