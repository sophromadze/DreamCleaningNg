import { Component, Inject, PLATFORM_ID } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { RouterModule } from '@angular/router';

@Component({
  selector: 'app-not-found',
  standalone: true,
  imports: [CommonModule, RouterModule],
  template: `
    <div class="not-found-container">
      <div class="not-found-content">
        <div class="error-code">404</div>
        <h1>Page Not Found</h1>
        <p class="error-message">
          Oops! The page you're looking for doesn't exist.
        </p>
        <p class="error-description">
          It might have been moved, deleted, or you entered the wrong URL.
        </p>
        <div class="actions">
          <button class="btn-primary" routerLink="/">
            <i class="fas fa-home"></i>
            Go to Homepage
          </button>
          <button class="btn-secondary" (click)="goBack()">
            <i class="fas fa-arrow-left"></i>
            Go Back
          </button>
        </div>
        <div class="helpful-links">
          <h3>You might be looking for:</h3>
          <ul>
            <li><a routerLink="/">Homepage</a></li>
            <li><a routerLink="/service-page">Our Services</a></li>
            <li><a routerLink="/booking">Book a Cleaning</a></li>
            <li><a routerLink="/contact">Contact Us</a></li>
            <li><a routerLink="/about">About Us</a></li>
          </ul>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .not-found-container {
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background: var(--soft-blue);
      padding: 20px;
    }

    .not-found-content {
      background: white;
      border-radius: 20px;
      padding: 40px;
      text-align: center;
      max-width: 600px;
      box-shadow: 0 20px 40px rgba(0, 0, 0, 0.1);
    }

    .error-code {
      font-size: 120px;
      font-weight: 900;
      color: var(--primary-color);
      line-height: 1;
      margin-bottom: 20px;
      text-shadow: 2px 2px 4px rgba(0, 0, 0, 0.1);
    }

    h1 {
      color: #333;
      margin-bottom: 16px;
      font-size: 2rem;
      font-weight: 700;
    }

    .error-message {
      font-size: 1.2rem;
      color: #666;
      margin-bottom: 12px;
      line-height: 1.6;
    }

    .error-description {
      font-size: 1rem;
      color: #888;
      margin-bottom: 32px;
      line-height: 1.6;
    }

    .actions {
      display: flex;
      gap: 16px;
      justify-content: center;
      margin-bottom: 32px;
      flex-wrap: wrap;
    }

    .btn-primary, .btn-secondary {
      padding: 12px 24px;
      border: none;
      border-radius: 8px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.3s ease;
      display: flex;
      align-items: center;
      gap: 8px;
      text-decoration: none;
      font-size: 14px;
    }

    .btn-primary {
      background: var(--btn-primary);
      color: white;
      
      &:hover {
        background: var(--btn-primary-hover);
        transform: translateY(-2px);
        box-shadow: var(--btn-primary-shadow);
      }
    }

    .btn-secondary {
      background: #f8f9fa;
      color: #333;
      border: 1px solid #e9ecef;
      
      &:hover {
        background: #e9ecef;
        transform: translateY(-2px);
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
      }
    }

    .helpful-links {
      border-top: 2px solid #eee;
      padding-top: 24px;
      text-align: left;
    }

    .helpful-links h3 {
      color: #333;
      margin-bottom: 16px;
      font-size: 1.1rem;
      text-align: center;
    }

    .helpful-links ul {
      list-style: none;
      padding: 0;
      margin: 0;
      display: flex;
      flex-wrap: wrap;
      justify-content: center;
      gap: 16px;
    }

    .helpful-links li {
      margin: 0;
    }

    .helpful-links a {
      color: var(--primary-color);
      text-decoration: none;
      font-weight: 500;
      padding: 8px 16px;
      border-radius: 6px;
      transition: all 0.3s ease;
      display: inline-block;
      
      &:hover {
        color: var(--primary-color-hover);
        transform: translateY(-1px);
      }
    }

    @media (max-width: 768px) {
      .not-found-content {
        padding: 30px 20px;
      }

      .error-code {
        font-size: 80px;
      }

      h1 {
        font-size: 1.5rem;
      }

      .actions {
        flex-direction: column;
        align-items: center;
      }

      .btn-primary, .btn-secondary {
        width: 100%;
        max-width: 250px;
        justify-content: center;
      }

      .helpful-links ul {
        flex-direction: column;
        align-items: center;
      }
    }
  `]
})
export class NotFoundComponent {
  private isBrowser: boolean;

  constructor(@Inject(PLATFORM_ID) private platformId: Object) {
    this.isBrowser = isPlatformBrowser(this.platformId);
  }

  goBack() {
    if (this.isBrowser) {
      window.history.back();
    }
  }
} 