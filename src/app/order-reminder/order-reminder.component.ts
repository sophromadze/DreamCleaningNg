import { Component, OnInit, OnDestroy, PLATFORM_ID, ChangeDetectionStrategy, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Subscription } from 'rxjs';
import { OrderReminderService, OrderReminder } from '../services/order-reminder.service';
import { AuthService } from '../services/auth.service';
import { IconComponent } from '../shared/icons/icon.component';
import { IconDefinition } from '../shared/icons/icon-definition';
import { faCheck } from '../shared/icons/glyphs/faCheck';
import { faCirclePlay } from '../shared/icons/glyphs/faCirclePlay';
import { faCircleStop } from '../shared/icons/glyphs/faCircleStop';

@Component({
  selector: 'app-order-reminder',
  standalone: true,
  imports: [IconComponent],
  templateUrl: './order-reminder.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ['./order-reminder.component.scss']
})
export class OrderReminderComponent implements OnInit, OnDestroy {
  private reminderService = inject(OrderReminderService);
  private authService = inject(AuthService);
  private platformId = inject<Object>(PLATFORM_ID);

  protected readonly icons = { faCheck };

  readonly activeReminders = signal<OrderReminder[]>([]);
  readonly modalReminder = signal<OrderReminder | null>(null);
  readonly isAdmin = signal(false);
  isBrowser: boolean;

  private subscriptions: Subscription[] = [];

  constructor() {
    this.isBrowser = isPlatformBrowser(this.platformId);
  }

  ngOnInit() {
    if (!this.isBrowser) return;

    this.subscriptions.push(
      this.authService.currentUser.subscribe(user => {
        this.isAdmin.set(user?.role === 'Admin');
      })
    );

    this.subscriptions.push(
      this.reminderService.activeReminders$.subscribe(reminders => {
        this.activeReminders.set(reminders);
      })
    );

    this.subscriptions.push(
      this.reminderService.modalReminder$.subscribe(reminder => {
        this.modalReminder.set(reminder);
      })
    );
  }

  ngOnDestroy() {
    this.subscriptions.forEach(s => s.unsubscribe());
  }

  onModalOk(): void {
    if (this.modalReminder()) {
      this.reminderService.acknowledgeReminder(this.modalReminder()!.orderId, this.modalReminder()!.type);
    }
  }

  onDismiss(reminder: OrderReminder): void {
    this.reminderService.acknowledgeReminder(reminder.orderId, reminder.type);
  }

  getReminderIcon(type: 'start' | 'end'): IconDefinition {
    return type === 'start' ? faCirclePlay : faCircleStop;
  }
}
