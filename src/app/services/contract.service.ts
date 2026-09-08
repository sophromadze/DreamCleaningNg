import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

// ── Enums (mirror Models/Contracts/ContractEnums.cs; sent and received as numbers) ──

export enum ContractStatus {
  Draft = 0,
  PreviewGenerated = 1,
  AwaitingClientReview = 2,
  NeedsRevision = 3,
  ReadyForSignature = 4,
  AwaitingSignatures = 5,
  PartiallySigned = 6,
  FullySigned = 7,
  Completed = 8,
  Voided = 9,
  Expired = 10
}

export enum ContractContactRole { ContractorSigner = 0, ClientSigner = 1, Other = 2 }
export enum ContractSignerRole { ContractorSigner = 0, ClientSigner = 1 }
export enum ContractSignerStatus { Pending = 0, Signed = 1, Voided = 2 }
export enum ContractSignatureMethod { Draw = 0, Type = 1 }

/** Where a signature was captured. Part of the audit trail, not a display detail. */
export enum ContractSignatureChannel { EmailLink = 0, AdminPanel = 1, CustomerPortal = 2 }

/** Officer title. Mirrors Models/OrgTitle.cs. */
export enum OrgTitle { None = 0, CEO = 1, CTO = 2 }
export enum ContractActorType { Admin = 0, Client = 1, System = 2 }
export enum ContractFileType { Preview = 0, FinalExecuted = 1, AuditCertificate = 2 }

/** Tax-inclusive = the typed amount is what the client pays; Pre-tax = tax is added on top. */
export enum ContractPriceMode { TaxInclusive = 0, PreTax = 1 }

// ── Scope checklist ──

export interface ScopeItem { label: string; selected: boolean; isCustom?: boolean; }

export interface ScopeGroup {
  /** Stable key the agreement body references as {{SCOPE:key}}. Never renamed in the UI. */
  key: string;
  title: string;
  kind: 'included' | 'excluded' | string;
  inline: boolean;
  items: ScopeItem[];
}

export interface ScopeStructure { groups: ScopeGroup[]; }

// ── Snapshot pieces ──

export interface ContractorSnapshot {
  id: number; legalEntityName: string; dba?: string; entityType: string;
  address: string; city: string; state: string; zip: string;
  noticeEmail: string; phone?: string;
}

export interface ClientSnapshot {
  id: number; legalEntityName: string; entityType: string; formationState?: string;
  principalAddress: string; city: string; state: string; zip: string;
  noticeEmail?: string; phone?: string;
  /** The business account this client is linked to, frozen at generation. */
  sourceUserId?: number | null;
}

export interface ServiceLocationSnapshot {
  id: number; businessBrand?: string; locationName?: string;
  address: string; city: string; state: string; zip: string;
}

export interface SignerSnapshot {
  contactId?: number; firstName: string; lastName: string;
  title?: string; email?: string; phone?: string;
}

export interface ScheduleSnapshot {
  frequencyUnit: string; visitsPerPeriod: number;
  serviceDay: string; serviceTime: string;
  flexibleScheduling: boolean; performedWhileClosed: boolean; accessType: string;
}

export interface TermSnapshot {
  initialTermMonths: number; minimumCommitmentMonths: number; terminationNoticeDays: number;
  renewalType: string; governingLawState: string; venueCounty: string;
}

/** Derived fields are read-only echoes of the server calculation — never posted back. */
export interface PricingSnapshot {
  priceMode: ContractPriceMode; priceInput: number; salesTaxRatePercent: number;
  preTaxPrice: number; salesTaxAmount: number; totalPrice: number;
  cancellationPercent: number; cancellationAmount: number;
  remainingBalance: number; lockoutFee: number;
  invoiceTiming: string; paymentDeadlineHours: number; paymentMethod: string;
  lateChargePercent: number; returnedPaymentFee: number;
}

export interface AdvancedTermsSnapshot {
  timelyRescheduleHours: number; curePeriodDays: number; pastDueDays: number;
  billingDisputeDays: number; qualityComplaintHours: number;
  visibleDamageHours: number; latentDamageDays: number;
  confidentialityYears: number; nonSolicitMonths: number; nonHireDamages: number;
  insurancePerOccurrence: number; insuranceAggregate: number; insuranceJurisdiction: string;
  liabilityCapLookbackMonths: number; disputeDiscussionDays: number;
  creditReturnDays: number; mediationVenue: string;
}

