import { formatNyDateTime } from '../ny-time.util';

/**
 * How an audit row's raw field name and raw JSON value become something an admin can read.
 *
 * WHY THIS IS ITS OWN FILE. Before 2026-08-31 the Audits tab knew 18 field names and rendered
 * everything else as the raw property name — `CleanerTotalSalary`, `SubscriptionDiscountAmount`,
 * `IsAvailableForAll` — beside an unformatted value. With the coverage sweep multiplying both the
 * entity types and the fields on them, the "18 known names" approach stopped being a small gap and
 * became the reason the tab was unreadable. So: an explicit map for the names worth naming, and a
 * HUMANIZED FALLBACK that is always better than the raw identifier, rather than a growing list
 * that silently fails closed.
 *
 * The three pseudo-entities with dedicated renderers — OrderServicesUpdate, CleanerAssignment,
 * BubblePointsAdjustment — do NOT come through here. Their OldValues are nested arrays, not flat
 * field maps, and a generic field/old/new table cannot absorb them. Those paths stay as they are.
 */

/**
 * Field names an admin should never see raw. Anything absent falls through to
 * {@link humanizeFieldName}, which is why this map does not need to be exhaustive — it only needs
 * to cover the names where splitting on capitals gives the wrong answer ("SubTotal" -> "Sub Total")
 * or where the column name is not the word the business uses ("MaidsCount" -> "Cleaners").
 */
