import { AbstractControl, FormControl, FormGroup, ValidationErrors } from '@angular/forms';

/**
 * Why this exists
 * ---------------
 * Admins regularly hit "I filled in everything and Book Now is still grey". The gate
 * (`isFormValid()` / `canProceedToNextStep()`) is a big boolean, so when it returns false
 * nothing on screen says which piece is missing — and some of the controls it checks can be
 * invalid without anything visible being wrong (`tips` fails its minimum silently). Those are
 * the cases that look impossible from the outside.
 *
 * This module turns the gate back into a list of named reasons and prints it to the console.
 * It is read-only: it never mutates a control, so calling it is always safe.
 */

/** A single reason the Book Now / Continue button is greyed out. */
export interface BookingBlocker {
  /** Field name as an admin would recognise it on the page. */
  field: string;
  /** Internal key (form control name or pseudo-key) so a dev can grep for it. */
  key: string;
  /** Plain-English description of what is wrong. */
  problem: string;
  /** What the control currently holds. */
  value: unknown;
  /** Booking step the field belongs to, or null for conditions that aren't a step field. */
  step: number | null;
  /** Whether the input is actually rendered on the page right now. */
  onScreen: 'yes' | 'no' | 'unknown';
  /**
   * True when no step's own validation checks this field — i.e. the page can look complete
   * and error-free while this alone keeps the button disabled. These are the ones worth
   * shouting about.
   */
  hidden: boolean;
}

/** Everything the diagnostics need from BookingComponent. Read-only snapshot. */
export interface BookingDiagnosticsSnapshot {
  /** Which button the admin clicked. */
  trigger: 'Book Now' | 'Continue' | 'Send for Quote';
  currentStep: number;

  bookingForm: FormGroup;
  serviceTypeControl: FormControl;
  /** The four admin-only custom-pricing controls; pass null when custom pricing is not shown. */
  customPricingControls: {
    customServiceName: FormControl;
    customAmount: FormControl;
    customCleaners: FormControl;
    customDuration: FormControl;
  } | null;

  selectedServiceType: { name?: string } | null;
  selectedSubscription: { name?: string } | null;
  showPollForm: boolean;
  showCustomPricing: boolean;

  pollQuestions: { id: number; question: string; isRequired: boolean }[];
  pollAnswers: { [key: number]: string };

  isAdminMode: boolean;
  selectedTargetUser: { firstName?: string; lastName?: string; email?: string } | null;

  /** Same-day extra selected but today has no free slots (blocks step 1). */
  sameDayFullyBooked: boolean;
  /** Selected date/time falls inside an admin-blocked slot (blocks steps 1 and 2). */
  dateTimeBlocked: boolean;

  /**
   * Property type asked but not answered (blocks step 1).
   *
   * A bespoke field rather than a control, because propertyType and levelsQuantity are plain
   * component fields, not FormControls - the form-walking part of this module cannot see them.
   * Leaving them out is exactly why a blocked Continue reported three step-3 consent fields and
   * never named the thing actually blocking it.
   */
  propertyTypeMissing: boolean;
  /** House chosen on a room-priced service type but no level count picked (blocks step 1). */
  levelsMissing: boolean;

  minTipAmount: number;

  /** The gate results themselves, so the log can show the boolean the button actually reads. */
  gates: {
    isFormValid: boolean;
    canProceedToNextStep: boolean;
    isStep1Valid: boolean;
    isStep2Valid: boolean;
    isStep3Valid: boolean;
  };
}

