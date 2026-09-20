import { Component, Inject, Input, PLATFORM_ID } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';

/**
 * "Refer a Friend" — the invite link + code card, with its copy and share actions.
 *
 * ONE implementation, used by the Rewards page and by the profile Overview tab. It is
 * deliberately presentational: each host already knows the customer's code (Rewards from its
 * summary, the profile from `GET api/referral/my-code`), so the card takes it as an input
 * rather than fetching a second time from inside a component that can be rendered twice.
 *
 * It renders NOTHING without a code — a referral box with an empty value reads as a fault, and
 * a host that could not load one (rewards disabled, request failed) simply has nothing to show.
 */
@Component({
  selector: 'app-refer-a-friend',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './refer-a-friend.component.html',
  styleUrl: './refer-a-friend.component.scss'
})
export class ReferAFriendComponent {
  /** The customer's referral code. Empty/absent hides the whole card. */
  @Input() code: string | null | undefined;

  /**
   * The invite URL the API handed back. Only used when it is absolute — a relative or missing
   * value falls back to the current origin, which is what makes the card usable in local dev.
   */
  @Input() shareUrl: string | null | undefined;

  /**
   * Named `heading` rather than `title`: an input called `title` collides with the host
   * element's own title attribute, which is how a component ends up with a tooltip nobody
   * asked for.
   */
  @Input() heading = 'Refer a Friend';
  @Input() hint =
    'Both of you get a reward — your friend gets bonus points when they sign up, and you earn a reward balance when they complete their first cleaning.';

  /** Which control just copied: 'link' | 'code' — for button feedback */
  copyFeedback: 'link' | 'code' | null = null;

  private readonly isBrowser: boolean;

  constructor(@Inject(PLATFORM_ID) platformId: Object) {
    this.isBrowser = isPlatformBrowser(platformId);
  }

  get hasCode(): boolean {
    return !!this.code?.trim();
  }

  /** Full invite URL; uses the API value when it is absolute, otherwise the current origin. */
  getReferralShareUrl(): string {
    const code = this.code?.trim();
    if (!code) return '';
    const fromApi = this.shareUrl?.trim() ?? '';
    if (/^https?:\/\//i.test(fromApi)) {
      return fromApi;
    }
    if (this.isBrowser && typeof window !== 'undefined') {
      return `${window.location.origin}/?ref=${encodeURIComponent(code)}`;
    }
    return fromApi;
  }

  copyReferralLink(): void {
    const url = this.getReferralShareUrl();
    if (!url) return;
    navigator.clipboard.writeText(url).then(() => {
      this.copyFeedback = 'link';
      setTimeout(() => (this.copyFeedback = null), 2000);
    });
  }

  copyReferralCode(): void {
    const code = this.code?.trim();
    if (!code) return;
    navigator.clipboard.writeText(code).then(() => {
      this.copyFeedback = 'code';
      setTimeout(() => (this.copyFeedback = null), 2000);
    });
  }

  shareReferralLink(): void {
    const url = this.getReferralShareUrl();
    if (!url) return;
    if (navigator.share) {
      navigator.share({
        title: 'Dream Cleaning — Bubble Rewards',
        text: 'Get a bonus when you book your first cleaning with Dream Cleaning!',
        url
      });
    } else {
      this.copyReferralLink();
    }
  }

  shareReferralCode(): void {
    const code = this.code?.trim();
    if (!code) return;
    if (navigator.share) {
      navigator.share({ text: code });
    } else {
      this.copyReferralCode();
    }
  }
}
