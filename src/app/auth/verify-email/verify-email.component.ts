// src/app/auth/verify-email/verify-email.component.ts
import { Component, OnInit, ChangeDetectionStrategy, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-verify-email',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './verify-email.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ['./verify-email.component.scss']
})
export class VerifyEmailComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private authService = inject(AuthService);
  private router = inject(Router);

  readonly isVerifying = signal(true);
  readonly isSuccess = signal(false);
  readonly errorMessage = signal('');

  ngOnInit() {
    const raw = this.route.snapshot.queryParams['token'];
    const token = typeof raw === 'string' ? raw.trim() : raw;
    if (token) {
      this.verifyEmail(token);
    } else {
      this.errorMessage.set('Invalid verification link');
      this.isVerifying.set(false);
    }
  }

  verifyEmail(token: string) {
    this.authService.verifyEmail(token).subscribe({
      next: () => {
        this.isSuccess.set(true);
        this.isVerifying.set(false);
        setTimeout(() => {
          this.router.navigate(['/login']);
        }, 3000);
      },
      error: (error) => {
        this.errorMessage.set(error.error?.message || 'Verification failed. The link may be expired or invalid.');
        this.isVerifying.set(false);
      }
    });
  }
}