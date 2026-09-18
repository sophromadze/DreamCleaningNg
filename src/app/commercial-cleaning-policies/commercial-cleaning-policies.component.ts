import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';

import { COMMERCIAL_POLICY_CONTENT } from '../shared/commercial-policies/commercial-policy.content';
import {
  PolicyBlock,
  PolicyDocument,
  PolicySection
} from '../shared/commercial-policies/commercial-policy.types';

/**
 * One thing to render. Consecutive `Bullet` blocks collapse into a single `list` so the contact
 * details come out as one four-item list rather than four one-item lists — four `<ul>`s in a row
 * is what a screen reader announces, and it is wrong about the structure of the document.
 *
 * Deliberately one flat shape rather than a discriminated union: an `*ngIf` on `kind` does not
 * reliably narrow a union for the template type-checker under `strictTemplates`, and the
 * workarounds cost more than an unused empty array.
 */
export interface PolicyRenderItem {
  kind: 'paragraph' | 'note' | 'list';
  /** The prose. Empty for a `list`. */
  text: string;
  /** The bullets. Empty for anything else. */
  items: string[];
}

/**
 * The public Commercial Cleaning Policies page.
 *
 * It renders the COMPLETE document from the generated content module, and links the two PDF
 * downloads the backend serves from the same source. There is no fetch: the content is a
 * compile-time constant, so the policy text is in the prerendered HTML for a reader with a slow
 * connection and for a crawler alike (this route falls under the `**` Prerender rule in
 * app.routes.server.ts).
 *
 * The standalone Cancellation & Termination document is NOT rendered here as a second copy — its
 * sections are literally the same clause blocks as sections 4, 5 and 7 below. It exists as a PDF
 * for handing to a prospective client on its own, and the page links to it rather than repeating
 * it under a second set of headings.
 *
 * Residential policies are untouched and separate: /terms-and-conditions governs online bookings,
 * this page governs commercial agreements, and section 1 says so.
 */
@Component({
  selector: 'app-commercial-cleaning-policies',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './commercial-cleaning-policies.component.html',
  styleUrls: ['./commercial-cleaning-policies.component.scss']
})
export class CommercialCleaningPoliciesComponent {
  readonly policy: PolicyDocument = COMMERCIAL_POLICY_CONTENT.complete;
  readonly cancellationPolicy: PolicyDocument = COMMERCIAL_POLICY_CONTENT.cancellation;

  /**
   * The render model, built once in the field initializer. The template iterates these rather
   * than calling a method: a getter or a pipe-less method call in an `*ngFor` re-runs on every
   * change-detection pass, and this list cannot change — the content is a compile-time constant.
   */
  readonly introItems: PolicyRenderItem[] = this.toRenderItems(this.policy.intro);
  readonly sectionItems: ReadonlyMap<string, PolicyRenderItem[]> = new Map(
    this.policy.sections.map(s => [s.anchor, this.toRenderItems(s.blocks)]));

  /**
   * The download URLs. Relative to /api, which the dev proxy and the production vhost both
   * forward to the backend, so no environment switch is needed. The filename a browser saves
   * comes from the endpoint's Content-Disposition, not from here.
   */
  readonly completePdfUrl = '/api/commercial-policies/complete.pdf';
  readonly cancellationPdfUrl = '/api/commercial-policies/cancellation-termination.pdf';

  readonly contactEmail = 'hello@dreamcleaningnyc.com';
  readonly contactPhone = '(929) 930-1525';

  /** "2026-09-16" → "September 16, 2026", matching what both PDFs print. */
  get effectiveDate(): string {
    return this.formatEffectiveDate(this.policy.effectiveDate);
  }

  formatEffectiveDate(iso: string): string {
    // Parsed as parts rather than `new Date(iso)`: a bare ISO date is parsed as UTC midnight and
    // then displayed in the viewer's zone, so a reader west of Greenwich is shown the day before.
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    if (!match) return iso;
    const [, year, month, day] = match;
    const date = new Date(Number(year), Number(month) - 1, Number(day));
    return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  }

  itemsFor(section: PolicySection): PolicyRenderItem[] {
    return this.sectionItems.get(section.anchor) ?? [];
  }

  private toRenderItems(blocks: PolicyBlock[]): PolicyRenderItem[] {
    const items: PolicyRenderItem[] = [];

    for (const block of blocks) {
      if (block.kind !== 'Bullet') {
        items.push({
          kind: block.kind === 'Note' ? 'note' : 'paragraph',
          text: block.text,
          items: []
        });
        continue;
      }

      const previous = items[items.length - 1];
      if (previous?.kind === 'list') previous.items.push(block.text);
      else items.push({ kind: 'list', text: '', items: [block.text] });
    }

    return items;
  }

  trackBySection = (_: number, section: PolicySection): string => section.anchor;
}
