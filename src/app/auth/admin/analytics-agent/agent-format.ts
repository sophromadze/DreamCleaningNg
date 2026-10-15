/** Value formats the analytics agent's charts and tables use (the tools' `format` field). */
export type AgentValueFormat = 'currency' | 'count' | 'percent' | 'number' | 'text' | 'date';

const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const moneyShort = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const count = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const number = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });

/**
 * Formats one value for display. Percent values arrive AS percentages (12.5 = 12.5%), which is
 * what the tool schema tells the model. `short` drops cents for axis ticks.
 */
export function formatAgentValue(value: unknown, format: AgentValueFormat | null | undefined, short = false): string {
  if (value === null || value === undefined || value === '') return '—';
  if (format === 'text' || format === 'date' || !format) return String(value);
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return String(value);
  switch (format) {
    case 'currency': return short ? moneyShort.format(n) : money.format(n);
    case 'count': return count.format(n);
    case 'percent': return `${number.format(n)}%`;
    default: return number.format(n);
  }
}

/** "$0.0123" — the running cost estimate, with enough digits to be non-zero for small chats. */
export function formatCostUsd(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  if (value === 0) return '$0.00';
  return value < 0.01 ? `$${value.toFixed(4)}` : `$${value.toFixed(2)}`;
}

/** 12345 → "12.3k". */
export function formatTokens(value: number): string {
  if (value < 1000) return String(value);
  if (value < 1_000_000) return `${(value / 1000).toFixed(1)}k`;
  return `${(value / 1_000_000).toFixed(2)}M`;
}
