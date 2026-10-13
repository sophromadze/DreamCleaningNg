import type { BookingFormData } from '../../services/form-persistence.service';
import type { ExtraService, ServiceType, Subscription } from '../../services/booking.service';
import { BEDROOMS_SERVICE_KEY, PROPERTY_TYPE_APARTMENT, PROPERTY_TYPE_HOUSE, normalizePropertyType } from './property-type.utils';
import { readCookie } from '../ssr/read-cookie';

/**
 * The visitor's booking choice - the non-personal part of the saved booking draft - mirrored into
 * one small first-party cookie so the SERVER can draw the home hero and step 1 of /booking exactly
 * as the browser will (2026-10). It replaced the home hero's own `dc_hero_choice`, which held
 * catalogue IDs and only the hero's fields: the hero and the booking page already share one
 * stored draft (FormPersistenceService), so one cookie keeps them consistent by construction.
 *
 * Browser storage stays the source of truth inside a tab; this cookie is written from it on every
 * save and deleted with it (FormPersistenceService). Same lifetime as the stored draft (24 hours).
 *
 * KEYS ONLY, never ids or names: service type by ServiceType.serviceKey, rooms by Service.serviceKey,
 * extras by ExtraService.extraServiceKey, the plan by its period (Subscription.subscriptionDays,
 * which is a plan's identity). The server resolves them against the CURRENT catalogue, and
 * anything it cannot resolve - a deleted type, an unkeyed extra, an out-of-range quantity - is
 * dropped on its own; a choice whose type is gone is no choice at all. Never an error.
 *
 * Functional only. Never a name, email, phone, address, promo code, poll answer, free text or a
 * price. Not written for an Admin Mode draft (that draft is discarded on reload anyway).
 *
 * Format (version 2, cookie-safe without encoding; keys are [a-z0-9] words joined by '-'):
 *   2.<type>.<n|d>.<a|h|>.<levels>.<svc>~<qty>_....<extra>~<qty>~<half-hours>_....<plan days>
 *     .<yyyymmdd>.<hhmm>.<tip cents>.<floor>~<floor>...
 * Empty fields stay empty. ~40-300 bytes in practice; MAX_* caps bound the worst case.
 */
export const BOOKING_CHOICE_COOKIE = 'dc_booking_choice';
/** The ID-based cookie it replaced: ignored when read, deleted on the next save. */
export const LEGACY_HERO_CHOICE_COOKIE = 'dc_hero_choice';
/** Same lifetime as the saved draft itself (FormPersistenceService FORM_TTL, 24 hours). */
export const BOOKING_CHOICE_MAX_AGE_SECONDS = 24 * 60 * 60;

const VERSION = '2';
const MAX_SERVICES = 12;
const MAX_EXTRAS = 24;
const MAX_FLOORS = 10;
const KEY = '[a-z0-9]{1,50}(?:-[a-z0-9]{1,50}){0,9}';
const KEY_RE = new RegExp(`^${KEY}$`);
const FLOOR_RE = /^[a-z]{1,20}(?:-[a-z]{1,20}){0,3}$/;
const FORMAT = new RegExp(
  `^2\\.(${KEY})\\.([nd])\\.([ah]?)\\.([1-9]?)` +
  `\\.((?:${KEY}~\\d{1,7}(?:_${KEY}~\\d{1,7}){0,${MAX_SERVICES - 1}})?)` +
  `\\.((?:${KEY}~\\d{1,3}~\\d{1,3}(?:_${KEY}~\\d{1,3}~\\d{1,3}){0,${MAX_EXTRAS - 1}})?)` +
  `\\.(\\d{0,4})\\.((?:\\d{8})?)\\.((?:\\d{4})?)\\.(\\d{0,7})` +
  `\\.((?:[a-z-]{1,40}(?:~[a-z-]{1,40}){0,${MAX_FLOORS - 1}})?)$`
);

/** A decoded cookie: keys and values exactly as stored, not yet checked against the catalogue. */
export interface BookingChoice {
  typeKey: string;
  cleaningType: 'normal' | 'deep';
  propertyType?: string;
  levels?: number;
  services: { key: string; quantity: number }[];
  extras: { key: string; quantity: number; hours: number }[];
  planDays?: number;
  date?: string;
  time?: string;
  tips?: number;
  floorTypes?: string[];
}

