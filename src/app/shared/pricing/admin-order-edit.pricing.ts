/**
 * Adapter: admin order-editor rows -> shared pricing calculator input.
 *
 * The admin order editor stores its state as index-aligned rows carrying a quantity and a cost,
 * rather than as the {service, quantity} selections the booking page and customer order-edit use.
 * That difference is the only reason it ever had its own arithmetic — and that arithmetic was
 * linear (unitPrice x quantity), so it ignored included allowances and rate tiers completely and
 * never applied the service type's minimum price.
 *
 * This module does the shape conversion and nothing else: no pricing math lives here. It maps
 * rows to the canonical selection shape and hands them to buildQuoteInputFromSelections, so the
 * admin editor prices through exactly the same code path as every other surface.
 *
 * Kept out of the component so it can be unit-tested against the shared cross-surface fixtures
 * without standing up an Angular TestBed.
 */

import { ExtraService, Service, ServiceType } from '../../services/booking.service';
import { QuoteInput, buildQuoteInputFromSelections } from './order-pricing.calculator';

/** Minimal shape of one editable service row in the admin order editor. */
export interface AdminEditServiceRow {
  quantity?: number | string | null;
}

/** Minimal shape of one editable extra-service row in the admin order editor. */
export interface AdminEditExtraRow {
  quantity?: number | string | null;
  hours?: number | string | null;
}

/** A row paired with the catalog definition it resolves to. Unresolved rows are skipped. */
export interface ResolvedRow<TRow, TDefinition> {
  row: TRow;
  definition: TDefinition | null;
}

export interface AdminEditQuoteInput {
  input: QuoteInput;
  /** Original row indices, aligned with the resulting quote's serviceLines. */
  serviceRowIndices: number[];
  /** Original row indices, aligned with the resulting quote's extraServiceLines. */
  extraRowIndices: number[];
}

const toNumber = (value: number | string | null | undefined): number => Number(value) || 0;

/**
 * Builds the calculator input plus the index maps needed to write per-line results back onto the
 * originating rows. Returns null when the service type is unknown, in which case the caller must
 * leave the form alone rather than pricing against a partial catalog.
 */
export function buildAdminEditQuoteInput(
  serviceType: ServiceType | null | undefined,
  serviceRows: ResolvedRow<AdminEditServiceRow, Service>[],
  extraRows: ResolvedRow<AdminEditExtraRow, ExtraService>[]
): AdminEditQuoteInput | null {
  if (!serviceType) return null;

  const serviceRowIndices: number[] = [];
  const selectedServices = serviceRows.reduce<{ service: Service; quantity: number }[]>(
    (acc, entry, index) => {
      if (!entry.definition) return acc;
      serviceRowIndices.push(index);
      acc.push({ service: entry.definition, quantity: toNumber(entry.row.quantity) });
      return acc;
    },
    []
  );

  const extraRowIndices: number[] = [];
  const selectedExtras = extraRows.reduce<{ extraService: ExtraService; quantity: number; hours: number }[]>(
    (acc, entry, index) => {
      if (!entry.definition) return acc;
      extraRowIndices.push(index);
      acc.push({
        extraService: entry.definition,
        quantity: toNumber(entry.row.quantity),
        hours: toNumber(entry.row.hours)
      });
      return acc;
    },
    []
  );

  return {
    input: buildQuoteInputFromSelections(serviceType, selectedServices, selectedExtras),
    serviceRowIndices,
    extraRowIndices
  };
}
