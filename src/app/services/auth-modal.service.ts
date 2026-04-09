import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class AuthModalService {
  private isOpenSubject = new BehaviorSubject<boolean>(false);
  private initialModeSubject = new BehaviorSubject<'login' | 'register'>('login');
  private returnUrlSubject = new BehaviorSubject<string | null>(null);
  
  public isOpen$: Observable<boolean> = this.isOpenSubject.asObservable();
  public initialMode$: Observable<'login' | 'register'> = this.initialModeSubject.asObservable();
  public returnUrl$: Observable<string | null> = this.returnUrlSubject.asObservable();

  open(mode: 'login' | 'register' = 'login', returnUrl?: string): void {
    this.initialModeSubject.next(mode);
    if (returnUrl) {
      this.returnUrlSubject.next(returnUrl);
    }
    this.isOpenSubject.next(true);
  }

  close(): void {
    this.isOpenSubject.next(false);
    // Clear return URL after closing
    setTimeout(() => {
      this.returnUrlSubject.next(null);
    }, 100);
  }

  getIsOpen(): boolean {
    return this.isOpenSubject.value;
  }

  getInitialMode(): 'login' | 'register' {
    return this.initialModeSubject.value;
  }

  getReturnUrl(): string | null {
    return this.returnUrlSubject.value;
  }
}
