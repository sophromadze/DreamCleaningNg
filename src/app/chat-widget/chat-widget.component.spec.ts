import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpTestingController } from '@angular/common/http/testing';
import { of } from 'rxjs';

import { ChatWidgetComponent } from './chat-widget.component';
import { AuthService } from '../services/auth.service';
import { testProviders } from '../../testing/test-providers';

/**
 * THE TWO THINGS A VISITOR COULD NOT DO (2026-09).
 *
 * From a real transcript: a couple looking for cleaning WORK were run through the booking
 * funnel, and when the assistant stopped understanding them the reply was "I'm not sure what
 * you mean" plus a phone number. Two widget-side gaps made that worse than it had to be.
 *
 *  1. THE EMAIL FIELD WAS UNREACHABLE IN PRACTICE. It hid itself as soon as `messages.length`
 *     went above zero — i.e. the instant the visitor typed their first message — so the only
 *     window to fill it in was before anyone had said anything, and nobody did. It now has its
 *     own submit button, and a successfully submitted address is the ONLY thing that hides it.
 *
 *  2. THERE WAS NO WAY TO ASK FOR A PERSON. Reaching a human meant convincing the assistant to
 *     escalate — the same assistant that was misreading the visitor. The handoff bar goes
 *     straight to the team through its own endpoint.
 *
 * The assistant's own side of this (recognising "a cleaning job", "my husband", "do you pay
 * cash") lives in the system prompt and is guarded by ChatAgentHumanHandoffTests.
 */
