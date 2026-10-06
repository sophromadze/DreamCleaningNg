import { Component, OnInit, OnDestroy, HostListener, ChangeDetectionStrategy, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  TaskService,
  AdminTask,
  ClientInteraction,
  HandoverNote,
  PersonalAdminTask,
  CreateAdminTask,
  CreateClientInteraction,
  CreateHandoverNote,
  UpdateHandoverNote,
  CreatePersonalAdminTask,
  UpdateAdminTask,
  UpdatePersonalAdminTask,
  ClientSearchResult,
  OrderSearchResult,
  TaskActivityLog
} from '../../services/task.service';
import { AdminService, UserAdmin } from '../../services/admin.service';
import { AuthService } from '../../services/auth.service';
import { SignalRService } from '../../services/signalr.service';
import { formatNy } from '../../shared/ny-time.util';
import { Subject, Subscription } from 'rxjs';
import { debounceTime, distinctUntilChanged, switchMap, filter } from 'rxjs/operators';

@Component({
  selector: 'app-tasks',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './tasks.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ['./tasks.component.scss']
})
export class TasksComponent implements OnInit, OnDestroy {
  private taskService = inject(TaskService);
  private adminService = inject(AdminService);
  private authService = inject(AuthService);
  private signalRService = inject(SignalRService);


  private signalRSub?: Subscription;

  // ── Current admin ──
  currentAdminName = '';
  currentAdminId = 0;
  currentAdminRole = '';

  // ── Data ──
  tasks: AdminTask[] = [];
  clientInteractions: ClientInteraction[] = [];
  readonly handoverNotes = signal<HandoverNote[]>([]);
  readonly admins = signal<UserAdmin[]>([]);
  personalTasks: PersonalAdminTask[] = [];

  // ── Computed / filtered ──
  readonly urgentTasks = signal<AdminTask[]>([]);
  readonly activeTasks = signal<AdminTask[]>([]);
  readonly activeTaskCount = signal(0);
  readonly doneSharedTasks = signal<AdminTask[]>([]);
  recentInteractions: ClientInteraction[] = [];
  readonly filteredHistory = signal<ClientInteraction[]>([]);
  readonly closedInteractions = signal<ClientInteraction[]>([]);

  // ── Personal tasks computed ──
  readonly myAssignedTasks = signal<PersonalAdminTask[]>([]);
  readonly myCreatedTasks = signal<PersonalAdminTask[]>([]);
  readonly allAdminTasks = signal<PersonalAdminTask[]>([]);
  readonly donePersonalTasks = signal<PersonalAdminTask[]>([]);
  readonly uncheckedDoneCreatedCount = signal(0);
  readonly loadingAllAdminTasks = signal(false);

  // ── Pagination (6 items per page) ──
  readonly itemsPerPage = 6;

  // Shared tab
  readonly urgentPage = signal(1);
  readonly urgentTotalPages = signal(1);
  readonly activePage = signal(1);
  readonly activeTotalPages = signal(1);

  // My Tasks tab
  readonly myAssignedPage = signal(1);
  readonly myAssignedTotalPages = signal(1);
  readonly myCreatedPage = signal(1);
  readonly myCreatedTotalPages = signal(1);
  readonly allAdminPage = signal(1);
  readonly allAdminTotalPages = signal(1);

  // Done cards
  readonly doneSharedPage = signal(1);
  readonly doneSharedTotalPages = signal(1);
  readonly donePersonalPage = signal(1);
  readonly donePersonalTotalPages = signal(1);
  readonly closedInteractionsPage = signal(1);
  readonly closedInteractionsTotalPages = signal(1);

  // Interactions tab
  readonly interactionsPage = signal(1);
  readonly interactionsTotalPages = signal(1);

  // Handover tab
  readonly handoverPage = signal(1);
  readonly handoverTotalPages = signal(1);

  // Logs tab
  readonly logsPage = signal(1);
  readonly logsTotalPages = signal(1);

  // ── Activity logs ──
  readonly activityLogs = signal<TaskActivityLog[]>([]);
  readonly loadingLogs = signal(false);
  readonly logSearchId = signal('');
  readonly logEntityTypeFilter = signal('');
  readonly logActionFilter = signal('');
  readonly logAdminFilter = signal('');
  logPage = 1;
  readonly logHasMore = signal(true);

  // ── Tabs ──
  readonly activeTab = signal('dashboard');

  // ── Sub-tabs ──
  readonly sharedSubTab = signal<'urgent' | 'active' | 'done'>('urgent');
  readonly myTasksSubTab = signal<'assigned' | 'created' | 'done' | 'allAdmin'>('assigned');
  readonly interactionsSubTab = signal<'active' | 'closed'>('active');

  // ── Filters ──
  taskFilter = 'all';
  readonly historySearch = signal('');
  readonly historyStatusFilter = signal('');
  readonly historyAdminFilter = signal('');
  historyPeriodFilter = 'thisMonth';

  // ── Loading ──
  readonly loadingTasks = signal(false);
  readonly loadingInteractions = signal(false);
  readonly loadingNotes = signal(false);
  readonly loadingPersonalTasks = signal(false);

  // ── Modals ──
  readonly showTaskModal = signal(false);
  readonly showInteractionModal = signal(false);
  readonly showNoteModal = signal(false);
  readonly showPersonalTaskModal = signal(false);

  // ── Task form ──
  readonly taskForm = signal<CreateAdminTask & { completionNote?: string }>({ title: '', priority: 'Normal' }, { equal: () => false });
  readonly editingTaskId = signal<number | null>(null);

  // ── Personal task form ──
  readonly personalTaskForm = signal<any>({ title: '', priority: 'Normal', assignedToAdminIds: [] as number[] }, { equal: () => false });
  readonly editingPersonalTaskId = signal<number | null>(null);