export const AUDIT_FIELD_LABELS: { [field: string]: string } = {
  // ── Identity / bookkeeping ──────────────────────────────────────────────────
  PasswordHash: 'Password',
  PasswordSalt: 'Password Salt',
  RefreshToken: 'Session Token',
  RefreshTokenExpiryTime: 'Session Expiry',
  CreatedAt: 'Created',
  UpdatedAt: 'Updated',
  IsActive: 'Active',
  IsDeleted: 'Deleted',
  FirstName: 'First Name',
  LastName: 'Last Name',
  ExternalAuthId: 'Social Login ID',

  // ── Order money ─────────────────────────────────────────────────────────────
  SubTotal: 'Subtotal',
  Tax: 'Sales Tax',
  Total: 'Total',
  Tips: 'Tips',
  CompanyDevelopmentTips: 'Company Development Tips (retired)',
  DiscountAmount: 'Promo / Offer Discount',
  SubscriptionDiscountAmount: 'Recurring Plan Discount',
  LoyaltyDiscountAmount: 'Loyalty Discount',
  LoyaltyDiscountPercentage: 'Loyalty Discount %',
  GiftCardAmountUsed: 'Gift Card Applied',
  PointsRedeemed: 'Points Redeemed',
  CreditsApplied: 'Store Credit Applied',
  TotalRefundedAmount: 'Total Refunded',
  InitialSubTotal: 'Original Subtotal',
  InitialTax: 'Original Sales Tax',
  InitialTotal: 'Original Total',
  InitialTips: 'Original Tips',

  // ── Order scheduling / service ──────────────────────────────────────────────
  ServiceDate: 'Service Date',
  ServiceTime: 'Service Time',
  'ServiceDate&Time': 'Service Date & Time',
  OrderDate: 'Booked On',
  ServiceTypeId: 'Service Type',
  CustomServiceDisplayName: 'Custom Service Name',
  TotalDuration: 'Total Duration',
  MaidsCount: 'Cleaners',
  PropertyType: 'Property Type',
  LevelsQuantity: 'Levels',
  BedroomsQuantity: 'Bedrooms',
  ServiceAddress: 'Address',
  AptSuite: 'Apt / Suite',
  EntryMethod: 'Entry Method',
  SpecialInstructions: 'Special Instructions',

  // ── Order state ─────────────────────────────────────────────────────────────
  Status: 'Status',
  StatusBeforeRefund: 'Status Before Refund',
  IsPaid: 'Paid',
  PaidAt: 'Paid At',
  PaymentMethod: 'Payment Method',
  PaymentIntentId: 'Stripe Payment ID',
  IsHidden: 'Hidden From List',
  HiddenAt: 'Hidden At',
  HiddenByUserId: 'Hidden By',
  CancellationReason: 'Cancellation Reason',
  AssignedAdminId: 'Assigned Admin',
  BookedByAdminUserId: 'Booked By Admin',
  PaymentConsentAcceptedAt: 'Consent Accepted At',
  PaymentConsentIpAddress: 'Consent IP Address',

  // ── Payroll — the headline gap this map was written for ─────────────────────
  CleanerTotalSalary: 'Cleaners Total Salary',
  CleanerHourlyRate: 'Cleaner Hourly Rate',
  SalaryHourlyRate: 'Hourly Rate (this cleaner)',
  SalaryBillableMinutes: 'Paid Hours (this cleaner)',
  BillableMinutes: 'Paid Hours',
  PaidAmount: 'Amount Paid',
  PaidVia: 'Paid Via',
  PaidByUserId: 'Paid By',
  PaymentNote: 'Payment Note',
  SlotIndex: 'Unassigned Slot',
  TipsForCleaner: 'Tips For Cleaner',
  PaidLinesPinnedToOldRate: 'Already-Paid Lines Pinned To Old Rate',
  LinesKeepingTheirOwnRate: 'Lines Keeping Their Own Rate',
  Cleaner: 'Cleaner',
  AccountName: 'Account',
  AccountEmail: 'Account Email',
  CleanerEmailBefore: 'Cleaner Record Email (before)',
  CleanerEmailAfter: 'Cleaner Record Email (after)',
  CleanerEmailKept: 'Cleaner Record Email (unchanged)',
  ReleasedCleanerIds: 'Also Detached (cleaner ids)',
  NewRole: 'New Role',

  // ── Refunds / payments ──────────────────────────────────────────────────────
  AmountRefunded: 'Amount Refunded',
  RequestedAmount: 'Amount Requested',
  StripeRefundIds: 'Stripe Refund IDs',
  CustomerEmailSent: 'Customer Emailed',
  FullyApplied: 'Fully Applied',
  TotalRefundedBefore: 'Total Refunded (before)',
  TotalRefundedAfter: 'Total Refunded (after)',
  AdditionalAmount: 'Additional Amount',
  PaymentReference: 'Payment Reference',
  StatusReactivated: 'Order Reactivated',
  CardLast4: 'Card (last 4)',

  // ── Change requests ─────────────────────────────────────────────────────────
  RequestId: 'Request',
  RequestedChanges: 'Requested Changes',
  RequestedByUserId: 'Requested By',
  RequestedAt: 'Requested At',
  RejectReason: 'Reject Reason',
  Reason: 'Reason',

  // ── Catalogue / pricing ─────────────────────────────────────────────────────
  ServiceKey: 'Service Key',
  ServiceRelationType: 'Relation Type',
  BasePrice: 'Base Price',
  MinimumPrice: 'Minimum Price',
  TimeDuration: 'Duration',
  PriceMultiplier: 'Price Multiplier',
  IsAvailableForAll: 'Available For All Types',
  IsDeepCleaning: 'Deep Cleaning',
  IsSuperDeepCleaning: 'Super Deep Cleaning',
  IsSameDayService: 'Same Day Service',
  HasQuantity: 'Has Quantity',
  HasHours: 'Has Hours',
  DisplayOrder: 'Display Order',
  ZeroQuantityCost: 'Cost At Zero Quantity',
  ZeroQuantityDuration: 'Duration At Zero Quantity',
  ChargeAboveThreshold: 'Charge Above Included Amount',
  SourceServiceId: 'Source Service',
  SourceQuantity: 'Per Source Quantity',
  IncludedQuantity: 'Included Amount',
  FromQuantity: 'From Quantity',
  ThresholdsWritten: 'Included Amounts Written',
  RateTiersWritten: 'Rate Tiers Written',
  ServiceTypesAffected: 'Service Types Affected',
  ServicesAffected: 'Services Affected',
  SourceServiceName: 'Copied From',
  TargetServiceTypeId: 'Copied Into Service Type',

  // ── Discounts ───────────────────────────────────────────────────────────────
  DiscountPercentage: 'Discount %',
  DiscountValue: 'Discount Value',
  IsPercentage: 'Percentage Discount',
  SubscriptionDays: 'Plan Interval (days)',
  MinimumOrderAmount: 'Minimum Order Amount',
  RequiresFirstTimeCustomer: 'First-Time Customers Only',
  ValidFrom: 'Valid From',
  ValidTo: 'Valid To',
  MaxUsageCount: 'Max Uses',
  CurrentUsageCount: 'Times Used',
  CurrentBalance: 'Balance',
  OriginalAmount: 'Original Amount',
  UsersGranted: 'Customers Granted',
  OfferName: 'Offer',

  // ── Rewards / referrals / loyalty ───────────────────────────────────────────
  BubblePoints: 'Bubble Points',
  BubbleCredits: 'Store Credit',
  AmountGranted: 'Amount Granted',
  ReferredByUserId: 'Referred By',
  ReferredUserId: 'Referred Customer',
  ReferredUserEmail: 'Referred Customer Email',
  ReferredByEmail: 'Referrer Email',
  Percentage: 'Discount %',
  IsManualOverride: 'Manually Set',
  ActivatedAt: 'Activated At',
  LastUsedAt: 'Last Used At',
  RatePerOrder: 'Bonus Per Order',

  // ── Contact preferences ─────────────────────────────────────────────────────
  CanReceiveEmails: 'Can Receive Emails',
  CanReceiveMessages: 'Can Receive SMS',
  CanReceiveCommunications: 'Can Receive Communications',
  CanEditOrdersWithoutApproval: 'Can Save Order Edits Without Approval',
  AdminViewablePages: 'Viewable Pages',

  // ── Cleaners ────────────────────────────────────────────────────────────────
  IsExperienced: 'Experienced',
  OperatingAreas: 'Operating Areas',
  BusyDaysOfWeek: 'Busy Weekdays',
  AlreadyWorkedWithUs: 'Worked With Us Before',
  RestrictedReason: 'Restriction Reason',
  MainNote: 'Main Note',
  DocumentType: 'Document Type',
  PaymentDetails: 'Payout Details',
  PhotoUrl: 'Photo',
  DocumentUrl: 'Document',
  OrderPerformance: 'Performance Rating',
  CreatedByAdminId: 'Created By',

  // ── Campaigns / site settings ───────────────────────────────────────────────
  RecipientCount: 'Recipients',
  TargetRoles: 'Audience',
  ScheduleType: 'Schedule Type',
  ScheduledDate: 'Scheduled Date',
  ScheduledTime: 'Scheduled Time',
  ScheduleTimezone: 'Timezone',
  NextScheduledAt: 'Next Send',
  TimesSent: 'Times Sent',
  DayOfWeek: 'Day Of Week',
  DayOfMonth: 'Day Of Month',
  WeekOfMonth: 'Week Of Month',
  MaintenanceMode: 'Maintenance Mode',
  LiveChatEnabled: 'Live Chat Widget',
  EscalationEmailEnabled: 'Escalation Emails',
  VisibilityMode: 'Chat Widget Visibility',
  PublicVisible: 'Blog Publicly Visible',
  AutoGenerateEnabled: 'Auto-Generate Posts',
  GenerationModel: 'AI Model',
  BackgroundImagePath: 'Background Image',
  UsdPerGel: 'Exchange Rate (USD per GEL)',
  AdminIds: 'Admins On Shift',
  ShiftDate: 'Shift Date',
  ShiftColor: 'Shift Colour',
  IsFullDay: 'Full Day',
  BlockedHours: 'Blocked Hours',

  // ── Data syncs ──────────────────────────────────────────────────────────────
  Source: 'Source',
  DateRange: 'Date Range',
  DaysSynced: 'Days Synced',
  DaysCovered: 'Days Covered',
  RowsUpserted: 'Rows Written',
  RecordsProcessed: 'Records Processed',
  OrdersUpdated: 'Orders Updated',
  RefundsImported: 'Refunds Imported',
  AmountImported: 'Amount Imported',
  AlertsCreated: 'Alerts Created',
  TotalUsd: 'Total (USD)',

  // ── CRM ─────────────────────────────────────────────────────────────────────
  LostReason: 'Lost Reason',
  IsArchived: 'Archived',
  ArchivedAt: 'Archived At',
  EstimatedValue: 'Estimated Value',
  AssignedToAdminId: 'Assigned To',
  NextFollowUpDate: 'Next Follow-Up',
  LastActivityAt: 'Last Activity',
  ThresholdDays: 'Threshold (days)',
  CooldownDays: 'Cooldown (days)',
  RuleKey: 'Rule',
  RemindAt: 'Remind At',
  ResolvedAt: 'Resolved At',
  ResolvedByAdminId: 'Resolved By',
};

