import { shouldShowAuditField, isSensitiveAuditField } from './audit-field-display';

const relationships: Record<string, string[]> = {
  UserId: ['User', 'Customer', 'CustomerUserId'], ApartmentId: ['Apartment'],
  RecurringSeriesId: ['RecurringSeries', 'RecurringOrderSeries'], ContractClientId: ['ContractClient'],
  AssignedAdminId: ['AssignedAdmin'], AssignedToAdminId: ['AssignedToAdmin'], BookedByAdminUserId: ['BookedByAdminUser', 'BookedByAdmin'],
  CreatedByAdminId: ['CreatedByAdmin', 'CreatedBy', 'CreatedByUser', 'CreatedByUserId'],
  LeadId: ['Lead'], AdminId: ['Admin'], ServiceTypeId: ['ServiceType'], CleanerId: ['Cleaner']
};

/** Older snapshots contained both scalar FKs and empty navigation objects. Keep one concept. */
export function normalizeAuditValues(values: any): any {
  if (!values || typeof values !== 'object') return null;
  const result = { ...values };
  for (const [key, aliases] of Object.entries(relationships)) {
    for (const alias of aliases) {
      const value = result[alias];
      // Purpose-written event payloads already carry a readable scalar name.
      if (result[key] == null && typeof value !== 'object' && !alias.endsWith('Id')) continue;
      if ((result[key] == null || result[key] === '') && value != null) {
        if (typeof value !== 'object') result[key] = value;
        else {
          const name = value.Name || value.FullName || [value.FirstName, value.LastName].filter(Boolean).join(' ');
          if (name) result[key] = name + (value.Id ? ` (#${value.Id})` : '');
          else if (value.Id) result[key] = value.Id;
        }
      }
      delete result[alias];
    }
  }
  for (const [id, name] of [['CreatedByAdminId', 'CreatedByAdminName'], ['AdminId', 'AdminName']]) {
    if (result[name] && (result[id] == null || typeof result[id] === 'number'))
      result[id] = result[name] + (result[id] ? ` (#${result[id]})` : '');
    delete result[name];
  }
  const clean = (value: any): any => {
    if (Array.isArray(value)) return value.map(clean);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
      .filter(([key]) => !isSensitiveAuditField(key)).map(([key, item]) => [key, clean(item)]));
    return value;
  };
  for (const key of Object.keys(result)) {
    if (isSensitiveAuditField(key)) delete result[key];
    else result[key] = clean(result[key]);
  }
  return Object.keys(result).length ? result : null;
}

function equivalent(value: any): string {
  if (value == null || value === '') return '';
  if (typeof value === 'object' && Object.keys(value).length === 0) return '';
  if (Array.isArray(value)) return JSON.stringify(value.map(equivalent).sort());
  if (typeof value === 'object') return JSON.stringify(Object.keys(value).sort().map(k => [k, equivalent(value[k])]));
  return String(value);
}

export function meaningfulAuditChanges(log: any): string[] {
  if (log.action === 'Create' || log.action === 'Delete') return [];
  if (!log.oldValues || !log.newValues) return [];
  const fields = [...new Set([...Object.keys(log.oldValues), ...Object.keys(log.newValues)])];
  return fields.filter(field => shouldShowAuditField(field)
    && equivalent(log.oldValues[field]) !== equivalent(log.newValues[field]));
}

/** Legacy snapshots may contain assignments; the dedicated service-line renderer handles extras. */
export function auditCollectionChanges(log: any): { added: string[]; removed: string[] } {
  if (log.action === 'Create' || log.action === 'Delete') return { added: [], removed: [] };
  const names = (values: any): Map<string, string> => new Map((values?.OrderCleaners ?? []).map((line: any) => {
    const cleaner = line.Cleaner ?? line;
    const id = line.CleanerId ?? cleaner.Id;
    const name = cleaner.Name || line.CleanerName || [cleaner.FirstName, cleaner.LastName].filter(Boolean).join(' ') || cleaner.Email;
    return [String(id ?? name ?? ''), name ? name + (id ? ` (#${id})` : '') : id ? `Cleaner #${id}` : ''];
  }).filter(([id, name]: string[]) => id && name));
  const before = names(log.oldValues), after = names(log.newValues);
  return { added: [...after].filter(([id]) => !before.has(id)).map(([, name]) => name),
    removed: [...before].filter(([id]) => !after.has(id)).map(([, name]) => name) };
}

const summaries: Record<string, string[]> = {
  Order: ['UserId', 'ContactFirstName', 'ContactLastName', 'ServiceTypeId', 'CustomServiceDisplayName', 'ServiceDate', 'ServiceTime',
    'ServiceAddress', 'AptSuite', 'City', 'State', 'ZipCode', 'Total', 'PaymentMethod', 'Status', 'BookedByAdminUserId',
    'AssignedAdminId', 'RecurringSeriesId', 'CancellationReason', 'Reason', 'DiscountAmount', 'LoyaltyDiscountAmount', 'Tips'],
  User: ['FirstName', 'LastName', 'Email', 'Phone', 'Role', 'IsActive', 'CreatedByAdminId'],
  Lead: ['FirstName', 'LastName', 'Email', 'Phone', 'Type', 'Source', 'Stage', 'ServiceAddress', 'CleaningType', 'Message', 'AssignedToAdminId', 'NextFollowUpDate'],
  UserNote: ['UserId', 'Type', 'Content', 'CreatedByAdminId'],
  LeadActivity: ['LeadId', 'Type', 'Content', 'AdminId'],
  RecurringOrderSeries: ['UserId', 'TemplateOrderId', 'IntervalValue', 'IntervalUnit', 'AnchorDate', 'ServiceTime', 'IsActive',
    'RecurringLoyaltyDiscountPercent', 'CopyCleanerAssignments', 'AutoRequestPayment', 'CreatedByAdminId'],
  CommercialInvoice: ['InvoiceNumber', 'ContractClientId', 'ContractId', 'ServiceAddress', 'ServiceStartDate', 'ServiceEndDate',
    'Total', 'TaxAmount', 'Status', 'PaymentMethod', 'DueDate'],
  Contract: ['ContractNumber', 'ContractClientId', 'Status', 'EffectiveDate', 'EndDate', 'Title']
};

const optionalZero = new Set(['DiscountAmount', 'LoyaltyDiscountAmount', 'Tips', 'RecurringLoyaltyDiscountPercent']);
export function auditSummaryFields(log: any, values: any): string[] {
  if (!values) return [];
  const fields = summaries[log.entityType] ?? Object.keys(values);
  return fields.filter(field => {
    const value = values[field];
    if (!shouldShowAuditField(field) || value == null || value === '') return false;
    if (typeof value === 'object') return false;
    if (optionalZero.has(field) && Number(value) === 0) return false;
    if (field.endsWith('Id') && value === 0) return false;
    if (field === 'ContactFirstName' || field === 'ContactLastName') {
      if (typeof values.UserId === 'string' && !values.UserId.startsWith('#')) return false;
    }
    return !/^(Initial|Original|Utm|Acquisition|Converting|Bonus)/.test(field);
  });
}
