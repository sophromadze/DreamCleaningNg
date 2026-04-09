import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MaintenanceModeService, MaintenanceModeStatus } from '../services/maintenance-mode.service';

@Component({
  selector: 'app-maintenance-mode',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="maintenance-container">
      <div class="maintenance-content">
        <div class="maintenance-icon">
          🔧
        </div>
        <h1>We're Under Maintenance</h1>
        <p class="maintenance-message">
          {{ status?.message || 'We are currently performing scheduled maintenance to improve our services.' }}
        </p>
        <p class="maintenance-info">
          We apologize for any inconvenience. Please check back soon!
        </p>
        <div class="maintenance-details" *ngIf="status && status.startedAt">
          <p><strong>Maintenance Started:</strong> {{ formatDate(status.startedAt) }}</p>
        </div>
        <div class="contact-info">
          <p>If you have an urgent matter, please contact us:</p>
          <p><strong>Email:</strong> <a href="mailto:hello@dreamcleaningnearme.com">hello&#64;dreamcleaningnearme.com</a></p>
          <p><strong>Phone:</strong> <a href="tel:+9299301525">(929) 930-1525</a></p>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .maintenance-container {
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background: var(--soft-blue);
      padding: 20px;
    }

    .maintenance-content {
      background: white;
      border-radius: 20px;
      padding: 40px;
      text-align: center;
      max-width: 600px;
      box-shadow: 0 20px 40px rgba(0, 0, 0, 0.1);
    }

    .maintenance-icon {
      font-size: 80px;
      margin-bottom: 20px;
    }

    h1 {
      color: #333;
      margin-bottom: 20px;
      font-size: 2.5rem;
      font-weight: 700;
    }

    .maintenance-message {
      font-size: 1.2rem;
      color: #666;
      margin-bottom: 20px;
      line-height: 1.6;
    }

    .maintenance-info {
      font-size: 1rem;
      color: #888;
      margin-bottom: 30px;
    }

    .maintenance-details {
      background: #f8f9fa;
      border-radius: 10px;
      padding: 20px;
      margin-bottom: 30px;
      text-align: left;
    }

    .maintenance-details p {
      margin: 5px 0;
      color: #555;
    }

    .contact-info {
      border-top: 2px solid #eee;
      padding-top: 20px;
    }

    .contact-info p {
      margin: 5px 0;
      color: #666;
    }

    .contact-info strong {
      color: #333;
    }

    .contact-info a {
      color: var(--primary-color);
      text-decoration: none;
      transition: color 0.3s ease;
    }

    .contact-info a:hover {
      color: var(--primary-color-hover);
      text-decoration: underline;
    }

    @media (max-width: 768px) {
      .maintenance-content {
        padding: 30px 20px;
      }

      h1 {
        font-size: 2rem;
      }

      .maintenance-icon {
        font-size: 60px;
      }
    }
  `]
})
export class MaintenanceModeComponent implements OnInit {
  status: MaintenanceModeStatus | null = null;

  constructor(private maintenanceModeService: MaintenanceModeService) { }

  ngOnInit() {
    this.loadMaintenanceStatus();
  }

  loadMaintenanceStatus() {
    this.maintenanceModeService.getStatus().subscribe({
      next: (status) => {
        this.status = status;
      },
      error: (error) => {
        console.error('Failed to load maintenance status:', error);
      }
    });
  }

  formatDate(date: Date | string | undefined): string {
    if (!date) return '';
    const d = new Date(date);
    return d.toLocaleString();
  }
} 