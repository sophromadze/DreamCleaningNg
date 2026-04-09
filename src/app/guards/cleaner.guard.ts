import { inject } from '@angular/core';
import { Router, CanActivateFn } from '@angular/router';
import { AuthService } from '../services/auth.service';

export const cleanerGuard: CanActivateFn = (route, state) => {
  const authService = inject(AuthService);
  const router = inject(Router);
  
  const currentUser = authService.currentUserValue;
  
  // Allow access for SuperAdmin, Admin, Moderator, and Cleaner
  // Deny access for Customer role
  if (currentUser && 
      (currentUser.role === 'SuperAdmin' || 
       currentUser.role === 'Admin' || 
       currentUser.role === 'Moderator' ||
       currentUser.role === 'Cleaner')) {
    return true;
  }
  
  // Not logged in or customer role, redirect to home page
  router.navigate(['/']);
  return false;
}; 