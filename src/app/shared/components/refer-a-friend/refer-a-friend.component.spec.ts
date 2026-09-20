import { TestBed } from '@angular/core/testing';

import { testProviders } from '../../../../testing/test-providers';
import { ReferAFriendComponent } from './refer-a-friend.component';

/**
 * The shared Refer a Friend card — rendered by the Rewards page AND by the profile Overview tab,
 * which is the whole point: one copy of the wording, the link and the copy/share behaviour.
 */
describe('ReferAFriendComponent', () => {
  beforeEach(() => TestBed.configureTestingModule({ providers: [...testProviders] }));

  const mount = (code: string | null, shareUrl = '') => {
    const f = TestBed.createComponent(ReferAFriendComponent);
    f.componentInstance.code = code;
    f.componentInstance.shareUrl = shareUrl;
    f.detectChanges();
    return f;
  };

  it('renders nothing at all without a code', () => {
    // A host that could not load one (request failed, rewards off) must not get an empty box
    // under a "Refer a Friend" heading — that reads as a rendering fault.
    const f = mount(null);
    expect(f.nativeElement.querySelector('.referral-hero')).toBeNull();
  });

  it('shows the code and its link once there is one', () => {
    const f = mount('ABC123', 'https://dreamcleaningnyc.com/?ref=ABC123');
    const text = f.nativeElement.textContent as string;
    expect(f.nativeElement.querySelector('.referral-hero')).not.toBeNull();
    expect(text).toContain('ABC123');
    expect(f.componentInstance.getReferralShareUrl()).toBe('https://dreamcleaningnyc.com/?ref=ABC123');
  });

  it('falls back to the current origin when the API URL is not absolute', () => {
    // Local dev returns a relative/absent share URL; a link the customer cannot open is worse
    // than one pointing at the site they are already on.
    const f = mount('ABC123', '/?ref=ABC123');
    expect(f.componentInstance.getReferralShareUrl()).toBe(`${window.location.origin}/?ref=ABC123`);
  });
});