export interface ContractSnapshot {
  contractNumber: string; versionNumber: number; effectiveDate?: string;
  contractTemplateId: number; contractTemplateName: string; contractTemplateVersion: string;
  templateBodyText: string;
  scopeTemplateId?: number; scopeTemplateName: string;
  contractor: ContractorSnapshot; client: ClientSnapshot;
  serviceLocation: ServiceLocationSnapshot;
  contractorSigner: SignerSnapshot; clientSigner: SignerSnapshot;
  schedule: ScheduleSnapshot; term: TermSnapshot;
  pricing: PricingSnapshot; advanced: AdvancedTermsSnapshot;
  scope: ScopeStructure; premisesType: string;
}

// ── Directory ──

export interface ContractorProfile {
  id: number; legalEntityName: string; dba?: string; entityType: string;
  address: string; city: string; state: string; zip: string;
  noticeEmail: string; phone?: string; isDefault: boolean;
}

export interface ContractServiceLocation {
  id: number; contractClientId: number; businessBrand?: string; locationName?: string;
  address: string; city: string; state: string; zip: string; displayLabel: string;
}

export interface ContractContact {
  id: number; firstName: string; lastName: string; fullName: string;
  title?: string; email?: string; phone?: string;
  role: ContractContactRole; contractClientId?: number;
}

export interface ContractClient {
  id: number; legalEntityName: string; entityType: string; formationState?: string;
  principalAddress: string; city: string; state: string; zip: string;
  noticeEmail?: string; phone?: string; isActive: boolean;
  /** The business-flagged account this client is linked to, when staff named one. */
  sourceUserId?: number | null;
  serviceLocations: ContractServiceLocation[]; contacts: ContractContact[];
}

export interface ScopeTemplate {
  id: number; name: string; premisesType: string;
  allowsCustomRows: boolean; structure: ScopeStructure;
}

export interface ContractTemplate {
  id: number; name: string; version: string; description?: string;
  isActive: boolean; bodyText?: string;
}

// ── Save payloads ──

export interface SaveContractClient {
  legalEntityName: string; entityType: string; formationState?: string;
  principalAddress: string; city: string; state: string; zip: string;
  noticeEmail?: string; phone?: string;
  /** Links the client to a business-flagged account, opening My Contracts for them. */
  sourceUserId?: number | null;
}

export interface SaveContractServiceLocation {
  contractClientId: number; businessBrand?: string; locationName?: string;
  address: string; city: string; state: string; zip: string;
}

export interface SaveContractContact {
  firstName: string; lastName: string; title?: string; email?: string; phone?: string;
  role: ContractContactRole; contractClientId?: number;
}

/**
 * Body of `POST api/crm/contract-directory/clients` — a commercial client created on its own.
 *
 * Extends the contract form's own client payload so the two cannot validate the company
 * differently. Both extras are optional; the nested `contractClientId` is omitted because the
 * client does not exist yet and the server fills it from the row it just inserted.
 */
export interface CreateCommercialClient extends SaveContractClient {
  billingContact?: Omit<SaveContractContact, 'contractClientId'> | null;
  serviceLocation?: Omit<SaveContractServiceLocation, 'contractClientId'> | null;
}

/** Only these three drive the money. Everything else on Exhibit B is derived server-side. */
export interface ContractPricingInput {
  priceMode: ContractPriceMode; priceInput: number; salesTaxRatePercent: number;
  cancellationPercent: number;
  invoiceTiming: string; paymentDeadlineHours: number; paymentMethod: string;
  lateChargePercent: number; returnedPaymentFee: number;
}

export interface SaveContract {
  contractTemplateId: number; scopeTemplateId?: number; contractorProfileId: number;
  effectiveDate?: string | null;
  contractClientId?: number | null; newClient?: SaveContractClient;
  contractServiceLocationId?: number | null; newServiceLocation?: SaveContractServiceLocation;
  contractorSignerEmail?: string; contractorSignerContactId?: number | null;
  clientSignerContactId?: number | null; newClientSigner?: SaveContractContact;
  premisesType?: string;
  schedule: ScheduleSnapshot; term: TermSnapshot;
  pricing: ContractPricingInput; advanced: AdvancedTermsSnapshot;
  scope: ScopeStructure;
}

export interface ContractPricingPreview {
  preTaxPrice: number; salesTaxAmount: number; totalPrice: number;
  cancellationAmount: number; remainingBalance: number; lockoutFee: number;
}

// ── Read models ──

