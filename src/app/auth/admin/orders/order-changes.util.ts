import { AuditLog } from '../../../services/admin.service';
import {
  formatAuditValue,
  getAuditActionLabel,
  getAuditEntityLabel,
  getAuditFieldLabel
} from '../../../shared/admin/audit-field-display';
import {
  auditCollectionChanges,
  auditSummaryFields,
  meaningfulAuditChanges,
  normalizeAuditValues
} from '../../../shared/admin/audit-presentation';

/**
 * One row of the order panel's Changes tab — the order's audit trail, reduced to what an admin
 * scanning it needs: when, who, what kind of change, and exactly what moved. The full
 * before/after table stays on the Audits tab. Built with the Audits tab's own label and
 * formatting helpers, so a field reads the same in both places.
 */
export interface OrderChangeEntry {
  id: number;
  createdAt: Date | string;
  changedBy: string | null;
  title: string;
  lines: string[];
  moreCount: number;
  undone: boolean;
}

const MAX_LINES = 8;

/** An edit writes an Order row and, when its lines moved, an OrderServicesUpdate row a moment
 *  later — the Audits tab shows them as one change, and so does this. */
const MERGE_WINDOW_MS = 5000;

/** Custom titles for the rows admins read most; anything else falls back to entity · action. */
function titleFor(row: AuditLog): string {
  const type = row.entityType ?? '';
  const action = row.action ?? '';
  if (type === 'Order') {
    if (action === 'Create') return 'Order booked';
    if (action === 'Update') return 'Order edited';
    if (action === 'Delete') return 'Order deleted';
  }
  if (type === 'OrderServicesUpdate') return 'Services changed';
  if (type === 'CleanerAssignment') {
    if (action === 'Assigned') return 'Cleaner assigned';
    if (action === 'Removed') return 'Cleaner removed';
  }
  return `${getAuditEntityLabel(type)} · ${getAuditActionLabel(action)}`;
}

function parseValues(value: any): any {
  if (value == null || value === '') return null;
  if (typeof value === 'string') {
    try { return JSON.parse(value); } catch { return null; }
  }
  return value;
}

function money(value: any): string {
  const n = Number(value);
  return Number.isFinite(n) ? `$${n.toFixed(2)}` : String(value ?? '');
}

/** "Windows ×6 · 2h · $60.00" — only the parts a line actually has. */
function describeLine(line: any, name: string): string {
  const parts = [name];
  if (line?.Quantity != null && Number(line.Quantity) !== 1) parts[0] += ` ×${line.Quantity}`;
  if (Number(line?.Hours) > 0) parts.push(`${line.Hours}h`);
  if (line?.Cost != null) parts.push(money(line.Cost));
  return parts.join(' · ');
}

/**
 * Services and extras are stored as whole lists, which the generic field diff deliberately hides.
 * Compare them by line (id, else name) and say what was ADDED, REMOVED, or CHANGED.
 */
function serviceLineChanges(oldValues: any, newValues: any): string[] {
  const lines: string[] = [];
  const compare = (key: string, idKey: string, nameKey: string, noun: string) => {
    const before: any[] = Array.isArray(oldValues?.[key]) ? oldValues[key] : [];
    const after: any[] = Array.isArray(newValues?.[key]) ? newValues[key] : [];
    const id = (l: any) => String(l?.[idKey] ?? l?.[nameKey] ?? '');
    const name = (l: any) => l?.[nameKey] ?? `${noun} #${l?.[idKey]}`;
    const beforeById = new Map(before.map(l => [id(l), l]));
    const afterById = new Map(after.map(l => [id(l), l]));

    for (const [key2, line] of afterById) {
      const prev = beforeById.get(key2);
      if (!prev) { lines.push(`${noun} added: ${describeLine(line, name(line))}`); continue; }
      const moved: string[] = [];
      if (Number(prev.Quantity) !== Number(line.Quantity)) moved.push(`qty ${prev.Quantity} → ${line.Quantity}`);
      if (Number(prev.Hours ?? 0) !== Number(line.Hours ?? 0)) moved.push(`hours ${prev.Hours ?? 0} → ${line.Hours ?? 0}`);
      if (Math.abs(Number(prev.Cost ?? 0) - Number(line.Cost ?? 0)) > 0.009) moved.push(`${money(prev.Cost)} → ${money(line.Cost)}`);
      if (moved.length > 0) lines.push(`${name(line)}: ${moved.join(', ')}`);
    }
    for (const [key2, line] of beforeById) {
      if (!afterById.has(key2)) lines.push(`${noun} removed: ${name(line)}`);
    }
  };
  compare('Services', 'ServiceId', 'ServiceName', 'Service');
  compare('ExtraServices', 'ExtraServiceId', 'ExtraServiceName', 'Extra');
  return lines;
}