/** Fields never shown: secrets, plumbing, and the row's own identity. */
const HIDDEN_FIELDS = new Set([
  'PasswordHash', 'PasswordSalt', 'RefreshToken', 'RefreshTokenExpiryTime', 'ExternalAuthId',
  'Apartments', 'Orders', 'Subscription', 'CreatedAt', 'UpdatedAt', 'Id',
  // Order lines have their own dedicated renderer; showing them here as opaque values duplicates
  // the OrderServicesUpdate table and disagrees with it.
  'Services', 'ExtraServices',
]);

export function shouldShowAuditField(field: string): boolean {
  return !HIDDEN_FIELDS.has(field);
}

/**
 * Split a PascalCase identifier into words, so an unmapped field still reads as English.
 *
 * `CleanerTotalSalary` -> `Cleaner Total Salary`, `IsAvailableForAll` -> `Is Available For All`,
 * `UsdPerGel` -> `Usd Per Gel`. Consecutive capitals are kept together (`IPAddress` -> `IP
 * Address`) so acronyms are not shattered into single letters. A trailing `Id` is dropped:
 * `AssignedAdminId` is about the admin, not about a number.
 */
export function humanizeFieldName(field: string): string {
  if (!field) return '';
  const withoutId = field.length > 2 && field.endsWith('Id') ? field.slice(0, -2) : field;
  return withoutId
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .trim();
}

