import type { BookingFormData } from '../../services/form-persistence.service';
import type { ServiceType } from '../../services/booking.service';
import { BEDROOMS_SERVICE_KEY, PROPERTY_TYPE_APARTMENT, PROPERTY_TYPE_HOUSE, normalizePropertyType } from './property-type.utils';

/**
 * The home hero's saved choice, mirrored into a small first-party cookie so the SERVER can render
 * a returning visitor's form directly. Browser storage (FormPersistenceService, sessionStorage)
 * stays the source of truth; this cookie is written from it on every save and deleted with it.
 *
 * Functional only: it holds the service type, the form quantities, Regular/Deep and the property
 * type - the four things the hero restores and shows. Never names, contact details or prices.
 *
 * Format (version 1, URL-safe, no encoding needed, ~20-60 bytes):
 *   1.<serviceTypeId>.<n|d>.<a|h|->.<serviceId>-<qty>_<serviceId>-<qty>...
 *   n/d = Regular/Deep cleaning; a/h/- = Apartment/House/unanswered.
 * Ids are the same catalogue ids the browser-storage restore uses.
 */
export const HERO_CHOICE_COOKIE = 'dc_hero_choice';

/** Same lifetime as the saved form itself (FormPersistenceService.FORM_TTL, 24 hours). */
export const HERO_CHOICE_MAX_AGE_SECONDS = 24 * 60 * 60;

const VERSION = '1';
const MAX_SERVICES = 12;
const FORMAT = /^1\.(\d{1,9})\.([nd])\.([ah-])\.((?:\d{1,9}-\d{1,7}(?:_\d{1,9}-\d{1,7}){0,11})?)$/;

/** The part of the saved form the hero restores. */
export type HeroChoice = Required<Pick<BookingFormData, 'selectedServiceTypeId' | 'selectedServices' | 'cleaningType'>>
  & Pick<BookingFormData, 'propertyType'>;

export function encodeHeroChoice(data: BookingFormData | null | undefined): string | null {
  const typeId = data?.selectedServiceTypeId;
  if (!typeId || !/^\d{1,9}$/.test(typeId)) return null;
  const cleaning = data!.cleaningType === 'deep' ? 'd' : 'n';
  const propertyType = normalizePropertyType(data!.propertyType);
  const property = propertyType === PROPERTY_TYPE_HOUSE ? 'h' : propertyType === PROPERTY_TYPE_APARTMENT ? 'a' : '-';
  const services = (data!.selectedServices ?? [])
    .filter(s => /^\d{1,9}$/.test(String(s.serviceId)) && Number.isInteger(s.quantity) && s.quantity >= 0 && s.quantity < 1e7)
    .slice(0, MAX_SERVICES)
    .map(s => `${s.serviceId}-${s.quantity}`)
    .join('_');
  return [VERSION, typeId, cleaning, property, services].join('.');
}

/** Strict parse. Anything that is not exactly the format above reads as "no choice". */
export function decodeHeroChoice(value: string | null | undefined): HeroChoice | null {
  const m = value ? FORMAT.exec(value) : null;
  if (!m) return null;
  return {
    selectedServiceTypeId: m[1],
    cleaningType: m[2] === 'd' ? 'deep' : 'normal',
    // Omitted rather than undefined: the choice also travels as JSON in TransferState.
    ...(m[3] === 'h' ? { propertyType: PROPERTY_TYPE_HOUSE } : m[3] === 'a' ? { propertyType: PROPERTY_TYPE_APARTMENT } : {}),
    selectedServices: m[4]
      ? m[4].split('_').map(pair => {
          const [serviceId, quantity] = pair.split('-');
          return { serviceId, quantity: Number(quantity) };
        })
      : []
  };
}

/**
 * Keeps only what the current catalogue can show: the type must be one the hero offers, and each
 * quantity must belong to that type and sit inside its service's own bounds. A choice whose type
 * is gone is dropped entirely (default form); an out-of-range quantity is dropped on its own.
 */
export function validateHeroChoice(choice: HeroChoice | null, serviceTypes: ServiceType[]): HeroChoice | null {
  if (!choice) return null;
  const type = serviceTypes.find(t => t.id.toString() === choice.selectedServiceTypeId);
  if (!type) return null;
  const selectedServices = choice.selectedServices.filter(saved => {
    const service = (type.services ?? []).find(s => s.id.toString() === saved.serviceId);
    if (!service || service.isActive === false) return false;
    const min = service.serviceKey === BEDROOMS_SERVICE_KEY ? 0 : (service.minValue ?? 0);
    const max = service.maxValue ?? Number.MAX_SAFE_INTEGER;
    return saved.quantity >= min && saved.quantity <= max;
  });
  return { ...choice, selectedServices };
}

/** Value of one cookie from a Cookie header / document.cookie string. */
export function readCookie(cookieHeader: string | null | undefined, name: string): string | null {
  for (const part of (cookieHeader ?? '').split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}

/** Browser only. Mirrors the saved form into the cookie, or deletes it when there is no choice. */
export function writeHeroChoiceCookie(doc: Document, data: BookingFormData | null | undefined): void {
  const value = encodeHeroChoice(data);
  const attributes = `; Path=/; SameSite=Lax; Secure; Max-Age=${value ? HERO_CHOICE_MAX_AGE_SECONDS : 0}`;
  doc.cookie = `${HERO_CHOICE_COOKIE}=${value ?? ''}${attributes}`;
}
