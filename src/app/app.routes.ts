import { Routes } from '@angular/router';
import { MainComponent } from './main/main.component';
import { SERVICE_PRICING } from './shared/service-pricing.data';
import { authGuard } from './guards/auth.guard';
import { noAuthGuard } from './guards/no-auth.guard';
import { adminGuard } from './guards/admin.guard';
import { maintenanceGuard } from './guards/maintenance.guard';
import { clientOnlyGuard } from './guards/client-only.guard';
import { realEmailGuard } from './guards/real-email.guard';
import { bookingSuccessGuard } from './guards/booking-success.guard';
import { pageViewGuard } from './guards/page-view.guard';
import { companyLandingGuard } from './guards/company-landing.guard';
import { passwordSetupGuard } from './guards/password-setup.guard';
import { pendingVerificationGuard } from './guards/pending-verification.guard';
import { pinSetupGuard } from './guards/pin-setup.guard';
import { superAdminGuard } from './guards/super-admin.guard';
import { skipWhenPaymentToken } from './guards/payment-link.guard';

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
      description: `5.0-star rated NYC cleaning service in Brooklyn, Manhattan & Queens. Standard from $${SERVICE_PRICING.residentialFrom}, deep from $${SERVICE_PRICING.deepFrom}. 100+ Google reviews. Book online in 2 minutes.`
    }
  },
  {
    path: 'about',
    loadComponent: () => import('./about/about.component').then(m => m.AboutComponent),
    data: {
      title: 'About Dream Cleaning - NYC Cleaning Service Since 2024',
      description: "Locally owned NYC cleaning company since 2024. Background-checked cleaners, thousands of homes cleaned, 5.0-star Google rating. Brooklyn, Manhattan & Queens."
    }
  },
  {
    path: 'service-page',
    loadComponent: () => import('./service-page/service-page.component').then(m => m.ServicePageComponent),
    data: {
      title: 'Cleaning Services in Manhattan, Brooklyn & Queens | Dream Cleaning',
      description: "Professional cleaning services in NYC — standard, deep, move in/out, office, post-construction & more. Brooklyn, Manhattan & Queens. Book online."
    }
  },
  {
    path: 'cleaning-checklist',
    loadComponent: () => import('./cleaning-checklist/cleaning-checklist.component').then(m => m.CleaningChecklistComponent),
    data: {
      title: 'Cleaning Checklist | Standard, Deep & Move In/Out | Dream Cleaning',
      description: `Compare our standard, deep, and move in/out cleaning checklists room by room — kitchen, bathroom, bedroom, living areas, exclusions and add-ons.`
    }
  },
  // Blog (public, SSR per-request — see app.routes.server.ts)
  {
    path: 'blog',
    loadComponent: () => import('./blog/blog.component').then(m => m.BlogComponent),
    data: {
      title: 'Cleaning Tips & NYC Home Guides | Dream Cleaning Blog',
      description: 'Practical cleaning guides for NYC apartments and homes — deep cleaning how-tos, moving checklists, Airbnb turnover tips and seasonal advice.'
    }
  },
  {
    // Per-post title/meta/OG/JSON-LD are set by the component once the post loads
    // (during SSR too); route data here is only the pre-fetch fallback.
    path: 'blog/:slug',
    loadComponent: () => import('./blog/blog-post/blog-post.component').then(m => m.BlogPostComponent),
    data: {
      title: 'Dream Cleaning Blog',
      description: 'Cleaning guides and tips for NYC homes from Dream Cleaning.'
    }
  },
  // Service routes
  {
    path: 'services/residential-cleaning',
    loadComponent: () => import('./service-page/services/residential-cleaning/residential-cleaning.component').then(m => m.ResidentialCleaningComponent),
    data: {
      title: 'Residential Cleaning Service NYC | Dream Cleaning',
      description: `Standard residential cleaning in NYC by Dream Cleaning. Starting from $${SERVICE_PRICING.residentialFrom}. Weekly, biweekly, monthly plans. Brooklyn, Manhattan & Queens. 5.0-star rated.`
    }
  },
  {
    path: 'services/residential-cleaning/kitchen',
    loadComponent: () => import('./service-page/services/residential-cleaning/kitchen-cleaning/kitchen-cleaning.component').then(m => m.KitchenCleaningComponent),
    data: {
      title: 'Kitchen Cleaning Service NYC | Dream Cleaning',
      description: "Professional kitchen cleaning in NYC — degreasing, sanitizing, stovetops, countertops, sinks and cabinet exteriors. Brooklyn, Manhattan & Queens."
    }
  },
  {
    path: 'services/residential-cleaning/bathroom',
    loadComponent: () => import('./service-page/services/residential-cleaning/bathroom-cleaning/bathroom-cleaning.component').then(m => m.BathroomCleaningComponent),
    data: {
      title: 'Bathroom Cleaning Service NYC | Dream Cleaning',
      description: "Professional bathroom cleaning in NYC — toilet, sink, shower and tub scrubbing, soap scum removal, tile cleaning. Brooklyn, Manhattan & Queens."
    }
  },
  {
    path: 'services/house-cleaning',
    loadComponent: () => import('./service-page/services/house-cleaning/house-cleaning.component').then(m => m.HouseCleaningComponent),
    data: {
      title: 'House Cleaning Service NYC | Dream Cleaning',
      description: `Professional house cleaning in NYC from $${SERVICE_PRICING.residentialFrom}. Multi-floor homes & estates in Queens, Brooklyn & Staten Island. Fully insured, 5.0-star rated.`
    }
  },
  {
    path: 'services/condo-cleaning',
    loadComponent: () => import('./service-page/services/condo-cleaning/condo-cleaning.component').then(m => m.CondoCleaningComponent),
    data: {
      title: 'Condo Cleaning Service NYC | Dream Cleaning',
      description: `Premium condo cleaning in NYC from $${SERVICE_PRICING.residentialFrom}. Luxury high-rise & boutique condos in Manhattan, Brooklyn & Queens. Fully insured, 5.0-star rated.`
    }
  },
  {
    path: 'services/airbnb-cleaning',
    loadComponent: () => import('./service-page/services/airbnb-cleaning/airbnb-cleaning.component').then(m => m.AirbnbCleaningComponent),
    data: {
      title: 'Airbnb Cleaning Service NYC | Short-Term Rental Turnover | Dream Cleaning',
      description: `Airbnb & short-term rental turnover cleaning in NYC from $${SERVICE_PRICING.residentialFrom}. Same-day changeovers, hotel-quality resets, restocking. Manhattan, Brooklyn & Queens.`
    }
  },
  {
    path: 'services/deep-cleaning',
    loadComponent: () => import('./service-page/services/deep-cleaning/deep-cleaning.component').then(m => m.DeepCleaningComponent),
    data: {
      title: 'Deep Cleaning Service NYC | Dream Cleaning',
      description: `Deep cleaning in NYC from $${SERVICE_PRICING.deepFrom} — baseboards, inside appliances, behind furniture. Brooklyn, Manhattan & Queens. 5.0-star rated.`
    }
  },
  {
    path: 'services/office-cleaning',
    loadComponent: () => import('./service-page/services/office-cleaning/office-cleaning.component').then(m => m.OfficeCleaningComponent),
    data: {
      title: 'Office Cleaning Service NYC | Dream Cleaning',
      description: "Professional office cleaning in NYC — flexible scheduling, background-checked cleaners, high-touch surface sanitizing. Manhattan, Brooklyn & Queens."
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
      description: `Move in/out cleaning in NYC from $${SERVICE_PRICING.moveInOutFrom} — cabinet interiors, appliance cleaning, wall spot cleaning. Brooklyn, Manhattan & Queens.`
    }
  },
  {
    path: 'services/heavy-condition-cleaning',
    loadComponent: () => import('./service-page/services/heavy-condition-cleaning/heavy-condition-cleaning.component').then(m => m.HeavyConditionCleaningComponent),
    data: {
      title: 'Heavy Condition Cleaning NYC | Dream Cleaning',
      description: `Heavy condition cleaning in NYC — $${SERVICE_PRICING.heavyConditionPerHour}/hour per cleaner for homes not cleaned in 6+ months. Wall washing, cabinet interiors. Brooklyn, Manhattan & Queens.`
    }
  },
  {
    path: 'services/filthy-cleaning',
    loadComponent: () => import('./service-page/services/filthy-cleaning/filthy-cleaning.component').then(m => m.FilthyCleaningComponent),
    data: {
      title: 'Filthy Cleaning Service NYC | Dream Cleaning',
      description: "Filthy cleaning in NYC — extreme cleaning for hoarding, severe neglect and heavy buildup. Brooklyn, Manhattan & Queens. Book Dream Cleaning."
    }
  },
  {
    path: 'services/post-construction-cleaning',
    loadComponent: () => import('./service-page/services/post-construction-cleaning/post-construction-cleaning.component').then(m => m.PostConstructionCleaningComponent),
    data: {
      title: 'Post Construction Cleaning NYC | Commercial Build-Outs | Dream Cleaning',
      description: "Commercial post construction cleaning in NYC — offices, retail and build-outs. Industrial dust, debris & residue removal. Brooklyn, Manhattan & Queens."
    }
  },
  {
    path: 'services/post-renovation-cleaning',
    loadComponent: () => import('./service-page/services/post-renovation-cleaning/post-renovation-cleaning.component').then(m => m.PostRenovationCleaningComponent),
    data: {
      title: 'Post Renovation Cleaning NYC | Home Remodel Cleanup | Dream Cleaning',
      description: "Post renovation cleaning for NYC homes — kitchen & bathroom remodels, room additions. Fine dust, paint specks & debris removal. Brooklyn, Manhattan & Queens."
    }
  },
  {
    path: 'services/laundry-and-dishwashing',
    loadComponent: () => import('./service-page/services/laundry-and-dishwashing/laundry-and-dishwashing.component').then(m => m.LaundryAndDishwashingComponent),
    data: {
      title: 'Laundry & Dishwashing Services NYC | Dream Cleaning',
      description: "Laundry, folding & dishwashing services in NYC. We use your building's machines — sort, wash, dry, fold and put away dishes. Brooklyn, Manhattan & Queens."
    }
  },
  {
    path: 'services/brooklyn-cleaning',
    loadComponent: () => import('./service-page/services/brooklyn-cleaning/brooklyn-cleaning.component').then(m => m.BrooklynCleaningComponent),
    data: {
      title: 'Cleaning Service in Brooklyn NY | Dream Cleaning',
      description: `Cleaning service in Brooklyn NY — 38 ZIP codes covered. Standard from $${SERVICE_PRICING.residentialFrom}, deep from $${SERVICE_PRICING.deepFrom}. 5.0-star Google rating, 100+ reviews. Book online.`
    }
  },
  {
    path: 'services/manhattan-cleaning',
    loadComponent: () => import('./service-page/services/manhattan-cleaning/manhattan-cleaning.component').then(m => m.ManhattanCleaningComponent),
    data: {
      title: 'Cleaning Service in Manhattan NY | Dream Cleaning',
      description: `Cleaning service in Manhattan NY — 24 ZIP codes covered. Standard from $${SERVICE_PRICING.residentialFrom}, deep from $${SERVICE_PRICING.deepFrom}. 5.0-star Google rating, 100+ reviews. Book online.`
    }
  },
  {
    path: 'services/queens-cleaning',
    loadComponent: () => import('./service-page/services/queens-cleaning/queens-cleaning.component').then(m => m.QueensCleaningComponent),
    data: {
      title: 'Cleaning Service in Queens NY | Dream Cleaning',
      description: `Cleaning service in Queens NY — 58 ZIP codes covered. Standard from $${SERVICE_PRICING.residentialFrom}, deep from $${SERVICE_PRICING.deepFrom}. 5.0-star Google rating, 100+ reviews. Book online.`
    }
  },
  {
    path: 'booking',
    loadComponent: () => import('./booking/booking.component').then(m => m.BookingComponent),
    canActivate: [maintenanceGuard],
    data: {
      title: 'Book Cleaning Service | Dream Cleaning NYC',
      description: `Book professional cleaning in NYC online in under 2 minutes. Standard from $${SERVICE_PRICING.residentialFrom}, deep from $${SERVICE_PRICING.deepFrom}. Instant estimates. Brooklyn, Manhattan & Queens.`
    }
  },
  {
    path: 'contact',
    loadComponent: () => import('./contact/contact.component').then(m => m.ContactComponent),
    canActivate: [maintenanceGuard],
    data: {
      title: 'Contact Dream Cleaning | NYC Cleaning Service',
      description: "Contact Dream Cleaning — call (929) 930-1525 or email hello@dreamcleaningnyc.com. Cleaning services in Brooklyn, Manhattan & Queens. 5.0-star rated."
    }
  },
  {
    path: 'reviews',
    loadComponent: () => import('./reviews/reviews.component').then(m => m.ReviewsComponent),
    data: {
      title: 'Customer Reviews | Dream Cleaning NYC',
      description: "Read why NYC customers rate Dream Cleaning 5.0 stars across 100+ Google reviews. Professional, reliable cleaning in Brooklyn, Manhattan & Queens."
    }
  },
  {
    path: 'pricing-and-discounts',
    loadComponent: () => import('./pricing-and-discounts/pricing-and-discounts.component').then(m => m.PricingAndDiscountsComponent),
    data: {
      title: 'Pricing & Discounts | Dream Cleaning NYC',
      description: `Transparent flat-rate cleaning prices from $${SERVICE_PRICING.residentialFrom}, plus first-time and recurring (weekly, bi-weekly, monthly) discounts. Brooklyn, Manhattan & Queens.`
    }
  },
  {
    path: 'privacy-policy',
    loadComponent: () => import('./privacy-policy/privacy-policy.component').then(m => m.PrivacyPolicyComponent),
    data: {
      title: 'Privacy Policy | Dream Cleaning NYC',
      description: "How Dream Cleaning collects, uses and protects your personal information when you book cleaning services in Brooklyn, Manhattan & Queens."
    }
  },
  {
    path: 'terms-and-conditions',
    loadComponent: () => import('./terms-and-conditions/terms-and-conditions.component').then(m => m.TermsAndConditionsComponent),
    data: {
      title: 'Terms & Conditions | Dream Cleaning NYC',
      description: "Terms and conditions for Dream Cleaning's NYC cleaning services — booking, cancellations, rescheduling, payments and our satisfaction guarantee."
    }
  },
  {
    path: 'faq',
    loadComponent: () => import('./faq/faq.component').then(m => m.FaqComponent),
    canActivate: [maintenanceGuard],
    data: {
      title: 'FAQ | Dream Cleaning NYC',
      description: `Answers about Dream Cleaning NYC — pricing (from $${SERVICE_PRICING.residentialFrom}), service areas (120 ZIP codes), booking, what's included and our satisfaction guarantee.`
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
    canActivate: [clientOnlyGuard, authGuard, realEmailGuard, passwordSetupGuard, pinSetupGuard, maintenanceGuard],
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
    canActivate: [clientOnlyGuard, authGuard, realEmailGuard, passwordSetupGuard, pinSetupGuard, maintenanceGuard],
    loadComponent: () => import('./auth/change-password/change-password.component').then(m => m.ChangePasswordComponent)
  },
  {
    path: 'set-password',
    canActivate: [clientOnlyGuard, authGuard, realEmailGuard, maintenanceGuard],
    loadComponent: () => import('./auth/set-password/set-password.component').then(m => m.SetPasswordComponent)
  },
  {
    // 2FA challenge — reached when a staff user logs in from an untrusted device.
    // Anonymous-friendly: the challenge lives entirely in localStorage state, no JWT yet.
    path: '2fa-challenge',
    canActivate: [clientOnlyGuard, maintenanceGuard],
    loadComponent: () => import('./auth/two-factor-challenge/two-factor-challenge.component').then(m => m.TwoFactorChallengeComponent)
  },
  {
    // Forced 2FA PIN setup — staff users with no PIN are routed here after first login.
    // Requires authGuard (we need a JWT to call /2fa/set-pin) but bypasses pinSetupGuard
    // so the user can actually reach the setup screen.
    path: 'setup-pin',
    canActivate: [clientOnlyGuard, authGuard, realEmailGuard, maintenanceGuard],
    loadComponent: () => import('./auth/setup-pin/setup-pin.component').then(m => m.SetupPinComponent)
  },
  {
    path: 'admin',
    canActivate: [clientOnlyGuard, authGuard, realEmailGuard, passwordSetupGuard, pinSetupGuard, adminGuard],
    loadComponent: () => import('./auth/admin/admin.component').then(m => m.AdminComponent)
  },
  {
    path: 'admin/tasks',
    canActivate: [clientOnlyGuard, authGuard, realEmailGuard, passwordSetupGuard, pinSetupGuard, adminGuard],
    loadComponent: () => import('./auth/tasks/tasks.component').then(m => m.TasksComponent)
  },
  {
    path: 'admin/shifts',
    canActivate: [clientOnlyGuard, authGuard, realEmailGuard, passwordSetupGuard, pinSetupGuard, adminGuard],
    loadComponent: () => import('./auth/shifts/shifts.component').then(m => m.ShiftsComponent)
  },
  // Statistics/Expenses/Finances moved under the Company shell (2026-07). Old paths redirect so
  // existing bookmarks and the current dropdown links keep working; each page keeps its pageViewGuard
  // on the child route below.
  { path: 'admin/statistics', redirectTo: 'admin/company/statistics', pathMatch: 'full' },
  {
    path: 'admin/rewards',
    canActivate: [clientOnlyGuard, authGuard, realEmailGuard, passwordSetupGuard, pinSetupGuard, pageViewGuard('bubble-rewards')],
    loadComponent: () => import('./auth/admin/rewards/admin-rewards.component').then(m => m.AdminRewardsComponent)
  },
  { path: 'admin/expenses', redirectTo: 'admin/company/expenses', pathMatch: 'full' },
  { path: 'admin/finances', redirectTo: 'admin/company/finances', pathMatch: 'full' },
  {
    path: 'admin/crm',
    canActivate: [clientOnlyGuard, authGuard, realEmailGuard, passwordSetupGuard, pinSetupGuard, adminGuard],
    loadComponent: () => import('./auth/admin/crm/crm.component').then(m => m.CrmComponent)
  },
  {
    // Company shell (money & performance): Statistics / Expenses / Finances / Ads as child tabs,
    // each pageView-gated. Bare path lands on the first tab the user is granted (companyLandingGuard).
    path: 'admin/company',
    canActivate: [clientOnlyGuard, authGuard, realEmailGuard, passwordSetupGuard, pinSetupGuard],
    loadComponent: () => import('./auth/admin/company/company.component').then(m => m.CompanyComponent),
    children: [
      // Bare /admin/company → first tab the user can actually see (not hardcoded to statistics).
      { path: '', canActivate: [companyLandingGuard], children: [] },
      {
        path: 'statistics',
        canActivate: [pageViewGuard('statistics')],
        loadComponent: () => import('./auth/statistics/statistics.component').then(m => m.StatisticsComponent)
      },
      {
        path: 'expenses',
        canActivate: [pageViewGuard('expenses')],
        loadComponent: () => import('./auth/admin/expenses/expenses.component').then(m => m.ExpensesComponent)
      },
      {
        path: 'finances',
        canActivate: [pageViewGuard('finances')],
        loadComponent: () => import('./auth/admin/finances/finances.component').then(m => m.FinancesComponent)
      },
      {
        path: 'ads',
        canActivate: [pageViewGuard('ads')],
        loadComponent: () => import('./auth/admin/crm/ads/crm-ads.component').then(m => m.CrmAdsComponent)
      },
      {
        path: 'traffic',
        canActivate: [pageViewGuard('traffic')],
        loadComponent: () => import('./auth/admin/company/traffic/traffic.component').then(m => m.TrafficComponent)
      },
      {
        path: 'keywords',
        canActivate: [pageViewGuard('keywords')],
        loadComponent: () => import('./auth/admin/company/keywords/keywords.component').then(m => m.KeywordsComponent)
      },
      {
        // Grant key and path differ on purpose — see TAB_ORDER in company-landing.guard.ts.
        path: 'customers',
        canActivate: [pageViewGuard('customer-stats')],
        loadComponent: () => import('./auth/admin/company/customers/customer-stats.component').then(m => m.CustomerStatsComponent)
      }
    ]
  },
  {
    // SuperAdmin only, and deliberately NOT behind a grantable pageView key: every write here
    // moves what the company reports as its labour cost, and records money leaving the business.
    path: 'admin/outgoing-payments',
    canActivate: [clientOnlyGuard, authGuard, realEmailGuard, passwordSetupGuard, pinSetupGuard, superAdminGuard],
    loadComponent: () => import('./auth/admin/outgoing-payments/outgoing-payments.component')
      .then(m => m.OutgoingPaymentsComponent)
  },
  {
    path: 'admin/blog',
    canActivate: [clientOnlyGuard, authGuard, realEmailGuard, passwordSetupGuard, pinSetupGuard, adminGuard],
    loadComponent: () => import('./auth/admin/blog/admin-blog.component').then(m => m.AdminBlogComponent)
  },

  {
    path: 'profile/orders',
    canActivate: [clientOnlyGuard, authGuard, realEmailGuard, passwordSetupGuard, pinSetupGuard, maintenanceGuard],
    loadComponent: () => import('./auth/profile/order-history/order-history.component').then(m => m.OrderHistoryComponent)
  },
  {
    path: 'order/:id',
    canActivate: [clientOnlyGuard, authGuard, realEmailGuard, passwordSetupGuard, pinSetupGuard, maintenanceGuard],
    loadComponent: () => import('./auth/profile/order-details/order-details.component').then(m => m.OrderDetailsComponent)
  },
  {
    path: 'order/:id/edit',
    canActivate: [clientOnlyGuard, authGuard, realEmailGuard, passwordSetupGuard, pinSetupGuard, maintenanceGuard],
    loadComponent: () => import('./auth/profile/order-edit/order-edit.component').then(m => m.OrderEditComponent)
  },
  {
    // Payment links carry a secret token (?t=...) that lets logged-out recipients open the
    // page; the auth-related guards are skipped only when the token is present. The backend
    // re-validates the token on every call and only while the order has something unpaid.
    path: 'order/:id/pay',
    canActivate: [
      clientOnlyGuard,
      skipWhenPaymentToken(authGuard),
      skipWhenPaymentToken(realEmailGuard),
      skipWhenPaymentToken(passwordSetupGuard),
      skipWhenPaymentToken(pinSetupGuard),
      maintenanceGuard
    ],
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
    canActivate: [clientOnlyGuard, authGuard, realEmailGuard, passwordSetupGuard, pinSetupGuard, adminGuard],
    loadComponent: () => import('./cleaners-dashboard/cleaners-dashboard.component').then(m => m.CleanersDashboardComponent),
    data: {
      title: 'Cleaners Dashboard | Dream Cleaning'
    }
  },
  {
    path: 'change-email',
    canActivate: [clientOnlyGuard, authGuard, realEmailGuard, passwordSetupGuard, pinSetupGuard, maintenanceGuard],
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
      description: `Get a free, no-obligation cleaning quote from Dream Cleaning. Standard from $${SERVICE_PRICING.residentialFrom}, deep from $${SERVICE_PRICING.deepFrom}. Brooklyn, Manhattan & Queens.`
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