export function getAuditFieldLabel(field: string): string {
  if (!field) return '';
  return AUDIT_FIELD_LABELS[field] ?? humanizeFieldName(field);
}

/** Fields whose numeric value is money. Matched by name because the JSON carries no type. */
const MONEY_FIELD_PATTERN =
  /(Amount|Price|Cost|Total|SubTotal|Salary|Rate|Balance|Tips|Tax|Credit|Payout|Spend|Usd)$/;
const MONEY_FIELD_EXACT = new Set([
  'SubTotal', 'Total', 'Tax', 'Tips', 'PaidAmount', 'CleanerTotalSalary', 'CleanerHourlyRate',
  'SalaryHourlyRate', 'DiscountAmount', 'SubscriptionDiscountAmount', 'LoyaltyDiscountAmount',
  'GiftCardAmountUsed', 'CreditsApplied', 'TotalRefundedAmount', 'AmountRefunded',
  'RequestedAmount', 'AdditionalAmount', 'MinimumOrderAmount', 'OriginalAmount', 'CurrentBalance',
  'EstimatedValue', 'BubbleCredits', 'RatePerOrder', 'AmountGranted', 'AmountImported', 'TotalUsd',
  'InitialSubTotal', 'InitialTax', 'InitialTotal', 'InitialTips', 'CompanyDevelopmentTips',
  'TotalRefundedBefore', 'TotalRefundedAfter', 'TipsForCleaner', 'BasePrice', 'MinimumPrice',
]);

function isMoneyField(field?: string): boolean {
  if (!field) return false;
  if (MONEY_FIELD_EXACT.has(field)) return true;
  // "UsdPerGel" is a rate but not dollars-and-cents in the same sense; excluded deliberately.
  if (field === 'UsdPerGel' || field === 'PriceMultiplier') return false;
  return MONEY_FIELD_PATTERN.test(field);
}

/** Percentage-valued fields, rendered with a % rather than as a bare number. */
const PERCENT_FIELDS = new Set([
  'LoyaltyDiscountPercentage', 'DiscountPercentage', 'Percentage', 'LoyaltyDay60Percentage',
  'LoyaltyDay90Percentage',
]);

