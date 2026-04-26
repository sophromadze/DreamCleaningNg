import { Routes } from '@angular/router';
import { MainComponent } from './main/main.component';
import { authGuard } from './guards/auth.guard';
import { noAuthGuard } from './guards/no-auth.guard';
import { adminGuard } from './guards/admin.guard';
import { maintenanceGuard } from './guards/maintenance.guard';
import { clientOnlyGuard } from './guards/client-only.guard';
import { realEmailGuard } from './guards/real-email.guard';
import { bookingSuccessGuard } from './guards/booking-success.guard';
import { superAdminGuard } from './guards/super-admin.guard';
import { passwordSetupGuard } from './guards/password-setup.guard';
import { pendingVerificationGuard } from './guards/pending-verification.guard';

export const routes: Routes = [
  {
    path: 'maintenance',
    loadComponent: () => import('./maintenance-mode/maintenance-mode.component').then(m => m.MaintenanceModeComponent)
  },
  {
    path: '',
    component: MainComponent,
    data: {
      title: 'Dream Cleaning - Professional Cleaning Services Near Me | NYC',
      description: "Dream Cleaning is a 5.0-star rated cleaning service in NYC serving Brooklyn, Manhattan & Queens. Standard cleaning from $110, deep cleaning from $190. 100+ Google reviews. Book online in 2 minutes."
    }
  },
  {
    path: 'about',
    loadComponent: () => import('./about/about.component').then(m => m.AboutComponent),
    data: {
      title: 'About Dream Cleaning - NYC Cleaning Service Since 2024',
      description: "About Dream Cleaning — NYC's locally owned cleaning company since 2024. 10+ background-checked cleaners, 200+ homes cleaned, 5.0-star Google rating. Serving 120 ZIP codes across Brooklyn, Manhattan & Queens."
    }
  },
  {
    path: 'service-page',
    loadComponent: () => import('./service-page/service-page.component').then(m => m.ServicePageComponent),
    data: {
      title: 'Cleaning Services in Manhattan, Brooklyn & Queens | Dream Cleaning',
      description: "Dream Cleaning's professional cleaning services in NYC — standard cleaning, deep cleaning, move in/out, office cleaning, post-construction & more. Brooklyn, Manhattan & Queens. Book online."
    }
  },
  // Service routes
  {
    path: 'services/residential-cleaning',
    loadComponent: () => import('./service-page/services/residential-cleaning/residential-cleaning.component').then(m => m.ResidentialCleaningComponent),
    data: {
      title: 'Residential Cleaning Service NYC | Dream Cleaning',
      description: "Standard residential cleaning in NYC by Dream Cleaning. Starting from $110. Weekly, biweekly, monthly plans. Brooklyn, Manhattan & Queens. 5.0-star rated."
    }
  },
  {
    path: 'services/residential-cleaning/kitchen',
    loadComponent: () => import('./service-page/services/residential-cleaning/kitchen-cleaning/kitchen-cleaning.component').then(m => m.KitchenCleaningComponent),
    data: {
      title: 'Kitchen Cleaning Service NYC | Dream Cleaning',
      description: "Professional kitchen cleaning in NYC — degreasing, sanitization, stovetops, countertops, sinks, cabinet exteriors. Brooklyn, Manhattan & Queens. Book Dream Cleaning online."
    }
  },
  {
    path: 'services/residential-cleaning/bathroom',
    loadComponent: () => import('./service-page/services/residential-cleaning/bathroom-cleaning/bathroom-cleaning.component').then(m => m.BathroomCleaningComponent),
    data: {
      title: 'Bathroom Cleaning Service NYC | Dream Cleaning',
      description: "Professional bathroom cleaning in NYC — toilet, sink, shower/bathtub scrubbing, soap scum removal, tile cleaning. Brooklyn, Manhattan & Queens. Book Dream Cleaning online."
    }
  },
  {
    path: 'services/deep-cleaning',
    loadComponent: () => import('./service-page/services/deep-cleaning/deep-cleaning.component').then(m => m.DeepCleaningComponent),
    data: {
      title: 'Deep Cleaning Service NYC | Dream Cleaning',
      description: "Deep cleaning services in NYC by Dream Cleaning. Starting from $190. Baseboards, inside appliances, behind furniture. Brooklyn, Manhattan & Queens. 5.0-star rated."
    }
  },
  {
    path: 'services/office-cleaning',
    loadComponent: () => import('./service-page/services/office-cleaning/office-cleaning.component').then(m => m.OfficeCleaningComponent),
    data: {
      title: 'Office Cleaning Service NYC | Dream Cleaning',
      description: "Professional office cleaning in NYC by Dream Cleaning. Flexible scheduling, background-checked cleaners, high-touch surface sanitization. Manhattan, Brooklyn & Queens."
    }
  },
  {
    path: 'services/custom-cleaning',
    loadComponent: () => import('./service-page/services/custom-cleaning/custom-cleaning.component').then(m => m.CustomCleaningComponent),
    data: {
      title: 'Custom Cleaning Service NYC | Dream Cleaning',
      description: "Custom cleaning services in NYC — design your own cleaning plan. Choose rooms, tasks, and duration. Brooklyn, Manhattan & Queens. Book Dream Cleaning online."
    }
  },
  {
    path: 'services/move-in-out-cleaning',
    loadComponent: () => import('./service-page/services/move-in-out-cleaning/move-in-out-cleaning.component').then(m => m.MoveInOutCleaningComponent),
    data: {
      title: 'Move In/Out Cleaning Service NYC | Dream Cleaning',
      description: "Move in/out cleaning in NYC by Dream Cleaning. Starting from $200. Cabinet interiors, appliance cleaning, wall spot cleaning. Brooklyn, Manhattan & Queens. 5.0-star rated."
    }
  },
  {
    path: 'services/heavy-condition-cleaning',
    loadComponent: () => import('./service-page/services/heavy-condition-cleaning/heavy-condition-cleaning.component').then(m => m.HeavyConditionCleaningComponent),
    data: {
      title: 'Heavy Condition Cleaning NYC | Dream Cleaning',
      description: "Heavy condition cleaning in NYC — $55/hour per cleaner. For homes not cleaned in 6+ months. Wall washing, cabinet interiors, professional restoration. Brooklyn, Manhattan & Queens."
    }
  },
  {
    path: 'services/filthy-cleaning',
    loadComponent: () => import('./service-page/services/filthy-cleaning/filthy-cleaning.component').then(m => m.FilthyCleaningComponent),
    data: {
      title: 'Filthy Cleaning Service NYC | Dream Cleaning',
      description: "Filthy cleaning service in NYC — extreme cleaning for hoarding, severe neglect, heavy buildup. Professional restoration. Brooklyn, Manhattan & Queens. Book Dream Cleaning."
    }
  },
  {
    path: 'services/post-construction-cleaning',
    loadComponent: () => import('./service-page/services/post-construction-cleaning/post-construction-cleaning.component').then(m => m.PostConstructionCleaningComponent),
    data: {
      title: 'Post Construction Cleaning NYC | Dream Cleaning',
      description: "Post construction cleaning in NYC — dust, debris, residue removal from all surfaces after renovation. Brooklyn, Manhattan & Queens. Book Dream Cleaning online."
    }
  },
  {
    path: 'services/laundry-and-dishwashing',
    loadComponent: () => import('./service-page/services/laundry-and-dishwashing/laundry-and-dishwashing.component').then(m => m.LaundryAndDishwashingComponent),
    data: {
      title: 'Laundry & Dishwashing Services NYC | Dream Cleaning',
      description: "Dream Cleaning's laundry, folding & dishwashing services in NYC. We use your building's machines, sort, wash, dry, fold, and put away dishes. Brooklyn, Manhattan & Queens. Book online."
    }
  },
  {
    path: 'services/brooklyn-cleaning',
    loadComponent: () => import('./service-page/services/brooklyn-cleaning/brooklyn-cleaning.component').then(m => m.BrooklynCleaningComponent),
    data: {
      title: 'Cleaning Service in Brooklyn NY | Dream Cleaning',
      description: "Professional cleaning service in Brooklyn NY — 38 ZIP codes covered. Standard from $110, deep from $190. 5.0-star Google rating, 100+ reviews. Book Dream Cleaning online."
    }
  },
  {
    path: 'services/manhattan-cleaning',
    loadComponent: () => import('./service-page/services/manhattan-cleaning/manhattan-cleaning.component').then(m => m.ManhattanCleaningComponent),
    data: {
      title: 'Cleaning Service in Manhattan NY | Dream Cleaning',
      description: "Professional cleaning service in Manhattan NY — 24 ZIP codes covered. Standard from $110, deep from $190. 5.0-star Google rating, 100+ reviews. Book Dream Cleaning online."
    }
  },
  {
    path: 'services/queens-cleaning',
    loadComponent: () => import('./service-page/services/queens-cleaning/queens-cleaning.component').then(m => m.QueensCleaningComponent),
    data: {
      title: 'Cleaning Service in Queens NY | Dream Cleaning',
      description: "Professional cleaning service in Queens NY — 58 ZIP codes covered. Standard from $110, deep from $190. 5.0-star Google rating, 100+ reviews. Book Dream Cleaning online."
    }
  },
  {
    path: 'booking',
    loadComponent: () => import('./booking/booking.component').then(m => m.BookingComponent),
    canActivate: [maintenanceGuard],
    data: {
      title: 'Book Cleaning Service | Dream Cleaning NYC',
      description: "Book professional cleaning in NYC online in under 2 minutes. Standard cleaning from $110, deep cleaning from $190. Instant estimates. Dream Cleaning — Brooklyn, Manhattan & Queens."
    }
  },
  {
    path: 'contact',
    loadComponent: () => import('./contact/contact.component').then(m => m.ContactComponent),
    canActivate: [maintenanceGuard],
    data: {
      title: 'Contact Dream Cleaning | NYC Cleaning Service',
      description: "Contact Dream Cleaning — call (929) 930-1525 or email hello@dreamcleaningnearme.com. Professional cleaning services in Brooklyn, Manhattan & Queens. 5.0-star rated."
    }
  },
  {
    path: 'privacy-policy',
    loadComponent: () => import('./privacy-policy/privacy-policy.component').then(m => m.PrivacyPolicyComponent)
  },
  {
    path: 'terms-and-conditions',
    loadComponent: () => import('./terms-and-conditions/terms-and-conditions.component').then(m => m.TermsAndConditionsComponent)
  },
  {
    path: 'faq',
    loadComponent: () => import('./faq/faq.component').then(m => m.FaqComponent),
    canActivate: [maintenanceGuard],
    data: {
      title: 'FAQ | Dream Cleaning NYC',
      description: "Frequently asked questions about Dream Cleaning NYC — pricing (from $110), service areas (120 ZIP codes), booking process, what's included, satisfaction guarantee, and more."
    }
  },
  {
    path: 'login',
    canActivate: [noAuthGuard],
    loadComponent: () => import('./auth/login/login.component').then(m => m.LoginComponent)
  },
  {
    path: 'auth/login',
    redirectTo: '/login',
    pathMatch: 'full'
  },
  {
    path: 'auth/apple-callback',
    loadComponent: () => import('./auth/login/apple-callback.component').then(m => m.AppleCallbackComponent)
  },
  {
    path: 'verify-email',
    canActivate: [authGuard],
    loadComponent: () => import('./auth/real-email-verify/real-email-verify.component').then(m => m.RealEmailVerifyComponent)
  },
  {
    path: 'profile',
    canActivate: [clientOnlyGuard, authGuard, realEmailGuard, passwordSetupGuard, maintenanceGuard],
    loadComponent: () => import('./auth/profile/profile.component').then(m => m.ProfileComponent)
  },
  {
    path: 'rewards',
    canActivate: [authGuard, maintenanceGuard],
    loadComponent: () => import('./rewards/rewards.component').then(m => m.RewardsComponent),
    data: {
      title: 'Bubble Rewards | Dream Cleaning',
      description: 'Earn points on every cleaning and unlock exclusive rewards with Dream Cleaning\'s Bubble Rewards program.'
    }
  },
  {
    path: 'change-password',
    canActivate: [clientOnlyGuard, authGuard, realEmailGuard, passwordSetupGuard, maintenanceGuard],
    loadComponent: () => import('./auth/change-password/change-password.component').then(m => m.ChangePasswordComponent)
  },
  {
    path: 'set-password',
    canActivate: [clientOnlyGuard, authGuard, realEmailGuard, maintenanceGuard],
    loadComponent: () => import('./auth/set-password/set-password.component').then(m => m.SetPasswordComponent)
  },
  {
    path: 'admin',
    canActivate: [clientOnlyGuard, authGuard, realEmailGuard, passwordSetupGuard, adminGuard],
    loadComponent: () => import('./auth/admin/admin.component').then(m => m.AdminComponent)
  },
  {
    path: 'admin/tasks',
    canActivate: [clientOnlyGuard, authGuard, realEmailGuard, passwordSetupGuard, adminGuard],
    loadComponent: () => import('./auth/tasks/tasks.component').then(m => m.TasksComponent)
  },
  {
    path: 'admin/shifts',
    canActivate: [clientOnlyGuard, authGuard, realEmailGuard, passwordSetupGuard, adminGuard],
    loadComponent: () => import('./auth/shifts/shifts.component').then(m => m.ShiftsComponent)
  },
  {
    path: 'admin/statistics',
    canActivate: [clientOnlyGuard, authGuard, realEmailGuard, passwordSetupGuard, superAdminGuard],
    loadComponent: () => import('./auth/statistics/statistics.component').then(m => m.StatisticsComponent)
  },
  {
    path: 'admin/rewards',
    canActivate: [clientOnlyGuard, authGuard, realEmailGuard, passwordSetupGuard, superAdminGuard],
    loadComponent: () => import('./auth/admin/rewards/admin-rewards.component').then(m => m.AdminRewardsComponent)
  },

  {
    path: 'profile/orders',
    canActivate: [clientOnlyGuard, authGuard, realEmailGuard, passwordSetupGuard, maintenanceGuard],
    loadComponent: () => import('./auth/profile/order-history/order-history.component').then(m => m.OrderHistoryComponent)
  },
  {
    path: 'order/:id',
    canActivate: [clientOnlyGuard, authGuard, realEmailGuard, passwordSetupGuard, maintenanceGuard],
    loadComponent: () => import('./auth/profile/order-details/order-details.component').then(m => m.OrderDetailsComponent)
  },
  {
    path: 'order/:id/edit',
    canActivate: [clientOnlyGuard, authGuard, realEmailGuard, passwordSetupGuard, maintenanceGuard],
    loadComponent: () => import('./auth/profile/order-edit/order-edit.component').then(m => m.OrderEditComponent)
  },
  {
    path: 'order/:id/pay',
    canActivate: [clientOnlyGuard, authGuard, realEmailGuard, passwordSetupGuard, maintenanceGuard],
    loadComponent: () => import('./auth/profile/order-payment/order-payment.component').then(m => m.OrderPaymentComponent)
  },
  {
    path: 'booking-confirmation',
    canActivate: [clientOnlyGuard, maintenanceGuard],
    loadComponent: () => import('./booking/booking-confirmation/booking-confirmation.component').then(m => m.BookingConfirmationComponent)
  },
  {
    path: 'booking-success/:orderId',
    canActivate: [clientOnlyGuard, maintenanceGuard, bookingSuccessGuard],
    loadComponent: () => import('./pages/booking-success/booking-success.component').then(m => m.BookingSuccessComponent)
  },
  {
    path: 'gift-cards',
    canActivate: [maintenanceGuard],
    loadComponent: () => import('./gift-cards/gift-cards.component').then(m => m.GiftCardsComponent),
    data: {
      title: 'Gift Cards | Dream Cleaning NYC',
      description: "Give the gift of a clean home. Dream Cleaning gift cards for professional cleaning services in Brooklyn, Manhattan & Queens. Buy online instantly."
    }
  },
  {
    path: 'auth/verify-email',
    loadComponent: () => import('./auth/verify-email/verify-email.component').then(m => m.VerifyEmailComponent)
  },
  {
    path: 'auth/verify-email-notice',
    canActivate: [pendingVerificationGuard],
    loadComponent: () => import('./auth/verify-email-notice/verify-email-notice.component').then(m => m.VerifyEmailNoticeComponent)
  },
  {
    path: 'auth/forgot-password',
    canActivate: [noAuthGuard, maintenanceGuard],
    loadComponent: () => import('./auth/forgot-password/forgot-password.component').then(m => m.ForgotPasswordComponent)
  },
  {
    path: 'auth/reset-password',
    canActivate: [noAuthGuard, maintenanceGuard],
    loadComponent: () => import('./auth/reset-password/reset-password.component').then(m => m.ResetPasswordComponent)
  },
  {
    path: 'cleaners-dashboard',
    canActivate: [clientOnlyGuard, authGuard, realEmailGuard, passwordSetupGuard, adminGuard],
    loadComponent: () => import('./cleaners-dashboard/cleaners-dashboard.component').then(m => m.CleanersDashboardComponent),
    data: {
      title: 'Cleaners Dashboard | Dream Cleaning'
    }
  },
  {
    path: 'change-email',
    canActivate: [clientOnlyGuard, authGuard, realEmailGuard, passwordSetupGuard, maintenanceGuard],
    loadComponent: () => import('./auth/change-email/change-email.component').then(m => m.ChangeEmailComponent)
  },
  {
    path: 'poll-success',
    loadComponent: () => import('./booking/poll-success/poll-success.component').then(m => m.PollSuccessComponent),
    canActivate: [maintenanceGuard]
  },
  {
    path: 'free-quote',
    loadComponent: () => import('./free-quote/free-quote.component').then(m => m.FreeQuoteComponent),
    canActivate: [maintenanceGuard],
    data: {
      title: 'Free Quote | Dream Cleaning NYC',
      description: "Get a free cleaning quote from Dream Cleaning. Professional cleaning services in Brooklyn, Manhattan & Queens. Standard from $110, deep from $190. No obligation."
    }
  },
  {
    path: 'gift-card-confirmation',
    canActivate: [maintenanceGuard],
    loadComponent: () => {
      return import('./gift-cards/gift-card-confirmation/gift-card-confirmation.component')
        .then(m => {
          return m.GiftCardConfirmationComponent;
        })
        .catch(error => {
          console.error('Failed to load component:', error);
          throw error;
        });
    }
  },
  {
    path: '**',
    redirectTo: '',
    pathMatch: 'prefix'
  }
];