import { loadBookingSession, readAccessToken } from './ssr-booking-session';

const TOKEN = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiI3MSJ9.c2lnbmF0dXJl';
const PROFILE = { id: 71, firstName: 'Nate', lastName: 'Returning', email: 'nate@example.invalid', phone: '7185550199',
  role: 'Customer', firstTimeOrder: false, loyaltyDiscountPercentage: 5, apartments: [{ id: 1, address: '1 Main St' }] };

describe('loadBookingSession (server render of a signed-in /booking)', () => {
  let calls: { url: string; headers: Record<string, string> }[];
  let answers: Record<string, () => Promise<Response>>;
  const json = (body: unknown, status = 200) => () => Promise.resolve(new Response(JSON.stringify(body), { status }));
  const fetchImpl = ((url: string, init: RequestInit) => {
    calls.push({ url, headers: init.headers as Record<string, string> });
    const path = url.replace('http://backend', '');
    return (answers[path] ?? json({ message: 'nope' }, 404))();
  }) as unknown as typeof fetch;
  const load = (cookie: string | null, timeoutMs?: number) =>
    loadBookingSession('http://backend', cookie, { fetchImpl, timeoutMs });

  beforeEach(() => {
    calls = [];
    answers = {
      '/api/profile': json(PROFILE),
      '/api/profile/special-offers': json([{ id: 3, name: 'Welcome back' }]),
      '/api/booking/user-subscription': json({ hasSubscription: false, preferredSubscriptionId: 4 }),
      '/api/bubble-points/summary': json({ pointsSystemEnabled: true, currentPoints: 260 }),
      '/api/order': json([{ id: 9, isCustomServiceType: true }, { id: 10, isCustomServiceType: false }]),
      '/api/admin/permissions': json({ permissions: { canCreate: true } })
    };
  });

  it('asks nothing for a guest (no access_token)', async () => {
    expect(await load(null)).toBeNull();
    expect(await load('dc_ui=u; refresh_token=abc')).toBeNull();
    expect(calls).toEqual([]);
  });

  it('forwards ONLY the access_token cookie - never refresh_token or anything else', async () => {
    await load(`dc_ui=u; refresh_token=REFRESH; access_token=${TOKEN}; dc_attribution=x`);

    expect(calls.length).toBe(5);
    for (const call of calls) {
      expect(call.headers['Cookie']).toBe(`access_token=${TOKEN}`);
      expect(JSON.stringify(call.headers)).not.toContain('REFRESH');
    }
  });

  it('collapses the profile, plan, offers, points and orders into one booking context', async () => {
    const session = await load(`access_token=${TOKEN}`);

    expect(session).toEqual({
      user: { id: 71, firstName: 'Nate', lastName: 'Returning', email: 'nate@example.invalid', phone: '7185550199', role: 'Customer', firstTimeOrder: false },
      loyaltyDiscountPercentage: 5,
      specialOffers: [{ id: 3, name: 'Welcome back' }],
      subscription: { hasSubscription: false, preferredSubscriptionId: 4 },
      points: { pointsSystemEnabled: true, currentPoints: 260 },
      hasPreviousOrders: true,
      canRegisterCustomers: false
    });
    // The order list is reduced to a flag and the saved addresses never leave the server.
    expect(JSON.stringify(session)).not.toContain('Main St');
  });

  it('asks for staff permissions only for a staff account', async () => {
    answers['/api/profile'] = json({ ...PROFILE, role: 'Admin' });

    const session = await load(`access_token=${TOKEN}`);

    expect(session!.canRegisterCustomers).toBe(true);
    expect(calls.map(c => c.url)).toContain('http://backend/api/admin/permissions');
  });

  it('renders as a guest when the session is expired, revoked or refused', async () => {
    answers['/api/profile'] = json({ message: 'Unauthorized' }, 401);

    expect(await load(`access_token=${TOKEN}`)).toBeNull();
  });

  it('leaves a part that failed to the browser (null), keeping the rest', async () => {
    answers['/api/profile/special-offers'] = json('down', 503);
    answers['/api/order'] = () => Promise.reject(new Error('socket hang up'));

    const session = await load(`access_token=${TOKEN}`);

    expect(session!.user.id).toBe(71);
    expect(session!.specialOffers).toBeNull();
    expect(session!.hasPreviousOrders).toBeNull();
    expect(session!.points).not.toBeNull();
  });

  it('never waits past its deadline: a hung profile call renders as a guest', async () => {
    answers['/api/profile'] = () => new Promise(() => {});
    const hanging = ((url: string, init: RequestInit) => new Promise<Response>((_, reject) => {
      calls.push({ url, headers: init.headers as Record<string, string> });
      init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
    })) as unknown as typeof fetch;

    const started = Date.now();
    const session = await loadBookingSession('http://backend', `access_token=${TOKEN}`, { fetchImpl: hanging, timeoutMs: 50 });

    expect(session).toBeNull();
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('only accepts a token shaped like a JWT', () => {
    expect(readAccessToken(`access_token=${TOKEN}`)).toBe(TOKEN);
    expect(readAccessToken('access_token=abc')).toBeNull();
    expect(readAccessToken('access_token=a.b.c%0D%0AX-Evil:1')).toBeNull();
    expect(readAccessToken('access_token=a b.c.d')).toBeNull();
  });
});
