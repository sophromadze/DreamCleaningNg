import {
  AfterViewInit, Component, ElementRef, EventEmitter, Input, OnDestroy, Output, ViewChild, inject
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { ContractSignatureMethod } from '../../../services/contract.service';
import { ThemeService } from '../../../services/theme.service';

/** What a completed capture hands back. Shape matches SignContractRequest's signing fields. */
export interface CapturedSignature {
  signerName: string;
  signerTitle?: string;
  signerEmail?: string;
  signatureMethod: ContractSignatureMethod;
  /** PNG data URI for Draw, the typed name for Type. */
  signatureData: string;
  consentAccepted: true;
}

/**
 * Draw-or-type signature capture with its consent gate.
 *
 * Shared by all three signing routes — the public token page, a CEO/CTO signing inside the admin
 * panel, and a business customer in their own portal — because the evidence they produce is meant
 * to be indistinguishable except for the channel it was captured on. That includes the consent
 * wording, which is a legal statement and must read identically wherever it is shown.
 *
 * The component validates and emits; it never talks to the API. Each host posts to its own
 * endpoint, which is what keeps the three authorization models separate.
 */
@Component({
  selector: 'app-signature-capture',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './signature-capture.component.html',
  styleUrls: ['./signature-capture.component.scss']
})
export class SignatureCaptureComponent implements AfterViewInit, OnDestroy {
  @ViewChild('padCanvas') padCanvas?: ElementRef<HTMLCanvasElement>;

  @Input() signerName = '';
  @Input() signerTitle = '';
  @Input() signerEmail = '';

  /** Locked for a contractor signer: identity comes from the contractor profile, not the form. */
  @Input() nameLocked = false;
  @Input() titleLocked = false;

  /** Hidden where the host already knows the address (an authenticated session). */
  @Input() showEmailField = true;

  /**
   * The consent a signer is agreeing to. Names the three things that make an electronic signature
   * binding — that they read it, accept the terms, and intend the mark above to be their
   * signature. The server sends the same wording on the token page; this default covers the two
   * authenticated hosts.
   */
  @Input() consentText =
    'I have reviewed this Agreement, agree to its terms, and adopt the signature above as my ' +
    'electronic signature with the intent to be legally bound.';

  @Input() submitLabel = 'Sign agreement';
  @Input() submitting = false;

  /** Surfaced by the host after a failed POST, so errors render in one place. */
  @Input() errorMessage = '';

  @Output() signed = new EventEmitter<CapturedSignature>();

  method: ContractSignatureMethod = ContractSignatureMethod.Type;
  consentAccepted = false;
  validationError = '';

  private typedOverride: string | null = null;

  /**
   * Defaults to the known signer name until the person types something, WITHOUT writing that
   * default into state during a lifecycle hook — seeding it in ngAfterViewInit mutated a bound
   * value after the view had been checked and threw NG0100.
   */
  get typedSignature(): string {
    return this.typedOverride ?? this.signerName ?? '';
  }
  set typedSignature(value: string) {
    this.typedOverride = value;
  }

  /**
   * Which mark the signer is adopting, said in the terms the consent checkbox below then refers
   * to. Switches with the toggle so the two never disagree about what "the signature above" is.
   */
  get modeCaption(): string {
    return this.method === ContractSignatureMethod.Draw
      ? 'The signature drawn above will be adopted as your electronic signature.'
      : 'The typed name above will be adopted as your electronic signature.';
  }

  readonly ContractSignatureMethod = ContractSignatureMethod;

  /**
   * What a signature is STORED as, whatever the screen is doing. The mark is stamped into the
   * executed PDF, which is a white page — sending the white ink a dark-mode admin actually drew
   * with would file an agreement with an empty signature box.
   */
  private static readonly ExportInk = '#111827';

  private drawing = false;
  private hasDrawnStrokes = false;
  private context: CanvasRenderingContext2D | null = null;
  private resizeObserver?: ResizeObserver;
  private themeSub?: Subscription;

  private theme = inject(ThemeService);
  private host = inject(ElementRef<HTMLElement>);

  ngAfterViewInit(): void {
    this.prepareCanvas();
    // The pad used to force a white ground so its fixed near-black ink stayed visible at night,
    // which left a white box sitting next to a dark typed-signature field. It now follows the
    // theme like every other input, and the ink follows with it.
    this.themeSub = this.theme.theme$.subscribe(() => this.applyInk());
  }

  ngOnDestroy(): void {
    this.resizeObserver?.disconnect();
    this.themeSub?.unsubscribe();
  }

  /** The colour the pad draws in ON SCREEN — the typed field's text colour, so the two modes match. */
  private screenInk(): string {
    const fallback = this.theme.isDark ? '#f8fafc' : SignatureCaptureComponent.ExportInk;
    if (typeof getComputedStyle === 'undefined') return fallback;

    const token = getComputedStyle(this.host.nativeElement)
      .getPropertyValue('--text-primary').trim();
    return token || fallback;
  }

  /**
   * Sets the ink for the next stroke and repaints anything already drawn in it.
   *
   * `source-in` keeps every pixel's alpha and replaces only its colour, so a half-finished
   * signature survives a theme flip with its antialiased edges intact — which redrawing from a
   * stored image would not.
   */
  private applyInk(): void {
    const canvas = this.padCanvas?.nativeElement;
    const ctx = this.context;
    const ink = this.screenInk();

    if (ctx) ctx.strokeStyle = ink;
    if (!canvas || !ctx || !this.hasDrawnStrokes) return;

    ctx.globalCompositeOperation = 'source-in';
    ctx.fillStyle = ink;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.globalCompositeOperation = 'source-over';
  }

  /**
   * The pad's strokes as a PNG, forced to `ExportInk`. Exporting the canvas as drawn would send
   * whatever the screen was showing, and that is theme-dependent.
   */
  private exportMark(): string {
    const canvas = this.padCanvas!.nativeElement;
    const out = document.createElement('canvas');
    out.width = canvas.width;
    out.height = canvas.height;

    const ctx = out.getContext('2d');
    if (!ctx) return canvas.toDataURL('image/png');

    ctx.drawImage(canvas, 0, 0);
    ctx.globalCompositeOperation = 'source-in';
    ctx.fillStyle = SignatureCaptureComponent.ExportInk;
    ctx.fillRect(0, 0, out.width, out.height);

    return out.toDataURL('image/png');
  }

  // ── signature pad ──────────────────────────────────────────────────────────

  /**
   * Sizes the canvas bitmap to its CSS box and keeps the two in step.
   *
   * The bitmap is measured EVERY time this runs rather than once, and a ResizeObserver re-runs it
   * whenever the element's box changes. That is the fix for the drawing appearing offset from the
   * pointer: the canvas is laid out fluid (`width: 100%`), so its CSS width changes with the
   * viewport, a sidebar opening, or an error banner appearing above it — and a bitmap sized once
   * at mount then no longer matches, which the browser resolves by scaling the bitmap into the
   * box. Every drawn point then lands at `x · (cssWidth / bitmapCssWidth)`, i.e. shifted, and
   * increasingly so the further right you draw.
   */
  private prepareCanvas(): void {
    const canvas = this.padCanvas?.nativeElement;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    // Zero while the element is display:none — nothing to size yet; the observer will call back.
    if (rect.width === 0 || rect.height === 0) return;

    const ratio = window.devicePixelRatio || 1;
    const targetWidth = Math.round(rect.width * ratio);
    const targetHeight = Math.round(rect.height * ratio);

    if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
      // Resizing a canvas clears it, so anything already drawn is captured and put back.
      const previous = this.hasDrawnStrokes ? canvas.toDataURL('image/png') : null;

      canvas.width = targetWidth;
      canvas.height = targetHeight;

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      // Deliberately NO ctx.scale(ratio): that bakes the ratio in at setup time, so a later
      // change to the box or to devicePixelRatio (moving windows between monitors, browser zoom)
      // silently desynchronises input from output. Coordinates are converted per-event instead,
      // from the live rect, which cannot drift.
      ctx.lineWidth = 2 * ratio;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = this.screenInk();
      this.context = ctx;

      if (previous) {
        const image = new Image();
        image.onload = () => {
          ctx.drawImage(image, 0, 0, targetWidth, targetHeight);
          // The snapshot carries whatever ink was current when it was taken. If the theme flipped
          // during the resize, this async redraw would otherwise land after applyInk and put the
          // old colour back.
          this.applyInk();
        };
        image.src = previous;
      }
    }

    this.observeResize(canvas);
  }

  private observeResize(canvas: HTMLCanvasElement): void {
    if (this.resizeObserver || typeof ResizeObserver === 'undefined') return;
    this.resizeObserver = new ResizeObserver(() => this.prepareCanvas());
    this.resizeObserver.observe(canvas);
  }

  /**
   * Converts a pointer position into BITMAP coordinates.
   *
   * `clientX/clientY` are viewport-relative, so the canvas's own offset has to come off first —
   * and then the result has to be scaled by the ratio between the bitmap and its rendered size.
   * Reading that ratio from the live rect on every event is what makes this correct for a mouse,
   * a trackpad or a touch, at any zoom or device pixel ratio, even mid-gesture.
   */
  private pointOf(event: PointerEvent): { x: number; y: number } {
    const canvas = this.padCanvas!.nativeElement;
    const rect = canvas.getBoundingClientRect();
    const scaleX = rect.width === 0 ? 1 : canvas.width / rect.width;
    const scaleY = rect.height === 0 ? 1 : canvas.height / rect.height;

    return {
      x: (event.clientX - rect.left) * scaleX,
      y: (event.clientY - rect.top) * scaleY
    };
  }

  startStroke(event: PointerEvent): void {
    this.prepareCanvas();
    if (!this.context) return;

    const canvas = this.padCanvas!.nativeElement;
    canvas.setPointerCapture(event.pointerId);
    this.drawing = true;
    this.hasDrawnStrokes = true;

    const point = this.pointOf(event);
    this.context.beginPath();
    this.context.moveTo(point.x, point.y);
    // A single tap should leave a mark rather than nothing.
    this.context.lineTo(point.x, point.y);
    this.context.stroke();
    event.preventDefault();
  }

  continueStroke(event: PointerEvent): void {
    if (!this.drawing || !this.context) return;
    const point = this.pointOf(event);
    this.context.lineTo(point.x, point.y);
    this.context.stroke();
    event.preventDefault();
  }

  endStroke(event: PointerEvent): void {
    if (!this.drawing) return;
    this.drawing = false;
    this.padCanvas?.nativeElement.releasePointerCapture?.(event.pointerId);
  }

  clearPad(): void {
    const canvas = this.padCanvas?.nativeElement;
    if (!canvas || !this.context) return;
    // Bitmap units, and the context carries no transform, so these agree.
    this.context.clearRect(0, 0, canvas.width, canvas.height);
    this.hasDrawnStrokes = false;
  }

  setMethod(method: ContractSignatureMethod): void {
    this.method = method;
    this.validationError = '';
    // The canvas only exists in the DOM in Draw mode, so it is measured after Angular has
    // rendered it rather than before.
    if (method === ContractSignatureMethod.Draw) {
      setTimeout(() => this.prepareCanvas());
    }
  }

  // ── submit ─────────────────────────────────────────────────────────────────

  submit(): void {
    if (this.submitting) return;
    this.validationError = '';

    if (!this.consentAccepted) {
      this.validationError = 'Please tick the consent box before signing.';
      return;
    }

    let signatureData: string;
    if (this.method === ContractSignatureMethod.Draw) {
      if (!this.hasDrawnStrokes) {
        this.validationError = 'Please draw your signature in the box.';
        return;
      }
      signatureData = this.exportMark();
    } else {
      if (!this.typedSignature.trim()) {
        this.validationError = 'Please type your name as your signature.';
        return;
      }
      signatureData = this.typedSignature.trim();
    }

    if (!this.nameLocked && !this.signerName.trim()) {
      this.validationError = 'Please enter your name.';
      return;
    }

    this.signed.emit({
      signerName: this.signerName.trim(),
      signerTitle: this.signerTitle?.trim(),
      signerEmail: this.signerEmail?.trim(),
      signatureMethod: this.method,
      signatureData,
      consentAccepted: true
    });
  }
}
