import { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';

export interface PasswordValidationResult {
  isValid: boolean;
  errors: string[];
}

export function validatePassword(password: string): PasswordValidationResult {
  const errors: string[] = [];

  if (!password || password.length === 0) {
    errors.push('Password is required');
    return { isValid: false, errors };
  }

  // Check minimum length
  if (password.length < 8) {
    errors.push('Password must be at least 8 characters long');
  }

  // Check for at least one letter
  if (!/[a-zA-Z]/.test(password)) {
    errors.push('Password must contain at least one letter');
  }

  // Check for at least one number
  if (!/\d/.test(password)) {
    errors.push('Password must contain at least one number');
  }

  // Check for at least one uppercase letter
  if (!/[A-Z]/.test(password)) {
    errors.push('Password must contain at least one uppercase letter');
  }

  // Only printable ASCII (Latin letters, numbers, common keyboard symbols) — no other scripts
  if (!/^[\x20-\x7E]+$/.test(password)) {
    errors.push('Password may only contain Latin letters (A–Z, a–z), numbers, and common keyboard symbols (e.g. ! @ # $ %).');
  }

  return {
    isValid: errors.length === 0,
    errors
  };
}

// Angular reactive form validator
export function passwordValidator(): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    const value = control.value;

    if (!value) {
      return null; // Let required validator handle empty values
    }

    const validation = validatePassword(value);
    
    if (!validation.isValid) {
      return { 
        passwordRequirements: {
          errors: validation.errors
        }
      };
    }

    return null;
  };
}

// Helper function to get all password requirements
export function getPasswordRequirements(): string[] {
  return [
    'At least 8 characters long',
    'At least one uppercase letter',
    'At least one lowercase letter',
    'At least one number',
    'Latin letters, numbers, and common keyboard symbols (e.g. ! @ # $ %)'
  ];
}