/** Minute-valued durations, rendered as hours and minutes. */
const DURATION_FIELDS = new Set([
  'TotalDuration', 'BillableMinutes', 'SalaryBillableMinutes', 'AutomaticMinutesPerCleaner',
]);

/**
 * Enum columns stored as ints.
 *
 * Keyed by the DECLARED numeric value, never by array position — `CleanerPaymentMethod` starts at
 * 1, so a positional list would label every cleaner payout with the wrong method, which on the
 * Outgoing Payments stream is a claim about where somebody's money went.
 *
 * `PaymentMethod` (how the CUSTOMER paid us) and `PaidVia` (how a CLEANER was paid their wages)
 * are different enums answering different questions; resolving them through one list is the
 * mistake to avoid.
 */
const ENUM_LABELS: { [field: string]: { [value: number]: string } } = {
  // Models/UserRole.cs
  Role: { 0: 'Customer', 1: 'SuperAdmin', 2: 'Admin', 3: 'Moderator' },
  // Models/PaymentMethod.cs — Normal means the Stripe card flow.
  PaymentMethod: { 0: 'Card (Stripe)', 1: 'Cash', 2: 'Zelle', 3: 'Check', 4: 'Other' },
  // Models/CleanerPaymentMethod.cs — 1-based.
  PaidVia: { 1: 'Zelle', 2: 'Cash', 3: 'Check', 4: 'Other' },
  // Models/CleanerRanking.cs
  Ranking: { 0: 'Top', 1: 'Standard', 2: 'Beginner', 3: 'Restricted', 4: 'No Experience' },
  // Models/ChatAgentSettings.cs
  VisibilityMode: { 0: 'Disabled', 1: 'Admin Only', 2: 'Public' },
};

/**
 * Human-readable form of one audit value.
 *
 * `resolveName` lets the caller turn an id into a person — the component passes a lookup built
 * from the admins the metadata endpoint returned, so `Paid By: 4` renders as `Paid By: Ana Reyes`.
 * It returns null when it does not know the id, and the number is then shown as `#4` rather than
 * as a bare integer that could be mistaken for a quantity.
 */
export function formatAuditValue(
  value: any,
  field?: string,
  resolveName?: (id: number) => string | null
): string {
  if (value === null || value === undefined) return 'None';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';

  // Ids that name a person. Checked before the numeric branches so they never render as money.
  if (field && /(UserId|AdminId|ByUserId|CleanerId)$/.test(field) && typeof value === 'number') {
    const name = resolveName?.(value);
    return name ? `${name} (#${value})` : `#${value}`;
  }

  if (field && ENUM_LABELS[field] && typeof value === 'number') {
    return ENUM_LABELS[field][value] ?? `#${value}`;
  }

  // Some payloads already carry the enum as its name (LogActionAsync call sites pass
  // `.ToString()`), which needs no translation.
  if (field && ENUM_LABELS[field] && typeof value === 'string') {
    return humanizeFieldName(value);
  }

  if (field && DURATION_FIELDS.has(field) && typeof value === 'number') {
    const hours = Math.floor(value / 60);
    const minutes = Math.round(value % 60);
    if (hours === 0) return `${minutes}m`;
    return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
  }

  if (field && PERCENT_FIELDS.has(field) && typeof value === 'number') {
    return `${value}%`;
  }

  if (isMoneyField(field) && typeof value === 'number') {
    return formatMoney(value);
  }

  // Times of day arrive as "HH:mm:ss" or as a serialized TimeSpan object.
  if (field === 'ServiceTime' || field === 'ScheduledTime') {
    return formatTimeOfDay(value);
  }

  if (typeof value === 'string' && looksLikeTimestamp(value)) {
    return formatAuditTimestamp(value, field);
  }

  if (typeof value === 'number') {
    // A money-shaped number that no rule matched still reads better without float noise.
    return Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100);
  }

  if (typeof value === 'object') {
    // Nothing flat left to say — but a raw JSON blob is exactly what this module exists to avoid,
    // so it is described rather than dumped.
    return Array.isArray(value) ? `${value.length} item(s)` : '(details)';
  }

  const text = String(value);
  if (text === '') return '(empty)';
  return text;
}

