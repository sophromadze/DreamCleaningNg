/**
 * GENERATED FILE - do not edit by hand.
 *
 * Produced by DreamCleaningNG/scripts/generate-pricing-fixtures.js from the real
 * order-pricing.calculator.ts against the production pricing configuration. The identical rows
 * are written to DreamCleaningBackend/DreamCleaningBackend.Tests/pricing-fixtures.json, which the
 * backend cross-surface test reads - one computation, two consumers, so they cannot disagree.
 *
 * Regenerate after any pricing change: node scripts/generate-pricing-fixtures.js
 */

export interface PricingFixture {
  serviceTypeName: string;
  bedrooms: number;
  bathrooms: number;
  sqft: number;
  deepCleaning: boolean;
  /** Level count for a house; null for an apartment, which has no levels line at all. */
  levels: number | null;
  expectedSubTotal: number;
  expectedDisplayDuration: number;
  expectedMinimumPriceApplied: boolean;
}

export const PRICING_FIXTURES: PricingFixture[] = [
  {
    "serviceTypeName": "Residential Cleaning",
    "bedrooms": 0,
    "bathrooms": 1,
    "sqft": 400,
    "deepCleaning": false,
    "levels": null,
    "expectedSubTotal": 130,
    "expectedDisplayDuration": 150,
    "expectedMinimumPriceApplied": true
  },
  {
    "serviceTypeName": "Residential Cleaning",
    "bedrooms": 0,
    "bathrooms": 2,
    "sqft": 400,
    "deepCleaning": false,
    "levels": null,
    "expectedSubTotal": 135,
    "expectedDisplayDuration": 180,
    "expectedMinimumPriceApplied": false
  },
  {
    "serviceTypeName": "Residential Cleaning",
    "bedrooms": 0,
    "bathrooms": 1,
    "sqft": 400,
    "deepCleaning": true,
    "levels": null,
    "expectedSubTotal": 258.75,
    "expectedDisplayDuration": 270,
    "expectedMinimumPriceApplied": false
  },
  {
    "serviceTypeName": "Residential Cleaning",
    "bedrooms": 0,
    "bathrooms": 2,
    "sqft": 400,
    "deepCleaning": true,
    "levels": null,
    "expectedSubTotal": 292.5,
    "expectedDisplayDuration": 300,
    "expectedMinimumPriceApplied": false
  },
  {
    "serviceTypeName": "Residential Cleaning",
    "bedrooms": 0,
    "bathrooms": 1,
    "sqft": 900,
    "deepCleaning": false,
    "levels": null,
    "expectedSubTotal": 198,
    "expectedDisplayDuration": 264,
    "expectedMinimumPriceApplied": false
  },
  {
    "serviceTypeName": "Residential Cleaning",
    "bedrooms": 0,
    "bathrooms": 2,
    "sqft": 900,
    "deepCleaning": false,
    "levels": null,
    "expectedSubTotal": 220.5,
    "expectedDisplayDuration": 294,
    "expectedMinimumPriceApplied": false
  },
  {
    "serviceTypeName": "Residential Cleaning",
    "bedrooms": 0,
    "bathrooms": 1,
    "sqft": 900,
    "deepCleaning": true,
    "levels": null,
    "expectedSubTotal": 387,
    "expectedDisplayDuration": 384,
    "expectedMinimumPriceApplied": false
  },
  {
    "serviceTypeName": "Residential Cleaning",
    "bedrooms": 0,
    "bathrooms": 2,
    "sqft": 900,
    "deepCleaning": true,
    "levels": null,
    "expectedSubTotal": 420.75,
    "expectedDisplayDuration": 414,
    "expectedMinimumPriceApplied": false
  },
  {
    "serviceTypeName": "Residential Cleaning",
    "bedrooms": 1,
    "bathrooms": 1,
    "sqft": 650,
    "deepCleaning": false,
    "levels": null,
    "expectedSubTotal": 135,
    "expectedDisplayDuration": 180,
    "expectedMinimumPriceApplied": false
  },
  {
    "serviceTypeName": "Residential Cleaning",
    "bedrooms": 1,
    "bathrooms": 2,
    "sqft": 650,
    "deepCleaning": false,
    "levels": null,
    "expectedSubTotal": 157.5,
    "expectedDisplayDuration": 210,
    "expectedMinimumPriceApplied": false
  },
  {
    "serviceTypeName": "Residential Cleaning",
    "bedrooms": 1,
    "bathrooms": 1,
    "sqft": 650,
    "deepCleaning": true,
    "levels": null,
    "expectedSubTotal": 292.5,
    "expectedDisplayDuration": 300,
    "expectedMinimumPriceApplied": false
  },
  {
    "serviceTypeName": "Residential Cleaning",
    "bedrooms": 1,
    "bathrooms": 2,
    "sqft": 650,
    "deepCleaning": true,
    "levels": null,
    "expectedSubTotal": 326.25,
    "expectedDisplayDuration": 330,
    "expectedMinimumPriceApplied": false
  },
  {
    "serviceTypeName": "Residential Cleaning",
    "bedrooms": 1,
    "bathrooms": 1,
    "sqft": 1200,
    "deepCleaning": false,
    "levels": null,
    "expectedSubTotal": 227.25,
    "expectedDisplayDuration": 303,
    "expectedMinimumPriceApplied": false
  },
  {
    "serviceTypeName": "Residential Cleaning",
    "bedrooms": 1,
    "bathrooms": 2,
    "sqft": 1200,
    "deepCleaning": false,
    "levels": null,
    "expectedSubTotal": 249.75,
    "expectedDisplayDuration": 333,
    "expectedMinimumPriceApplied": false
  },
  {
    "serviceTypeName": "Residential Cleaning",
    "bedrooms": 1,
    "bathrooms": 1,
    "sqft": 1200,
    "deepCleaning": true,
    "levels": null,
    "expectedSubTotal": 430.88,
    "expectedDisplayDuration": 423,
    "expectedMinimumPriceApplied": false
  },
  {
    "serviceTypeName": "Residential Cleaning",
    "bedrooms": 1,
    "bathrooms": 2,
    "sqft": 1200,
    "deepCleaning": true,
    "levels": null,
    "expectedSubTotal": 464.63,
    "expectedDisplayDuration": 453,
    "expectedMinimumPriceApplied": false
  },
  {
    "serviceTypeName": "Residential Cleaning",
    "bedrooms": 2,
    "bathrooms": 1,
    "sqft": 850,
    "deepCleaning": false,
    "levels": null,
    "expectedSubTotal": 157.5,
    "expectedDisplayDuration": 210,
    "expectedMinimumPriceApplied": false
  },
  {
    "serviceTypeName": "Residential Cleaning",
    "bedrooms": 2,
    "bathrooms": 2,
    "sqft": 850,
    "deepCleaning": false,
    "levels": null,
    "expectedSubTotal": 180,
    "expectedDisplayDuration": 240,
    "expectedMinimumPriceApplied": false
  },
  {
    "serviceTypeName": "Residential Cleaning",
    "bedrooms": 2,
    "bathrooms": 1,
    "sqft": 850,
    "deepCleaning": true,
    "levels": null,
    "expectedSubTotal": 326.25,
    "expectedDisplayDuration": 330,
    "expectedMinimumPriceApplied": false
  },
  {
    "serviceTypeName": "Residential Cleaning",
    "bedrooms": 2,
    "bathrooms": 2,
    "sqft": 850,
    "deepCleaning": true,
    "levels": null,
    "expectedSubTotal": 360,
    "expectedDisplayDuration": 360,
    "expectedMinimumPriceApplied": false
  },
  {
    "serviceTypeName": "Residential Cleaning",
    "bedrooms": 3,
    "bathrooms": 1,
    "sqft": 1000,
    "deepCleaning": false,
    "levels": null,
    "expectedSubTotal": 180,
    "expectedDisplayDuration": 240,
    "expectedMinimumPriceApplied": false
  },
  {
    "serviceTypeName": "Residential Cleaning",
    "bedrooms": 3,
    "bathrooms": 2,
    "sqft": 1000,
    "deepCleaning": false,
    "levels": null,
    "expectedSubTotal": 202.5,
    "expectedDisplayDuration": 270,
    "expectedMinimumPriceApplied": false
  },
  {
    "serviceTypeName": "Residential Cleaning",
    "bedrooms": 3,
    "bathrooms": 1,
    "sqft": 1000,
    "deepCleaning": true,
    "levels": null,
    "expectedSubTotal": 360,
    "expectedDisplayDuration": 360,
    "expectedMinimumPriceApplied": false
  },
  {
    "serviceTypeName": "Residential Cleaning",
    "bedrooms": 3,
    "bathrooms": 2,
    "sqft": 1000,
    "deepCleaning": true,
    "levels": null,
    "expectedSubTotal": 393.75,
    "expectedDisplayDuration": 390,
    "expectedMinimumPriceApplied": false
  },
  {
    "serviceTypeName": "Residential Cleaning",
    "bedrooms": 3,
    "bathrooms": 1,
    "sqft": 2400,
    "deepCleaning": false,
    "levels": null,
    "expectedSubTotal": 382,
    "expectedDisplayDuration": 509,
    "expectedMinimumPriceApplied": false
  },
  {
    "serviceTypeName": "Residential Cleaning",
    "bedrooms": 3,
    "bathrooms": 2,
    "sqft": 2400,
    "deepCleaning": false,
    "levels": null,
    "expectedSubTotal": 404.5,
    "expectedDisplayDuration": 539,
    "expectedMinimumPriceApplied": false
  },
  {
    "serviceTypeName": "Residential Cleaning",
    "bedrooms": 3,
    "bathrooms": 1,
    "sqft": 2400,
    "deepCleaning": true,
    "levels": null,
    "expectedSubTotal": 663,
    "expectedDisplayDuration": 629,
    "expectedMinimumPriceApplied": false
  },
  {
    "serviceTypeName": "Residential Cleaning",
    "bedrooms": 3,
    "bathrooms": 2,
    "sqft": 2400,
    "deepCleaning": true,
    "levels": null,
    "expectedSubTotal": 696.75,
    "expectedDisplayDuration": 659,
    "expectedMinimumPriceApplied": false
  },
  {
    "serviceTypeName": "Residential Cleaning",
    "bedrooms": 6,
    "bathrooms": 1,
    "sqft": 2000,
    "deepCleaning": false,
    "levels": null,
    "expectedSubTotal": 247.5,
    "expectedDisplayDuration": 330,
    "expectedMinimumPriceApplied": false
  },
  {
    "serviceTypeName": "Residential Cleaning",
    "bedrooms": 6,
    "bathrooms": 2,
    "sqft": 2000,
    "deepCleaning": false,
    "levels": null,
    "expectedSubTotal": 270,
    "expectedDisplayDuration": 360,
    "expectedMinimumPriceApplied": false
  },
  {
    "serviceTypeName": "Residential Cleaning",
    "bedrooms": 6,
    "bathrooms": 1,
    "sqft": 2000,
    "deepCleaning": true,
    "levels": null,
    "expectedSubTotal": 461.25,
    "expectedDisplayDuration": 450,
    "expectedMinimumPriceApplied": false
  },
  {
    "serviceTypeName": "Residential Cleaning",
    "bedrooms": 6,
    "bathrooms": 2,
    "sqft": 2000,
    "deepCleaning": true,
    "levels": null,
    "expectedSubTotal": 495,
    "expectedDisplayDuration": 480,
    "expectedMinimumPriceApplied": false
  },
  {
    "serviceTypeName": "Residential Cleaning",
    "bedrooms": 6,
    "bathrooms": 1,
    "sqft": 5000,
    "deepCleaning": false,
    "levels": null,
    "expectedSubTotal": 625.5,
    "expectedDisplayDuration": 831,
    "expectedMinimumPriceApplied": false
  },
  {
    "serviceTypeName": "Residential Cleaning",
    "bedrooms": 6,
    "bathrooms": 2,
    "sqft": 5000,
    "deepCleaning": false,
    "levels": null,
    "expectedSubTotal": 648,
    "expectedDisplayDuration": 861,
    "expectedMinimumPriceApplied": false
  },
  {
    "serviceTypeName": "Residential Cleaning",
    "bedrooms": 6,
    "bathrooms": 1,
    "sqft": 5000,
    "deepCleaning": true,
    "levels": null,
    "expectedSubTotal": 1028.25,
    "expectedDisplayDuration": 951,
    "expectedMinimumPriceApplied": false
  },
  {
    "serviceTypeName": "Residential Cleaning",
    "bedrooms": 6,
    "bathrooms": 2,
    "sqft": 5000,
    "deepCleaning": true,
    "levels": null,
    "expectedSubTotal": 1062,
    "expectedDisplayDuration": 981,
    "expectedMinimumPriceApplied": false
  },
  {
    "serviceTypeName": "Move in/out Cleaning",
    "bedrooms": 0,
    "bathrooms": 1,
    "sqft": 400,
    "deepCleaning": false,
    "levels": null,
    "expectedSubTotal": 245,
    "expectedDisplayDuration": 300,
    "expectedMinimumPriceApplied": true
  },
  {
    "serviceTypeName": "Move in/out Cleaning",
    "bedrooms": 0,
    "bathrooms": 2,
    "sqft": 400,
    "deepCleaning": false,
    "levels": null,
    "expectedSubTotal": 245,
    "expectedDisplayDuration": 330,
    "expectedMinimumPriceApplied": true
  },
  {
    "serviceTypeName": "Move in/out Cleaning",
    "bedrooms": 0,
    "bathrooms": 1,
    "sqft": 400,
    "deepCleaning": true,
    "levels": null,
    "expectedSubTotal": 405,
    "expectedDisplayDuration": 420,
    "expectedMinimumPriceApplied": false
  },
  {
    "serviceTypeName": "Move in/out Cleaning",
    "bedrooms": 0,
    "bathrooms": 2,
    "sqft": 400,
    "deepCleaning": true,
    "levels": null,
    "expectedSubTotal": 438.75,
    "expectedDisplayDuration": 450,
    "expectedMinimumPriceApplied": false
  },
  {
    "serviceTypeName": "Move in/out Cleaning",
    "bedrooms": 1,
    "bathrooms": 1,
    "sqft": 650,
    "deepCleaning": false,
    "levels": null,
    "expectedSubTotal": 255,
    "expectedDisplayDuration": 360,
    "expectedMinimumPriceApplied": false
  },
  {
    "serviceTypeName": "Move in/out Cleaning",
    "bedrooms": 1,
    "bathrooms": 2,
    "sqft": 650,
    "deepCleaning": false,
    "levels": null,
    "expectedSubTotal": 277.5,
    "expectedDisplayDuration": 390,
    "expectedMinimumPriceApplied": false
  },
  {
    "serviceTypeName": "Move in/out Cleaning",
    "bedrooms": 1,
    "bathrooms": 1,
    "sqft": 650,
    "deepCleaning": true,
    "levels": null,
    "expectedSubTotal": 472.5,
    "expectedDisplayDuration": 480,
    "expectedMinimumPriceApplied": false
  },
  {
    "serviceTypeName": "Move in/out Cleaning",
    "bedrooms": 1,
    "bathrooms": 2,
    "sqft": 650,
    "deepCleaning": true,
    "levels": null,
    "expectedSubTotal": 506.25,
    "expectedDisplayDuration": 510,
    "expectedMinimumPriceApplied": false
  },
  {
    "serviceTypeName": "Move in/out Cleaning",
    "bedrooms": 1,
    "bathrooms": 1,
    "sqft": 1200,
    "deepCleaning": false,
    "levels": null,
    "expectedSubTotal": 345,
    "expectedDisplayDuration": 480,
    "expectedMinimumPriceApplied": false
  },
  {
    "serviceTypeName": "Move in/out Cleaning",
    "bedrooms": 1,
    "bathrooms": 2,
    "sqft": 1200,
    "deepCleaning": false,
    "levels": null,
    "expectedSubTotal": 367.5,
    "expectedDisplayDuration": 510,
    "expectedMinimumPriceApplied": false
  },
  {
    "serviceTypeName": "Move in/out Cleaning",
    "bedrooms": 1,
    "bathrooms": 1,
    "sqft": 1200,
    "deepCleaning": true,
    "levels": null,
    "expectedSubTotal": 607.5,
    "expectedDisplayDuration": 600,
    "expectedMinimumPriceApplied": false
  },
  {
    "serviceTypeName": "Move in/out Cleaning",
    "bedrooms": 1,
    "bathrooms": 2,
    "sqft": 1200,
    "deepCleaning": true,
    "levels": null,
    "expectedSubTotal": 641.25,
    "expectedDisplayDuration": 630,
    "expectedMinimumPriceApplied": false
  },
  {
    "serviceTypeName": "Move in/out Cleaning",
    "bedrooms": 2,
    "bathrooms": 1,
    "sqft": 850,
    "deepCleaning": false,
    "levels": null,
    "expectedSubTotal": 277.5,
    "expectedDisplayDuration": 390,
    "expectedMinimumPriceApplied": false
  },
  {
    "serviceTypeName": "Move in/out Cleaning",
    "bedrooms": 2,
    "bathrooms": 2,
    "sqft": 850,
    "deepCleaning": false,
    "levels": null,
    "expectedSubTotal": 300,
    "expectedDisplayDuration": 420,
    "expectedMinimumPriceApplied": false
  },
  {
    "serviceTypeName": "Move in/out Cleaning",
    "bedrooms": 2,
    "bathrooms": 1,
    "sqft": 850,
    "deepCleaning": true,
    "levels": null,
    "expectedSubTotal": 506.25,
    "expectedDisplayDuration": 510,
    "expectedMinimumPriceApplied": false
  },
  {
    "serviceTypeName": "Move in/out Cleaning",
    "bedrooms": 2,
    "bathrooms": 2,
    "sqft": 850,
    "deepCleaning": true,
    "levels": null,
    "expectedSubTotal": 540,
    "expectedDisplayDuration": 540,
    "expectedMinimumPriceApplied": false
  },
  {
    "serviceTypeName": "Move in/out Cleaning",
    "bedrooms": 3,
    "bathrooms": 1,
    "sqft": 1000,
    "deepCleaning": false,
    "levels": null,
    "expectedSubTotal": 300,
    "expectedDisplayDuration": 420,
    "expectedMinimumPriceApplied": false
  },
  {
    "serviceTypeName": "Move in/out Cleaning",
    "bedrooms": 3,
    "bathrooms": 2,
    "sqft": 1000,
    "deepCleaning": false,
    "levels": null,
    "expectedSubTotal": 322.5,
    "expectedDisplayDuration": 450,
    "expectedMinimumPriceApplied": false
  },
  {
    "serviceTypeName": "Move in/out Cleaning",
    "bedrooms": 3,
    "bathrooms": 1,
    "sqft": 1000,
    "deepCleaning": true,
    "levels": null,
    "expectedSubTotal": 540,
    "expectedDisplayDuration": 540,
    "expectedMinimumPriceApplied": false
  },
  {
    "serviceTypeName": "Move in/out Cleaning",
    "bedrooms": 3,
    "bathrooms": 2,
    "sqft": 1000,
    "deepCleaning": true,
    "levels": null,
    "expectedSubTotal": 573.75,
    "expectedDisplayDuration": 570,
    "expectedMinimumPriceApplied": false
  },
  {
    "serviceTypeName": "Move in/out Cleaning",
    "bedrooms": 4,
    "bathrooms": 1,
    "sqft": 1500,
    "deepCleaning": false,
    "levels": null,
    "expectedSubTotal": 322.5,
    "expectedDisplayDuration": 450,
    "expectedMinimumPriceApplied": false
  },
  {
    "serviceTypeName": "Move in/out Cleaning",
    "bedrooms": 4,
    "bathrooms": 2,
    "sqft": 1500,
    "deepCleaning": false,
    "levels": null,
    "expectedSubTotal": 345,
    "expectedDisplayDuration": 480,
    "expectedMinimumPriceApplied": false
  },
  {
    "serviceTypeName": "Move in/out Cleaning",
    "bedrooms": 4,
    "bathrooms": 1,
    "sqft": 1500,
    "deepCleaning": true,
    "levels": null,
    "expectedSubTotal": 573.75,
    "expectedDisplayDuration": 570,
    "expectedMinimumPriceApplied": false
  },
  {
    "serviceTypeName": "Move in/out Cleaning",
    "bedrooms": 4,
    "bathrooms": 2,
    "sqft": 1500,
    "deepCleaning": true,
    "levels": null,
    "expectedSubTotal": 607.5,
    "expectedDisplayDuration": 600,
    "expectedMinimumPriceApplied": false
  },
  {
    "serviceTypeName": "Move in/out Cleaning",
    "bedrooms": 6,
    "bathrooms": 1,
    "sqft": 2000,
    "deepCleaning": false,
    "levels": null,
    "expectedSubTotal": 367.5,
    "expectedDisplayDuration": 510,
    "expectedMinimumPriceApplied": false
  },
  {
    "serviceTypeName": "Move in/out Cleaning",
    "bedrooms": 6,
    "bathrooms": 2,
    "sqft": 2000,
    "deepCleaning": false,
    "levels": null,
    "expectedSubTotal": 390,
    "expectedDisplayDuration": 540,
    "expectedMinimumPriceApplied": false
  },
  {
    "serviceTypeName": "Move in/out Cleaning",
    "bedrooms": 6,
    "bathrooms": 1,
    "sqft": 2000,
    "deepCleaning": true,
    "levels": null,
    "expectedSubTotal": 641.25,
    "expectedDisplayDuration": 630,
    "expectedMinimumPriceApplied": false
  },
  {
    "serviceTypeName": "Move in/out Cleaning",
    "bedrooms": 6,
    "bathrooms": 2,
    "sqft": 2000,
    "deepCleaning": true,
    "levels": null,
    "expectedSubTotal": 675,
    "expectedDisplayDuration": 660,
    "expectedMinimumPriceApplied": false
  },
  {
    "serviceTypeName": "Move in/out Cleaning",
    "bedrooms": 6,
    "bathrooms": 1,
    "sqft": 3000,
    "deepCleaning": false,
    "levels": null,
    "expectedSubTotal": 511.5,
    "expectedDisplayDuration": 702,
    "expectedMinimumPriceApplied": false
  },
  {
    "serviceTypeName": "Move in/out Cleaning",
    "bedrooms": 6,
    "bathrooms": 2,
    "sqft": 3000,
    "deepCleaning": false,
    "levels": null,
    "expectedSubTotal": 534,
    "expectedDisplayDuration": 732,
    "expectedMinimumPriceApplied": false
  },
  {
    "serviceTypeName": "Move in/out Cleaning",
    "bedrooms": 6,
    "bathrooms": 1,
    "sqft": 3000,
    "deepCleaning": true,
    "levels": null,
    "expectedSubTotal": 857.25,
    "expectedDisplayDuration": 822,
    "expectedMinimumPriceApplied": false
  },
  {
    "serviceTypeName": "Move in/out Cleaning",
    "bedrooms": 6,
    "bathrooms": 2,
    "sqft": 3000,
    "deepCleaning": true,
    "levels": null,
    "expectedSubTotal": 891,
    "expectedDisplayDuration": 852,
    "expectedMinimumPriceApplied": false
  },
  {
    "serviceTypeName": "Residential Cleaning",
    "bedrooms": 2,
    "bathrooms": 2,
    "sqft": 850,
    "deepCleaning": false,
    "levels": 1,
    "expectedSubTotal": 180,
    "expectedDisplayDuration": 240,
    "expectedMinimumPriceApplied": false
  },
  {
    "serviceTypeName": "Residential Cleaning",
    "bedrooms": 2,
    "bathrooms": 2,
    "sqft": 850,
    "deepCleaning": true,
    "levels": 1,
    "expectedSubTotal": 360,
    "expectedDisplayDuration": 360,
    "expectedMinimumPriceApplied": false
  },
  {
    "serviceTypeName": "Residential Cleaning",
    "bedrooms": 2,
    "bathrooms": 2,
    "sqft": 850,
    "deepCleaning": false,
    "levels": 2,
    "expectedSubTotal": 215,
    "expectedDisplayDuration": 265,
    "expectedMinimumPriceApplied": false
  },
  {
    "serviceTypeName": "Residential Cleaning",
    "bedrooms": 2,
    "bathrooms": 2,
    "sqft": 850,
    "deepCleaning": true,
    "levels": 2,
    "expectedSubTotal": 412.5,
    "expectedDisplayDuration": 385,
    "expectedMinimumPriceApplied": false
  },
  {
    "serviceTypeName": "Residential Cleaning",
    "bedrooms": 2,
    "bathrooms": 2,
    "sqft": 850,
    "deepCleaning": false,
    "levels": 3,
    "expectedSubTotal": 250,
    "expectedDisplayDuration": 290,
    "expectedMinimumPriceApplied": false
  },
  {
    "serviceTypeName": "Residential Cleaning",
    "bedrooms": 2,
    "bathrooms": 2,
    "sqft": 850,
    "deepCleaning": true,
    "levels": 3,
    "expectedSubTotal": 465,
    "expectedDisplayDuration": 410,
    "expectedMinimumPriceApplied": false
  },
  {
    "serviceTypeName": "Residential Cleaning",
    "bedrooms": 2,
    "bathrooms": 2,
    "sqft": 850,
    "deepCleaning": false,
    "levels": 4,
    "expectedSubTotal": 285,
    "expectedDisplayDuration": 315,
    "expectedMinimumPriceApplied": false
  },
  {
    "serviceTypeName": "Residential Cleaning",
    "bedrooms": 2,
    "bathrooms": 2,
    "sqft": 850,
    "deepCleaning": true,
    "levels": 4,
    "expectedSubTotal": 517.5,
    "expectedDisplayDuration": 435,
    "expectedMinimumPriceApplied": false
  },
  {
    "serviceTypeName": "Residential Cleaning",
    "bedrooms": 3,
    "bathrooms": 2,
    "sqft": 2400,
    "deepCleaning": false,
    "levels": 1,
    "expectedSubTotal": 404.5,
    "expectedDisplayDuration": 539,
    "expectedMinimumPriceApplied": false
  },
  {
    "serviceTypeName": "Residential Cleaning",
    "bedrooms": 3,
    "bathrooms": 2,
    "sqft": 2400,
    "deepCleaning": true,
    "levels": 1,
    "expectedSubTotal": 696.75,
    "expectedDisplayDuration": 659,
    "expectedMinimumPriceApplied": false
  },
  {
    "serviceTypeName": "Residential Cleaning",
    "bedrooms": 3,
    "bathrooms": 2,
    "sqft": 2400,
    "deepCleaning": false,
    "levels": 2,
    "expectedSubTotal": 439.5,
    "expectedDisplayDuration": 564,
    "expectedMinimumPriceApplied": false
  },
  {
    "serviceTypeName": "Residential Cleaning",
    "bedrooms": 3,
    "bathrooms": 2,
    "sqft": 2400,
    "deepCleaning": true,
    "levels": 2,
    "expectedSubTotal": 749.25,
    "expectedDisplayDuration": 684,
    "expectedMinimumPriceApplied": false
  },
  {
    "serviceTypeName": "Residential Cleaning",
    "bedrooms": 3,
    "bathrooms": 2,
    "sqft": 2400,
    "deepCleaning": false,
    "levels": 3,
    "expectedSubTotal": 474.5,
    "expectedDisplayDuration": 589,
    "expectedMinimumPriceApplied": false
  },
  {
    "serviceTypeName": "Residential Cleaning",
    "bedrooms": 3,
    "bathrooms": 2,
    "sqft": 2400,
    "deepCleaning": true,
    "levels": 3,
    "expectedSubTotal": 801.75,
    "expectedDisplayDuration": 709,
    "expectedMinimumPriceApplied": false
  },
  {
    "serviceTypeName": "Residential Cleaning",
    "bedrooms": 3,
    "bathrooms": 2,
    "sqft": 2400,
    "deepCleaning": false,
    "levels": 4,
    "expectedSubTotal": 509.5,
    "expectedDisplayDuration": 614,
    "expectedMinimumPriceApplied": false
  },
  {
    "serviceTypeName": "Residential Cleaning",
    "bedrooms": 3,
    "bathrooms": 2,
    "sqft": 2400,
    "deepCleaning": true,
    "levels": 4,
    "expectedSubTotal": 854.25,
    "expectedDisplayDuration": 734,
    "expectedMinimumPriceApplied": false
  },
  {
    "serviceTypeName": "Move in/out Cleaning",
    "bedrooms": 2,
    "bathrooms": 2,
    "sqft": 850,
    "deepCleaning": false,
    "levels": 1,
    "expectedSubTotal": 300,
    "expectedDisplayDuration": 420,
    "expectedMinimumPriceApplied": false
  },
  {
    "serviceTypeName": "Move in/out Cleaning",
    "bedrooms": 2,
    "bathrooms": 2,
    "sqft": 850,
    "deepCleaning": true,
    "levels": 1,
    "expectedSubTotal": 540,
    "expectedDisplayDuration": 540,
    "expectedMinimumPriceApplied": false
  },
  {
    "serviceTypeName": "Move in/out Cleaning",
    "bedrooms": 2,
    "bathrooms": 2,
    "sqft": 850,
    "deepCleaning": false,
    "levels": 2,
    "expectedSubTotal": 335,
    "expectedDisplayDuration": 445,
    "expectedMinimumPriceApplied": false
  },
  {
    "serviceTypeName": "Move in/out Cleaning",
    "bedrooms": 2,
    "bathrooms": 2,
    "sqft": 850,
    "deepCleaning": true,
    "levels": 2,
    "expectedSubTotal": 592.5,
    "expectedDisplayDuration": 565,
    "expectedMinimumPriceApplied": false
  },
  {
    "serviceTypeName": "Move in/out Cleaning",
    "bedrooms": 2,
    "bathrooms": 2,
    "sqft": 850,
    "deepCleaning": false,
    "levels": 3,
    "expectedSubTotal": 370,
    "expectedDisplayDuration": 470,
    "expectedMinimumPriceApplied": false
  },
  {
    "serviceTypeName": "Move in/out Cleaning",
    "bedrooms": 2,
    "bathrooms": 2,
    "sqft": 850,
    "deepCleaning": true,
    "levels": 3,
    "expectedSubTotal": 645,
    "expectedDisplayDuration": 590,
    "expectedMinimumPriceApplied": false
  },
  {
    "serviceTypeName": "Move in/out Cleaning",
    "bedrooms": 2,
    "bathrooms": 2,
    "sqft": 850,
    "deepCleaning": false,
    "levels": 4,
    "expectedSubTotal": 405,
    "expectedDisplayDuration": 495,
    "expectedMinimumPriceApplied": false
  },
  {
    "serviceTypeName": "Move in/out Cleaning",
    "bedrooms": 2,
    "bathrooms": 2,
    "sqft": 850,
    "deepCleaning": true,
    "levels": 4,
    "expectedSubTotal": 697.5,
    "expectedDisplayDuration": 615,
    "expectedMinimumPriceApplied": false
  },
  {
    "serviceTypeName": "Move in/out Cleaning",
    "bedrooms": 3,
    "bathrooms": 2,
    "sqft": 1000,
    "deepCleaning": false,
    "levels": 1,
    "expectedSubTotal": 322.5,
    "expectedDisplayDuration": 450,
    "expectedMinimumPriceApplied": false
  },
  {
    "serviceTypeName": "Move in/out Cleaning",
    "bedrooms": 3,
    "bathrooms": 2,
    "sqft": 1000,
    "deepCleaning": true,
    "levels": 1,
    "expectedSubTotal": 573.75,
    "expectedDisplayDuration": 570,
    "expectedMinimumPriceApplied": false
  },
  {
    "serviceTypeName": "Move in/out Cleaning",
    "bedrooms": 3,
    "bathrooms": 2,
    "sqft": 1000,
    "deepCleaning": false,
    "levels": 2,
    "expectedSubTotal": 357.5,
    "expectedDisplayDuration": 475,
    "expectedMinimumPriceApplied": false
  },
  {
    "serviceTypeName": "Move in/out Cleaning",
    "bedrooms": 3,
    "bathrooms": 2,
    "sqft": 1000,
    "deepCleaning": true,
    "levels": 2,
    "expectedSubTotal": 626.25,
    "expectedDisplayDuration": 595,
    "expectedMinimumPriceApplied": false
  },
  {
    "serviceTypeName": "Move in/out Cleaning",
    "bedrooms": 3,
    "bathrooms": 2,
    "sqft": 1000,
    "deepCleaning": false,
    "levels": 3,
    "expectedSubTotal": 392.5,
    "expectedDisplayDuration": 500,
    "expectedMinimumPriceApplied": false
  },
  {
    "serviceTypeName": "Move in/out Cleaning",
    "bedrooms": 3,
    "bathrooms": 2,
    "sqft": 1000,
    "deepCleaning": true,
    "levels": 3,
    "expectedSubTotal": 678.75,
    "expectedDisplayDuration": 620,
    "expectedMinimumPriceApplied": false
  },
  {
    "serviceTypeName": "Move in/out Cleaning",
    "bedrooms": 3,
    "bathrooms": 2,
    "sqft": 1000,
    "deepCleaning": false,
    "levels": 4,
    "expectedSubTotal": 427.5,
    "expectedDisplayDuration": 525,
    "expectedMinimumPriceApplied": false
  },
  {
    "serviceTypeName": "Move in/out Cleaning",
    "bedrooms": 3,
    "bathrooms": 2,
    "sqft": 1000,
    "deepCleaning": true,
    "levels": 4,
    "expectedSubTotal": 731.25,
    "expectedDisplayDuration": 645,
    "expectedMinimumPriceApplied": false
  }
];
