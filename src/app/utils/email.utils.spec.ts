import { describeEmailProblem, isValidEmailFormat, EMAIL_EXAMPLE } from './email.utils';

/**
 * The point of these specs is the WORDING, not just the accept/reject verdict.
 *
 * The 2026-08 incident was not that a bad address got through — it was correctly rejected. It was
 * that the admin was told "Http failure response for .../users/register: 400" and therefore could
 * not see that the address they had typed was missing its "@". A check that says only "invalid
 * email" would have failed them the same way, so each case below asserts that the message names
 * the actual defect.
 */
describe('describeEmailProblem', () => {
  it('accepts ordinary addresses', () => {
    for (const email of [
      'john@example.com',
      'JOHN.DOE+tag@sub.example.co.uk',
      'a_b-c@example.io',
      "  spaced@example.com  "  // surrounding whitespace is trimmed, not an error
    ]) {
      expect(describeEmailProblem(email)).withContext(email).toBeNull();
      expect(isValidEmailFormat(email)).withContext(email).toBeTrue();
    }
  });

  // ── The exact incident ──
  it('names the missing "@" — the mistake the admin actually made', () => {
    const problem = describeEmailProblem('johnexample.com');

    expect(problem).toContain('@');
    expect(problem).toContain('missing');
    expect(problem).toContain(EMAIL_EXAMPLE);
  });

  it('never answers with a bare "invalid email"', () => {
    // Anything an admin can mistype must come back with a sentence naming the defect.
    for (const email of ['johnexample.com', 'john@@example.com', '@example.com', 'john@', 'john@example', 'jo hn@example.com']) {
      const problem = describeEmailProblem(email);

      expect(problem).withContext(email).toBeTruthy();
      expect(problem!.toLowerCase()).withContext(email).not.toBe('invalid email address.');
      expect(problem).withContext(email).toContain(EMAIL_EXAMPLE);
    }
  });

  it('reports an empty address as required, not as malformed', () => {
    for (const value of ['', '   ', null, undefined]) {
      expect(describeEmailProblem(value as any)).toBe('Email address is required.');
    }
  });

  it('counts duplicate "@" symbols', () => {
    expect(describeEmailProblem('john@@example.com')).toContain('2 "@" symbols');
  });

  it('names a missing local part', () => {
    expect(describeEmailProblem('@example.com')).toContain('before the "@"');
  });

  it('names a missing domain', () => {
    expect(describeEmailProblem('john@')).toContain('after the "@"');
  });

  it('names a domain with no ending', () => {
    const problem = describeEmailProblem('john@example');

    expect(problem).toContain('example');
    expect(problem).toContain('.com');
  });

  it('rejects malformed dots in the domain', () => {
    expect(describeEmailProblem('john@example..com')).toContain('check the dots');
    expect(describeEmailProblem('john@.example.com')).toContain('check the dots');
    expect(describeEmailProblem('john@example.com.')).toContain('check the dots');
  });

  it('rejects a numeric or one-letter domain ending', () => {
    expect(describeEmailProblem('john@example.c')).toContain('domain ending');
    expect(describeEmailProblem('john@example.123')).toContain('domain ending');
  });

  it('rejects spaces anywhere in the address', () => {
    expect(describeEmailProblem('jo hn@example.com')).toContain('spaces');
  });

  it('rejects characters that cannot appear in an address', () => {
    expect(describeEmailProblem('john<doe@example.com')).toContain('not allowed');
    expect(describeEmailProblem('john,doe@example.com')).toContain('not allowed');
  });
});
