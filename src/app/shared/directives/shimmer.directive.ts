import { Directive, ElementRef, Input, OnChanges, OnDestroy, Renderer2, SimpleChanges } from '@angular/core';

/**
 * Classic shimmer directive.
 *
 * This only toggles the `shimmer-loading` class.
 * Bubble/foam DOM injection was removed so the UI shows only the classic sweep.
 */
@Directive({
  selector: '[shimmer]',
  standalone: true,
})
export class ShimmerDirective implements OnChanges, OnDestroy {
  @Input() shimmer: boolean = true;

  constructor(
    private el: ElementRef<HTMLElement>,
    private renderer: Renderer2
  ) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (!('shimmer' in changes)) return;

    const native = this.el.nativeElement;

    // Cleanup any leftover foam DOM from previous implementation.
    const foamTracks = native.querySelectorAll('.foam-track');
    foamTracks.forEach((node) => node.parentElement?.removeChild(node));

    if (this.shimmer) {
      this.renderer.addClass(native, 'shimmer-loading');
    } else {
      this.renderer.removeClass(native, 'shimmer-loading');
    }
  }

  ngOnDestroy(): void {
    const native = this.el.nativeElement;
    this.renderer.removeClass(native, 'shimmer-loading');

    const foamTracks = native.querySelectorAll('.foam-track');
    foamTracks.forEach((node) => node.parentElement?.removeChild(node));
  }
}
