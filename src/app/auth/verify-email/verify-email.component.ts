// src/app/auth/verify-email/verify-email.component.ts
import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-verify-email',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './verify-email.component.html',
  styleUrls: ['./verify-email.component.scss']
})
export class VerifyEmailComponent implements OnInit {
  isVerifying = true;
  isSuccess = false;
  errorMessage = '';

  constructor(
    private route: ActivatedRoute,
    private authService: AuthService,
    private router: Router
  ) {}

  ngOnInit() {
    const raw = this.route.snapshot.queryParams['token'];
    const token = typeof raw === 'string' ? raw.trim() : raw;
    if (token) {
      this.verifyEmail(token);
    } else {
      this.errorMessage = 'Invalid verification link';
      this.isVerifying = false;
    }
  }

  verifyEmail(token: string) {
    this.authService.verifyEmail(token).subscribe({
      next: () => {
        this.isSuccess = true;
        this.isVerifying = false;
        setTimeout(() => {
          this.router.navigate(['/login']);
        }, 3000);
      },
      error: (error) => {
        this.errorMessage = error.error?.message || 'Verification failed. The link may be expired or invalid.';
        this.isVerifying = false;
      }
    });
  }
}