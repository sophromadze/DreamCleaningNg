import { extractApiErrorMessage } from './http-error.utils';

const FALLBACK = 'Registration failed. Please try again.';

describe('extractApiErrorMessage', () => {
  it('reads our own BadRequest(new { message }) shape', () => {
    const err = { status: 400, message: 'Http failure response for /api/x: 400', error: { message: 'Phone is required.' } };

    expect(extractApiErrorMessage(err, FALLBACK)).toBe('Phone is required.');
  });

  /**
   * The regression this file exists for. `[ApiController]` model validation answers with a
   * ValidationProblemDetails — an `errors` dictionary and NO `message` — so the old
   * `err.error?.message || err.message` fell through to Angular's transport text and the admin
   * was shown "Http failure response for .../users/register: 400".
   */
  it('reads an ASP.NET ValidationProblemDetails instead of falling back to the transport text', () => {
    const err = {
      status: 400,
      message: 'Http failure response for https://dreamcleaningnyc.com/api/admin/users/register: 400',
      error: {
        type: 'https://tools.ietf.org/html/rfc7231#section-6.5.1',
        title: 'One or more validation errors occurred.',
        status: 400,
        errors: { Email: ['The Email field is not a valid e-mail address.'] }
      }
    };

    const message = extractApiErrorMessage(err, FALLBACK);

    expect(message).toContain('not a valid e-mail address');
    expect(message).not.toContain('Http failure response');
  });

  it('prefixes the field name when the message does not already name it', () => {
    const err = { status: 400, error: { errors: { Phone: ['Must be 10 digits.'] } } };

    expect(extractApiErrorMessage(err, FALLBACK)).toBe('Phone: Must be 10 digits.');
  });

  it('joins several validation errors into one sentence', () => {
    const err = {
      status: 400,
      error: { errors: { FirstName: ['The FirstName field is required.'], LastName: ['The LastName field is required.'] } }
    };

    const message = extractApiErrorMessage(err, FALLBACK);

    expect(message).toContain('FirstName field is required');
    expect(message).toContain('LastName field is required');
  });

  it('strips a dto. prefix from the field path', () => {
    const err = { status: 400, error: { errors: { 'dto.Email': ['Bad.'] } } };

    expect(extractApiErrorMessage(err, FALLBACK)).toBe('Email: Bad.');
  });

  it('falls back to the generic title when there is nothing more specific', () => {
    const err = { status: 400, error: { title: 'One or more validation errors occurred.', errors: {} } };

    expect(extractApiErrorMessage(err, FALLBACK)).toBe('One or more validation errors occurred.');
  });

  it('accepts a plain-text body', () => {
    expect(extractApiErrorMessage({ status: 500, error: 'Something broke.' }, FALLBACK)).toBe('Something broke.');
  });

  it('ignores an HTML error page — a gateway page is not a message for a user', () => {
    const err = { status: 502, error: '<!DOCTYPE html><html><body>Bad Gateway</body></html>' };

    expect(extractApiErrorMessage(err, FALLBACK)).toBe(FALLBACK);
  });

  it('never returns the Angular transport text', () => {
    const err = { status: 0, message: 'Http failure response for /api/admin/users/register: 0 Unknown Error', error: null };

    expect(extractApiErrorMessage(err, FALLBACK)).toBe(FALLBACK);
  });

  it('survives a null or undefined error', () => {
    expect(extractApiErrorMessage(null, FALLBACK)).toBe(FALLBACK);
    expect(extractApiErrorMessage(undefined, FALLBACK)).toBe(FALLBACK);
  });

  it('truncates a runaway body', () => {
    const err = { status: 400, error: { message: 'x'.repeat(1000) } };

    expect(extractApiErrorMessage(err, FALLBACK).length).toBeLessThanOrEqual(400);
  });
});
