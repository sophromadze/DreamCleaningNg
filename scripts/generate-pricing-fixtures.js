/**
 * Generates the shared cross-surface pricing fixtures.
 *
 *   node scripts/generate-pricing-fixtures.js
 *
 * Compiles the REAL frontend calculator (src/app/shared/pricing/order-pricing.calculator.ts),
 * runs the fixture matrix through it against the production pricing configuration, and writes the
 * SAME computed rows to two places:
 *
 *   1. ../DreamCleaningBackend/DreamCleaningBackend.Tests/pricing-fixtures.json
 *        read at runtime by CrossSurfaceEquivalenceTests — the backend must reproduce every row
 *        through OrderPricingInputBuilder + OrderPricingCalculator.
 *   2. src/app/shared/pricing/pricing-fixtures.data.ts
 *        imported by the Angular specs. A .ts module rather than the JSON because the Angular
 *        tsconfig has resolveJsonModule off and rootDir pinned to ./src.
 *
 * One computation, two consumers, so the two artifacts cannot drift apart.
 *
 * CONFIG below mirrors the admin-panel export. After changing pricing in the admin panel,
 * re-export and update CONFIG, then re-run this script and both test suites.
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const NG_ROOT = path.resolve(__dirname, '..');
const CALCULATOR_TS = path.join(NG_ROOT, 'src/app/shared/pricing/order-pricing.calculator.ts');
const JSON_DEST = path.resolve(NG_ROOT, '../DreamCleaningBackend/DreamCleaningBackend.Tests/pricing-fixtures.json');
const TS_DEST = path.join(NG_ROOT, 'src/app/shared/pricing/pricing-fixtures.data.ts');

// ── Production configuration (admin-panel export, 2026-08-02) ────────────────────────────
const SQFT_THRESHOLDS = [[0, 400], [1, 650], [2, 850], [3, 1000], [4, 1500], [5, 1800], [6, 2000]];

const CONFIG = {
  'Residential Cleaning': {
    basePrice: 90, timeDuration: 120, minimumPrice: 130,
    bedrooms: { cost: 22.5, timeDuration: 30, zeroQuantityCost: 0, zeroQuantityDuration: 0, rateTiers: [] },
    bathrooms: { cost: 22.5, timeDuration: 30 },
    sqftTiers: [
      { fromQuantity: 0, cost: 0.18, timeDuration: 0.24 },
      { fromQuantity: 400, cost: 0.135, timeDuration: 0.18 },
      { fromQuantity: 1200, cost: 0.11, timeDuration: 0.145 }
    ]
  },
  'Move in/out Cleaning': {
    basePrice: 187.5, timeDuration: 270, minimumPrice: 245,
    bedrooms: {
      cost: 22.5, timeDuration: 30, zeroQuantityCost: 0, zeroQuantityDuration: 0,
      rateTiers: [
        { fromQuantity: 0, cost: 45, timeDuration: 60 },
        { fromQuantity: 1, cost: 22.5, timeDuration: 30 }
      ]
    },
    bathrooms: { cost: 22.5, timeDuration: 30 },
    sqftTiers: [
      { fromQuantity: 0, cost: 0.18, timeDuration: 0.24 },
      { fromQuantity: 400, cost: 0.12, timeDuration: 0.16 },
      { fromQuantity: 1200, cost: 0.1125, timeDuration: 0.15 }
    ]
  }
};

// Deep Cleaning as configured in production.
const DEEP = {
  extraServiceId: 1, name: 'Deep Cleaning', price: 90, duration: 120, priceMultiplier: 1.5,
  isDeepCleaning: true, isSuperDeepCleaning: false, isSameDayService: false,
  hasHours: false, hasQuantity: false, quantity: 1, hours: 0
};

const BED_ID = 10, BATH_ID = 20, SQFT_ID = 30;

const FIXTURE_SETS = {
  'Residential Cleaning': [[0, 400], [0, 900], [1, 650], [1, 1200], [2, 850], [3, 1000], [3, 2400], [6, 2000], [6, 5000]],
  'Move in/out Cleaning': [[0, 400], [1, 650], [1, 1200], [2, 850], [3, 1000], [4, 1500], [6, 2000], [6, 3000]]
};

function compileCalculator() {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pricing-mirror-'));
  // Run the local tsc entrypoint with the current node binary rather than shelling out to npx:
  // Node 20+ refuses to spawn .cmd shims without shell:true on Windows, and this avoids the
  // shell entirely.
  const tsc = path.join(NG_ROOT, 'node_modules', 'typescript', 'bin', 'tsc');
  execFileSync(
    process.execPath,
    [tsc, CALCULATOR_TS, '--outDir', outDir, '--module', 'commonjs',
     '--target', 'es2020', '--skipLibCheck', '--downlevelIteration'],
    { cwd: NG_ROOT, stdio: 'inherit' }
  );
  return require(path.join(outDir, 'order-pricing.calculator.js'));
}

function includedFor(bedrooms) {
  let match = SQFT_THRESHOLDS[0];
  for (const row of SQFT_THRESHOLDS) if (row[0] <= bedrooms) match = row;
  return match[1];
}

function buildInput(serviceTypeName, bedrooms, bathrooms, sqft, deep) {
  const cfg = CONFIG[serviceTypeName];
  // The server clamps sqft up to the included allowance before pricing; mirror that so both
  // sides are given the same effective selection.
  const clamped = Math.max(sqft, includedFor(bedrooms));

  return {
    basePrice: cfg.basePrice,
    baseDuration: cfg.timeDuration,
    minimumPrice: cfg.minimumPrice,
    services: [
      {
        serviceId: BED_ID, cost: cfg.bedrooms.cost, timeDuration: cfg.bedrooms.timeDuration,
        serviceKey: 'bedrooms', quantity: bedrooms,
        zeroQuantityCost: cfg.bedrooms.zeroQuantityCost,
        zeroQuantityDuration: cfg.bedrooms.zeroQuantityDuration,
        chargeAboveThreshold: false, thresholds: [], rateTiers: cfg.bedrooms.rateTiers
      },
      {
        serviceId: BATH_ID, cost: cfg.bathrooms.cost, timeDuration: cfg.bathrooms.timeDuration,
        serviceKey: 'bathrooms', quantity: bathrooms,
        chargeAboveThreshold: false, thresholds: [], rateTiers: []
      },
      {
        serviceId: SQFT_ID, cost: 0.18, timeDuration: 0.24,
        serviceKey: 'sqft', quantity: clamped, chargeAboveThreshold: true,
        thresholds: SQFT_THRESHOLDS.map(([q, i]) =>
          ({ sourceServiceId: BED_ID, sourceQuantity: q, includedQuantity: i })),
        rateTiers: cfg.sqftTiers
      }
    ],
    extraServices: deep ? [DEEP] : []
  };
}

function main() {
  const calc = compileCalculator();
  const fixtures = [];

  for (const [serviceTypeName, rows] of Object.entries(FIXTURE_SETS)) {
    for (const [bedrooms, sqft] of rows) {
      for (const deep of [false, true]) {
        for (const bathrooms of [1, 2]) {
          const quote = calc.calculateQuote(buildInput(serviceTypeName, bedrooms, bathrooms, sqft, deep));
          fixtures.push({
            serviceTypeName, bedrooms, bathrooms, sqft, deepCleaning: deep,
            expectedSubTotal: Number(quote.subTotal.toFixed(2)),
            expectedDisplayDuration: quote.displayDuration,
            expectedMinimumPriceApplied: quote.minimumPriceApplied
          });
        }
      }
    }
  }

  fs.writeFileSync(JSON_DEST, JSON.stringify({
    generatedBy: 'order-pricing.calculator.ts (frontend, real module)',
    configurationSource: 'admin panel export 2026-08-02',
    note: 'Backend must reproduce every row through OrderPricingInputBuilder + OrderPricingCalculator.',
    fixtures
  }, null, 2));

  const header = `/**
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

export const PRICING_FIXTURES: PricingFixture[] = `;

  fs.writeFileSync(TS_DEST, header + JSON.stringify(fixtures, null, 2) + ';\n');

  console.log(`Wrote ${fixtures.length} fixtures:`);
  console.log(`  ${JSON_DEST}`);
  console.log(`  ${TS_DEST}`);
}

main();