export interface ContractListItem {
  id: number; contractNumber: string; clientLegalName: string; serviceLocationLabel: string;
  status: ContractStatus; statusLabel: string; currentVersionNumber: number;
  createdAt: string; updatedAt: string; effectiveDate?: string;
  totalPrice: number; createdByAdminName?: string;
  signedCount: number; signerCount: number;
  /** Only ever true when "Show hidden contracts" is on. */
  isHidden: boolean;
}

export interface ContractFileRef {
  id: number; fileType: ContractFileType; fileName: string;
  fileSizeBytes: number; createdAt: string;
}

export interface ContractVersionRef {
  id: number; versionNumber: number; generatedAt: string; generatedByAdminName?: string;
  documentHashSha256: string; isSuperseded: boolean; isCurrent: boolean;
  files: ContractFileRef[];
}

export interface ContractSigner {
  id: number; role: ContractSignerRole; invitedName: string; invitedTitle?: string;
  invitedEmail?: string; status: ContractSignerStatus;
  inviteSentAt?: string; tokenExpiresAt: string; signedAt?: string;
  signatureMethod?: ContractSignatureMethod; signingUrl?: string;
}

export interface ContractAuditEntry {
  id: number; eventType: string; eventDescription: string;
  actorType: ContractActorType; actorIdentifier?: string;
  contractVersionId?: number; timestamp: string;
}

export interface ContractSignatureParty {
  partyLabel: string; entityName: string; signerName: string; signerTitle?: string;
  hasSigned: boolean; signedAt?: string;
  method?: ContractSignatureMethod; signatureMark: string;
}

export interface ContractSignatureBlock {
  contractor: ContractSignatureParty;
  client: ContractSignatureParty;
}

export interface ContractDetail {
  id: number; contractNumber: string; status: ContractStatus; statusLabel: string;
  createdAt: string; updatedAt: string; completedAt?: string;
  createdByAdminName?: string; voidReason?: string; duplicatedFromContractId?: number;
  currentVersionId?: number; currentVersionNumber: number;
  documentHtml: string; documentHash: string; unresolvedTokens: string[];
  /** Composed server-side; carries the actual marks once a party has signed. */
  signatureBlock: ContractSignatureBlock;
  draft: ContractSnapshot; currentSnapshot?: ContractSnapshot;
  clientReviewUrl?: string;
  versions: ContractVersionRef[]; signers: ContractSigner[]; auditLog: ContractAuditEntry[];
  canEdit: boolean; canGeneratePreview: boolean; canSendForReview: boolean;
  canSendForSignature: boolean; isLocked: boolean;
  /** Soft-deleted: hidden from the default list, restorable, purged after 6 months. */
  isHidden: boolean; hiddenAt?: string;
  canDelete: boolean; canRestore: boolean;
  /** True when the signed-in account IS this contract's pending contractor signer. */
  isPendingContractorSigner: boolean;
}

// ── Client-facing ──

export interface ClientReviewInfo {
  companyLegalName: string; firstName: string; lastName: string;
  title?: string; email?: string; phone?: string;
  companyAddress: string; city: string; state: string; zip: string;
}

export interface ContractReviewPage {
  contractNumber: string; documentTitle: string; contractorDisplayName: string;
  clientLegalName: string; versionNumber: number;
  status: ContractStatus; statusLabel: string;
  documentHtml: string; signatureBlock: ContractSignatureBlock;
  yourInformation: ClientReviewInfo;
  canEdit: boolean; canContinueToSignature: boolean;
  signingToken?: string; message?: string;
}

export interface ClientEditResult {
  createdRevision: boolean; versionNumber: number;
  status: ContractStatus; message: string; changedFields: string[];
}

export interface ContractSigningPage {
  contractNumber: string; documentTitle: string; versionNumber: number;
  documentHtml: string; signatureBlock: ContractSignatureBlock;
  role: ContractSignerRole; partyEntityName: string;
  signerName: string; signerTitle?: string; signerEmail?: string;
  nameLocked: boolean; titleLocked: boolean;
  alreadySigned: boolean; signedAt?: string;
  expired: boolean; superseded: boolean;
  consentText: string; message?: string;
}

export interface SignContractRequest {
  signerName: string; signerTitle?: string; signerEmail?: string;
  signatureMethod: ContractSignatureMethod;
  /** PNG data URI for Draw, the typed name for Type. */
  signatureData: string;
  consentAccepted: boolean;
}

export interface SignContractResult {
  status: ContractStatus; statusLabel: string;
  fullyExecuted: boolean; signedAt: string; message: string;
}

// ── Permissions, officer titles, business flag ──

