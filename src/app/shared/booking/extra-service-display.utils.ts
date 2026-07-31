/**
 * Display helpers shared by the booking page and the user order-edit page.
 * One definition for the extra-service icon mapping, tooltip text, and the
 * mobile tooltip show/auto-hide machinery — change here, applies to both.
 */

/** Icon path for an extra service card (name-based mapping, _disabled suffix when unselected). */
export function getExtraServiceImage(extraService: { name: string }, isSelected: boolean): string {
  const serviceName = extraService.name.toLowerCase();
  const suffix = isSelected ? '' : '_disabled';

  if (serviceName.includes('same day')) return `/images/same_day${suffix}.png`;
  if (serviceName.includes('extra cleaners')) return `/images/extra_cleaners${suffix}.png`;
  if (serviceName.includes('extra minutes')) return `/images/extra_minutes${suffix}.png`;
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
export function getExtraServiceTooltip(extra: { name: string; description?: string | null }): string {
  let tooltip = extra.description || '';
  if (extra.name === 'Extra Cleaners') {
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
