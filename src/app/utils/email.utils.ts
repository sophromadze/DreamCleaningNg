/**
 * Email-format checking that explains ITSELF.
 *
 * ## Why this exists (2026-08 incident)
 *
 * An admin registered a customer through the admin panel and typed an address with no `@` in it.
 * The backend rejected it, but the rejection arrived as ASP.NET's automatic model-validation
 * response — a `ValidationProblemDetails` body, which carries an `errors` dictionary and no
 * `message` property. The panel only read `err.error.message`, so what the admin actually saw was
 * the bare transport text:
 *
 *   `Http failure response for https://dreamcleaningnyc.com/api/admin/users/register: 400`
 *
 * Nothing in that names the field, let alone the missing character, and the admin could not see
 * what was wrong with what they had typed.
 *
 * The fix is in three parts and all three are needed:
 *  1. `describeEmailProblem` (here) catches it BEFORE the request is sent and names the actual
 *     defect — a missing `@` says "missing the @ symbol", not "invalid email".
 *  2. `extractApiErrorMessage` (`http-error.utils.ts`) turns any ValidationProblemDetails that
 *     still gets through into readable text, so a 400 is never shown as transport noise again.
 *  3. The backend validates the address itself and answers with `{ message }` like every other
 *     failure branch of that endpoint (see `AdminUsersController.RegisterUser`), so a direct API
 *     call gets the same sentence.
 *
 * This is deliberately NOT a full RFC 5322 implementation. It is a "did a human mistype this"
 * check whose only job is to produce a sentence a non-technical admin can act on; the server
 * remains the authority on whether the address is accepted.
 */

/** The shape shown to the user in every message here. One spelling, one place. */
export const EMAIL_EXAMPLE = 'name@example.com';

/**
 * Final shape check, applied only after the specific checks below have all passed — so it can
 * only ever fire for something exotic (stray `,`, `<`, quotes) that has no dedicated message.
 */
const EMAIL_SHAPE = /^[^\s@,<>()[\];:"]+@[^\s@,<>()[\];:"]+\.[A-Za-z]{2,}$/;

/**
 * Returns a sentence describing what is wrong with `rawEmail`, or `null` when it looks usable.
 *
 * The order of the checks is the point: the FIRST thing wrong with the address is the thing the
 * person needs to be told about. A generic "invalid email address" is exactly the message that
 * failed the admin in the incident above.
 */
export function describeEmailProblem(rawEmail: string | null | undefined): string | null {
  const email = (rawEmail ?? '').trim();

  if (!email) {
    return 'Email address is required.';
  }

  if (/\s/.test(email)) {
    return `Email address cannot contain spaces. It should look like ${EMAIL_EXAMPLE}.`;
  }

  const atCount = (email.match(/@/g) || []).length;
  if (atCount === 0) {
    return `Email address is missing the "@" symbol. It should look like ${EMAIL_EXAMPLE}.`;
  }
  if (atCount > 1) {
    return `Email address has ${atCount} "@" symbols — it should have exactly one, like ${EMAIL_EXAMPLE}.`;
  }

  const [localPart, domain] = email.split('@');

  if (!localPart) {
    return `Email address is missing the part before the "@". It should look like ${EMAIL_EXAMPLE}.`;
  }
  if (!domain) {
    return `Email address is missing the part after the "@" (the domain). It should look like ${EMAIL_EXAMPLE}.`;
  }
  if (!domain.includes('.')) {
    return `Email domain "${domain}" is missing its ending, such as ".com". It should look like ${EMAIL_EXAMPLE}.`;
  }
  if (domain.startsWith('.') || domain.endsWith('.') || domain.includes('..')) {
    return `Email domain "${domain}" does not look right — check the dots. It should look like ${EMAIL_EXAMPLE}.`;
  }

  const tld = domain.slice(domain.lastIndexOf('.') + 1);
  if (!/^[A-Za-z]{2,}$/.test(tld)) {
    return `Email domain "${domain}" does not end in a valid domain ending such as ".com". It should look like ${EMAIL_EXAMPLE}.`;
  }

  if (!EMAIL_SHAPE.test(email)) {
    return `Email address contains characters that are not allowed. It should look like ${EMAIL_EXAMPLE}.`;
  }

  return null;
}

/** Convenience predicate over {@link describeEmailProblem}. */
export function isValidEmailFormat(rawEmail: string | null | undefined): boolean {
  return describeEmailProblem(rawEmail) === null;
}