  // ── Interaction form ──
  readonly interactionForm = signal<CreateClientInteraction>({
    clientName: '',
    type: '',
    notes: '',
    status: 'Pending'
  }, { equal: () => false });
  readonly editingInteractionId = signal<number | null>(null);

  // ── Note form ──
  readonly noteForm = signal<CreateHandoverNote>({ content: '', targetAudience: 'ForNextAdmin' });
  readonly editingNoteId = signal<number | null>(null);

  // ── Dashboard limit ──
  readonly dashboardLimit = 10;

  // ── Personal task edit restriction ──
  readonly personalTaskReadOnly = signal(false);

  // ── View-only modal for SuperAdmin all tasks ──
  readonly showViewPersonalTaskModal = signal(false);
  readonly viewingPersonalTask = signal<PersonalAdminTask | null>(null);

  // ── Completion modal ──
  readonly showCompletionModal = signal(false);
  readonly completionNoteText = signal('');
  pendingCompletionTask: AdminTask | PersonalAdminTask | null = null;
  pendingCompletionType: 'shared' | 'personal' = 'shared';

  // ── Filtered admins (no moderators for history) ──
  readonly historyAdmins = signal<UserAdmin[]>([]);

  // ── Context menus ──
  readonly openMenuTaskId = signal<number | null>(null);
  readonly openMenuInteractionId = signal<number | null>(null);
  readonly openMenuPersonalTaskId = signal<number | null>(null);

  // ── Client autocomplete (for tasks) ──
  readonly taskClientQuery = signal('');
  readonly taskClientResults = signal<ClientSearchResult[]>([]);
  readonly showTaskClientDropdown = signal(false);
  taskClientSelected = false;
  private taskClientSearch$ = new Subject<string>();

  // ── Order autocomplete (for tasks) ──
  readonly taskOrderQuery = signal('');
  readonly taskOrderResults = signal<OrderSearchResult[]>([]);
  readonly showTaskOrderDropdown = signal(false);
  taskOrderSelected = false;
  private taskOrderSearch$ = new Subject<string>();

  // ── Client autocomplete (for interactions) ──
  readonly interactionClientQuery = signal('');
  readonly interactionClientResults = signal<ClientSearchResult[]>([]);
  readonly showInteractionClientDropdown = signal(false);
  interactionClientSelected = false;
  private interactionClientSearch$ = new Subject<string>();

  ngOnInit(): void {
    const user = this.authService.currentUserValue;
    if (user) {
      this.currentAdminName = user.firstName;
      this.currentAdminId = user.id;
      this.currentAdminRole = user.role;
    }
    const savedTab = sessionStorage.getItem('tasksActiveTab');
    if (savedTab) this.activeTab.set(savedTab);
    this.loadData();
    if (this.activeTab() === 'logs' && this.isSuperAdmin) {
      this.loadActivityLogs();
    }
    this.setupSearchStreams();
    this.setupSignalR();
  }

  ngOnDestroy(): void {
    this.signalRSub?.unsubscribe();
  }

  private setupSignalR(): void {
    this.signalRSub = this.signalRService.tasksUpdated$.pipe(
      filter(e => e !== null)
    ).subscribe(event => {
      if (!event) return;
      switch (event.type) {
        case 'shared':
          this.loadTasks();
          break;
        case 'personal':
          this.loadPersonalTasks();
          if (this.currentAdminRole === 'SuperAdmin') {
            this.loadAllAdminTasks();
          }
          break;
        case 'interactions':
          this.loadInteractions();
          break;
        case 'handover':
          this.loadHandoverNotes();
          break;
      }
      // Refresh logs if on logs tab
      if (this.activeTab() === 'logs') {
        this.loadActivityLogs();
      }
    });
  }

  @HostListener('document:click')
  onDocumentClick(): void {
    this.openMenuTaskId.set(null);
    this.openMenuInteractionId.set(null);
    this.openMenuPersonalTaskId.set(null);
    this.showTaskClientDropdown.set(false);
    this.showTaskOrderDropdown.set(false);
    this.showInteractionClientDropdown.set(false);
  }

  // ── Search streams with debounce ──

  private setupSearchStreams(): void {
    this.taskClientSearch$.pipe(
      debounceTime(300),
      distinctUntilChanged(),
      switchMap(q => this.taskService.searchClients(q))
    ).subscribe(results => {
      this.taskClientResults.set(results);
      this.showTaskClientDropdown.set(results.length > 0);
    });

    this.taskOrderSearch$.pipe(
      debounceTime(300),
      distinctUntilChanged(),
      switchMap(q => this.taskService.searchOrders(q))
    ).subscribe(results => {
      this.taskOrderResults.set(results);
      this.showTaskOrderDropdown.set(results.length > 0);
    });

    this.interactionClientSearch$.pipe(
      debounceTime(300),
      distinctUntilChanged(),
      switchMap(q => this.taskService.searchClients(q))
    ).subscribe(results => {
      this.interactionClientResults.set(results);
      this.showInteractionClientDropdown.set(results.length > 0);
    });
  }

  // ── Task client autocomplete ──

  onTaskClientInput(value: string): void {
    this.taskClientQuery.set(value);
    this.taskClientSelected = false;
    this.taskForm().clientName = value;
    this.taskForm.set(this.taskForm());
    this.taskForm().clientId = undefined;
    this.taskForm.set(this.taskForm());
    if (value.length >= 2) {
      this.taskClientSearch$.next(value);
    } else {
      this.taskClientResults.set([]);
      this.showTaskClientDropdown.set(false);
    }
  }

