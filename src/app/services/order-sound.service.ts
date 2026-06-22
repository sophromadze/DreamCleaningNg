import { Injectable, Inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

/**
 * Plays short, synthesized confirmation sounds via the Web Audio API (no audio
 * files to host). Three distinct cues:
 *   - playFormSubmit()      — quote form submitted (Shiny Sparkle)
 *   - playBookingConfirmed() — payment confirmed / order created (Bubbly Success)
 *   - playNewOrderAdmin()   — admin hears a new order arrive (Bubble Trio)
 *
 * All synthesis stays in this service so callers just pick a cue. SSR-safe:
 * every entry point no-ops when not running in the browser.
 */
@Injectable({ providedIn: 'root' })
export class OrderSoundService {
  private isBrowser: boolean;
  private ctx: AudioContext | null = null;

  constructor(@Inject(PLATFORM_ID) private platformId: Object) {
    this.isBrowser = isPlatformBrowser(this.platformId);
  }

  // ---- public cues ---------------------------------------------------------

  /** Quote form submitted — soft glistening twinkle. */
  playFormSubmit(): void {
    const ctx = this.getCtx();
    if (!ctx) return;
    const C5 = 523, E5 = 659, G5 = 784, C6 = 1046;
    this.tone(ctx, 'sine', C6, 0, 0.5, 0.14);
    this.tone(ctx, 'sine', G5, 0.1, 0.5, 0.16);
    this.tone(ctx, 'sine', E5, 0.2, 0.6, 0.18);
    this.tone(ctx, 'sine', C5, 0.3, 0.9, 0.2); // warm landing
  }

  /** Payment confirmed / order created — rising bubbles into a warm chord. */
  playBookingConfirmed(): void {
    const ctx = this.getCtx();
    if (!ctx) return;
    const C4 = 262, E4 = 330, G4 = 392, C5 = 523, E5 = 659;
    this.bubble(ctx, G4, 0, 0.26);
    this.bubble(ctx, C5, 0.1, 0.26);
    this.bubble(ctx, E5, 0.2, 0.26);
    this.chord(ctx, 'sine', [C4, E4, G4], 0.34, 1.0, 0.16);
  }

  /** New order arrived (admin) — three rising bubble pops. */
  playNewOrderAdmin(): void {
    const ctx = this.getCtx();
    if (!ctx) return;
    const F4 = 349, A4 = 440, C5 = 523;
    this.bubble(ctx, F4, 0, 0.28);
    this.bubble(ctx, A4, 0.12, 0.28);
    this.bubble(ctx, C5, 0.24, 0.3);
  }

  // ---- audio context -------------------------------------------------------

  private getCtx(): AudioContext | null {
    if (!this.isBrowser) return null;
    if (!this.ctx) {
      const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
      if (!Ctx) return null;
      this.ctx = new Ctx();
    }
    // Autoplay policy may leave the context suspended until a user gesture.
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  // ---- synthesis helpers ---------------------------------------------------

  /** A single tone with a soft, rounded attack and a long gentle release. */
  private tone(
    ctx: AudioContext,
    type: OscillatorType,
    freq: number,
    start: number,
    duration: number,
    peak = 0.3
  ): void {
    const t0 = ctx.currentTime + start;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(peak, t0 + 0.06);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + duration + 0.05);
  }

  /** Several frequencies played together at the same start time. */
  private chord(
    ctx: AudioContext,
    type: OscillatorType,
    freqs: number[],
    start: number,
    duration: number,
    peak = 0.22
  ): void {
    freqs.forEach(f => this.tone(ctx, type, f, start, duration, peak));
  }

  /** A "bubble" pop: a quick upward pitch blip with a short, soft envelope. */
  private bubble(ctx: AudioContext, baseFreq: number, start: number, peak = 0.3): void {
    const t0 = ctx.currentTime + start;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(baseFreq, t0);
    osc.frequency.exponentialRampToValueAtTime(baseFreq * 2.2, t0 + 0.07);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(peak, t0 + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.14);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + 0.18);
  }
}
