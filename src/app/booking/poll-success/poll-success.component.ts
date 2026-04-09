// src/app/poll-success/poll-success.component.ts
import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';

@Component({
  selector: 'app-poll-success',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="poll-success-container">
      <div class="success-card">
        <div class="success-icon">
          <i class="fas fa-check-circle"></i>
        </div>
        <h1>Thank You!</h1>
        <p class="success-message">
          Your request for <strong>{{ serviceType }}</strong> has been submitted successfully.
        </p>
        <p class="next-steps">
          Our team will review your information and contact you within 24 hours with a customized quote.
        </p>
        <div class="actions">
          <button class="btn-primary" (click)="goHome()">Return to Home</button>
          <button class="btn-secondary" (click)="bookAnother()">Request Another Quote</button>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .poll-success-container {
      min-height: 80vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 2rem;
    }

    .success-card {
      background: var(--surface);
      border-radius: 12px;
      box-shadow: 0 4px 20px var(--shadow-color, rgba(0, 0, 0, 0.1));
      padding: 3rem;
      text-align: center;
      max-width: 500px;
      width: 100%;
      border: 1px solid var(--border-color, transparent);
    }

    .success-icon {
      font-size: 4rem;
      color: var(--fresh-green);
      margin-bottom: 1rem;
    }

    h1 {
      margin: 0 0 1rem 0;
      color: var(--text-primary);
      font-size: 2rem;
    }

    .success-message {
      font-size: 1.1rem;
      color: var(--text-secondary);
      margin-bottom: 1rem;
      line-height: 1.5;
    }

    .success-message strong {
      color: var(--text-primary);
    }

    .next-steps {
      background: var(--surface-elevated);
      border-left: 4px solid var(--primary-color);
      padding: 1rem;
      margin: 1.5rem 0;
      border-radius: 0 4px 4px 0;
      font-size: 0.95rem;
      color: var(--text-secondary);
    }

    .actions {
      display: flex;
      gap: 1rem;
      justify-content: center;
      flex-wrap: wrap;
      margin-top: 2rem;
    }

    .btn-primary,
    .btn-secondary {
      padding: 0.75rem 1.5rem;
      border: none;
      border-radius: 6px;
      font-size: 1rem;
      cursor: pointer;
      transition: all 0.3s;
      text-decoration: none;
    }

    .btn-primary {
      background: var(--primary-color);
      color: white;
      
      &:hover {
        background: var(--primary-color-hover);
      }
    }

    .btn-secondary {
      background: var(--btn-secondary);
      color: white;
      box-shadow: var(--btn-secondary-shadow);

      &:hover {
        background: var(--btn-secondary-hover);
        box-shadow: var(--btn-secondary-shadow-hover);
      }
    }
  `]
})
export class PollSuccessComponent implements OnInit {
  serviceType = '';

  constructor(
    private route: ActivatedRoute,
    private router: Router
  ) {}

  ngOnInit() {
    this.serviceType = this.route.snapshot.queryParams['serviceType'] || 'your service';
  }

  goHome() {
    this.router.navigate(['/']);
  }

  bookAnother() {
    this.router.navigate(['/booking']);
  }
}