/**
 * What the signed-in account may do in the Contracts module, straight from the server's matrix.
 * The UI renders from THIS rather than re-deriving the rules from a role string — the browser
 * having its own copy of the matrix is exactly how the two drift apart.
 */
export interface ContractPermissions {
  viewContracts: boolean;
  toggleBusinessFlag: boolean;
  assignOrgTitle: boolean;
  createContract: boolean;
  generatePreview: boolean;
  sendForReview: boolean;
  sendForSignature: boolean;
  duplicate: boolean;
  regenerateExecutedPdf: boolean;
  resendExecutedCopy: boolean;
  backToEdit: boolean;
  createRevision: boolean;
  createAmendment: boolean;
  deleteContract: boolean;
  restoreContract: boolean;
  signAsContractor: boolean;
}

export interface OrgTitleHolder {
  userId: number;
  fullName: string;
  email: string;
  role: string;
  orgTitle: OrgTitle;
}

export interface OrgTitleOverview {
  holders: OrgTitleHolder[];
  currentCtoUserId?: number;
  /** True while any SuperAdmin may still grant a title — i.e. no CTO exists yet. */
  isBootstrapMode: boolean;
  canAssign: boolean;
}

/**
 * A business-flagged customer, carrying enough of their account to pre-fill the contract form.
 * Everything here is a starting point the admin can edit — the document renders from the
 * contract's own snapshot, never from the live account.
 */
export interface BusinessCustomer {
  userId: number;
  fullName: string;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  /** From the account's primary address; may be absent if they have none on file. */
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
}

// ── Customer self-service ──

export interface MyContractListItem {
  id: number;
  contractNumber: string;
  status: ContractStatus;
  statusLabel: string;
  versionNumber: number;
  versionDate: string;
  serviceLocationLabel: string;
  awaitingYourSignature: boolean;
  isExecuted: boolean;
}

/**
 * Commercial contracts + e-signature.
 *
 * Two API surfaces live here on purpose: the admin one under /crm (authenticated, permission
 * gated) and the client one under /contracts (anonymous, addressed only by opaque token). The
 * client methods are the ones the review and signing pages call and must never require a login.
 */
@Injectable({ providedIn: 'root' })
export class ContractService {
  private readonly adminUrl = `${environment.apiUrl}/crm/contracts`;
  private readonly directoryUrl = `${environment.apiUrl}/crm/contract-directory`;
  private readonly publicUrl = `${environment.apiUrl}/contracts`;
  private readonly myUrl = `${environment.apiUrl}/my-contracts`;
  private readonly accessUrl = `${environment.apiUrl}/admin`;

  constructor(private http: HttpClient) {}

  // ── Permissions (the server's matrix, never re-derived here) ──

  getMyPermissions(): Observable<ContractPermissions> {
    return this.http.get<ContractPermissions>(`${this.adminUrl}/my-permissions`);
  }

  // ── Officer titles and the business flag ──

  getOrgTitles(): Observable<OrgTitleOverview> {
    return this.http.get<OrgTitleOverview>(`${this.accessUrl}/org-titles`);
  }

  setOrgTitle(userId: number, orgTitle: OrgTitle): Observable<{ message: string; orgTitle: OrgTitle }> {
    return this.http.put<{ message: string; orgTitle: OrgTitle }>(
      `${this.accessUrl}/users/${userId}/org-title`, { orgTitle });
  }

  setBusinessFlag(userId: number, isBusiness: boolean): Observable<{ message: string; isBusiness: boolean }> {
    return this.http.put<{ message: string; isBusiness: boolean }>(
      `${this.accessUrl}/users/${userId}/business-flag`, { isBusiness });
  }

  getBusinessCustomers(search?: string): Observable<BusinessCustomer[]> {
    let params = new HttpParams();
    if (search) params = params.set('search', search);
    return this.http.get<BusinessCustomer[]>(`${this.accessUrl}/business-customers`, { params });
  }

  // ── Customer self-service ("My Contracts") ──

  /**
   * The cheap boolean behind the header menu item. Deliberately not the contract list: the
   * dropdown renders on every page for every logged-in user and only needs to know whether to
   * draw one link.
   */
  hasMyContracts(): Observable<{ hasContracts: boolean }> {
    return this.http.get<{ hasContracts: boolean }>(`${this.myUrl}/has-contracts`);
  }

  getMyContracts(): Observable<MyContractListItem[]> {
    return this.http.get<MyContractListItem[]>(this.myUrl);
  }

