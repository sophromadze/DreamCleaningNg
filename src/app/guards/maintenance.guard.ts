import { inject } from '@angular/core';
import { Router, CanActivateFn } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { MaintenanceModeService } from '../services/maintenance-mode.service';
import { map, catchError } from 'rxjs/operators';
import { of } from 'rxjs';

export const maintenanceGuard: CanActivateFn = (route, state) => {
  const authService = inject(AuthService);
  const maintenanceModeService = inject(MaintenanceModeService);
  const router = inject(Router);
  
  const currentUser = authService.currentUserValue;
  
  // Allow access for SuperAdmin, Admin, Moderator, and Cleaner roles
  if (currentUser && 
      (currentUser.role === 'SuperAdmin' || 
       currentUser.role === 'Admin' || 
       currentUser.role === 'Moderator' ||
       currentUser.role === 'Cleaner')) {
    return true;
  }
  
  // Check maintenance mode for customers
  return maintenanceModeService.isEnabled().pipe(
    map(isEnabled => {
      if (isEnabled) {
        // Redirect to maintenance page
        router.navigate(['/maintenance']);
        return false;
      }
      return true;
    }),
    catchError(() => {
      // If there's an error checking maintenance mode, allow access
      return of(true);
    })
  );
}; 