import { Component, Inject, PLATFORM_ID } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { Router } from '@angular/router';

@Component({
  selector: 'app-client-only-notice',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="client-only-notice" *ngIf="!isBrowser">
      <div class="notice-content">
        <h2>Client-Only Content</h2>
        <p>This content is only available in the browser environment.</p>
        <button (click)="goHome()" class="btn-primary">Go to Home</button>
      </div>
    </div>
  `,
  styles: [`
    .client-only-notice {
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 50vh;
      padding: 2rem;
    }
    
    .notice-content {
      text-align: center;
      max-width: 400px;
      padding: 2rem;
      border: 1px solid #ddd;
      border-radius: 8px;
      background: #f9f9f9;
    }
    
    .btn-primary {
      background: var(--primary-color);
      color: white;
      border: none;
      padding: 0.5rem 1rem;
      border-radius: 4px;
      cursor: pointer;
      margin-top: 1rem;
    }
    
    .btn-primary:hover {
      background: var(--primary-color-hover);
    }
  `]
})
export class ClientOnlyNoticeComponent {
  isBrowser: boolean;

  constructor(
    @Inject(PLATFORM_ID) private platformId: Object,
    private router: Router
  ) {
    this.isBrowser = isPlatformBrowser(this.platformId);
  }

  goHome() {
    this.router.navigate(['/']);
  }
} 