/** Control name -> label an admin would recognise. */
const CONTROL_LABELS: Record<string, string> = {
  serviceDate: 'Service date',
  serviceTime: 'Service time',
  entryMethod: 'Entry method',
  customEntryMethod: 'Entry method — custom instructions',
  specialInstructions: 'Special instructions',
  contactFirstName: 'First name',
  contactLastName: 'Last name',
  contactEmail: 'Email',
  contactPhone: 'Phone',
  useApartmentAddress: 'Use saved address toggle',
  selectedApartmentId: 'Saved address selection',
  serviceAddress: 'Street address',
  apartmentName: 'Address name (Home / Office / Other dropdown beside the ZIP code)',
  aptSuite: 'Apt / Suite',
  city: 'City',
  state: 'State',
  zipCode: 'ZIP code',
  promoCode: 'Promo code',
  tips: 'Tip for the cleaners',
  cleaningType: 'Cleaning type (standard / deep)',
  smsConsent: 'SMS consent checkbox',
  cancellationConsent: 'Cancellation policy checkbox',
  termsConsent: 'Terms & conditions checkbox',
  serviceTypeControl: 'Service type',
  customServiceName: 'Custom pricing — service name',
  customAmount: 'Custom pricing — total amount',
  customCleaners: 'Custom pricing — number of cleaners',
  customDuration: 'Custom pricing — duration'
};

/** Which step each control is edited on. */
const CONTROL_STEPS: Record<string, number> = {
  serviceTypeControl: 1,
  cleaningType: 1,
  customServiceName: 1,
  customAmount: 1,
  customCleaners: 1,
  customDuration: 1,
  serviceDate: 2,
  serviceTime: 2,
  entryMethod: 2,
  customEntryMethod: 2,
  specialInstructions: 2,
  tips: 2,
  contactFirstName: 3,
  contactLastName: 3,
  contactEmail: 3,
  contactPhone: 3,
  useApartmentAddress: 3,
  selectedApartmentId: 3,
  serviceAddress: 3,
  apartmentName: 3,
  aptSuite: 3,
  city: 3,
  state: 3,
  zipCode: 3,
  promoCode: 3,
  smsConsent: 3,
  cancellationConsent: 3,
  termsConsent: 3
};

/**
 * Controls that at least one step's own validation gate checks. Anything invalid that is
 * NOT in here can block the button while every visible step reports itself as complete.
 * Keep in sync with isStep1Valid / isStep2Valid / isStep3Valid in BookingComponent.
 */
const STEP_GATED_CONTROLS = new Set([
  'serviceTypeControl',
  'cleaningType',
  'customServiceName',
  'customAmount',
  'customCleaners',
  'customDuration',
  'serviceDate',
  'serviceTime',
  'entryMethod',
  'contactFirstName',
  'contactLastName',
  'contactEmail',
  'contactPhone',
  'serviceAddress',
  'city',
  'state',
  'zipCode',
  'smsConsent',
  'cancellationConsent',
  'termsConsent'
]);

/**
 * Control name -> element id in booking.component.html, for the "is it even on screen?"
 * check. Controls absent from this map report 'unknown' rather than a wrong 'no'.
 */
const CONTROL_ELEMENT_IDS: Record<string, string> = {
  contactFirstName: 'contactFirstName',
  contactLastName: 'contactLastName',
  contactEmail: 'contactEmail',
  contactPhone: 'contactPhone',
  serviceAddress: 'serviceAddress',
  aptSuite: 'aptSuite',
  city: 'city',
  state: 'state',
  zipCode: 'zipCode',
  apartmentName: 'apartmentName',
  customServiceName: 'customServiceName',
  customAmount: 'customAmount',
  customCleaners: 'customCleaners'
};

function labelFor(key: string): string {
  return CONTROL_LABELS[key] ?? key;
}

function onScreenFor(key: string): BookingBlocker['onScreen'] {
  const id = CONTROL_ELEMENT_IDS[key];
  if (!id || typeof document === 'undefined') return 'unknown';
  const el = document.getElementById(id);
  if (!el) return 'no';
  return el.offsetParent !== null || el.getClientRects().length > 0 ? 'yes' : 'no';
}

