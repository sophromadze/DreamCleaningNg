import { Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { BubbleFieldComponent } from '../bubble-field/bubble-field.component';
import { MarketingPricingService } from '../shared/pricing/marketing-pricing.service';
import { responsiveImage } from '../shared/images/responsive-image.loader';

/**
 * Drawn width of the team photo (3:2, object-fit: cover), measured from the rendered page:
 *   <= 768px  full-width banner, box 100vw - 47px, drawn at box width
 *   <= 900px  box ~358x323 -> height-bound, drawn ~485px
 *   wider     420x280 box, drawn 420px
 */
const TEAM_PHOTO_SIZES =
  '(max-width: 768px) calc(100vw - 47px), ' +
  '(max-width: 900px) 485px, ' +
  '420px';

@Component({
  selector: 'app-about',
  standalone: true,
  imports: [BubbleFieldComponent],
  templateUrl: './about.component.html',
  styleUrl: './about.component.scss'
})
export class AboutComponent {
  readonly pricing = inject(MarketingPricingService).text;
  protected readonly teamPhoto = responsiveImage('/images/dream-cleaning-maids-in-nyc.webp', TEAM_PHOTO_SIZES);

  constructor(private router: Router) {}

  navigateToBooking() {
    this.router.navigate(['/booking']);
  }
}
