import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { PromoCodesComponent } from '../promo-codes/promo-codes.component';
import { SpecialOffersComponent } from '../special-offers/special-offers.component';
import { SubscriptionsComponent } from '../subscriptions/subscriptions.component';
import { AdminGiftCardsComponent } from '../admin-gift-cards/admin-gift-cards.component';
import { LoyaltyDiscountAdminComponent } from '../loyalty-discount-admin/loyalty-discount-admin.component';

type DiscountSubTab = 'promo-codes' | 'special-offers' | 'subscriptions' | 'gift-cards' | 'loyalty';

@Component({
  selector: 'app-discounts',
  standalone: true,
  imports: [
    CommonModule,
    PromoCodesComponent,
    SpecialOffersComponent,
    SubscriptionsComponent,
    AdminGiftCardsComponent,
    LoyaltyDiscountAdminComponent
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
      tab === 'gift-cards' ||
      tab === 'loyalty'
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
