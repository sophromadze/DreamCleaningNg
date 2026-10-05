import { Component, inject, ChangeDetectionStrategy } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { PhoneNumberService } from '../services/phone-number.service';
import { IconComponent } from '../shared/icons/icon.component';
import { faFacebookF } from '../shared/icons/glyphs/faFacebookF';
import { faGoogle } from '../shared/icons/glyphs/faGoogle';
import { faInstagram } from '../shared/icons/glyphs/faInstagram';
import { faTiktok } from '../shared/icons/glyphs/faTiktok';
import { faYelp } from '../shared/icons/glyphs/faYelp';

@Component({
  selector: 'app-footer',
  standalone: true,
  imports: [RouterLink, RouterLinkActive, IconComponent],
  templateUrl: './footer.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './footer.component.scss'
})
export class FooterComponent {
  protected readonly icons = { faFacebookF, faGoogle, faInstagram, faTiktok, faYelp };

  protected readonly phoneNumber = inject(PhoneNumberService);
}
