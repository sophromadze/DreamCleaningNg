/**
 * Single source of truth for marketing-copy service prices shown across the
 * site (main page "What We Offer", borough pages, individual service pages,
 * About page, JSON-LD schemas, etc.).
 *
 * Update a value here and every component that imports it will reflect the
 * change. Booking-flow prices come from the backend API and are independent
 * of these constants.
 */
export const SERVICE_PRICING = {
  /** Standard residential / weekly maintenance — flat starting price. */
  residentialFrom: 130,
  residentialHigh: 380,

  /** Deep cleaning — flat starting price. */
  deepFrom: 220,
  deepHigh: 460,

  /** Move in/out cleaning — flat starting price. */
  moveInOutFrom: 245,
  moveInOutHigh: 470,

  /** Heavy condition cleaning — hourly per cleaner. */
  heavyConditionPerHour: 60,

  /** Filthy cleaning — hourly per cleaner. */
  filthyPerHour: 100,

  /** Custom cleaning — hourly. */
  customPerHour: 45,
} as const;

export type ServicePricing = typeof SERVICE_PRICING;
