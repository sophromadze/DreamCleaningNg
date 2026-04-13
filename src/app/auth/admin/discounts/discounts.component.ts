import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { PromoCodesComponent } from '../promo-codes/promo-codes.component';
import { SpecialOffersComponent } from '../special-offers/special-offers.component';
import { SubscriptionsComponent } from '../subscriptions/subscriptions.component';
import { AdminGiftCardsComponent } from '../admin-gift-cards/admin-gift-cards.component';

type DiscountSubTab = 'promo-codes' | 'special-offers' | 'subscriptions' | 'gift-cards';

@Component({
  selector: 'app-discounts',
  standalone: true,
  imports: [
    CommonModule,
    PromoCodesComponent,
    SpecialOffersComponent,
    SubscriptionsComponent,
    AdminGiftCardsComponent
  ],
  templateUrl: './discounts.component.html',
  styleUrls: ['./discounts.component.scss']
})
export class DiscountsComponent {
  activeSubTab: DiscountSubTab = 'promo-codes';

  @Input() set initialSubTab(tab: string | null | undefined) {
    if (
      tab === 'promo-codes' ||
      tab === 'special-offers' ||
      tab === 'subscriptions' ||
      tab === 'gift-cards'
    ) {
      this.activeSubTab = tab;
    } else {
      this.activeSubTab = 'promo-codes';
    }
  }

  setSubTab(tab: DiscountSubTab) {
    this.activeSubTab = tab;
  }
}