function validKey(key: unknown): key is string {
  return typeof key === 'string' && KEY_RE.test(key);
}

/** The cookie value for a saved draft, or null when there is nothing (keyed) to remember. */
export function encodeBookingChoice(data: BookingFormData | null | undefined): string | null {
  if (!data || data.wasAdminMode) return null;
  const typeKey = data.selectedServiceTypeKey;
  if (!validKey(typeKey)) return null;

  const cleaning = data.cleaningType === 'deep' ? 'd' : 'n';
  const propertyType = normalizePropertyType(data.propertyType);
  const property = propertyType === PROPERTY_TYPE_HOUSE ? 'h' : propertyType === PROPERTY_TYPE_APARTMENT ? 'a' : '';
  const levels = Number.isInteger(data.levelsQuantity) && data.levelsQuantity! >= 1 && data.levelsQuantity! <= 9
    ? String(data.levelsQuantity) : '';

  const services = (data.selectedServices ?? [])
    .filter(s => validKey(s.serviceKey) && Number.isInteger(s.quantity) && s.quantity >= 0 && s.quantity < 1e7)
    .slice(0, MAX_SERVICES)
    .map(s => `${s.serviceKey}~${s.quantity}`)
    .join('_');

  // An extra with no key cannot be named here; it is restored from browser storage instead.
  const extras = (data.selectedExtraServices ?? [])
    .filter(e => validKey(e.extraServiceKey))
    .map(e => ({ key: e.extraServiceKey!, quantity: Math.round(Number(e.quantity) || 0), halfHours: Math.round((Number(e.hours) || 0) * 2) }))
    .filter(e => e.quantity >= 0 && e.quantity < 1000 && e.halfHours >= 0 && e.halfHours < 1000)
    .slice(0, MAX_EXTRAS)
    .map(e => `${e.key}~${e.quantity}~${e.halfHours}`)
    .join('_');

  const planDays = Number.isInteger(data.selectedSubscriptionDays) && data.selectedSubscriptionDays! >= 0 && data.selectedSubscriptionDays! < 10000
    ? String(data.selectedSubscriptionDays) : '';
  const date = /^\d{4}-\d{2}-\d{2}$/.test(data.serviceDate ?? '') ? data.serviceDate!.replace(/-/g, '') : '';
  const time = /^\d{2}:\d{2}$/.test(data.serviceTime ?? '') ? data.serviceTime!.replace(':', '') : '';
  const tipCents = Math.round((Number(data.tips) || 0) * 100);
  const tips = tipCents > 0 && tipCents < 1e7 ? String(tipCents) : '';
  const floors = (data.floorTypes ?? []).filter(f => FLOOR_RE.test(f)).slice(0, MAX_FLOORS).join('~');

  return [VERSION, typeKey, cleaning, property, levels, services, extras, planDays, date, time, tips, floors].join('.');
}

/** Strict parse. Anything that is not exactly the format above - including version 1 - is no choice. */
export function decodeBookingChoice(value: string | null | undefined): BookingChoice | null {
  const m = value ? FORMAT.exec(value) : null;
  if (!m) return null;
  const [, typeKey, cleaning, property, levels, services, extras, planDays, date, time, tips, floors] = m;
  const choice: BookingChoice = {
    typeKey,
    cleaningType: cleaning === 'd' ? 'deep' : 'normal',
    services: services ? services.split('_').map(p => { const [key, q] = p.split('~'); return { key, quantity: Number(q) }; }) : [],
    extras: extras ? extras.split('_').map(p => { const [key, q, h] = p.split('~'); return { key, quantity: Number(q), hours: Number(h) / 2 }; }) : []
  };
  // Optional fields are omitted rather than undefined: the choice also travels as JSON.
  if (property) choice.propertyType = property === 'h' ? PROPERTY_TYPE_HOUSE : PROPERTY_TYPE_APARTMENT;
  if (levels) choice.levels = Number(levels);
  if (planDays) choice.planDays = Number(planDays);
  if (date) {
    const iso = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;
    if (!Number.isNaN(Date.parse(`${iso}T00:00:00Z`))) choice.date = iso;
  }
  if (time && Number(time.slice(0, 2)) < 24 && Number(time.slice(2)) < 60) choice.time = `${time.slice(0, 2)}:${time.slice(2)}`;
  if (tips) choice.tips = Number(tips) / 100;
  if (floors) choice.floorTypes = floors.split('~').filter(f => FLOOR_RE.test(f));
  return choice;
}

