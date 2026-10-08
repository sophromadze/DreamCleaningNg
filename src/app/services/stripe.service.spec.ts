import { TestBed } from '@angular/core/testing';

import { StripeService, WalletButtonOptions } from './stripe.service';
import { ThemeService } from './theme.service';

import { testProviders } from '../../testing/test-providers';

describe('StripeService', () => {
  let service: StripeService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [...testProviders],
    });
    service = TestBed.inject(StripeService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  // ── Apple Pay / Google Pay (2026-10) ────────────────────────────────────────────────────────
  //
  // Stripe.js 10 (endive) no longer ships the Payment Request Button. Its replacement is the
  // Express Checkout Element, used here ONLY to obtain a card PaymentMethod: every page then
  // charges it against its own PaymentIntent through confirmPaymentRequest, exactly as before.
  describe('the wallet button (Express Checkout Element)', () => {
    type Handler = (event: any) => unknown;
    let handlers: Record<string, Handler>;
    let button: { on: ReturnType<typeof vi.fn>; mount: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn> };
    let group: { create: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn>; submit: ReturnType<typeof vi.fn> };
    let stripe: { elements: ReturnType<typeof vi.fn>; createPaymentMethod: ReturnType<typeof vi.fn> };
    let options: WalletButtonOptions;
    let host: HTMLElement;

    beforeEach(() => {
      handlers = {};
      button = {
        on: vi.fn((name: string, cb: Handler) => { handlers[name] = cb; return button; }),
        mount: vi.fn(),
        destroy: vi.fn(),
      };
      group = { create: vi.fn(() => button), update: vi.fn(), submit: vi.fn(async () => ({})) };
      stripe = {
        elements: vi.fn(() => group),
        createPaymentMethod: vi.fn(async () => ({ paymentMethod: { id: 'pm_wallet' } })),
      };
      (service as any).stripe = stripe;

      host = document.createElement('div');
      host.id = 'wallet-host';
      document.body.appendChild(host);

      options = {
        elementId: 'wallet-host',
        amount: 386.16,
        canStart: vi.fn(() => true),
        onAvailability: vi.fn(),
        onPaymentMethod: vi.fn(),
        onError: vi.fn(),
      };
    });

    afterEach(() => {
      service.destroyWalletButton();
      host.remove();
    });

    it('creates a deferred, card-only group that only creates a payment method', async () => {
      expect(await service.mountWalletButton(options)).toBe(true);

      expect(stripe.elements).toHaveBeenCalledWith({
        mode: 'payment',
        amount: 38616,
        currency: 'usd',
        paymentMethodCreation: 'manual',
        allowedPaymentMethodTypes: ['card'],
      });
      expect(group.create).toHaveBeenCalledWith('expressCheckout', expect.objectContaining({
        paymentMethods: { applePay: 'auto', googlePay: 'auto', link: 'never', paypal: 'never', amazonPay: 'never', klarna: 'never' },
        buttonHeight: 48,
        layout: { maxColumns: 1, maxRows: 0, overflow: 'never' },
      }));
      expect(button.mount).toHaveBeenCalledWith('#wallet-host');
    });

    it('does not mount when the container is missing', async () => {
      host.remove();
      expect(await service.mountWalletButton(options)).toBe(false);
      expect(stripe.elements).not.toHaveBeenCalled();
    });

    it('reports availability only for Apple Pay or Google Pay', async () => {
      await service.mountWalletButton(options);

      handlers['ready']({ availablePaymentMethods: undefined });
      handlers['ready']({ availablePaymentMethods: { applePay: false, googlePay: false, link: true, paypal: false, amazonPay: false, klarna: false } });
      handlers['ready']({ availablePaymentMethods: { applePay: true, googlePay: false, link: false, paypal: false, amazonPay: false, klarna: false } });

      expect(vi.mocked(options.onAvailability).mock.calls).toEqual([[false], [false], [true]]);
    });

    it('keeps the sheet closed while the page is already paying', async () => {
      await service.mountWalletButton(options);
      const event = { resolve: vi.fn(), reject: vi.fn() };

      vi.mocked(options.canStart).mockReturnValue(false);
      handlers['click'](event);
      expect(event.reject).toHaveBeenCalled();
      expect(event.resolve).not.toHaveBeenCalled();

      vi.mocked(options.canStart).mockReturnValue(true);
      handlers['click'](event);
      expect(event.resolve).toHaveBeenCalledTimes(1);
    });

    it('hands the created card payment method to the page and charges nothing itself', async () => {
      await service.mountWalletButton(options);
      const event = { paymentFailed: vi.fn() };

      await handlers['confirm'](event);

      expect(group.submit).toHaveBeenCalled();
      expect(stripe.createPaymentMethod).toHaveBeenCalledWith({ elements: group });
      expect(options.onPaymentMethod).toHaveBeenCalledWith('pm_wallet');
      expect(event.paymentFailed).not.toHaveBeenCalled();
    });

    it('fails the sheet and reports the reason when the payment method cannot be created', async () => {
      await service.mountWalletButton(options);
      stripe.createPaymentMethod.mockResolvedValue({ error: { message: 'Your card was declined.' } });
      const event = { paymentFailed: vi.fn() };

      await handlers['confirm'](event);

      expect(event.paymentFailed).toHaveBeenCalledWith({ reason: 'fail' });
      expect(options.onError).toHaveBeenCalledWith('Your card was declined.');
      expect(options.onPaymentMethod).not.toHaveBeenCalled();
    });

    it('fails the sheet when the wallet details do not validate', async () => {
      await service.mountWalletButton(options);
      group.submit.mockResolvedValue({ error: { message: 'Incomplete details.' } });
      const event = { paymentFailed: vi.fn() };

      await handlers['confirm'](event);

      expect(event.paymentFailed).toHaveBeenCalled();
      expect(stripe.createPaymentMethod).not.toHaveBeenCalled();
      expect(options.onError).toHaveBeenCalledWith('Incomplete details.');
    });

    it('keeps the amount on the sheet in step with the page', async () => {
      service.updateWalletAmount(100); // nothing mounted yet: no-op
      await service.mountWalletButton(options);

      service.updateWalletAmount(250.5);
      service.updateWalletAmount(0); // a fully covered total never reaches the sheet

      expect(group.update.mock.calls).toEqual([[{ amount: 25050 }]]);
    });

    it('follows the site theme, rebuilding the button on a flip', async () => {
      const theme = TestBed.inject(ThemeService);
      theme.setTheme('light');
      await service.mountWalletButton(options);
      expect(group.create.mock.lastCall![1].buttonTheme).toEqual({ applePay: 'white', googlePay: 'white' });

      theme.setTheme('dark');

      expect(button.destroy).toHaveBeenCalled();
      expect(group.create).toHaveBeenCalledTimes(2);
      expect(group.create.mock.lastCall![1].buttonTheme).toEqual({ applePay: 'black', googlePay: 'black' });
      theme.setTheme('light');
    });

    it('destroys the button and forgets the page', async () => {
      await service.mountWalletButton(options);
      service.destroyWalletButton();

      expect(button.destroy).toHaveBeenCalled();
      service.updateWalletAmount(10);
      expect(group.update).not.toHaveBeenCalled();
    });
  });
});
