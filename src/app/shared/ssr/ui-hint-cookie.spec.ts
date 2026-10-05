import {
  ANONYMOUS_UI_HINT, UI_HINT_COOKIE, decodeUiHint, encodeUiHint, hasUiHint, readUiHint, uiHintForUser, writeUiHintCookie
} from './ui-hint-cookie';
import { readCookie } from '../booking/hero-choice-cookie';

describe('dc_ui layout hint', () => {
  afterEach(() => writeUiHintCookie(document, ANONYMOUS_UI_HINT));

  it('round-trips every combination', () => {
    for (const admin of [false, true]) for (const pointsBadge of [false, true]) {
      const hint = { signedIn: true, admin, pointsBadge };
      expect(decodeUiHint(encodeUiHint(hint))).toEqual(hint);
    }
  });

  it('carries nothing about the welcome offer any more (2026-10)', () => {
    expect(Object.keys(decodeUiHint('ua')).sort()).toEqual(['admin', 'pointsBadge', 'signedIn']);
    expect(encodeUiHint({ signedIn: true, admin: false, pointsBadge: true })).toBe('u');
    expect(encodeUiHint({ signedIn: true, admin: true, pointsBadge: false })).toBe('uan');
  });

  it('a signed-in visitor has the points badge unless the points system said off', () => {
    expect(decodeUiHint('u').pointsBadge).toBe(true);
    expect(decodeUiHint('ua').pointsBadge).toBe(true);
    expect(decodeUiHint('un').pointsBadge).toBe(false);
  });

  it('still reads the first release\'s "u[a][f][b]" cookies as signed in, so nobody renders anonymous for a visit', () => {
    for (const legacy of ['ufb', 'uafb', 'ub', 'uab', 'uf', 'uaf']) {
      const hint = decodeUiHint(legacy);
      expect(hint.signedIn, legacy).toBe(true);
      expect(hint.admin, legacy).toBe(legacy.startsWith('ua'));
      expect(hint.pointsBadge, legacy).toBe(true);
    }
  });

  it('reads anything unexpected as anonymous', () => {
    for (const raw of [null, '', 'x', 'ua1', 'UAFB', 'ubfa', 'una', 'u a', '%75', '<script>']) {
      expect(decodeUiHint(raw as any), String(raw)).toEqual(ANONYMOUS_UI_HINT);
    }
    expect(encodeUiHint(ANONYMOUS_UI_HINT)).toBeNull();
  });

  it('finds the hint among other cookies', () => {
    expect(readUiHint('a=1; dc_ui=un; dc_hero_choice=1.1.n.-.')).toEqual(
      { signedIn: true, admin: false, pointsBadge: false });
    expect(hasUiHint('a=1')).toBe(false);
    expect(hasUiHint('dc_ui=u')).toBe(true);
  });

  it('derives the hint from the role and the badge state only', () => {
    expect(uiHintForUser({ role: 'Admin' }, true)).toEqual({ signedIn: true, admin: true, pointsBadge: true });
    expect(uiHintForUser({ role: 'SuperAdmin' }, false).admin).toBe(true);
    expect(uiHintForUser({ role: 'Moderator' }, false).admin).toBe(false);
    expect(uiHintForUser(null, true)).toEqual(ANONYMOUS_UI_HINT);
  });

  it('writes and deletes the browser cookie', () => {
    writeUiHintCookie(document, { signedIn: true, admin: true, pointsBadge: false });
    expect(readCookie(document.cookie, UI_HINT_COOKIE)).toBe('uan');
    writeUiHintCookie(document, ANONYMOUS_UI_HINT);
    expect(readCookie(document.cookie, UI_HINT_COOKIE)).toBeNull();
  });
});