  /** Same shape as the token review page, so the same components render it. */
  getMyContract(id: number): Observable<ContractReviewPage> {
    return this.http.get<ContractReviewPage>(`${this.myUrl}/${id}`);
  }

  updateMyContractInformation(id: number, info: ClientReviewInfo): Observable<ClientEditResult> {
    return this.http.put<ClientEditResult>(`${this.myUrl}/${id}/information`, info);
  }

  signMyContract(id: number, dto: SignContractRequest): Observable<SignContractResult> {
    return this.http.post<SignContractResult>(`${this.myUrl}/${id}/sign`, dto);
  }

  downloadMyExecutedContract(id: number): Observable<Blob> {
    return this.http.get(`${this.myUrl}/${id}/executed-document`, { responseType: 'blob' });
  }

  // ── Admin: contracts ──

  getContracts(
    search?: string, status?: ContractStatus, includeHidden = false
  ): Observable<ContractListItem[]> {
    let params = new HttpParams();
    if (search) params = params.set('search', search);
    if (status !== undefined && status !== null) params = params.set('status', String(status));
    if (includeHidden) params = params.set('includeHidden', 'true');
    return this.http.get<ContractListItem[]>(this.adminUrl, { params });
  }

  getContract(id: number): Observable<ContractDetail> {
    return this.http.get<ContractDetail>(`${this.adminUrl}/${id}`);
  }

  createContract(dto: SaveContract): Observable<ContractDetail> {
    return this.http.post<ContractDetail>(this.adminUrl, dto);
  }

  updateContract(id: number, dto: SaveContract): Observable<ContractDetail> {
    return this.http.put<ContractDetail>(`${this.adminUrl}/${id}`, dto);
  }

  generatePreview(id: number): Observable<ContractDetail> {
    return this.http.post<ContractDetail>(`${this.adminUrl}/${id}/generate-preview`, {});
  }

  /** Server-side echo while typing — the browser never computes a contract figure itself. */
  pricingPreview(dto: ContractPricingInput): Observable<ContractPricingPreview> {
    return this.http.post<ContractPricingPreview>(`${this.adminUrl}/pricing-preview`, dto);
  }

  sendForReview(id: number): Observable<ContractDetail> {
    return this.http.post<ContractDetail>(`${this.adminUrl}/${id}/send-for-review`, {});
  }

  sendForSignature(id: number, expiryDays?: number): Observable<ContractDetail> {
    return this.http.post<ContractDetail>(`${this.adminUrl}/${id}/send-for-signature`, { expiryDays });
  }

  revise(id: number): Observable<ContractDetail> {
    return this.http.post<ContractDetail>(`${this.adminUrl}/${id}/revise`, {});
  }

  /** Soft delete: hides the contract and revokes its outstanding signing links. CTO-only. */
  deleteContract(id: number): Observable<ContractDetail> {
    return this.http.post<ContractDetail>(`${this.adminUrl}/${id}/delete`, {});
  }

  restoreContract(id: number): Observable<ContractDetail> {
    return this.http.post<ContractDetail>(`${this.adminUrl}/${id}/restore`, {});
  }

  duplicate(id: number, asAmendment: boolean): Observable<ContractDetail> {
    return this.http.post<ContractDetail>(
      `${this.adminUrl}/${id}/duplicate?asAmendment=${asAmendment}`, {});
  }

  /** Re-renders the executed PDF. Sends nothing — see resendExecuted for that. */
  regenerateExecuted(id: number): Observable<ContractDetail> {
    return this.http.post<ContractDetail>(`${this.adminUrl}/${id}/regenerate-executed`, {});
  }

  /** Emails the executed copy on file to both parties again. */
  resendExecuted(id: number): Observable<ContractDetail> {
    return this.http.post<ContractDetail>(`${this.adminUrl}/${id}/resend-executed`, {});
  }

  /** A CEO/CTO signing as the contractor without leaving the admin panel. */
  signAsContractor(id: number, dto: SignContractRequest): Observable<SignContractResult> {
    return this.http.post<SignContractResult>(`${this.adminUrl}/${id}/sign-as-contractor`, dto);
  }

