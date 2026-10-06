import { Component, inject, ChangeDetectionStrategy } from '@angular/core';
import { RouterLink } from '@angular/router';
import { HeaderComponent } from '../header.component';
import { IconComponent } from '../../shared/icons/icon.component';
import { faUser } from '../../shared/icons/glyphs/faUser';

/**
 * The header's account menus: the guest menu (Log In / Sign Up) or, when signed in, the avatar and
 * its dropdown. State and actions stay on HeaderComponent (it also owns the click-outside and
 * menu-closing logic); this component only renders them.
 *
 * Its own component so that its styles are only added to a page when it renders - in the browser,
 * once auth is known. In the header's stylesheet they were part of every server-rendered page.
 */
@Component({
  selector: 'app-header-account-menu',
  standalone: true,
  imports: [RouterLink, IconComponent],
  templateUrl: './header-account-menu.component.html',
  // Renders HeaderComponent state; goes OnPush together with the header (phase 3).
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './header-account-menu.component.scss'
})
export class HeaderAccountMenuComponent {
  protected readonly header = inject(HeaderComponent);
  protected readonly icons = { faUser };
}
