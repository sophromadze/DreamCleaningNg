/**
 * The shape of the published commercial policies.
 *
 * Hand-written, unlike `commercial-policy.content.ts` beside it, which is generated from
 * `Helpers/Commercial/CommercialPolicyDocument.cs` on the backend. These interfaces mirror the C#
 * `PolicyDocument` / `PolicySection` / `PolicyBlock` classes, which are what the two downloadable
 * PDFs are rendered from — so the page and the PDFs are two renderings of one document rather
 * than two documents that have to be kept saying the same thing.
 */

/**
 * `Note` is the load-bearing one. It marks a qualifier a reader must not skim past — "this cap is
 * not an automatic charge", "the signed agreement governs" — and every surface renders it as a
 * callout rather than as another paragraph.
 */
export type PolicyBlockKind = 'Paragraph' | 'Bullet' | 'Note';

export interface PolicyBlock {
  kind: PolicyBlockKind;
  text: string;
}

export interface PolicySection {
  /** "1", "2" … printed before the title and used to build the heading. */
  number: string;
  title: string;
  /** The DOM id and URL fragment the table of contents links to. */
  anchor: string;
  blocks: PolicyBlock[];
}

export interface PolicyDocument {
  key: string;
  title: string;
  subtitle: string;
  /** "Nodar Alania Inc. d/b/a Dream Cleaning NYC" — printed under the title. */
  legalIdentity: string;
  version: string;
  /** ISO-8601, formatted for display at the point of use. */
  effectiveDate: string;
  /** What the download is called. Matches the filename the backend serves. */
  pdfFileName: string;
  intro: PolicyBlock[];
  sections: PolicySection[];
}

export interface CommercialPolicyContent {
  complete: PolicyDocument;
  /**
   * The standalone Cancellation & Termination Policy. Its first three sections are the SAME
   * block arrays as the complete document's sections 4, 5 and 7 — assembled from shared clauses
   * on the backend, so the two published documents cannot state different notice periods.
   */
  cancellation: PolicyDocument;
}