  resendSignerInvite(contractId: number, signerId: number): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(
      `${this.adminUrl}/${contractId}/signers/${signerId}/resend`, {});
  }

  getVersionDocument(contractId: number, versionId: number): Observable<{
    versionNumber: number; generatedAt: string; documentHash: string;
    isSuperseded: boolean; documentHtml: string;
    signatureBlock: ContractSignatureBlock; snapshot: ContractSnapshot;
  }> {
    return this.http.get<any>(`${this.adminUrl}/${contractId}/versions/${versionId}`);
  }

  /** Contract PDFs sit outside the public uploads tree, so this is the only way to fetch one. */
  downloadFile(fileId: number): Observable<Blob> {
    return this.http.get(`${this.adminUrl}/files/${fileId}`, { responseType: 'blob' });
  }

  // ── Admin: directory ──

  getContractorProfiles(): Observable<ContractorProfile[]> {
    return this.http.get<ContractorProfile[]>(`${this.directoryUrl}/contractor-profiles`);
  }

  updateContractorProfile(id: number, dto: Partial<ContractorProfile>): Observable<ContractorProfile> {
    return this.http.put<ContractorProfile>(`${this.directoryUrl}/contractor-profiles/${id}`, dto);
  }

  getClients(search?: string): Observable<ContractClient[]> {
    let params = new HttpParams();
    if (search) params = params.set('search', search);
    return this.http.get<ContractClient[]>(`${this.directoryUrl}/clients`, { params });
  }

  /**
   * Creates a commercial client on its own — no contract, no DCC number, no document.
   *
   * The endpoint is the one the contract directory already exposed; it simply had no caller until
   * Commercial → Clients and the invoice form got their "New client" buttons. Creation only:
   * editing an existing client stays on the contract, where a rename is governed by
   * ContractClientEditPolicy.
   */
  createClient(dto: CreateCommercialClient): Observable<ContractClient> {
    return this.http.post<ContractClient>(`${this.directoryUrl}/clients`, dto);
  }

  /**
   * Edits a commercial client. The link to a customer account is NOT part of this payload — it is
   * made and unmade by the business flag on the account, because it grants that customer sight of
   * the client's contracts.
   */
  updateClient(id: number, dto: CreateCommercialClient): Observable<ContractClient> {
    return this.http.put<ContractClient>(`${this.directoryUrl}/clients/${id}`, dto);
  }

  /**
   * SOFT delete. Contracts, invoices, payments and reference numbers all survive; the client just
   * stops being offered. For a client linked to a customer account this also removes that
   * account's business designation, which is what makes the deletion stick — otherwise the next
   * sync would put the client straight back.
   */
  deactivateClient(id: number): Observable<{ message: string; businessFlagRemoved: boolean }> {
    return this.http.delete<{ message: string; businessFlagRemoved: boolean }>(
      `${this.directoryUrl}/clients/${id}`);
  }

  /** Standalone clients only — a linked one comes back via the business flag on its account. */
  restoreClient(id: number): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(`${this.directoryUrl}/clients/${id}/restore`, {});
  }

  getLocations(clientId: number): Observable<ContractServiceLocation[]> {
    return this.http.get<ContractServiceLocation[]>(
      `${this.directoryUrl}/clients/${clientId}/locations`);
  }

  getContacts(role?: ContractContactRole, clientId?: number): Observable<ContractContact[]> {
    let params = new HttpParams();
    if (role !== undefined) params = params.set('role', String(role));
    if (clientId) params = params.set('clientId', String(clientId));
    return this.http.get<ContractContact[]>(`${this.directoryUrl}/contacts`, { params });
  }

  getScopeTemplates(): Observable<ScopeTemplate[]> {
    return this.http.get<ScopeTemplate[]>(`${this.directoryUrl}/scope-templates`);
  }

  getContractTemplates(): Observable<ContractTemplate[]> {
    return this.http.get<ContractTemplate[]>(`${this.directoryUrl}/contract-templates`);
  }

  // ── Client-facing (anonymous, token addressed) ──

  getReviewPage(token: string): Observable<ContractReviewPage> {
    return this.http.get<ContractReviewPage>(`${this.publicUrl}/review/${token}`);
  }

  updateReviewInformation(token: string, info: ClientReviewInfo): Observable<ClientEditResult> {
    return this.http.put<ClientEditResult>(`${this.publicUrl}/review/${token}/information`, info);
  }

  downloadExecutedForClient(token: string): Observable<Blob> {
    return this.http.get(`${this.publicUrl}/review/${token}/executed-document`, { responseType: 'blob' });
  }

  getSigningPage(token: string): Observable<ContractSigningPage> {
    return this.http.get<ContractSigningPage>(`${this.publicUrl}/sign/${token}`);
  }

  sign(token: string, dto: SignContractRequest): Observable<SignContractResult> {
    return this.http.post<SignContractResult>(`${this.publicUrl}/sign/${token}`, dto);
  }
}
