/**
 * Turns an `HttpErrorResponse` into a sentence a human can act on.
 *
 * ## Why this exists (2026-08 incident — see also `email.utils.ts`)
 *
 * ASP.NET has TWO error shapes and our code only ever read one of them:
 *
 *  - Our own hand-written failures: `return BadRequest(new { message = "..." })` → `err.error.message`.
 *  - `[ApiController]` automatic model validation (a `[Required]`, `[EmailAddress]`,
 *    `[StringLength]` that fails): a `ValidationProblemDetails` → `{ title, status, errors:
 *    { FieldName: ["..."] } }`, with **no `message` property at all**.
 *
 * `err.error?.message || err.message` therefore fell through to `err.message`, which is Angular's
 * transport text — `"Http failure response for <url>: 400"`. That is what an admin was shown
 * after mistyping an email address, and it told them nothing.
 *
 * Reading the `errors` dictionary is what makes the second shape legible. `err.message` is
 * deliberately never returned: it is never about the user's input.
 */

/** Hard cap so a runaway server body can't blow out a modal. */
const MAX_MESSAGE_LENGTH = 400;

/**
 * @param err      the error handed to an RxJS `error:` callback (usually an `HttpErrorResponse`)
 * @param fallback what to say when the response carried nothing readable
 */
export function extractApiErrorMessage(err: any, fallback: string): string {
  const body = err?.error;

  // Plain-text / already-parsed-string body. HTML (a proxy or gateway error page) is not
  // something to show a user, so it falls through to the fallback.
  if (typeof body === 'string') {
    const text = body.trim();
    if (text && !text.startsWith('<')) return truncate(text);
  }

  if (body && typeof body === 'object') {
    // Our own `BadRequest(new { message = ... })` shape.
    const message = pickString(body.message) ?? pickString(body.detail) ?? pickString(body.error);
    if (message) return truncate(message);

    // ValidationProblemDetails: { errors: { Email: ["The Email field is not a valid e-mail address."] } }
    const fromValidation = flattenValidationErrors(body.errors);
    if (fromValidation) return truncate(fromValidation);

    // `title` is the generic "One or more validation errors occurred." — worth showing only when
    // there was nothing more specific, since it at least says the input was rejected.
    const title = pickString(body.title);
    if (title) return truncate(title);
  }

  return fallback;
}

/**
 * Joins every message in a validation dictionary into one sentence, prefixing the field name
 * when the message doesn't already name it (ASP.NET's default text does; a custom one may not).
 */
function flattenValidationErrors(errors: any): string | null {
  if (!errors || typeof errors !== 'object') return null;

  const parts: string[] = [];
  for (const field of Object.keys(errors)) {
    const raw = errors[field];
    const messages: string[] = Array.isArray(raw)
      ? raw.filter((m): m is string => typeof m === 'string')
      : typeof raw === 'string' ? [raw] : [];

    for (const message of messages) {
      const text = message.trim();
      if (!text) continue;
      // `field` is "" for model-level errors, and can be a path like "dto.Email".
      const label = field.split('.').pop() ?? '';
      parts.push(label && !text.toLowerCase().includes(label.toLowerCase()) ? `${label}: ${text}` : text);
    }
  }

  return parts.length ? parts.join(' ') : null;
}

function pickString(value: any): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function truncate(text: string): string {
  return text.length > MAX_MESSAGE_LENGTH ? `${text.slice(0, MAX_MESSAGE_LENGTH - 1)}…` : text;
}
