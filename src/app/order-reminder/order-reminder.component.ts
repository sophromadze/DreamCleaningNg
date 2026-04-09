import { Component, OnInit, OnDestroy, Inject, PLATFORM_ID } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { Subscription } from 'rxjs';
import { OrderReminderService, OrderReminder } from '../services/order-reminder.service';
import { AuthService } from '../services/auth.service';

@Component({
  selector: 'app-order-reminder',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './order-reminder.component.html',
  styleUrls: ['./order-reminder.component.scss']
})
export class OrderReminderComponent implements OnInit, OnDestroy {
  activeReminders: OrderReminder[] = [];
  modalReminder: OrderReminder | null = null;
  isAdmin = false;
  isBrowser: boolean;

  private subscriptions: Subscription[] = [];

  constructor(
    private reminderService: OrderReminderService,
    private authService: AuthService,
    @Inject(PLATFORM_ID) private platformId: Object
  ) {
    this.isBrowser = isPlatformBrowser(this.platformId);
  }

  ngOnInit() {
    if (!this.isBrowser) return;

    this.subscriptions.push(
      this.authService.currentUser.subscribe(user => {
        this.isAdmin = user?.role === 'Admin';
      })
    );

    this.subscriptions.push(
      this.reminderService.activeReminders$.subscribe(reminders => {
        this.activeReminders = reminders;
      })
    );

    this.subscriptions.push(
      this.reminderService.modalReminder$.subscribe(reminder => {
        this.modalReminder = reminder;
      })
    );
  }

  ngOnDestroy() {
    this.subscriptions.forEach(s => s.unsubscribe());
  }

  onModalOk(): void {
    if (this.modalReminder) {
      this.reminderService.acknowledgeReminder(this.modalReminder.orderId, this.modalReminder.type);
    }
  }

  onDismiss(reminder: OrderReminder): void {
    this.reminderService.acknowledgeReminder(reminder.orderId, reminder.type);
  }

  getReminderIcon(type: 'start' | 'end'): string {
    return type === 'start' ? 'fa-play-circle' : 'fa-stop-circle';
  }
}