/** Turn Angular's error object into something an admin can act on. */
function describeErrors(errors: ValidationErrors | null, snapshot: BookingDiagnosticsSnapshot): string {
  if (!errors) return 'is invalid';
  return Object.keys(errors)
    .map(key => {
      const detail = errors[key];
      switch (key) {
        case 'required':
          return 'is empty (required)';
        case 'requiredTrue':
          return 'is not ticked (required)';
        case 'email':
          return 'is not a valid email address';
        case 'pattern':
          return `does not match the required format (expected ${detail?.requiredPattern}, got "${detail?.actualValue}")`;
        case 'minlength':
          return `is too short (needs ${detail?.requiredLength} characters, has ${detail?.actualLength})`;
        case 'maxlength':
          return `is too long (max ${detail?.requiredLength} characters, has ${detail?.actualLength})`;
        case 'min':
          return `is below the minimum of ${detail?.min}`;
        case 'max':
          return `is above the maximum of ${detail?.max}`;
        case 'minTipAmount':
          return `is below the $${snapshot.minTipAmount} minimum tip (clear it or set at least $${snapshot.minTipAmount})`;
        default:
          return `failed the "${key}" rule`;
      }
    })
    .join('; ');
}

function blockerFromControl(
  key: string,
  control: AbstractControl,
  snapshot: BookingDiagnosticsSnapshot
): BookingBlocker {
  return {
    field: labelFor(key),
    key,
    problem: describeErrors(control.errors, snapshot),
    value: control.value,
    step: CONTROL_STEPS[key] ?? null,
    onScreen: onScreenFor(key),
    hidden: !STEP_GATED_CONTROLS.has(key)
  };
}

/**
 * Every reason the button is currently disabled, in the order an admin would fix them.
 * Pure — reads state, changes nothing.
 */
export function collectBookingBlockers(snapshot: BookingDiagnosticsSnapshot): BookingBlocker[] {
  const blockers: BookingBlocker[] = [];
  const push = (b: BookingBlocker) => blockers.push(b);

  // --- Conditions that are not form controls -------------------------------
  if (!snapshot.selectedServiceType) {
    push({
      field: 'Service type',
      key: 'selectedServiceType',
      problem: 'no service type is selected (nothing else can validate until this is set)',
      value: null,
      step: 1,
      onScreen: 'unknown',
      hidden: false
    });
  }

  if (snapshot.serviceTypeControl.invalid) {
    push(blockerFromControl('serviceTypeControl', snapshot.serviceTypeControl, snapshot));
  }

  if (!snapshot.selectedSubscription) {
    push({
      field: 'Frequency / subscription',
      key: 'selectedSubscription',
      problem: 'no frequency is selected (one-time, weekly, …)',
      value: null,
      step: 2,
      onScreen: 'unknown',
      hidden: false
    });
  }

  if (snapshot.isAdminMode && !snapshot.selectedTargetUser) {
    push({
      field: 'Admin mode — customer',
      key: 'selectedTargetUser',
      problem: 'admin mode is on but no customer has been picked to book for',
      value: null,
      step: 1,
      onScreen: 'unknown',
      hidden: false
    });
  }

  if (snapshot.sameDayFullyBooked) {
    push({
      field: 'Same-day service',
      key: 'sameDayFullyBooked',
      problem: 'same-day service is selected but today has no free time slots left',
      value: true,
      step: 1,
      onScreen: 'unknown',
      hidden: false
    });
  }

  if (snapshot.dateTimeBlocked) {
    push({
      field: 'Service date / time',
      key: 'dateTimeBlocked',
      problem: 'the selected date and time fall inside an admin-blocked slot',
      value: true,
      step: 2,
      onScreen: 'unknown',
      hidden: false
    });
  }

  if (snapshot.propertyTypeMissing) {
    push({
      field: 'Property type',
      key: 'propertyType',
      problem: 'neither Apartment / Condo nor House / Townhouse has been selected',
      value: null,
      step: 1,
      onScreen: 'yes',
      hidden: false
    });
  }

  if (snapshot.levelsMissing) {
    push({
      field: 'Levels',
      key: 'levelsQuantity',
      problem: 'House is selected but no level count has been chosen',
      value: null,
      step: 1,
      onScreen: 'yes',
      hidden: false
    });
  }

  // --- Poll (quote request) questions --------------------------------------
  if (snapshot.showPollForm) {
    for (const question of snapshot.pollQuestions) {
      const answer = snapshot.pollAnswers[question.id];
      if (question.isRequired && (!answer || answer.trim() === '')) {
        push({
          field: `Quote question: "${question.question}"`,
          key: `pollAnswers[${question.id}]`,
          problem: 'required question is unanswered',
          value: answer ?? null,
          step: 1,
          onScreen: 'unknown',
          hidden: false
        });
      }
    }
  }

  // --- Custom pricing controls (they live outside bookingForm) --------------
  if (snapshot.showCustomPricing && snapshot.customPricingControls) {
    for (const [key, control] of Object.entries(snapshot.customPricingControls)) {
      if (control.invalid) push(blockerFromControl(key, control, snapshot));
    }
  }

  // --- Every invalid control in bookingForm, including ones no step renders --
  for (const key of Object.keys(snapshot.bookingForm.controls)) {
    const control = snapshot.bookingForm.get(key);
    if (control && control.invalid) {
      push(blockerFromControl(key, control, snapshot));
    }
  }

  return blockers;
}