/** What a cleaner-assignment row is about: the name when the payload has one, else the email. */
function cleanerLine(values: any): string | null {
  if (!values) return null;
  const name = values.CleanerName || [values.FirstName, values.LastName].filter(Boolean).join(' ');
  return name || values.CleanerEmail || null;
}

function fieldLines(log: any): string[] {
  const lines: string[] = [];
  for (const field of meaningfulAuditChanges(log)) {
    lines.push(`${getAuditFieldLabel(field)}: ${formatAuditValue(log.oldValues?.[field], field)} → ${formatAuditValue(log.newValues?.[field], field)}`);
  }
  const cleaners = auditCollectionChanges(log);
  cleaners.added.forEach(name => lines.push(`Cleaner added: ${name}`));
  cleaners.removed.forEach(name => lines.push(`Cleaner removed: ${name}`));
  return lines;
}

function linesFor(row: AuditLog, rawOld: any, rawNew: any): string[] {
  const type = row.entityType ?? '';

  if (type === 'OrderServicesUpdate') return serviceLineChanges(rawOld, rawNew);

  if (type === 'CleanerAssignment') {
    const who = cleanerLine(rawNew) ?? cleanerLine(rawOld);
    return who ? [who] : [];
  }

  if (type === 'Order' && row.action === 'Create') return [];

  const log: any = { ...row, oldValues: normalizeAuditValues(rawOld), newValues: normalizeAuditValues(rawNew) };
  const lines = fieldLines(log);

  // A one-sided payload (a payment recorded, an invoice sent) has no "before" — show what was
  // recorded instead of an empty row.
  if (lines.length === 0) {
    const values = log.newValues ?? log.oldValues;
    for (const field of auditSummaryFields(log, values)) {
      lines.push(`${getAuditFieldLabel(field)}: ${formatAuditValue(values[field], field)}`);
    }
  }
  return lines;
}

export function buildOrderChangeEntries(rows: AuditLog[]): OrderChangeEntry[] {
  const parsed = (rows ?? []).map(row => ({
    row,
    rawOld: parseValues(row.oldValues),
    rawNew: parseValues(row.newValues),
    time: new Date(row.createdAt as any).getTime()
  }));

  const consumed = new Set<number>();
  const entries: OrderChangeEntry[] = [];

  for (const item of parsed) {
    if (consumed.has(item.row.id)) continue;
    const { row } = item;
    let lines = linesFor(row, item.rawOld, item.rawNew);

    // Fold the services row written by the same edit into the order edit.
    if (row.entityType === 'Order' && row.action === 'Update') {
      for (const other of parsed) {
        if (other.row.entityType !== 'OrderServicesUpdate' || consumed.has(other.row.id)) continue;
        if (Math.abs(other.time - item.time) > MERGE_WINDOW_MS) continue;
        if ((other.row.changedBy ?? '') !== (row.changedBy ?? '')) continue;
        lines = [...serviceLineChanges(other.rawOld, other.rawNew), ...lines];
        consumed.add(other.row.id);
      }
    }
    consumed.add(row.id);

    entries.push({
      id: row.id,
      createdAt: row.createdAt,
      changedBy: row.changedBy?.trim() || null,
      title: titleFor(row),
      lines: lines.slice(0, MAX_LINES),
      moreCount: Math.max(0, lines.length - MAX_LINES),
      undone: !!row.undoneAt
    });
  }
  return entries;
}
