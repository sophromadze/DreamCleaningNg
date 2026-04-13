import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { AdminService, UserPermissions } from '../../services/admin.service';
import { MaintenanceModeService, MaintenanceModeStatus, ToggleMaintenanceModeRequest } from '../../services/maintenance-mode.service';
import { LiveChatService } from '../../services/live-chat.service';
import { OrdersComponent } from './orders/orders.component';
import { UserManagementComponent } from './user-management/user-management.component';
import { BookingServicesComponent } from './booking-services/booking-services.component';
import { AuditHistoryComponent } from './audit-history/audit-history.component';
import { CommunicationsComponent } from './communications/communications.component';
import { DiscountsComponent } from './discounts/discounts.component';
import { SchedulingComponent } from './scheduling/scheduling.component';

@Component({
  selector: 'app-admin',
  standalone: true,
  imports: [
    CommonModule,
    OrdersComponent,
    UserManagementComponent,
    BookingServicesComponent,
    AuditHistoryComponent,
    CommunicationsComponent,
    DiscountsComponent,
    SchedulingComponent
  ],
  templateUrl: './admin.component.html',
  styleUrls: ['./admin.component.scss']
})
export class AdminComponent implements OnInit {
  // Permissions
  userRole: string = '';
  userPermissions: any = {
    role: '',
    permissions: {
      canView: false,
      canCreate: false,
      canUpdate: false,
      canDelete: false,
      canActivate: false,
      canDeactivate: false
    }
  };

  // UI State
  activeTab: string = 'orders';
  selectedDiscountSubTab: 'promo-codes' | 'special-offers' | 'subscriptions' | 'gift-cards' = 'promo-codes';
  pendingOrderId: number | null = null;
  errorMessage = '';
  successMessage = '';

  // Maintenance Mode
  maintenanceStatus: MaintenanceModeStatus | null = null;
  isTogglingMaintenance = false;

  // Live Chat toggle
  chatEnabled = true;
  isTogglingChat = false;

  constructor(
    private adminService: AdminService,
    private maintenanceModeService: MaintenanceModeService,
    private liveChatService: LiveChatService,
    private route: ActivatedRoute
  ) {}

  ngOnInit() {
    // If orderId query param is present, go straight to orders tab and auto-open that order
    const orderIdParam = this.route.snapshot.queryParamMap.get('orderId');
    if (orderIdParam) {
      const id = parseInt(orderIdParam, 10);
      if (!isNaN(id)) {
        this.activeTab = 'orders';
        this.pendingOrderId = id;
      }
    } else {
      // Restore last active tab from sessionStorage if available
      let savedTab = sessionStorage.getItem('adminActiveTab');
      if (savedTab === 'mails' || savedTab === 'sms') {
        savedTab = 'mails-sms';
      }
      if (
        savedTab === 'promo-codes' ||
        savedTab === 'special-offers' ||
        savedTab === 'subscriptions' ||
        savedTab === 'gift-cards'
      ) {
        this.selectedDiscountSubTab = 'promo-codes';
        savedTab = 'discounts';
      }
      if (savedTab) {
        this.activeTab = savedTab;
      }
    }

    // Refresh token before loading permissions to ensure we have a valid token
    this.refreshTokenAndLoadPermissions();
  }

  refreshTokenAndLoadPermissions() {
    // Refresh token before loading permissions to ensure we have a valid token
    this.adminService.refreshTokenIfNeeded().subscribe({
      next: () => {
        // Token refreshed successfully, now load permissions
        this.loadUserPermissions();
      },
      error: (error: any) => {
        console.error('Error refreshing token:', error);
        
        // If refresh fails, check if we need to redirect to login
        if (error.status === 401) {
          this.errorMessage = 'Your session has expired. Please log in again.';
          // Redirect to login after a short delay
          setTimeout(() => {
            window.location.href = '/login';
          }, 2000);
          return;
        }
        
        // Even if refresh fails, try to load permissions anyway
        this.loadUserPermissions();
      }
    });
  }

  loadUserPermissions() {
    this.adminService.getUserPermissions().subscribe({
      next: (response) => {
        this.userRole = response.role;
        this.userPermissions = response;
        
        // Load maintenance status if user is SuperAdmin
        if (response.role === 'SuperAdmin') {
          this.loadMaintenanceStatus();
        }

        // Any admin can toggle chat
        if (response.role === 'Admin' || response.role === 'SuperAdmin') {
          this.loadChatStatus();
        }
      },
      error: (error) => {
        console.error('Error loading permissions:', error);
        this.errorMessage = 'Failed to load permissions. Please try again.';
      }
    });
  }

  loadMaintenanceStatus() {
    this.maintenanceModeService.getStatus().subscribe({
      next: (status) => {
        this.maintenanceStatus = status;
      },
      error: (error) => {
        console.error('Error loading maintenance status:', error);
      }
    });
  }

  loadChatStatus() {
    this.liveChatService.loadChatStatus();
    this.liveChatService.chatEnabled$.subscribe(enabled => {
      this.chatEnabled = enabled;
    });
  }

  toggleChat() {
    this.isTogglingChat = true;
    this.liveChatService.toggleChatEnabled().subscribe({
      next: (res) => {
        this.chatEnabled = res.isEnabled;
        this.isTogglingChat = false;
        this.successMessage = `Live chat ${res.isEnabled ? 'enabled' : 'disabled'} for visitors`;
        setTimeout(() => this.successMessage = '', 3000);
      },
      error: () => {
        this.errorMessage = 'Failed to toggle chat';
        this.isTogglingChat = false;
        setTimeout(() => this.errorMessage = '', 3000);
      }
    });
  }

  confirmToggleMaintenance() {
    const action = this.maintenanceStatus?.isEnabled ? 'stop' : 'start';
    const message = this.maintenanceStatus?.isEnabled 
      ? 'Are you sure you want to stop maintenance mode? This will allow customers to access the site again.'
      : 'Are you sure you want to start maintenance mode? This will block all customers from accessing the site.';
    
    if (confirm(message)) {
      this.toggleMaintenanceMode();
    }
  }

  toggleMaintenanceMode() {
    if (!this.maintenanceStatus) return;

    this.isTogglingMaintenance = true;
    const request: ToggleMaintenanceModeRequest = {
      isEnabled: !this.maintenanceStatus.isEnabled,
      message: this.maintenanceStatus.isEnabled ? undefined : 'Scheduled maintenance in progress. We apologize for any inconvenience.'
    };

    this.maintenanceModeService.toggleMaintenanceMode(request).subscribe({
      next: (status) => {
        this.maintenanceStatus = status;
        this.isTogglingMaintenance = false;
        this.successMessage = `Maintenance mode ${status.isEnabled ? 'enabled' : 'disabled'} successfully`;
        setTimeout(() => this.successMessage = '', 3000);
      },
      error: (error) => {
        console.error('Error toggling maintenance mode:', error);
        this.errorMessage = 'Failed to toggle maintenance mode';
        this.isTogglingMaintenance = false;
        setTimeout(() => this.errorMessage = '', 3000);
      }
    });
  }

  formatDate(date: Date | string | undefined): string {
    if (!date) return 'N/A';
    const d = new Date(date);
    return d.toLocaleString();
  }

  setActiveTab(tab: string) {
    this.activeTab = tab;
    if (tab === 'discounts') {
      this.selectedDiscountSubTab = 'promo-codes';
    }
    sessionStorage.setItem('adminActiveTab', tab);
  }
}