describe('ChatWidgetComponent', () => {
  let fixture: ComponentFixture<ChatWidgetComponent>;
  let component: ChatWidgetComponent;
  let http: HttpTestingController;

  // The test environment points at an absolute apiUrl, so requests are matched on the tail of
  // the URL rather than on a literal path.
  const endsWith = (path: string) => (r: { url: string }) => r.url.endsWith(path);

  beforeEach(async () => {
    localStorage.removeItem('chatWidgetSession');

    await TestBed.configureTestingModule({
      imports: [ChatWidgetComponent],
      providers: [
        ...testProviders,
        // The real AuthService reads localStorage and schedules token refreshes on
        // construction; the widget only ever reads currentUser.
        { provide: AuthService, useValue: { currentUser: of(null) } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ChatWidgetComponent);
    component = fixture.componentInstance;
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    fixture.destroy();
    http.verify();
    localStorage.removeItem('chatWidgetSession');
  });

  /** Boot as a guest with the widget enabled, panel open. */
  const openAsGuest = () => {
    fixture.detectChanges();
    http.expectOne(endsWith('/chat/widget-visibility')).flush({ visible: true });
    fixture.detectChanges();

    component.toggleOpen();
    fixture.detectChanges();
  };

  /** Send a message and answer it, so the widget has a session and a transcript. */
  const sendFirstMessage = (text = 'Hey I need cleaning job and my husband') => {
    component.draft = text;
    component.send();

    const request = http.expectOne(endsWith('/chat/message'));
    request.flush({
      sessionId: 'session-1',
      reply: 'Just to check — are you looking to book a cleaning, or for a job with our team?',
      escalated: false,
    });
    fixture.detectChanges();
    return request;
  };

  const emailField = () =>
    fixture.nativeElement.querySelector('.chat-panel__email-field') as HTMLInputElement | null;
  const handoffButton = () =>
    fixture.nativeElement.querySelector('.chat-panel__handoff-btn') as HTMLButtonElement | null;

  it('should create', () => {
    openAsGuest();
    expect(component).toBeTruthy();
  });

  // ===== The email field =====

  describe('the guest email field', () => {
    it('is still on screen after the first message — the regression', () => {
      openAsGuest();
      expect(emailField()).not.toBeNull();

      sendFirstMessage();

      // The old rule was `messages.length === 0`, which this send has just falsified.
      expect(component.showEmailField).toBeTrue();
      expect(emailField()).not.toBeNull();
    });

    it('names what is wrong with a mistyped address, and keeps the field up', () => {
      openAsGuest();

      component.guestEmailInput = 'sophieexample.com';
      component.submitGuestEmail();
      fixture.detectChanges();

      // The same wording the admin panel gets — "invalid email" would leave the visitor
      // hunting for which character is wrong.
      expect(component.guestEmailError).toContain('@');
      expect(component.guestEmailSaved).toBeFalse();
      expect(emailField()).not.toBeNull();
      // Nothing was sent anywhere — there is no session yet and the value is not usable.
      http.expectNone(endsWith('/guest-email'));
    });

    it('holds an address submitted before the first message and sends it with that message', () => {
      openAsGuest();

      component.guestEmailInput = 'sophie@example.com';
      component.submitGuestEmail();
      fixture.detectChanges();

      // Accepted locally: there is no session to POST it against yet.
      expect(component.guestEmailSaved).toBeTrue();
      expect(emailField()).toBeNull();

      const request = sendFirstMessage();
      expect(request.request.body.guestEmail).toBe('sophie@example.com');
    });

    it('does NOT send an address that was typed but never submitted', () => {
      openAsGuest();

      // Typing alone must not count: the button is what the visitor uses to confirm, and the
      // field is still on screen waiting for them to press it.
      component.guestEmailInput = 'half-typed@exa';
      const request = sendFirstMessage();

      expect(request.request.body.guestEmail).toBeNull();
      expect(component.showEmailField).toBeTrue();
    });

    it('posts an address submitted mid-conversation to its own endpoint', () => {
      openAsGuest();
      sendFirstMessage();

      component.guestEmailInput = 'sophie@example.com';
      component.submitGuestEmail();

      const save = http.expectOne(endsWith('/chat/session/session-1/guest-email'));
      expect(save.request.body).toEqual({ email: 'sophie@example.com' });
      save.flush({ status: 'saved' });
      fixture.detectChanges();

      expect(component.guestEmailSaved).toBeTrue();
      expect(emailField()).toBeNull();
    });

    it('keeps the field up when the server rejects the address', () => {
      openAsGuest();
      sendFirstMessage();

      component.guestEmailInput = 'sophie@example.com';
      component.submitGuestEmail();

      http.expectOne(endsWith('/guest-email')).flush(
        { message: 'Email address is missing the "@" symbol. It should look like name@example.com.' },
        { status: 400, statusText: 'Bad Request' }
      );
      fixture.detectChanges();

      expect(component.guestEmailSaved).toBeFalse();
      expect(component.guestEmailError).toContain('@');
      expect(emailField()).not.toBeNull();
    });
  });

  // ===== Talk to a real person =====

  describe('the human handoff', () => {
    it('is offered from the first moment the panel is open, before anything is typed', () => {
      openAsGuest();

      expect(component.showHumanHandoff).toBeTrue();
      expect(handoffButton()).not.toBeNull();
    });

    it('asks before paging the team', () => {
      openAsGuest();

      component.askForHuman();
      fixture.detectChanges();

      // One stray tap must not create a Telegram topic and an escalation email.
      expect(component.confirmingHumanRequest).toBeTrue();
      http.expectNone(endsWith('/request-human'));

      component.cancelHumanRequest();
      fixture.detectChanges();
      expect(handoffButton()).not.toBeNull();
    });

    it('escalates on confirmation and replaces the bar with the escalated state', () => {
      openAsGuest();
      sendFirstMessage();

      component.askForHuman();
      component.confirmHumanRequest();

      const request = http.expectOne(endsWith('/chat/request-human'));
      expect(request.request.body.sessionId).toBe('session-1');
      request.flush({
        sessionId: 'session-1',
        reply: "I've forwarded this conversation to our team.",
        escalated: true,
      });

      // syncHistory() adopts the server's ids so polling can't duplicate the bubbles.
      http.expectOne(endsWith('/chat/session/session-1/messages')).flush({
        sessionId: 'session-1',
        status: 'escalatedToHuman',
        messages: [],
      });
      fixture.detectChanges();

      expect(component.escalated).toBeTrue();
      expect(component.showHumanHandoff).toBeFalse();
      expect(handoffButton()).toBeNull();
    });

    it('works before the visitor has typed anything, and adopts the session the server creates', () => {
      openAsGuest();

      component.askForHuman();
      component.confirmHumanRequest();

      const request = http.expectOne(endsWith('/chat/request-human'));
      expect(request.request.body.sessionId).toBeNull();
      request.flush({ sessionId: 'session-9', reply: 'Forwarded.', escalated: true });

      http.expectOne(endsWith('/chat/session/session-9/messages')).flush({
        sessionId: 'session-9',
        status: 'escalatedToHuman',
        messages: [],
      });
      fixture.detectChanges();

      expect(component.escalated).toBeTrue();
    });

    it('points at the phone number when the handoff itself fails', () => {
      openAsGuest();

      component.askForHuman();
      component.confirmHumanRequest();
      http.expectOne(endsWith('/request-human')).flush(null, { status: 500, statusText: 'Server Error' });
      fixture.detectChanges();

      // Failing to reach the team is exactly when a dead end is least acceptable.
      expect(component.error).toContain('929');
      expect(component.requestingHuman).toBeFalse();
    });
  });
});