  selectTaskClient(client: ClientSearchResult, event: Event): void {
    event.stopPropagation();
    this.taskClientQuery.set(`${client.firstName} ${client.lastName}`);
    this.taskForm().clientName = this.taskClientQuery();
    this.taskForm.set(this.taskForm());
    this.taskForm().clientEmail = client.email;
    this.taskForm.set(this.taskForm());
    this.taskForm().clientPhone = client.phone || '';
    this.taskForm.set(this.taskForm());
    this.taskForm().clientId = client.id;
    this.taskForm.set(this.taskForm());
    this.taskClientSelected = true;
    this.showTaskClientDropdown.set(false);
  }

  // ── Task order autocomplete ──

  onTaskOrderInput(value: string): void {
    this.taskOrderQuery.set(value);
    this.taskOrderSelected = false;
    this.taskForm().orderId = undefined;
    this.taskForm.set(this.taskForm());
    if (value.length >= 1) {
      this.taskOrderSearch$.next(value);
    } else {
      this.taskOrderResults.set([]);
      this.showTaskOrderDropdown.set(false);
    }
  }

  selectTaskOrder(order: OrderSearchResult, event: Event): void {
    event.stopPropagation();
    this.taskOrderQuery.set(`#${order.id} - ${order.contactFirstName} ${order.contactLastName} (${order.serviceTypeName})`);
    this.taskForm().orderId = order.id;
    this.taskForm.set(this.taskForm());
    this.taskForm().clientName = `${order.contactFirstName} ${order.contactLastName}`;
    this.taskForm.set(this.taskForm());
    this.taskForm().clientEmail = order.contactEmail || '';
    this.taskForm.set(this.taskForm());
    this.taskForm().clientPhone = order.contactPhone || '';
    this.taskForm.set(this.taskForm());
    this.taskClientQuery.set(this.taskForm().clientName!);
    this.taskClientSelected = true;
    this.taskOrderSelected = true;
    this.showTaskOrderDropdown.set(false);
  }

  // ── Interaction client autocomplete ──

  onInteractionClientInput(value: string): void {
    this.interactionClientQuery.set(value);
    this.interactionClientSelected = false;
    this.interactionForm().clientName = value;
    this.interactionForm.set(this.interactionForm());
    this.interactionForm().clientId = undefined;
    this.interactionForm.set(this.interactionForm());
    if (value.length >= 2) {
      this.interactionClientSearch$.next(value);
    } else {
      this.interactionClientResults.set([]);
      this.showInteractionClientDropdown.set(false);
    }
  }

  selectInteractionClient(client: ClientSearchResult, event: Event): void {
    event.stopPropagation();
    this.interactionClientQuery.set(`${client.firstName} ${client.lastName}`);
    this.interactionForm().clientName = this.interactionClientQuery();
    this.interactionForm.set(this.interactionForm());
    this.interactionForm().clientEmail = client.email;
    this.interactionForm.set(this.interactionForm());
    this.interactionForm().clientPhone = client.phone || '';
    this.interactionForm.set(this.interactionForm());
    this.interactionForm().clientId = client.id;
    this.interactionForm.set(this.interactionForm());
    this.interactionClientSelected = true;
    this.showInteractionClientDropdown.set(false);
  }

  // ── Data loading ──

  loadData(): void {
    this.loadTasks();
    this.loadPersonalTasks();
    this.loadInteractions();
    this.loadHandoverNotes();
    this.loadAdmins();
    if (this.currentAdminRole === 'SuperAdmin') {
      this.loadAllAdminTasks();
    }
  }

  get isSuperAdmin(): boolean {
    return this.currentAdminRole === 'SuperAdmin';
  }

  loadTasks(): void {
    this.loadingTasks.set(true);
    this.taskService.getTasks().subscribe({
      next: (tasks) => {
        this.tasks = tasks;
        this.computeTaskViews();
        this.loadingTasks.set(false);
      },
      error: () => { this.loadingTasks.set(false); }
    });
  }

  loadPersonalTasks(): void {
    this.loadingPersonalTasks.set(true);
    this.taskService.getPersonalTasks().subscribe({
      next: (tasks) => {
        this.personalTasks = tasks;
        this.computePersonalTaskViews();
        this.loadingPersonalTasks.set(false);
      },
      error: () => { this.loadingPersonalTasks.set(false); }
    });
  }

  loadAllAdminTasks(): void {
    this.loadingAllAdminTasks.set(true);
    this.taskService.getAllPersonalTasks().subscribe({
      next: (tasks) => {
        this.allAdminTasks.set(tasks.filter(t => t.status !== 'Done'));
        this.allAdminPage.set(1);
        this.updatePaginationCounts();
        this.loadingAllAdminTasks.set(false);
      },
      error: () => { this.loadingAllAdminTasks.set(false); }
    });
  }

  loadInteractions(): void {
    this.loadingInteractions.set(true);
    this.taskService.getClientInteractions().subscribe({
      next: (interactions) => {
        this.clientInteractions = interactions;
        this.recentInteractions = interactions.slice(0, 3);
        this.applyHistoryFilters();
        this.loadingInteractions.set(false);
      },
      error: () => { this.loadingInteractions.set(false); }
    });
  }

  loadHandoverNotes(): void {
    this.loadingNotes.set(true);
    this.taskService.getHandoverNotes().subscribe({
      next: (notes) => {
        this.handoverNotes.set(notes);
        this.handoverPage.set(1);
        this.updatePaginationCounts();
        this.loadingNotes.set(false);
      },
      error: () => { this.loadingNotes.set(false); }
    });
  }