function formatValue(value: unknown): string {
  if (value === null) return '(null)';
  if (value === undefined) return '(undefined)';
  if (value === '') return '(empty)';
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

/**
 * Print the full explanation to the console. Called when an admin clicks a button that
 * the validation gate has greyed out.
 */
export function logBookingBlockers(snapshot: BookingDiagnosticsSnapshot): void {
  if (typeof console === 'undefined') return;

  const blockers = collectBookingBlockers(snapshot);
  const heading = `[Booking] "${snapshot.trigger}" is disabled — ${blockers.length} blocker(s) on step ${snapshot.currentStep}`;

  console.group(`%c${heading}`, 'color:#ef4444;font-weight:700');

  if (blockers.length > 0) {
    console.table(
      blockers.map(b => ({
        Field: b.field,
        Problem: b.problem,
        'Current value': formatValue(b.value),
        'On screen now': b.onScreen,
        Step: b.step ?? '—',
        'Hidden blocker': b.hidden ? 'YES' : '',
        Control: b.key
      }))
    );

    const hidden = blockers.filter(b => b.hidden);
    if (hidden.length > 0) {
      console.warn(
        `${hidden.length} blocker(s) are not validated by any visible step — this is why the page looks ` +
          `complete but the button stays grey:\n` +
          hidden.map(b => `  • ${b.field} [${b.key}] — ${b.problem}`).join('\n')
      );
    }

    console.info('Fix the fields above and the button enables itself — no refresh needed.');
  } else {
    console.warn(
      'No blocking field was found, yet the gate returned false. The cause is one of the ' +
        'conditions below, not a form field — send this whole log to the developer.'
    );
  }

  console.groupCollapsed('Gate results (the booleans the button reads)');
  console.log({
    ...snapshot.gates,
    currentStep: snapshot.currentStep,
    'bookingForm.valid': snapshot.bookingForm.valid,
    'serviceTypeControl.valid': snapshot.serviceTypeControl.valid
  });
  console.groupEnd();

  console.groupCollapsed('Context');
  console.log({
    serviceType: snapshot.selectedServiceType?.name ?? null,
    subscription: snapshot.selectedSubscription?.name ?? null,
    showPollForm: snapshot.showPollForm,
    showCustomPricing: snapshot.showCustomPricing,
    isAdminMode: snapshot.isAdminMode,
    bookingFor: snapshot.selectedTargetUser
      ? `${snapshot.selectedTargetUser.firstName ?? ''} ${snapshot.selectedTargetUser.lastName ?? ''} <${snapshot.selectedTargetUser.email ?? ''}>`.trim()
      : null,
    sameDayFullyBooked: snapshot.sameDayFullyBooked,
    dateTimeBlocked: snapshot.dateTimeBlocked,
    propertyTypeMissing: snapshot.propertyTypeMissing,
    levelsMissing: snapshot.levelsMissing,
    url: typeof location !== 'undefined' ? location.href : null
  });
  console.groupEnd();

  console.groupEnd();
}
