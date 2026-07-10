import { Pipe, PipeTransform } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

/**
 * Lightweight markdown-ish rendering for chat messages (assistant/team bubbles in
 * the widget and the admin transcript). No dependency — a few targeted regexes:
 *  - [text](url)  → clickable link
 *  - bare URLs / bare domains (dreamcleaningnyc.com/booking) → clickable links
 *  - **text**     → <span class="chat-em"> (accent COLOR, not bold — design feedback:
 *                    fewer visual asterisks/bold, a color cue instead)
 *
 * SAFETY: the input is fully HTML-escaped BEFORE any tags are injected. All link
 * shapes are converted in ONE combined pass (alternation), so a URL can never be
 * re-matched inside an href it just created. Emphasis runs before links; its span
 * markup contains nothing the link regexes can match. Only then is the result
 * marked trusted — bypassSecurityTrustHtml is safe because every byte of original
 * content went through the escape step.
 */
@Pipe({ name: 'chatMarkdown', standalone: true })
export class ChatMarkdownPipe implements PipeTransform {
  private static readonly Bold = /\*\*([^*]+)\*\*/g;

  // Combined link pass. Alternative 1 (groups 1+2): markdown [label](url).
  // Alternative 2 (no groups): bare http(s) URL. Alternative 3 (no groups): bare
  // domain — word-boundary + common TLD + optional path; the lookbehind blocks
  // emails (name@gmail.com) and mid-word fragments. Conservative on purpose.
  private static readonly Links = new RegExp(
    String.raw`\[([^\]]+)\]\(((?:https?:\/\/)?[^\s)]+)\)` +
    '|' + String.raw`https?:\/\/[^\s<>"')\]]+` +
    '|' + String.raw`(?<![@\w.-])(?:[a-zA-Z0-9-]+\.)+(?:com|net|org|nyc|io|co|us)\b(?:\/[^\s<>"')\]]*)?`,
    'g');

  constructor(private sanitizer: DomSanitizer) {}

  transform(value: string | null | undefined): SafeHtml {
    if (!value) return '';

    // 1. Escape everything — after this, no original character can form a tag.
    let text = value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

    // 2. Emphasis — color cue instead of bold weight.
    text = text.replace(ChatMarkdownPipe.Bold, '<span class="chat-em">$1</span>');

    // 3. Links — single pass over all three shapes.
    text = text.replace(ChatMarkdownPipe.Links, (match, mdLabel?: string, mdUrl?: string) => {
      if (mdLabel !== undefined && mdUrl !== undefined) {
        return this.anchor(mdUrl, mdLabel);
      }
      // Keep sentence punctuation ("…at dreamcleaningnyc.com/booking.") outside the link.
      const trimmed = match.replace(/[.,!?;:]+$/, '');
      return this.anchor(trimmed, trimmed) + match.slice(trimmed.length);
    });

    return this.sanitizer.bypassSecurityTrustHtml(text);
  }

  private anchor(url: string, label: string): string {
    const href = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    return `<a href="${href}" target="_blank" rel="noopener">${label}</a>`;
  }
}