  loadAdmins(): void {
    this.adminService.getUsers().subscribe({
      next: (response: any) => {
        const users: UserAdmin[] = response.users || response;
        this.admins.set(users.filter(u =>
          u.role === 'Admin' || u.role === 'SuperAdmin'
        ));
        this.historyAdmins.set(users.filter(u =>
          u.role === 'Admin' || u.role === 'SuperAdmin'
        ));
      }
    });
  }

  // ── Activity Logs ──

  loadActivityLogs(reset = true): void {
    if (reset) {
      this.logPage = 1;
      this.activityLogs.set([]);
      this.logHasMore.set(true);
    }
    this.loadingLogs.set(true);
    const adminId = this.logAdminFilter() ? +this.logAdminFilter() : undefined;
    const entityId = this.logSearchId() ? +this.logSearchId() : undefined;
    this.taskService.getTaskActivityLogs(
      this.logEntityTypeFilter() || undefined,
      this.logActionFilter() || undefined,
      adminId,
      this.logPage,
      50,
      entityId
    ).subscribe({
      next: (logs) => {
        if (reset) {
          this.activityLogs.set(logs);
          this.logsPage.set(1);
        } else {
          this.activityLogs.set([...this.activityLogs(), ...logs]);
        }
        this.logHasMore.set(logs.length >= 50);
        this.updatePaginationCounts();
        this.loadingLogs.set(false);
      },
      error: () => { this.loadingLogs.set(false); }
    });
  }

  loadMoreLogs(): void {
    this.logPage++;
    this.loadActivityLogs(false);
  }

  onLogFilterChange(): void {
    this.loadActivityLogs();
  }

  parseChanges(changesJson?: string): { field: string; from: string; to: string }[] {
    if (!changesJson) return [];
    try {
      const parsed = JSON.parse(changesJson);
      return Object.entries(parsed)
        .map(([field, val]: [string, any]) => ({
          field,
          from: typeof val === 'object' && val?.from !== undefined ? val.from : '',
          to: typeof val === 'object' && val?.to !== undefined ? val.to : String(val)
        }))
        .filter(c => c.to && c.to !== 'null' && c.to !== '');
    } catch {
      return [];
    }
  }

  getActionLabel(action: string): string {
    switch (action) {
      case 'Created': return 'Created';
      case 'Updated': return 'Edited';
      case 'Deleted': return 'Deleted';
      case 'StatusChanged': return 'Status Changed';
      default: return action;
    }
  }

  getEntityTypeLabel(type: string): string {
    switch (type) {
      case 'SharedTask': return 'Shared Task';
      case 'PersonalTask': return 'Admin Task';
      case 'ClientInteraction': return 'Client Interaction';
      case 'HandoverNote': return 'Handover Note';
      default: return type;
    }
  }

  getActionClass(action: string): string {
    switch (action) {
      case 'Created': return 'log-created';
      case 'Updated': return 'log-updated';
      case 'Deleted': return 'log-deleted';
      case 'StatusChanged': return 'log-status';
      default: return '';
    }
  }

  // ── Tab switching ──

  goToSharedTab(subTab: 'urgent' | 'active' | 'done'): void {
    this.activeTab.set('shared');
    this.sharedSubTab.set(subTab);
    sessionStorage.setItem('tasksActiveTab', 'shared');
  }

  setActiveTab(tab: string): void {
    this.activeTab.set(tab);
    sessionStorage.setItem('tasksActiveTab', tab);
    if (tab === 'logs' && this.activityLogs().length === 0) {
      this.loadActivityLogs();
    }
  }

  // ── Task filtering ──

  computeTaskViews(): void {
    this.urgentTasks.set(this.tasks.filter(t =>
      t.status !== 'Done' &&
      (t.priority === 'Urgent' || t.priority === 'High' || this.isDueSoon(t))
    ));
    this.urgentPage.set(1);
    this.applyTaskFilter();
  }

  computePersonalTaskViews(): void {
    this.myAssignedTasks.set(this.personalTasks.filter(t => t.assignedToAdminId === this.currentAdminId && t.status !== 'Done'));
    this.myCreatedTasks.set(this.personalTasks.filter(t => t.createdByAdminId === this.currentAdminId && (t.status !== 'Done' || !t.checkedByCreator)));
    this.donePersonalTasks.set(this.personalTasks.filter(t =>
      t.status === 'Done' &&
      (t.assignedToAdminId === this.currentAdminId || t.createdByAdminId === this.currentAdminId)
    ));
    this.uncheckedDoneCreatedCount.set(this.personalTasks.filter(t =>
      t.createdByAdminId === this.currentAdminId && t.status === 'Done' && !t.checkedByCreator
    ).length);
    this.myAssignedPage.set(1);
    this.myCreatedPage.set(1);
    this.donePersonalPage.set(1);
    this.updatePaginationCounts();
  }

  applyTaskFilter(): void {
    const urgentIds = new Set(this.urgentTasks().map(t => t.id));
    this.activeTasks.set(this.tasks.filter(t => t.status !== 'Done' && !urgentIds.has(t.id)));
    this.activeTaskCount.set(this.activeTasks().length);
    this.doneSharedTasks.set(this.tasks.filter(t => t.status === 'Done'));
    this.activePage.set(1);
    this.doneSharedPage.set(1);
    this.updatePaginationCounts();
  }

  onTaskFilterChange(): void {
    this.applyTaskFilter();
  }


  // ── Dashboard top-10 getters (sorted by priority / due date / recency) ──

  private readonly priorityOrder: Record<string, number> = {
    'Urgent': 0, 'High': 1, 'Medium': 2, 'Normal': 3, 'Low': 4
  };