export interface ResolveChoiceOptions {
  /** The plans, when the caller has them (the hero does not; it then leaves the plan out). */
  subscriptions?: Subscription[] | null;
  /** Which types the caller can draw. Defaults to every active non-custom type. */
  acceptType?: (type: ServiceType) => boolean;
}

/**
 * The decoded choice against the CURRENT catalogue, as a saved draft (ids AND keys) that the
 * ordinary restore paths apply. Keys only; the type must be one the caller offers, every
 * quantity must belong to it and sit in its service's bounds, every extra must be one of the
 * type's active, keyed extras. Whatever does not resolve is dropped on its own; no type, no choice.
 */
export function resolveBookingChoice(
  choice: BookingChoice | null,
  serviceTypes: ServiceType[] | null | undefined,
  options: ResolveChoiceOptions = {}
): BookingFormData | null {
  if (!choice) return null;
  const accept = options.acceptType ?? ((t: ServiceType) => t.isActive !== false && !t.isCustom);
  const type = (serviceTypes ?? []).find(t => t.serviceKey === choice.typeKey && accept(t));
  if (!type) return null;

  const selectedServices: NonNullable<BookingFormData['selectedServices']> = [];
  for (const saved of choice.services) {
    const service = (type.services ?? []).find(s => s.serviceKey === saved.key && s.isActive !== false);
    if (!service || selectedServices.some(s => s.serviceKey === saved.key)) continue;
    const min = service.serviceKey === BEDROOMS_SERVICE_KEY ? 0 : (service.minValue ?? 0);
    const max = service.maxValue ?? Number.MAX_SAFE_INTEGER;
    if (saved.quantity < min || saved.quantity > max) continue;
    selectedServices.push({ serviceId: String(service.id), serviceKey: service.serviceKey, quantity: saved.quantity });
  }

  const selectedExtraServices: NonNullable<BookingFormData['selectedExtraServices']> = [];
  for (const saved of choice.extras) {
    const extra: ExtraService | undefined = (type.extraServices ?? [])
      .find(e => e.extraServiceKey === saved.key && e.isActive !== false);
    if (!extra || selectedExtraServices.some(e => e.extraServiceKey === saved.key)) continue;
    if (saved.hours > 24 || saved.quantity > 99) continue;
    selectedExtraServices.push({ extraServiceId: String(extra.id), extraServiceKey: saved.key, quantity: saved.quantity, hours: saved.hours });
  }

  const plan = choice.planDays != null
    // api/booking/subscriptions lists only active plans (its DTO has no isActive to test).
    ? (options.subscriptions ?? []).find(s => s.subscriptionDays === choice.planDays)
    : undefined;

  const resolved: BookingFormData = {
    selectedServiceTypeId: String(type.id),
    selectedServiceTypeKey: type.serviceKey!,
    selectedServices,
    selectedExtraServices,
    cleaningType: choice.cleaningType
  };
  if (choice.propertyType) resolved.propertyType = choice.propertyType;
  if (choice.levels != null) resolved.levelsQuantity = choice.levels;
  if (plan) {
    resolved.selectedSubscriptionId = String(plan.id);
    resolved.selectedSubscriptionDays = plan.subscriptionDays;
  }
  if (choice.date) resolved.serviceDate = choice.date;
  if (choice.time) resolved.serviceTime = choice.time;
  if (choice.tips != null) resolved.tips = choice.tips;
  if (choice.floorTypes?.length) resolved.floorTypes = choice.floorTypes;
  return resolved;
}

/** Decode + resolve in one step, from a Cookie header (server) or document.cookie (browser). */
export function readBookingChoice(
  cookieHeader: string | null | undefined,
  serviceTypes: ServiceType[] | null | undefined,
  options: ResolveChoiceOptions = {}
): BookingFormData | null {
  return resolveBookingChoice(decodeBookingChoice(readCookie(cookieHeader, BOOKING_CHOICE_COOKIE)), serviceTypes, options);
}