export function formatMoney(value: number): string {
  const sign = value < 0 ? '-' : '';
  return `${sign}$${Math.abs(value).toFixed(2)}`;
}

function looksLikeTimestamp(value: string): boolean {
  // Deliberately strict. `Date.parse` accepts things like "5" and "Deep Clean 2", and the old
  // getFieldValue used exactly that test — which is how ordinary text ended up rendered as a date.
  return /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:\d{2})?)?$/.test(value);
}

/**
 * Audit timestamps are UTC and are shown in NY (business) time.
 *
 * A midnight value is a DATE-ONLY wall-clock field (ServiceDate, ValidFrom, DueDate, ...), not an
 * instant — converting it to NY would move it to the previous evening and show yesterday's date.
 * Those render as the date exactly as stored.
 */
export function formatAuditTimestamp(value: any, field?: string): string {
  if (value === null || value === undefined) return 'None';

  const raw = String(value);
  if (raw.startsWith('0001-01-01')) return 'Not set';

  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(raw) || /T00:00:00(\.0+)?Z?$/.test(raw);
  if (dateOnly) {
    const d = new Date(raw.replace(/Z$/, '').split('T')[0] + 'T00:00:00');
    return isNaN(d.getTime()) ? raw : d.toLocaleDateString();
  }

  const formatted = formatNyDateTime(value);
  return formatted || raw;
}

function formatTimeOfDay(value: any): string {
  let text = value;
  if (typeof value === 'object' && value !== null) {
    text = value.Hours !== undefined
      ? `${String(value.Hours).padStart(2, '0')}:${String(value.Minutes || 0).padStart(2, '0')}`
      : String(value);
  }
  text = String(text);
  const parts = text.split(':');
  if (parts.length < 2) return text;
  const hours = parseInt(parts[0], 10);
  if (isNaN(hours)) return text;
  const suffix = hours >= 12 ? 'PM' : 'AM';
  const display = hours % 12 || 12;
  return `${display}:${parts[1]} ${suffix}`;
}

/**
 * Entity-type labels for the table and the filter dropdown.
 *
 * Unmapped types fall through to {@link humanizeFieldName} for the same reason field names do —
 * a stream added by a newly audited action reads as "Order Cleaner Hourly Rate" rather than as
 * `OrderCleanerHourlyRate`, with no frontend change required.
 */