  private sortTasksByImportance<T extends { priority: string; dueDate?: string; createdAt?: string }>(tasks: T[]): T[] {
    return [...tasks].sort((a, b) => {
      const pa = this.priorityOrder[a.priority] ?? 5;
      const pb = this.priorityOrder[b.priority] ?? 5;
      if (pa !== pb) return pa - pb;
      const da = a.dueDate ? new Date(a.dueDate).getTime() : Infinity;
      const db = b.dueDate ? new Date(b.dueDate).getTime() : Infinity;
      if (da !== db) return da - db;
      const ca = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const cb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return cb - ca;
    });
  }

  get dashboardUrgentTasks(): AdminTask[] {
    return this.sortTasksByImportance(this.urgentTasks()).slice(0, this.dashboardLimit);
  }

  get dashboardActiveTasks(): AdminTask[] {
    return this.sortTasksByImportance(this.activeTasks()).slice(0, this.dashboardLimit);
  }

  get dashboardInteractions(): ClientInteraction[] {
    return [...this.filteredHistory()]
      .sort((a, b) => new Date(b.interactionDate).getTime() - new Date(a.interactionDate).getTime())
      .slice(0, this.dashboardLimit);
  }

  get dashboardNotes(): HandoverNote[] {
    return [...this.handoverNotes()]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, this.dashboardLimit);
  }

  // ── Pagination helpers ──

  private calcTotalPages(totalItems: number): number {
    return Math.max(1, Math.ceil(totalItems / this.itemsPerPage));
  }

  private paginate<T>(items: T[], page: number): T[] {
    const start = (page - 1) * this.itemsPerPage;
    return items.slice(start, start + this.itemsPerPage);
  }

  get paginatedUrgentTasks(): AdminTask[] {
    return this.paginate(this.urgentTasks(), this.urgentPage());
  }

  get paginatedActiveTasks(): AdminTask[] {
    return this.paginate(this.activeTasks(), this.activePage());
  }

  get paginatedMyAssignedTasks(): PersonalAdminTask[] {
    return this.paginate(this.myAssignedTasks(), this.myAssignedPage());
  }

  get paginatedMyCreatedTasks(): PersonalAdminTask[] {
    return this.paginate(this.myCreatedTasks(), this.myCreatedPage());
  }

  get paginatedAllAdminTasks(): PersonalAdminTask[] {
    return this.paginate(this.allAdminTasks(), this.allAdminPage());
  }

  get paginatedFilteredHistory(): ClientInteraction[] {
    return this.paginate(this.filteredHistory(), this.interactionsPage());
  }

  get paginatedHandoverNotes(): HandoverNote[] {
    return this.paginate(this.handoverNotes(), this.handoverPage());
  }

  get paginatedActivityLogs(): TaskActivityLog[] {
    return this.paginate(this.activityLogs(), this.logsPage());
  }

  get paginatedDoneSharedTasks(): AdminTask[] {
    return this.paginate(this.doneSharedTasks(), this.doneSharedPage());
  }

  get paginatedDonePersonalTasks(): PersonalAdminTask[] {
    return this.paginate(this.donePersonalTasks(), this.donePersonalPage());
  }

  get paginatedClosedInteractions(): ClientInteraction[] {
    return this.paginate(this.closedInteractions(), this.closedInteractionsPage());
  }

  private updatePaginationCounts(): void {
    this.urgentTotalPages.set(this.calcTotalPages(this.urgentTasks().length));
    this.activeTotalPages.set(this.calcTotalPages(this.activeTasks().length));
    this.myAssignedTotalPages.set(this.calcTotalPages(this.myAssignedTasks().length));
    this.myCreatedTotalPages.set(this.calcTotalPages(this.myCreatedTasks().length));
    this.allAdminTotalPages.set(this.calcTotalPages(this.allAdminTasks().length));
    this.interactionsTotalPages.set(this.calcTotalPages(this.filteredHistory().length));
    this.handoverTotalPages.set(this.calcTotalPages(this.handoverNotes().length));
    this.logsTotalPages.set(this.calcTotalPages(this.activityLogs().length));
    this.doneSharedTotalPages.set(this.calcTotalPages(this.doneSharedTasks().length));
    this.donePersonalTotalPages.set(this.calcTotalPages(this.donePersonalTasks().length));
    this.closedInteractionsTotalPages.set(this.calcTotalPages(this.closedInteractions().length));
  }

  goToPageFor(section: string, page: number): void {
    const totalKey = section + 'TotalPages';
    const total = (this as any)[totalKey] || 1;
    if (page < 1 || page > total) return;
    (this as any)[section + 'Page'] = page;
  }

  getVisiblePagesFor(section: string): number[] {
    const current = (this as any)[section + 'Page'] as number;
    const total = (this as any)[section + 'TotalPages'] as number;
    const pages: number[] = [];
    const maxVisible = 3;

    if (total <= 5) {
      for (let i = 2; i < total; i++) pages.push(i);
    } else {
      let start = Math.max(2, current - 1);
      let end = Math.min(total - 1, start + maxVisible - 1);
      if (end === total - 1) start = Math.max(2, end - maxVisible + 1);
      for (let i = start; i <= end; i++) pages.push(i);
    }
    return pages;
  }

  isDueSoon(task: AdminTask): boolean {
    if (!task.dueDate) return false;
    const due = new Date(task.dueDate);
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(23, 59, 59, 999);
    return due <= tomorrow;
  }

  getDueLabel(task: AdminTask | PersonalAdminTask): string {
    if (!task.dueDate) return '';
    const due = new Date(task.dueDate);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const dueDay = new Date(due);
    dueDay.setHours(0, 0, 0, 0);

    const diff = Math.round((dueDay.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    if (diff < 0) return 'Overdue';
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Tomorrow';
    return due.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  getDueLabelClass(task: AdminTask | PersonalAdminTask): string {
    const label = this.getDueLabel(task);
    if (label === 'Overdue' || label === 'Today') return 'due-today';
    if (label === 'Tomorrow') return 'due-tomorrow';
    return 'due-later';
  }

  // ── Task CRUD ──

  toggleTaskStatus(task: AdminTask): void {
    if (task.status !== 'Done') {
      // Marking as Done → show completion modal
      this.pendingCompletionTask = task;
      this.pendingCompletionType = 'shared';
      this.completionNoteText.set(task.completionNote || '');
      this.showCompletionModal.set(true);
    } else {
      // Re-opening task
      this.taskService.updateTaskStatus(task.id, 'Todo').subscribe({
        next: (updated) => {
          const idx = this.tasks.findIndex(t => t.id === task.id);
          if (idx >= 0) this.tasks[idx] = updated;
          this.computeTaskViews();
        }
      });
    }
  }

  openCreateTask(): void {
    this.editingTaskId.set(null);
    this.taskForm.set({ title: '', priority: 'Normal' });
    this.taskClientQuery.set('');
    this.taskOrderQuery.set('');
    this.taskClientSelected = false;
    this.taskOrderSelected = false;
    this.showTaskModal.set(true);
  }

  openEditTask(task: AdminTask): void {
    this.editingTaskId.set(task.id);
    this.taskForm.set({
      title: task.title,
      description: task.description,
      priority: task.priority,
      dueDate: task.dueDate ? task.dueDate.split('T')[0] : undefined,
      clientName: task.clientName,
      clientEmail: task.clientEmail,
      clientPhone: task.clientPhone,
      clientId: task.clientId,
      orderId: task.orderId,
      completionNote: task.completionNote
    });
    this.taskClientQuery.set(task.clientName || '');
    this.taskOrderQuery.set(task.orderId ? `#${task.orderId}` : '');
    this.taskClientSelected = !!task.clientId;
    this.taskOrderSelected = !!task.orderId;
    this.showTaskModal.set(true);
    this.openMenuTaskId.set(null);
  }

  saveTask(): void {
    if (!this.taskForm().title.trim()) return;

    if (this.editingTaskId()) {
      const update: UpdateAdminTask = { ...this.taskForm() };
      // The HTML date input gives '' (empty string) when cleared. Sending '' to the
      // backend's DateTime? property fails model binding (400). Normalise to null and
      // set clearDueDate so the backend actually nulls the column instead of preserving
      // the old value via its HasValue gate.
      const due = (update.dueDate ?? '').toString().trim();
      if (due === '') {
        update.dueDate = undefined;
        update.clearDueDate = true;
      }
      this.taskService.updateTask(this.editingTaskId()!, update).subscribe({
        next: () => { this.showTaskModal.set(false); this.loadTasks(); }
      });
    } else {
      const { completionNote, ...createData } = this.taskForm() as any;
      this.taskService.createTask(createData).subscribe({
        next: () => { this.showTaskModal.set(false); this.loadTasks(); }
      });
    }
  }

  deleteTask(task: AdminTask): void {
    if (!confirm(`Delete task "${task.title}"?`)) return;
    this.taskService.deleteTask(task.id).subscribe({
      next: () => this.loadTasks()
    });
    this.openMenuTaskId.set(null);
  }

  toggleMenu(taskId: number, event: Event): void {
    event.stopPropagation();
    this.openMenuTaskId.set(this.openMenuTaskId() === taskId ? null : taskId);
  }

  // ── Personal Admin Task CRUD ──

  togglePersonalTaskStatus(task: PersonalAdminTask): void {
    if (task.status !== 'Done') {
      // Marking as Done → show completion modal
      this.pendingCompletionTask = task;
      this.pendingCompletionType = 'personal';
      this.completionNoteText.set(task.completionNote || '');
      this.showCompletionModal.set(true);
    } else {
      // Re-opening task
      this.taskService.updatePersonalTaskStatus(task.id, 'Todo').subscribe({
        next: () => { this.loadPersonalTasks(); if (this.isSuperAdmin) this.loadAllAdminTasks(); }
      });
    }
  }

  openCreatePersonalTask(): void {
    this.editingPersonalTaskId.set(null);
    this.personalTaskForm.set({ title: '', priority: 'Normal', assignedToAdminIds: [] as number[] });
    this.showPersonalTaskModal.set(true);
  }

  openEditPersonalTask(task: PersonalAdminTask): void {
    this.editingPersonalTaskId.set(task.id);
    this.personalTaskReadOnly.set(task.createdByAdminId !== this.currentAdminId);
    this.personalTaskForm.set({
      title: task.title,
      description: task.description,
      priority: task.priority,
      dueDate: task.dueDate ? task.dueDate.split('T')[0] : undefined,
      assignedToAdminId: task.assignedToAdminId,
      completionNote: task.completionNote
    });
    this.showPersonalTaskModal.set(true);
    this.openMenuPersonalTaskId.set(null);

    // Mark as checked by creator when creator opens a completed task
    if (task.status === 'Done' && !task.checkedByCreator && task.createdByAdminId === this.currentAdminId) {
      this.taskService.markTaskCheckedByCreator(task.id).subscribe({
        next: () => {
          task.checkedByCreator = true;
          this.computePersonalTaskViews();
        }
      });
    }
  }

  openViewPersonalTask(task: PersonalAdminTask): void {
    this.viewingPersonalTask.set(task);
    this.showViewPersonalTaskModal.set(true);

    // Mark as checked by creator when creator views a completed task
    if (task.status === 'Done' && !task.checkedByCreator && task.createdByAdminId === this.currentAdminId) {
      this.taskService.markTaskCheckedByCreator(task.id).subscribe({
        next: () => {
          task.checkedByCreator = true;
          this.computePersonalTaskViews();
        }
      });
    }
  }

  savePersonalTask(): void {
    if (!this.personalTaskForm().title.trim()) return;

    if (this.editingPersonalTaskId()) {
      const update: UpdatePersonalAdminTask = {
        title: this.personalTaskForm().title,
        description: this.personalTaskForm().description,
        priority: this.personalTaskForm().priority,
        dueDate: this.personalTaskForm().dueDate,
        assignedToAdminId: this.personalTaskForm().assignedToAdminId,
        completionNote: this.personalTaskForm().completionNote
      };
      // Same fix as saveTask() — empty date input means "remove the date" and needs to be
      // translated into clearDueDate=true so the backend nulls the column.
      const due = (update.dueDate ?? '').toString().trim();
      if (due === '') {
        update.dueDate = undefined;
        update.clearDueDate = true;
      }
      this.taskService.updatePersonalTask(this.editingPersonalTaskId()!, update).subscribe({
        next: () => { this.showPersonalTaskModal.set(false); this.loadPersonalTasks(); if (this.isSuperAdmin) this.loadAllAdminTasks(); }
      });
    } else {
      if (!this.personalTaskForm().assignedToAdminIds || this.personalTaskForm().assignedToAdminIds.length === 0) return;
      const create: CreatePersonalAdminTask = {
        title: this.personalTaskForm().title,
        description: this.personalTaskForm().description,
        priority: this.personalTaskForm().priority,
        dueDate: this.personalTaskForm().dueDate,
        assignedToAdminIds: this.personalTaskForm().assignedToAdminIds
      };
      this.taskService.createPersonalTask(create).subscribe({
        next: () => { this.showPersonalTaskModal.set(false); this.loadPersonalTasks(); if (this.isSuperAdmin) this.loadAllAdminTasks(); }
      });
    }
  }

  toggleAdminSelection(adminId: number): void {
    const ids: number[] = this.personalTaskForm().assignedToAdminIds || [];
    const idx = ids.indexOf(adminId);
    if (idx >= 0) {
      ids.splice(idx, 1);
    } else {
      ids.push(adminId);
    }
    this.personalTaskForm().assignedToAdminIds = [...ids];
    this.personalTaskForm.set(this.personalTaskForm());
  }

  isAdminSelected(adminId: number): boolean {
    return (this.personalTaskForm().assignedToAdminIds || []).includes(adminId);
  }

  deletePersonalTask(task: PersonalAdminTask): void {
    if (!confirm(`Delete task "${task.title}"?`)) return;
    this.taskService.deletePersonalTask(task.id).subscribe({
      next: () => { this.loadPersonalTasks(); if (this.isSuperAdmin) this.loadAllAdminTasks(); }
    });
    this.openMenuPersonalTaskId.set(null);
  }

  togglePersonalTaskMenu(taskId: number, event: Event): void {
    event.stopPropagation();
    this.openMenuPersonalTaskId.set(this.openMenuPersonalTaskId() === taskId ? null : taskId);
  }

  // ── Interaction CRUD ──

  openCreateInteraction(): void {
    this.editingInteractionId.set(null);
    this.interactionForm.set({ clientName: '', type: '', notes: '', status: 'Pending' });
    this.interactionClientQuery.set('');
    this.interactionClientSelected = false;
    this.showInteractionModal.set(true);
  }

  openEditInteraction(interaction: ClientInteraction): void {
    this.editingInteractionId.set(interaction.id);
    this.interactionForm.set({
      clientName: interaction.clientName,
      clientPhone: interaction.clientPhone,
      clientEmail: interaction.clientEmail,
      type: interaction.type,
      notes: interaction.notes,
      status: interaction.status
    });
    this.interactionClientQuery.set(interaction.clientName);
    this.interactionClientSelected = !!interaction.clientId;
    this.showInteractionModal.set(true);
  }

  saveInteraction(): void {
    if (!this.interactionForm().clientName.trim()) return;

    if (this.editingInteractionId()) {
      this.taskService.updateClientInteraction(this.editingInteractionId()!, {
        clientName: this.interactionForm().clientName,
        clientPhone: this.interactionForm().clientPhone,
        clientEmail: this.interactionForm().clientEmail,
        type: this.interactionForm().type,
        notes: this.interactionForm().notes,
        status: this.interactionForm().status
      }).subscribe({
        next: () => { this.showInteractionModal.set(false); this.loadInteractions(); }
      });
    } else {
      this.taskService.createClientInteraction(this.interactionForm()).subscribe({
        next: () => { this.showInteractionModal.set(false); this.loadInteractions(); }
      });
    }
  }

  deleteInteraction(interaction: ClientInteraction): void {
    if (!confirm(`Delete interaction with "${interaction.clientName}"?`)) return;
    this.taskService.deleteClientInteraction(interaction.id).subscribe({
      next: () => this.loadInteractions()
    });
    this.openMenuInteractionId.set(null);
  }

  toggleInteractionMenu(interactionId: number, event: Event): void {
    event.stopPropagation();
    this.openMenuInteractionId.set(this.openMenuInteractionId() === interactionId ? null : interactionId);
  }

  // ── Handover Note CRUD ──

  openCreateNote(): void {
    this.noteForm.set({ content: '', targetAudience: 'ForNextAdmin' });
    this.editingNoteId.set(null);
    this.showNoteModal.set(true);
  }

  openEditNote(note: HandoverNote): void {
    this.noteForm.set({ content: note.content, targetAudience: note.targetAudience });
    this.editingNoteId.set(note.id);
    this.showNoteModal.set(true);
  }

  saveNote(): void {
    if (!this.noteForm().content.trim()) return;
    if (this.editingNoteId()) {
      this.taskService.updateHandoverNote(this.editingNoteId()!, {
        content: this.noteForm().content,
        targetAudience: this.noteForm().targetAudience
      }).subscribe({
        next: () => { this.showNoteModal.set(false); this.loadHandoverNotes(); }
      });
    } else {
      this.taskService.createHandoverNote(this.noteForm()).subscribe({
        next: () => { this.showNoteModal.set(false); this.loadHandoverNotes(); }
      });
    }
  }

  deleteNote(note: HandoverNote): void {
    if (!confirm('Delete this handover note?')) return;
    this.taskService.deleteHandoverNote(note.id).subscribe({
      next: () => this.loadHandoverNotes()
    });
  }

  // ── History filters ──

  applyHistoryFilters(): void {
    let filtered = [...this.clientInteractions];

    if (this.historySearch()) {
      const q = this.historySearch().toLowerCase();
      filtered = filtered.filter(i =>
        i.clientName.toLowerCase().includes(q) ||
        (i.clientPhone && i.clientPhone.toLowerCase().includes(q)) ||
        (i.clientEmail && i.clientEmail.toLowerCase().includes(q)) ||
        (i.notes && i.notes.toLowerCase().includes(q))
      );
    }

    if (this.historyStatusFilter()) {
      filtered = filtered.filter(i => i.status === this.historyStatusFilter());
    }

    if (this.historyAdminFilter()) {
      filtered = filtered.filter(i => i.adminId === +this.historyAdminFilter());
    }

    this.filteredHistory.set(filtered.filter(i => i.status !== 'Closed'));
    this.closedInteractions.set(filtered.filter(i => i.status === 'Closed'));
    this.interactionsPage.set(1);
    this.closedInteractionsPage.set(1);
    this.updatePaginationCounts();
  }

  onHistoryFilterChange(): void {
    this.applyHistoryFilters();
  }

  // ── Helpers ──

  displayRole(role: string): string {
    return role === 'SuperAdmin' ? 'SAdmin' : role;
  }

  getInitials(name: string): string {
    if (!name) return '?';
    return name.split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2);
  }

  getAvatarColor(name: string): string {
    // 700 shades of the original hues so white initials pass AA (2026-10); order kept.
    const colors = ['#2563eb', '#6d28d9', '#b91c1c', '#15803d', '#b45309', '#8E44AD', '#0f766e', '#c2410c'];
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
      hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    return colors[Math.abs(hash) % colors.length];
  }

  formatDate(dateStr: string): string {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  // Both helpers format UTC timestamps (createdAt) in NY (business) time.
  // Wall-clock fields (dueDate) go through getDueLabel instead — don't reuse these for them.
  formatFullDate(dateStr: string): string {
    if (!dateStr) return '';
    return formatNy(dateStr, { month: 'short', day: 'numeric', year: 'numeric' });
  }

  formatFullDateTime(dateStr: string): string {
    if (!dateStr) return '';
    return formatNy(dateStr, { month: 'short', day: 'numeric', year: 'numeric' }) +
      ' ' + formatNy(dateStr, { hour: '2-digit', minute: '2-digit', hour12: true });
  }

  getTargetAudienceLabel(audience: string): string {
    switch (audience) {
      case 'ForNextAdmin': return 'For Next Admin';
      case 'ForAllAdmins': return 'For All Admins';
      default: return audience;
    }
  }

  // ── Completion modal ──

  confirmCompletion(): void {
    if (!this.pendingCompletionTask) return;
    const note = this.completionNoteText().trim() || undefined;

    if (this.pendingCompletionType === 'shared') {
      this.taskService.updateTaskStatus(this.pendingCompletionTask.id, 'Done', note).subscribe({
        next: (updated) => {
          const idx = this.tasks.findIndex(t => t.id === this.pendingCompletionTask!.id);
          if (idx >= 0) this.tasks[idx] = updated;
          this.computeTaskViews();
          this.closeCompletionModal();
        }
      });
    } else {
      this.taskService.updatePersonalTaskStatus(this.pendingCompletionTask.id, 'Done', note).subscribe({
        next: () => {
          this.loadPersonalTasks();
          if (this.isSuperAdmin) this.loadAllAdminTasks();
          this.closeCompletionModal();
        }
      });
    }
  }

  skipCompletion(): void {
    if (!this.pendingCompletionTask) return;

    if (this.pendingCompletionType === 'shared') {
      this.taskService.updateTaskStatus(this.pendingCompletionTask.id, 'Done').subscribe({
        next: (updated) => {
          const idx = this.tasks.findIndex(t => t.id === this.pendingCompletionTask!.id);
          if (idx >= 0) this.tasks[idx] = updated;
          this.computeTaskViews();
          this.closeCompletionModal();
        }
      });
    } else {
      this.taskService.updatePersonalTaskStatus(this.pendingCompletionTask.id, 'Done').subscribe({
        next: () => {
          this.loadPersonalTasks();
          if (this.isSuperAdmin) this.loadAllAdminTasks();
          this.closeCompletionModal();
        }
      });
    }
  }

  closeCompletionModal(): void {
    this.showCompletionModal.set(false);
    this.completionNoteText.set('');
    this.pendingCompletionTask = null;
  }


  closeModal(event: MouseEvent): void {
    if ((event.target as HTMLElement).classList.contains('modal-overlay')) {
      this.showTaskModal.set(false);
      this.showInteractionModal.set(false);
      this.showNoteModal.set(false);
      this.showPersonalTaskModal.set(false);
      this.showViewPersonalTaskModal.set(false);
      this.closeCompletionModal();
    }
  }
}