/** Browser only. Mirrors the saved draft into the cookie (or deletes it), and retires the old one. */
export function writeBookingChoiceCookie(doc: Document, data: BookingFormData | null | undefined): void {
  const value = encodeBookingChoice(data);
  // Always written, even unchanged: every save renews the 24 hours, exactly as it renews the draft.
  const attributes = `; Path=/; SameSite=Lax; Secure; Max-Age=${value ? BOOKING_CHOICE_MAX_AGE_SECONDS : 0}`;
  doc.cookie = `${BOOKING_CHOICE_COOKIE}=${value ?? ''}${attributes}`;
  if (readCookie(doc.cookie, LEGACY_HERO_CHOICE_COOKIE) !== null) {
    doc.cookie = `${LEGACY_HERO_CHOICE_COOKIE}=; Path=/; SameSite=Lax; Secure; Max-Age=0`;
  }
}

/**
 * A decoded choice as a KEY-ONLY draft (no ids), merged with what the caller could resolve. Used
 * to seed the storage of a tab that has none (a new tab, storage cleared) before the hero saves
 * into it: the hero resolves only its own fields, and without this seed its save would write the
 * cookie back without the extras, plan and date the visitor chose on /booking. The booking page
 * fills the missing ids from the keys when it restores (fillDraftIdsFromKeys).
 */
export function seedDraftFromChoice(choice: BookingChoice, resolved: BookingFormData | null): BookingFormData {
  const draft: BookingFormData = {
    selectedServiceTypeKey: choice.typeKey,
    cleaningType: choice.cleaningType,
    selectedServices: choice.services.map(s => ({ serviceId: '', serviceKey: s.key, quantity: s.quantity })),
    selectedExtraServices: choice.extras.map(e => ({ extraServiceId: '', extraServiceKey: e.key, quantity: e.quantity, hours: e.hours }))
  };
  if (choice.propertyType) draft.propertyType = choice.propertyType;
  if (choice.levels != null) draft.levelsQuantity = choice.levels;
  if (choice.planDays != null) draft.selectedSubscriptionDays = choice.planDays;
  if (choice.date) draft.serviceDate = choice.date;
  if (choice.time) draft.serviceTime = choice.time;
  if (choice.tips != null) draft.tips = choice.tips;
  if (choice.floorTypes?.length) draft.floorTypes = choice.floorTypes;
  if (resolved) {
    draft.selectedServiceTypeId = resolved.selectedServiceTypeId;
    draft.selectedServices = resolved.selectedServices;
  }
  return draft;
}

/**
 * A stored draft with every missing id filled from its key, against the catalogue the caller holds
 * (entries seeded by seedDraftFromChoice). Entries that already carry an id are left exactly as
 * they are; a key that does not resolve leaves its entry id-less, which every restore path skips.
 */
export function fillDraftIdsFromKeys(
  draft: BookingFormData,
  serviceTypes: ServiceType[] | null | undefined,
  subscriptions?: Subscription[] | null
): BookingFormData {
  const types = serviceTypes ?? [];
  const type = draft.selectedServiceTypeId
    ? types.find(t => String(t.id) === String(draft.selectedServiceTypeId))
    : types.find(t => !!draft.selectedServiceTypeKey && t.serviceKey === draft.selectedServiceTypeKey);
  if (!type) return draft;
  const filled: BookingFormData = { ...draft, selectedServiceTypeId: String(type.id) };
  filled.selectedServices = (draft.selectedServices ?? []).map(s => s.serviceId ? s : {
    ...s, serviceId: String((type.services ?? []).find(x => !!s.serviceKey && x.serviceKey === s.serviceKey)?.id ?? '')
  });
  filled.selectedExtraServices = (draft.selectedExtraServices ?? []).map(e => e.extraServiceId ? e : {
    ...e, extraServiceId: String((type.extraServices ?? []).find(x => !!e.extraServiceKey && x.extraServiceKey === e.extraServiceKey)?.id ?? '')
  });
  if (!filled.selectedSubscriptionId && filled.selectedSubscriptionDays != null) {
    const plan = (subscriptions ?? []).find(p => p.subscriptionDays === filled.selectedSubscriptionDays);
    if (plan) filled.selectedSubscriptionId = String(plan.id);
  }
  return filled;
}
