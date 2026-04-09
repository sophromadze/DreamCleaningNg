import {
  Component, OnInit, OnDestroy, ViewChild, ElementRef, Inject, PLATFORM_ID, HostBinding
} from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, NavigationEnd } from '@angular/router';
import { LiveChatService, ChatMessage, ChatStatus } from '../../services/live-chat.service';
import { AuthService } from '../../services/auth.service';
import { Subscription } from 'rxjs';
import { filter } from 'rxjs/operators';

@Component({
  selector: 'app-live-chat-widget',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './live-chat-widget.component.html',
  styleUrls: ['./live-chat-widget.component.scss']
})
export class LiveChatWidgetComponent implements OnInit, OnDestroy {
  @ViewChild('messagesContainer') messagesContainer!: ElementRef;
  @ViewChild('fileInput') fileInput!: ElementRef<HTMLInputElement>;

  isOpen = false;
  isChatStarted = false;
  visitorName = '';
  messageText = '';
  messages: ChatMessage[] = [];
  status: ChatStatus = 'disconnected';
  errorMessage = '';
  isBrowser: boolean;
  unreadCount = 0;
  isDraggingFile = false;
  currentUser: any = null;
  chatEnabled = true;

  @HostBinding('class.on-booking-page') isOnBookingPage = false;

  private chatAutoStarted = false;
  private subscriptions: Subscription[] = [];

  constructor(
    private chatService: LiveChatService,
    private authService: AuthService,
    private router: Router,
    @Inject(PLATFORM_ID) platformId: Object
  ) {
    this.isBrowser = isPlatformBrowser(platformId);
  }

  ngOnInit(): void {
    if (!this.isBrowser) return;

    // Track booking page for mobile chat offset
    this.isOnBookingPage = this.router.url.startsWith('/booking');
    this.subscriptions.push(
      this.router.events.pipe(filter(e => e instanceof NavigationEnd)).subscribe((e: any) => {
        this.isOnBookingPage = e.urlAfterRedirects.startsWith('/booking');
      })
    );

    // Check server-side enabled state on every page load
    this.chatService.loadChatStatus();

    this.subscriptions.push(
      this.chatService.chatEnabled$.subscribe(enabled => {
        this.chatEnabled = enabled;
        // Close the window if admin disables while visitor has it open
        if (!enabled && this.isOpen) this.isOpen = false;
      }),
      this.authService.currentUser.subscribe(user => {
        this.currentUser = user;
        if (user) {
          this.visitorName = user.email;
        }
      }),
      this.chatService.messages$.subscribe(msgs => {
        this.messages = msgs;
        if (!this.isOpen && msgs.length > 0) {
          const lastMsg = msgs[msgs.length - 1];
          if (!lastMsg.isFromVisitor) {
            this.unreadCount++;
          }
        }
        setTimeout(() => this.scrollToBottom(), 100);
      }),
      this.chatService.status$.subscribe(status => {
        this.status = status;
      }),
      this.chatService.error$.subscribe(error => {
        this.errorMessage = error;
        setTimeout(() => this.errorMessage = '', 5000);
      })
    );

    // Reconnect if there's a stored session (localStorage shared across tabs + survives refresh)
    const existingSession = localStorage.getItem('livechat_session');
    if (existingSession) {
      this.isChatStarted = true;
      const name = this.currentUser?.email || 'Returning Visitor';
      this.chatService.startChat(name);
    }
  }

  ngOnDestroy(): void {
    this.subscriptions.forEach(s => s.unsubscribe());
  }

  toggleChat(): void {
    this.isOpen = !this.isOpen;
    if (this.isOpen) {
      this.unreadCount = 0;
      setTimeout(() => this.scrollToBottom(), 150);
    }
  }

  startChat(): void {
    if (!this.visitorName.trim()) {
      this.visitorName = 'Visitor';
    }
    this.isChatStarted = true;
    this.chatService.startChat(this.visitorName.trim());
  }

  async sendMessage(): Promise<void> {
    if (!this.messageText.trim()) return;
    const text = this.messageText;
    this.messageText = '';
    await this.chatService.sendMessage(text);
  }

  onKeyPress(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.sendMessage();
    }
  }

  triggerFileUpload(): void {
    this.fileInput?.nativeElement.click();
  }

  async onFileSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      await this.chatService.sendImage(input.files[0]);
      input.value = '';
    }
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isDraggingFile = true;
  }

  onDragLeave(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isDraggingFile = false;
  }

  async onDrop(event: DragEvent): Promise<void> {
    event.preventDefault();
    event.stopPropagation();
    this.isDraggingFile = false;

    const files = event.dataTransfer?.files;
    if (files && files.length > 0) {
      const file = files[0];
      if (file.type.startsWith('image/')) {
        await this.chatService.sendImage(file);
      } else {
        this.errorMessage = 'Only image files are supported.';
        setTimeout(() => this.errorMessage = '', 3000);
      }
    }
  }

  endChat(): void {
    this.chatService.disconnect();
    this.isChatStarted = false;
    this.chatAutoStarted = false;
    this.messages = [];
    this.isOpen = false;
  }

  getImageSrc(msg: ChatMessage): string {
    if (msg.imageBase64 && msg.imageMimeType) {
      return `data:${msg.imageMimeType};base64,${msg.imageBase64}`;
    }
    return '';
  }

  openImageInTab(src: string): void {
    window.open(src, '_blank');
  }

  private scrollToBottom(): void {
    try {
      const container = this.messagesContainer?.nativeElement;
      if (container) {
        container.scrollTop = container.scrollHeight;
      }
    } catch {}
  }
}