export const AUDIT_ENTITY_LABELS: { [entityType: string]: string } = {
  User: 'Customer / Staff',
  Order: 'Order',
  CleanerAssignment: 'Cleaner Assignment',
  OrderServicesUpdate: 'Order Services',
  OrderNotification: 'Customer Notification',
  BubblePointsAdjustment: 'Bubble Points',
  UserLoyaltyDiscount: 'Loyalty Discount',
  BubblePointsResetSnapshot: 'Bubble Points Reset',
  GiftCard: 'Gift Card',
  GiftCardUsage: 'Gift Card Usage',
  ServiceType: 'Service Type',
  Service: 'Service',
  ServiceThreshold: 'Included Amount',
  ServiceRateTier: 'Rate Tier',
  ExtraService: 'Extra Service',
  Subscription: 'Recurring Plan',
  PromoCode: 'Promo Code',
  SpecialOffer: 'Special Offer',
  SpecialOfferGrant: 'Special Offer Grant',
  Apartment: 'Address',
  CleanerPayrollOverride: 'Payroll Override',
  OrderCleanerHourlyRate: 'Order Hourly Rate',
  CleanerPayout: 'Cleaner Payout',
  OrderRefundAction: 'Refund',
  OrderAdminNote: 'Order Note',
  OrderVisibility: 'Order Visibility',
  OrderTransferAction: 'Order Transfer',
  OrderEditRequest: 'Change Request',
  OrderPaymentAction: 'Order Payment',
  OrderAssignedAdmin: 'Assigned Admin',
  UserAdminNote: 'Customer Note',
  UserCommunicationPreference: 'Contact Preferences',
  RewardAdjustment: 'Reward Adjustment',
  ReferralAdjustment: 'Referral',
  RewardSetting: 'Rewards Setting',
  CleanerDocument: 'Cleaner File',
  CleanerPerformance: 'Cleaner Performance',
  CleanerAccountLink: 'Cleaner Login Link',
  PricingConfiguration: 'Pricing Import',
  CatalogueCopy: 'Catalogue Copy',
  CampaignAction: 'Campaign Send',
  SiteSetting: 'Site Setting',
  DataSync: 'Data Sync',
  Cleaner: 'Cleaner',
  CleanerNote: 'Cleaner Note',
  Expense: 'Expense',
  ExpenseCategory: 'Expense Category',
  BlockedTimeSlot: 'Blocked Time Slot',
  PollQuestion: 'Poll Question',
  PollSubmission: 'Poll Submission',
  BlogPost: 'Blog Post',
  BlogTopic: 'Blog Topic',
  BlogSettings: 'Blog Settings',
  BeforeAfterPhoto: 'Before / After Photo',
  Lead: 'CRM Lead',
  LeadActivity: 'CRM Activity',
  CustomerTag: 'Customer Tag',
  AutomationRule: 'Automation Rule',
  AutomationAlert: 'Automation Alert',
  ScheduledMail: 'Scheduled Email',
  ScheduledSms: 'Scheduled SMS',
  AdminTask: 'Shared Task',
  PersonalAdminTask: 'Personal Task',
  HandoverNote: 'Handover Note',
  ClientInteraction: 'Client Communication',
  UserNote: 'Customer Note',
  UserCleaningPhoto: 'Cleaning Photo',
  AdminShift: 'Admin Shift',
  ChatAgentSettings: 'Chat Agent Settings',
};

export function getAuditEntityLabel(entityType?: string): string {
  if (!entityType) return '';
  return AUDIT_ENTITY_LABELS[entityType] ?? humanizeFieldName(entityType);
}

/**
 * Friendly label for an action badge.
 *
 * The Create/Update/Delete vocabulary is short enough to display verbatim; everything else is a
 * verb somebody coined at a call site (`PayoutRecorded`, `ChangeRejected`, `Ga4SessionBackfill`)
 * and is humanized. Existing badges are unchanged.
 */
export function getAuditActionLabel(action: string): string {
  switch (action) {
    case 'LoyaltyAutoActivated': return 'Auto-activated';
    case 'LoyaltyAutoUpgraded': return 'Auto-upgraded';
    case 'LoyaltyManualSet': return 'Manually set';
    case 'LoyaltyManualCleared': return 'Cleared';
    case 'LoyaltyUsed': return 'Used on order';
    case 'LoyaltyReversed': return 'Restored';
    case 'Create': case 'Update': case 'Delete':
    case 'Assigned': case 'Removed':
      return action;
    case 'PointsAdded': return 'Points added';
    case 'PointsDeducted': return 'Points deducted';
    default: return humanizeFieldName(action);
  }
}

/**
 * Badge colour class for an action. Falls back by SHAPE rather than to a blank class, so a newly
 * coined action still reads as create-ish / delete-ish instead of as unstyled text.
 */
export function getAuditActionClass(action: string): string {
  const a = (action || '').toLowerCase();
  switch (a) {
    case 'create': return 'action-create';
    case 'update': return 'action-update';
    case 'delete': return 'action-delete';
    case 'assigned': return 'action-assigned';
    case 'removed': return 'action-removed';
    case 'pointsadded': return 'action-points-added';
    case 'pointsdeducted': return 'action-points-deducted';
    case 'loyaltyautoactivated':
    case 'loyaltymanualset': return 'action-create';
    case 'loyaltyautoupgraded': return 'action-update';
    case 'loyaltymanualcleared': return 'action-points-deducted';
    case 'loyaltyused': return 'action-removed';
    case 'loyaltyreversed': return 'action-delete';
  }
  if (/(reversed|rejected|deleted|removed|cleared|unpublish)/.test(a)) return 'action-delete';
  if (/(recorded|created|added|granted|issued|sent|approved|published|set)/.test(a)) return 'action-create';
  return 'action-update';
}
