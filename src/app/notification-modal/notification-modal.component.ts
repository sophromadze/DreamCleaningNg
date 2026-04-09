import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subscription } from 'rxjs';
import { SignalRService, UserNotification } from '../services/signalr.service';

@Component({
  selector: 'app-notification-modal',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './notification-modal.component.html',
  styleUrls: ['./notification-modal.component.scss']
})
export class NotificationModalComponent implements OnInit, OnDestroy {
  showModal = false;
  currentNotification: UserNotification | null = null;
  private subscription?: Subscription;

  constructor(private signalRService: SignalRService) {}

  ngOnInit() {
    // Subscribe to notifications
    this.subscription = this.signalRService.notifications$.subscribe(notification => {
      if (notification) {
        this.currentNotification = notification;
        this.showModal = true;
      }
    });
  }

  ngOnDestroy() {
    this.subscription?.unsubscribe();
  }

  closeModal() {
    this.showModal = false;
    this.signalRService.clearNotifications();
  }

  getTitle(): string {
    if (this.currentNotification?.type === 'accountUpdated' && this.currentNotification?.title) {
      return this.currentNotification.title;
    }
    if (this.currentNotification?.type === 'accountUpdated') {
      return 'Account Updated';
    }
    switch (this.currentNotification?.type) {
      case 'blocked':
        return 'Account Blocked';
      case 'unblocked':
        return 'Account Unblocked';
      case 'roleChanged':
        return 'Role Updated';
      case 'forceLogout':
        return 'Session Terminated';
      case 'userDeleted':
        return 'Account Deleted';
      default:
        return 'Notification';
    }
  }

  getHeaderClass(): string {
    const typeMap: { [key: string]: string } = {
      'blocked': 'blocked',
      'unblocked': 'unblocked',
      'roleChanged': 'role-changed',
      'accountUpdated': 'account-updated',
      'forceLogout': 'force-logout',
      'userDeleted': 'user-deleted'
    };
    return typeMap[this.currentNotification?.type || ''] || '';
  }

  getIconClass(): string {
    return this.currentNotification?.type || '';
  }

  getIcon(): string {
    switch (this.currentNotification?.type) {
      case 'blocked':
        return '🚫';
      case 'unblocked':
        return '✅';
      case 'roleChanged':
        if (this.currentNotification?.data?.updating) {
          return '⏳';
        } else if (this.currentNotification?.data?.redirecting) {
          return '🔄';
        } else if (this.currentNotification?.data?.success) {
          return '🎉';
        } else {
          return '👤';
        }
      case 'accountUpdated':
        return '📝';
      case 'forceLogout':
        return '⚠️';
      case 'userDeleted':
        return '🗑️';
      default:
        return 'ℹ️';
    }
  }

  hasAction(): boolean {
    // No action buttons - everything is automatic now
    return false;
  }

  getActionText(): string {
    // No action text needed
    return '';
  }

  handleAction() {
    // No action needed - everything is automatic
  }
}