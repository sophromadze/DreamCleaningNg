import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideRouter } from '@angular/router';

import { RegisterCustomerModalComponent, RegisteredCustomer } from './register-customer-modal.component';
import { environment } from '../../../../environments/environment';

const REGISTER_URL = `${environment.apiUrl}/admin/users/register`;

describe('RegisterCustomerModalComponent', () => {
  let component: RegisterCustomerModalComponent;
  let fixture: ComponentFixture<RegisterCustomerModalComponent>;
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RegisterCustomerModalComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])]
    }).compileComponents();

    fixture = TestBed.createComponent(RegisterCustomerModalComponent);
    component = fixture.componentInstance;
    httpMock = TestBed.inject(HttpTestingController);

    fixture.componentRef.setInput('open', true);
    fixture.detectChanges();
  });

  afterEach(() => httpMock.verify());

  const fillValid = () => {
    component.form.firstName = 'Jane';
    component.form.lastName = 'Doe';
    component.form.email = 'jane@example.com';
  };

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  /**
   * The 2026-08 incident. An admin typed an address with no "@"; the server rejected it through
   * automatic model validation, whose body has no `message`, and the panel rendered
   * "Http failure response for .../users/register: 400". Two defences are asserted here: the
   * request is not sent at all, and the message names the missing character.
   */
  describe('a mistyped email is explained, not just rejected', () => {
    it('names the missing "@" and never reaches the server', () => {
      fillValid();
      component.form.email = 'janeexample.com';

      component.submit();

      expect(component.errorMessage).toContain('@');
      expect(component.errorMessage).toContain('name@example.com');
      httpMock.expectNone(REGISTER_URL);
    });

    it('reports the problem on blur, next to the field that caused it', () => {
      component.form.email = 'janeexample.com';

      component.onEmailBlur();

      expect(component.errorMessage).toContain('@');
    });

    it('says nothing on blur while the box is still empty', () => {
      component.form.email = '';

      component.onEmailBlur();

      expect(component.errorMessage).toBe('');
    });

    it('clears the standing error as soon as the admin edits anything', () => {
      component.errorMessage = 'Email address is missing the "@" symbol.';

      component.onFieldInput();

      expect(component.errorMessage).toBe('');
    });

    it('does not check the email format for a no-email customer', () => {
      component.form = { firstName: 'Jane', lastName: 'Doe', email: 'garbage', phone: '2125550134', noEmail: true };

      component.submit();

      httpMock.expectOne(REGISTER_URL).flush({ id: 7, firstName: 'Jane', lastName: 'Doe', email: null, isNoEmailUser: true });
      expect(component.errorMessage).toBe('');
    });
  });

  describe('validation', () => {
    it('requires first and last name', () => {
      component.form.email = 'jane@example.com';

      component.submit();

      expect(component.errorMessage).toContain('First name and last name');
      httpMock.expectNone(REGISTER_URL);
    });

    it('requires an email unless the no-email box is ticked', () => {
      component.form.firstName = 'Jane';
      component.form.lastName = 'Doe';

      component.submit();

      expect(component.errorMessage).toContain('no email');
      httpMock.expectNone(REGISTER_URL);
    });

    it('requires a phone for a no-email customer', () => {
      component.form = { firstName: 'Jane', lastName: 'Doe', email: '', phone: '', noEmail: true };

      component.submit();

      expect(component.errorMessage).toContain('Phone is required');
      httpMock.expectNone(REGISTER_URL);
    });
  });

  describe('submitting', () => {
    it('emits the created customer and closes', () => {
      const registered: RegisteredCustomer[] = [];
      const closes: number[] = [];
      component.registered.subscribe(c => registered.push(c));
      component.closed.subscribe(() => closes.push(1));

      fillValid();
      component.submit();

      httpMock.expectOne(REGISTER_URL).flush({
        id: 42, firstName: 'Jane', lastName: 'Doe', email: 'jane@example.com',
        phone: null, role: 'Customer', authProvider: 'Admin', isNoEmailUser: false
      });

      expect(registered.length).toBe(1);
      expect(registered[0].id).toBe(42);
      expect(closes.length).toBe(1);
    });

    it('reports a duplicate email as a duplicate', () => {
      fillValid();
      component.submit();

      httpMock.expectOne(REGISTER_URL).flush({ message: 'A user with this email already exists.' },
        { status: 409, statusText: 'Conflict' });

      expect(component.errorMessage).toContain('already exists');
    });

    /** Whatever slips past the client checks must still arrive as readable text. */
    it('renders a ValidationProblemDetails 400 rather than the transport text', () => {
      fillValid();
      component.submit();

      httpMock.expectOne(REGISTER_URL).flush(
        { title: 'One or more validation errors occurred.', status: 400, errors: { Email: ['The Email field is not a valid e-mail address.'] } },
        { status: 400, statusText: 'Bad Request' });

      expect(component.errorMessage).toContain('not a valid e-mail address');
      expect(component.errorMessage).not.toContain('Http failure response');
    });

    /**
     * Regression: the button was released in `complete`, which RxJS never calls on an HTTP error,
     * so a failed registration left the form stuck on "Registering…" and the admin could not
     * correct the address they had just been told about.
     */
    it('re-enables the form after a failure', () => {
      fillValid();
      component.submit();
      expect(component.isRegistering).toBeTrue();

      httpMock.expectOne(REGISTER_URL).flush({ message: 'Boom.' }, { status: 500, statusText: 'Server Error' });

      expect(component.isRegistering).toBeFalse();
      expect(component.errorMessage).toBe('Boom.');
    });
  });

  it('resets the form each time it is opened', () => {
    fillValid();
    component.errorMessage = 'stale';

    fixture.componentRef.setInput('open', false);
    fixture.detectChanges();
    fixture.componentRef.setInput('open', true);
    fixture.detectChanges();

    expect(component.form).toEqual({ firstName: '', lastName: '', email: '', phone: '', noEmail: false });
    expect(component.errorMessage).toBe('');
  });
});
