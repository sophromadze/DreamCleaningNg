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
    "expectedSubTotal": 891,
    "expectedDisplayDuration": 852,
    "expectedMinimumPriceApplied": false
  }
];
