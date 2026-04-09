import { Injectable, Inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { HubConnection, HubConnectionBuilder, LogLevel, HttpTransportType } from '@microsoft/signalr';
import { BehaviorSubject, Observable } from 'rxjs';
import { AuthService } from './auth.service';
import { environment } from '../../environments/environment';
import { filter, skip, debounceTime, distinctUntilChanged } from 'rxjs/operators';

export interface UserNotification {
  message: string;
  timestamp: Date;
  type: 'blocked' | 'unblocked' | 'roleChanged' | 'accountUpdated' | 'forceLogout' | 'userDeleted';
  title?: string;
  data?: any;
}

@Injectable({
  providedIn: 'root'
})
export class SignalRService {
  private static instanceCount = 0;
  private static authSubscriptionSetup = false;
  private static globalConnectionState = new BehaviorSubject<boolean>(false);
  private static globalNotifications = new BehaviorSubject<UserNotification | null>(null);
  private static globalReminderAcknowledged = new BehaviorSubject<{orderId: number; type: string} | null>(null);
  private static globalNewOrderCreated = new BehaviorSubject<{orderId: number} | null>(null);
  private static globalNewOrderViewed = new BehaviorSubject<{orderId: number} | null>(null);
  private static globalTasksUpdated = new BehaviorSubject<{type: string} | null>(null);

  private apiUrl = environment.apiUrl;
  private useCookieAuth = environment.useCookieAuth || false;
  private static hubConnection?: HubConnection;
  private isInitialized = false;
  private isBrowser: boolean;

  public connectionState$ = SignalRService.globalConnectionState.asObservable();
  public notifications$ = SignalRService.globalNotifications.asObservable();
  public reminderAcknowledged$ = SignalRService.globalReminderAcknowledged.asObservable();
  public newOrderCreated$ = SignalRService.globalNewOrderCreated.asObservable();
  public newOrderViewed$ = SignalRService.globalNewOrderViewed.asObservable();
  public tasksUpdated$ = SignalRService.globalTasksUpdated.asObservable();

  constructor(
    private authService: AuthService,
    @Inject(PLATFORM_ID) private platformId: Object
  ) {
    this.isBrowser = isPlatformBrowser(this.platformId);
    
    // Only initialize in browser context
    if (!this.isBrowser) {
      return;
    }
    
    SignalRService.instanceCount++;

    // Only setup auth subscription once for the first browser instance
    if (!SignalRService.authSubscriptionSetup) {
      SignalRService.authSubscriptionSetup = true;
      this.initializeOnce();
    }
  }

  private initializeOnce(): void {
    // Add a small delay to ensure auth service is fully ready
    setTimeout(() => {
      // Wait for auth service to be fully initialized before setting up subscriptions
      this.authService.isInitialized$.subscribe(isInitialized => {
        if (isInitialized && !this.isInitialized) {
          this.isInitialized = true;
          this.setupAuthSubscription();
        }
      });
    }, 100);
  }

  private setupAuthSubscription(): void {   
    // Check current user state first
    const currentUser = this.authService.currentUserValue;
    if (currentUser) {
      this.connect();
    }

    // Subscribe to future auth state changes with debounce to avoid rapid connect/disconnect
    this.authService.currentUser.pipe(
      skip(1), // Skip the first emission to avoid duplicate connection attempts
      debounceTime(300), // Add debounce to prevent rapid reconnections
      distinctUntilChanged((prev, curr) => prev?.id === curr?.id) // Prevent duplicate connections
    ).subscribe(user => {      
      if (user && !SignalRService.hubConnection) {
        this.connect();
      } else if (!user && SignalRService.hubConnection) {
        this.disconnect();
      }
    });
  }

  public async connect(): Promise<void> {
    // Check if already connected or connecting
    if (SignalRService.hubConnection?.state === 'Connected' || 
        SignalRService.hubConnection?.state === 'Connecting') {
      return;
    }

    // Disconnect any existing connection first
    if (SignalRService.hubConnection) {
      try {
        await SignalRService.hubConnection.stop();
      } catch (e) {
        console.warn('Error stopping existing connection:', e);
      }
    }

    // Use this.apiUrl just like other services, but remove /api for SignalR hub
    const baseUrl = this.apiUrl.replace('/api', '');
    const hubUrl = `${baseUrl}/userManagementHub`;

    // Configure connection based on auth method
    if (this.useCookieAuth) {
      // For cookie auth, use withCredentials
      SignalRService.hubConnection = new HubConnectionBuilder()
        .withUrl(hubUrl, {
          withCredentials: true,
          skipNegotiation: false,
          transport: HttpTransportType.WebSockets | HttpTransportType.ServerSentEvents
        })
        .withAutomaticReconnect([0, 2000, 5000, 10000, 30000])
        .configureLogging(LogLevel.None)
        .build();
    } else {
      // For localStorage auth, use access token
      const token = this.authService.getToken();
      if (!token) {
        console.error('No token available for SignalR connection');
        return;
      }

      SignalRService.hubConnection = new HubConnectionBuilder()
        .withUrl(hubUrl, {
          accessTokenFactory: () => {
            // Always get fresh token
            return this.authService.getToken() || token;
          },
          skipNegotiation: false,
          transport: HttpTransportType.WebSockets | HttpTransportType.ServerSentEvents
        })
        .withAutomaticReconnect([0, 2000, 5000, 10000, 30000])
        .configureLogging(LogLevel.None)
        .build();
    }

    // Set up event handlers BEFORE starting
    this.setupEventHandlers();

    try {
      await SignalRService.hubConnection.start();
      SignalRService.globalConnectionState.next(true);
    } catch (error) {
      console.error('SignalR: Connection failed:', error);
      SignalRService.globalConnectionState.next(false);
      
      // Retry after delay if user is still authenticated
      if (this.authService.isLoggedIn()) {
        setTimeout(() => this.connect(), 5000);
      }
    }
  }

  public async disconnect(): Promise<void> {
    if (SignalRService.hubConnection) {
      try {
        await SignalRService.hubConnection.stop();
      } catch (error) {
        console.error('Error closing SignalR connection:', error);
      } finally {
        SignalRService.hubConnection = undefined;
        SignalRService.globalConnectionState.next(false);
      }
    }
  }

  private setupEventHandlers(): void {
    if (!SignalRService.hubConnection) return;
  
    // Handle user blocked notification
    SignalRService.hubConnection.on('UserBlocked', (data: any) => {
      
      // Show the notification modal
      SignalRService.globalNotifications.next({
        message: data.message || 'Your account has been blocked by an administrator.',
        timestamp: new Date(data.timestamp || new Date()),
        type: 'blocked',
        data: data
      });
  
      // Wait for user to see the message before logging out
      if (data.shouldLogout !== false) {
        setTimeout(() => {
          this.authService.logout();
        }, 3000);
      }
    });
  
    // Handle user unblocked notification
    SignalRService.hubConnection.on('UserUnblocked', (data: any) => {
      
      SignalRService.globalNotifications.next({
        message: data.message || 'Your account has been unblocked.',
        timestamp: new Date(data.timestamp || new Date()),
        type: 'unblocked',
        data: data
      });
    });
  
    // Handle role changed notification (role-only update from admin)
    SignalRService.hubConnection.on('RoleChanged', (data: any) => {
      SignalRService.globalNotifications.next({
        message: data.message || `Your role has been updated to ${data.newRole}. Please log in again to access your new permissions.`,
        timestamp: new Date(data.timestamp || new Date()),
        type: 'roleChanged',
        data: data
      });
      setTimeout(() => {
        this.authService.logout();
      }, 4000);
    });

    // Handle account updated (e.g. phone, email, name, role - shows what changed)
    SignalRService.hubConnection.on('AccountUpdated', (data: any) => {
      SignalRService.globalNotifications.next({
        title: data.title || 'Account Updated',
        message: data.message || 'Your account was updated. Please log in again to continue.',
        timestamp: new Date(data.timestamp || new Date()),
        type: 'accountUpdated',
        data: data
      });
      setTimeout(() => {
        this.authService.logout();
      }, 4000);
    });
  
    // Handle user deleted (account permanently deleted by admin)
    SignalRService.hubConnection.on('UserDeleted', (data: any) => {
      SignalRService.globalNotifications.next({
        message: data.message || 'Your account has been permanently deleted by an administrator.',
        timestamp: new Date(data.timestamp || new Date()),
        type: 'userDeleted',
        data: data
      });
      if (data.shouldLogout !== false) {
        setTimeout(() => {
          this.authService.logout();
        }, 3000);
      }
    });

    // Handle force logout
    SignalRService.hubConnection.on('ForceLogout', (data: any) => {
      
      SignalRService.globalNotifications.next({
        message: data.reason || 'Your session has been terminated.',
        timestamp: new Date(data.timestamp || new Date()),
        type: 'forceLogout',
        data: data
      });
  
      // Force logout after short delay
      setTimeout(() => {
        this.authService.logout();
      }, 2000);
    });
  
    // Handle order reminder acknowledged by another admin
    SignalRService.hubConnection.on('OrderReminderAcknowledged', (data: any) => {
      SignalRService.globalReminderAcknowledged.next({
        orderId: data.orderId,
        type: data.type
      });
    });

    // Handle new order created notification
    SignalRService.hubConnection.on('NewOrderCreated', (data: any) => {
      SignalRService.globalNewOrderCreated.next({ orderId: data.orderId });
    });

    // Handle new order viewed by another admin
    SignalRService.hubConnection.on('NewOrderViewed', (data: any) => {
      SignalRService.globalNewOrderViewed.next({ orderId: data.orderId });
    });

    // Handle task/interaction/handover updates from other admins
    SignalRService.hubConnection.on('TasksUpdated', (data: any) => {
      SignalRService.globalTasksUpdated.next({ type: data.type });
    });

    // Connection event handlers
    SignalRService.hubConnection.onreconnected(() => {
      SignalRService.globalConnectionState.next(true);
    });
  
    SignalRService.hubConnection.onreconnecting(() => {
      SignalRService.globalConnectionState.next(false);
    });
  
    SignalRService.hubConnection.onclose(() => {
      SignalRService.globalConnectionState.next(false);
    });
  }

  public isConnected(): boolean {
    return SignalRService.hubConnection?.state === 'Connected';
  }

  public getConnectionState(): Observable<boolean> {
    return SignalRService.globalConnectionState.asObservable();
  }

  public clearNotifications(): void {
    SignalRService.globalNotifications.next(null);
  }
}