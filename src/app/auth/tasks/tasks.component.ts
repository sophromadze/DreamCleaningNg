import { Component, OnInit, OnDestroy, HostListener } from '@angular/core';
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
import { Subject, Subscription } from 'rxjs';
import { debounceTime, distinctUntilChanged, switchMap, filter } from 'rxjs/operators';

@Component({
  selector: 'app-tasks',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './tasks.component.html',
  styleUrls: ['./tasks.component.scss']
})
export class TasksComponent implements OnInit, OnDestroy {

  private signalRSub?: Subscription;

  // ── Current admin ──
  currentAdminName = '';
  currentAdminId = 0;
  currentAdminRole = '';

  // ── Data ──
  tasks: AdminTask[] = [];
  clientInteractions: ClientInteraction[] = [];
  handoverNotes: HandoverNote[] = [];
  admins: UserAdmin[] = [];
  personalTasks: PersonalAdminTask[] = [];

  // ── Computed / filtered ──
  urgentTasks: AdminTask[] = [];
  activeTasks: AdminTask[] = [];
  activeTaskCount = 0;
  doneSharedTasks: AdminTask[] = [];
  recentInteractions: ClientInteraction[] = [];
  filteredHistory: ClientInteraction[] = [];
  closedInteractions: ClientInteraction[] = [];

  // ── Personal tasks computed ──
  myAssignedTasks: PersonalAdminTask[] = [];
  myCreatedTasks: PersonalAdminTask[] = [];
  allAdminTasks: PersonalAdminTask[] = [];
  donePersonalTasks: PersonalAdminTask[] = [];
  uncheckedDoneCreatedCount = 0;
  loadingAllAdminTasks = false;

  // ── Pagination (6 items per page) ──
  readonly itemsPerPage = 6;

  // Shared tab
  urgentPage = 1;
  urgentTotalPages = 1;
  activePage = 1;
  activeTotalPages = 1;

  // My Tasks tab
  myAssignedPage = 1;
  myAssignedTotalPages = 1;
  myCreatedPage = 1;
  myCreatedTotalPages = 1;
  allAdminPage = 1;
  allAdminTotalPages = 1;

  // Done cards
  doneSharedPage = 1;
  doneSharedTotalPages = 1;
  donePersonalPage = 1;
  donePersonalTotalPages = 1;
  closedInteractionsPage = 1;
  closedInteractionsTotalPages = 1;

  // Interactions tab
  interactionsPage = 1;
  interactionsTotalPages = 1;

  // Handover tab
  handoverPage = 1;
  handoverTotalPages = 1;

  // Logs tab
  logsPage = 1;
  logsTotalPages = 1;

  // ── Activity logs ──
  activityLogs: TaskActivityLog[] = [];
  loadingLogs = false;
  logSearchId = '';
  logEntityTypeFilter = '';
  logActionFilter = '';
  logAdminFilter = '';
  logPage = 1;
  logHasMore = true;

  // ── Tabs ──
  activeTab = 'dashboard';

  // ── Sub-tabs ──
  sharedSubTab: 'urgent' | 'active' | 'done' = 'urgent';
  myTasksSubTab: 'assigned' | 'created' | 'done' | 'allAdmin' = 'assigned';
  interactionsSubTab: 'active' | 'closed' = 'active';

  // ── Filters ──
  taskFilter = 'all';
  historySearch = '';
  historyStatusFilter = '';
  historyAdminFilter = '';
  historyPeriodFilter = 'thisMonth';

  // ── Loading ──
  loadingTasks = false;
  loadingInteractions = false;
  loadingNotes = false;
  loadingPersonalTasks = false;

  // ── Modals ──
  showTaskModal = false;
  showInteractionModal = false;
  showNoteModal = false;
  showPersonalTaskModal = false;

  // ── Task form ──
  taskForm: CreateAdminTask & { completionNote?: string } = { title: '', priority: 'Normal' };
  editingTaskId: number | null = null;

  // ── Personal task form ──
  personalTaskForm: any = { title: '', priority: 'Normal', assignedToAdminIds: [] as number[] };
  editingPersonalTaskId: number | null = null;

  // ── Interaction form ──
  interactionForm: CreateClientInteraction = {
    clientName: '',
    type: '',
    notes: '',
    status: 'Pending'
  };
  editingInteractionId: number | null = null;

  // ── Note form ──
  noteForm: CreateHandoverNote = { content: '', targetAudience: 'ForNextAdmin' };
  editingNoteId: number | null = null;

  // ── Dashboard limit ──
  readonly dashboardLimit = 10;

  // ── Personal task edit restriction ──
  personalTaskReadOnly = false;

  // ── View-only modal for SuperAdmin all tasks ──
  showViewPersonalTaskModal = false;
  viewingPersonalTask: PersonalAdminTask | null = null;

  // ── Completion modal ──
  showCompletionModal = false;
  completionNoteText = '';
  pendingCompletionTask: AdminTask | PersonalAdminTask | null = null;
  pendingCompletionType: 'shared' | 'personal' = 'shared';

  // ── Filtered admins (no moderators for history) ──
  historyAdmins: UserAdmin[] = [];

  // ── Context menus ──
  openMenuTaskId: number | null = null;
  openMenuInteractionId: number | null = null;
  openMenuPersonalTaskId: number | null = null;

  // ── Client autocomplete (for tasks) ──
  taskClientQuery = '';
  taskClientResults: ClientSearchResult[] = [];
  showTaskClientDropdown = false;
  taskClientSelected = false;
  private taskClientSearch$ = new Subject<string>();

  // ── Order autocomplete (for tasks) ──
  taskOrderQuery = '';
  taskOrderResults: OrderSearchResult[] = [];
  showTaskOrderDropdown = false;
  taskOrderSelected = false;
  private taskOrderSearch$ = new Subject<string>();

  // ── Client autocomplete (for interactions) ──
  interactionClientQuery = '';
  interactionClientResults: ClientSearchResult[] = [];
  showInteractionClientDropdown = false;
  interactionClientSelected = false;
  private interactionClientSearch$ = new Subject<string>();

  constructor(
    private taskService: TaskService,
    private adminService: AdminService,
    private authService: AuthService,
    private signalRService: SignalRService
  ) {}

  ngOnInit(): void {
    const user = this.authService.currentUserValue;
    if (user) {
      this.currentAdminName = user.firstName;
      this.currentAdminId = user.id;
      this.currentAdminRole = user.role;
    }
    const savedTab = sessionStorage.getItem('tasksActiveTab');
    if (savedTab) this.activeTab = savedTab;
    this.loadData();
    if (this.activeTab === 'logs' && this.isSuperAdmin) {
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
      if (this.activeTab === 'logs') {
        this.loadActivityLogs();
      }
    });
  }

  @HostListener('document:click')
  onDocumentClick(): void {
    this.openMenuTaskId = null;
    this.openMenuInteractionId = null;
    this.openMenuPersonalTaskId = null;
    this.showTaskClientDropdown = false;
    this.showTaskOrderDropdown = false;
    this.showInteractionClientDropdown = false;
  }

  // ── Search streams with debounce ──

  private setupSearchStreams(): void {
    this.taskClientSearch$.pipe(
      debounceTime(300),
      distinctUntilChanged(),
      switchMap(q => this.taskService.searchClients(q))
    ).subscribe(results => {
      this.taskClientResults = results;
      this.showTaskClientDropdown = results.length > 0;
    });

    this.taskOrderSearch$.pipe(
      debounceTime(300),
      distinctUntilChanged(),
      switchMap(q => this.taskService.searchOrders(q))
    ).subscribe(results => {
      this.taskOrderResults = results;
      this.showTaskOrderDropdown = results.length > 0;
    });

    this.interactionClientSearch$.pipe(
      debounceTime(300),
      distinctUntilChanged(),
      switchMap(q => this.taskService.searchClients(q))
    ).subscribe(results => {
      this.interactionClientResults = results;
      this.showInteractionClientDropdown = results.length > 0;
    });
  }

  // ── Task client autocomplete ──

  onTaskClientInput(value: string): void {
    this.taskClientQuery = value;
    this.taskClientSelected = false;
    this.taskForm.clientName = value;
    this.taskForm.clientId = undefined;
    if (value.length >= 2) {
      this.taskClientSearch$.next(value);
    } else {
      this.taskClientResults = [];
      this.showTaskClientDropdown = false;
    }
  }

  selectTaskClient(client: ClientSearchResult, event: Event): void {
    event.stopPropagation();
    this.taskClientQuery = `${client.firstName} ${client.lastName}`;
    this.taskForm.clientName = this.taskClientQuery;
    this.taskForm.clientEmail = client.email;
    this.taskForm.clientPhone = client.phone || '';
    this.taskForm.clientId = client.id;
    this.taskClientSelected = true;
    this.showTaskClientDropdown = false;
  }

  // ── Task order autocomplete ──

  onTaskOrderInput(value: string): void {
    this.taskOrderQuery = value;
    this.taskOrderSelected = false;
    this.taskForm.orderId = undefined;
    if (value.length >= 1) {
      this.taskOrderSearch$.next(value);
    } else {
      this.taskOrderResults = [];
      this.showTaskOrderDropdown = false;
    }
  }

  selectTaskOrder(order: OrderSearchResult, event: Event): void {
    event.stopPropagation();
    this.taskOrderQuery = `#${order.id} - ${order.contactFirstName} ${order.contactLastName} (${order.serviceTypeName})`;
    this.taskForm.orderId = order.id;
    this.taskForm.clientName = `${order.contactFirstName} ${order.contactLastName}`;
    this.taskForm.clientEmail = order.contactEmail || '';
    this.taskForm.clientPhone = order.contactPhone || '';
    this.taskClientQuery = this.taskForm.clientName;
    this.taskClientSelected = true;
    this.taskOrderSelected = true;
    this.showTaskOrderDropdown = false;
  }

  // ── Interaction client autocomplete ──

  onInteractionClientInput(value: string): void {
    this.interactionClientQuery = value;
    this.interactionClientSelected = false;
    this.interactionForm.clientName = value;
    this.interactionForm.clientId = undefined;
    if (value.length >= 2) {
      this.interactionClientSearch$.next(value);
    } else {
      this.interactionClientResults = [];
      this.showInteractionClientDropdown = false;
    }
  }

  selectInteractionClient(client: ClientSearchResult, event: Event): void {
    event.stopPropagation();
    this.interactionClientQuery = `${client.firstName} ${client.lastName}`;
    this.interactionForm.clientName = this.interactionClientQuery;
    this.interactionForm.clientEmail = client.email;
    this.interactionForm.clientPhone = client.phone || '';
    this.interactionForm.clientId = client.id;
    this.interactionClientSelected = true;
    this.showInteractionClientDropdown = false;
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
    this.loadingTasks = true;
    this.taskService.getTasks().subscribe({
      next: (tasks) => {
        this.tasks = tasks;
        this.computeTaskViews();
        this.loadingTasks = false;
      },
      error: () => { this.loadingTasks = false; }
    });
  }

  loadPersonalTasks(): void {
    this.loadingPersonalTasks = true;
    this.taskService.getPersonalTasks().subscribe({
      next: (tasks) => {
        this.personalTasks = tasks;
        this.computePersonalTaskViews();
        this.loadingPersonalTasks = false;
      },
      error: () => { this.loadingPersonalTasks = false; }
    });
  }

  loadAllAdminTasks(): void {
    this.loadingAllAdminTasks = true;
    this.taskService.getAllPersonalTasks().subscribe({
      next: (tasks) => {
        this.allAdminTasks = tasks.filter(t => t.status !== 'Done');
        this.allAdminPage = 1;
        this.updatePaginationCounts();
        this.loadingAllAdminTasks = false;
      },
      error: () => { this.loadingAllAdminTasks = false; }
    });
  }

  loadInteractions(): void {
    this.loadingInteractions = true;
    this.taskService.getClientInteractions().subscribe({
      next: (interactions) => {
        this.clientInteractions = interactions;
        this.recentInteractions = interactions.slice(0, 3);
        this.applyHistoryFilters();
        this.loadingInteractions = false;
      },
      error: () => { this.loadingInteractions = false; }
    });
  }

  loadHandoverNotes(): void {
    this.loadingNotes = true;
    this.taskService.getHandoverNotes().subscribe({
      next: (notes) => {
        this.handoverNotes = notes;
        this.handoverPage = 1;
        this.updatePaginationCounts();
        this.loadingNotes = false;
      },
      error: () => { this.loadingNotes = false; }
    });
  }

  loadAdmins(): void {
    this.adminService.getUsers().subscribe({
      next: (response: any) => {
        const users: UserAdmin[] = response.users || response;
        this.admins = users.filter(u =>
          u.role === 'Admin' || u.role === 'SuperAdmin'
        );
        this.historyAdmins = users.filter(u =>
          u.role === 'Admin' || u.role === 'SuperAdmin'
        );
      }
    });
  }

  // ── Activity Logs ──

  loadActivityLogs(reset = true): void {
    if (reset) {
      this.logPage = 1;
      this.activityLogs = [];
      this.logHasMore = true;
    }
    this.loadingLogs = true;
    const adminId = this.logAdminFilter ? +this.logAdminFilter : undefined;
    const entityId = this.logSearchId ? +this.logSearchId : undefined;
    this.taskService.getTaskActivityLogs(
      this.logEntityTypeFilter || undefined,
      this.logActionFilter || undefined,
      adminId,
      this.logPage,
      50,
      entityId
    ).subscribe({
      next: (logs) => {
        if (reset) {
          this.activityLogs = logs;
          this.logsPage = 1;
        } else {
          this.activityLogs = [...this.activityLogs, ...logs];
        }
        this.logHasMore = logs.length >= 50;
        this.updatePaginationCounts();
        this.loadingLogs = false;
      },
      error: () => { this.loadingLogs = false; }
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
    this.activeTab = 'shared';
    this.sharedSubTab = subTab;
    sessionStorage.setItem('tasksActiveTab', 'shared');
  }

  setActiveTab(tab: string): void {
    this.activeTab = tab;
    sessionStorage.setItem('tasksActiveTab', tab);
    if (tab === 'logs' && this.activityLogs.length === 0) {
      this.loadActivityLogs();
    }
  }

  // ── Task filtering ──

  computeTaskViews(): void {
    this.urgentTasks = this.tasks.filter(t =>
      t.status !== 'Done' &&
      (t.priority === 'Urgent' || t.priority === 'High' || this.isDueSoon(t))
    );
    this.urgentPage = 1;
    this.applyTaskFilter();
  }

  computePersonalTaskViews(): void {
    this.myAssignedTasks = this.personalTasks.filter(t => t.assignedToAdminId === this.currentAdminId && t.status !== 'Done');
    this.myCreatedTasks = this.personalTasks.filter(t => t.createdByAdminId === this.currentAdminId && (t.status !== 'Done' || !t.checkedByCreator));
    this.donePersonalTasks = this.personalTasks.filter(t =>
      t.status === 'Done' &&
      (t.assignedToAdminId === this.currentAdminId || t.createdByAdminId === this.currentAdminId)
    );
    this.uncheckedDoneCreatedCount = this.personalTasks.filter(t =>
      t.createdByAdminId === this.currentAdminId && t.status === 'Done' && !t.checkedByCreator
    ).length;
    this.myAssignedPage = 1;
    this.myCreatedPage = 1;
    this.donePersonalPage = 1;
    this.updatePaginationCounts();
  }

  applyTaskFilter(): void {
    const urgentIds = new Set(this.urgentTasks.map(t => t.id));
    this.activeTasks = this.tasks.filter(t => t.status !== 'Done' && !urgentIds.has(t.id));
    this.activeTaskCount = this.activeTasks.length;
    this.doneSharedTasks = this.tasks.filter(t => t.status === 'Done');
    this.activePage = 1;
    this.doneSharedPage = 1;
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
    return this.sortTasksByImportance(this.urgentTasks).slice(0, this.dashboardLimit);
  }

  get dashboardActiveTasks(): AdminTask[] {
    return this.sortTasksByImportance(this.activeTasks).slice(0, this.dashboardLimit);
  }

  get dashboardInteractions(): ClientInteraction[] {
    return [...this.filteredHistory]
      .sort((a, b) => new Date(b.interactionDate).getTime() - new Date(a.interactionDate).getTime())
      .slice(0, this.dashboardLimit);
  }

  get dashboardNotes(): HandoverNote[] {
    return [...this.handoverNotes]
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
    return this.paginate(this.urgentTasks, this.urgentPage);
  }

  get paginatedActiveTasks(): AdminTask[] {
    return this.paginate(this.activeTasks, this.activePage);
  }

  get paginatedMyAssignedTasks(): PersonalAdminTask[] {
    return this.paginate(this.myAssignedTasks, this.myAssignedPage);
  }

  get paginatedMyCreatedTasks(): PersonalAdminTask[] {
    return this.paginate(this.myCreatedTasks, this.myCreatedPage);
  }

  get paginatedAllAdminTasks(): PersonalAdminTask[] {
    return this.paginate(this.allAdminTasks, this.allAdminPage);
  }

  get paginatedFilteredHistory(): ClientInteraction[] {
    return this.paginate(this.filteredHistory, this.interactionsPage);
  }

  get paginatedHandoverNotes(): HandoverNote[] {
    return this.paginate(this.handoverNotes, this.handoverPage);
  }

  get paginatedActivityLogs(): TaskActivityLog[] {
    return this.paginate(this.activityLogs, this.logsPage);
  }

  get paginatedDoneSharedTasks(): AdminTask[] {
    return this.paginate(this.doneSharedTasks, this.doneSharedPage);
  }

  get paginatedDonePersonalTasks(): PersonalAdminTask[] {
    return this.paginate(this.donePersonalTasks, this.donePersonalPage);
  }

  get paginatedClosedInteractions(): ClientInteraction[] {
    return this.paginate(this.closedInteractions, this.closedInteractionsPage);
  }

  private updatePaginationCounts(): void {
    this.urgentTotalPages = this.calcTotalPages(this.urgentTasks.length);
    this.activeTotalPages = this.calcTotalPages(this.activeTasks.length);
    this.myAssignedTotalPages = this.calcTotalPages(this.myAssignedTasks.length);
    this.myCreatedTotalPages = this.calcTotalPages(this.myCreatedTasks.length);
    this.allAdminTotalPages = this.calcTotalPages(this.allAdminTasks.length);
    this.interactionsTotalPages = this.calcTotalPages(this.filteredHistory.length);
    this.handoverTotalPages = this.calcTotalPages(this.handoverNotes.length);
    this.logsTotalPages = this.calcTotalPages(this.activityLogs.length);
    this.doneSharedTotalPages = this.calcTotalPages(this.doneSharedTasks.length);
    this.donePersonalTotalPages = this.calcTotalPages(this.donePersonalTasks.length);
    this.closedInteractionsTotalPages = this.calcTotalPages(this.closedInteractions.length);
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
      this.completionNoteText = task.completionNote || '';
      this.showCompletionModal = true;
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
    this.editingTaskId = null;
    this.taskForm = { title: '', priority: 'Normal' };
    this.taskClientQuery = '';
    this.taskOrderQuery = '';
    this.taskClientSelected = false;
    this.taskOrderSelected = false;
    this.showTaskModal = true;
  }

  openEditTask(task: AdminTask): void {
    this.editingTaskId = task.id;
    this.taskForm = {
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
    };
    this.taskClientQuery = task.clientName || '';
    this.taskOrderQuery = task.orderId ? `#${task.orderId}` : '';
    this.taskClientSelected = !!task.clientId;
    this.taskOrderSelected = !!task.orderId;
    this.showTaskModal = true;
    this.openMenuTaskId = null;
  }

  saveTask(): void {
    if (!this.taskForm.title.trim()) return;

    if (this.editingTaskId) {
      const update: UpdateAdminTask = { ...this.taskForm };
      this.taskService.updateTask(this.editingTaskId, update).subscribe({
        next: () => { this.showTaskModal = false; this.loadTasks(); }
      });
    } else {
      const { completionNote, ...createData } = this.taskForm as any;
      this.taskService.createTask(createData).subscribe({
        next: () => { this.showTaskModal = false; this.loadTasks(); }
      });
    }
  }

  deleteTask(task: AdminTask): void {
    if (!confirm(`Delete task "${task.title}"?`)) return;
    this.taskService.deleteTask(task.id).subscribe({
      next: () => this.loadTasks()
    });
    this.openMenuTaskId = null;
  }

  toggleMenu(taskId: number, event: Event): void {
    event.stopPropagation();
    this.openMenuTaskId = this.openMenuTaskId === taskId ? null : taskId;
  }

  // ── Personal Admin Task CRUD ──

  togglePersonalTaskStatus(task: PersonalAdminTask): void {
    if (task.status !== 'Done') {
      // Marking as Done → show completion modal
      this.pendingCompletionTask = task;
      this.pendingCompletionType = 'personal';
      this.completionNoteText = task.completionNote || '';
      this.showCompletionModal = true;
    } else {
      // Re-opening task
      this.taskService.updatePersonalTaskStatus(task.id, 'Todo').subscribe({
        next: () => { this.loadPersonalTasks(); if (this.isSuperAdmin) this.loadAllAdminTasks(); }
      });
    }
  }

  openCreatePersonalTask(): void {
    this.editingPersonalTaskId = null;
    this.personalTaskForm = { title: '', priority: 'Normal', assignedToAdminIds: [] as number[] };
    this.showPersonalTaskModal = true;
  }

  openEditPersonalTask(task: PersonalAdminTask): void {
    this.editingPersonalTaskId = task.id;
    this.personalTaskReadOnly = task.createdByAdminId !== this.currentAdminId;
    this.personalTaskForm = {
      title: task.title,
      description: task.description,
      priority: task.priority,
      dueDate: task.dueDate ? task.dueDate.split('T')[0] : undefined,
      assignedToAdminId: task.assignedToAdminId,
      completionNote: task.completionNote
    };
    this.showPersonalTaskModal = true;
    this.openMenuPersonalTaskId = null;

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
    this.viewingPersonalTask = task;
    this.showViewPersonalTaskModal = true;

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
    if (!this.personalTaskForm.title.trim()) return;

    if (this.editingPersonalTaskId) {
      const update: UpdatePersonalAdminTask = {
        title: this.personalTaskForm.title,
        description: this.personalTaskForm.description,
        priority: this.personalTaskForm.priority,
        dueDate: this.personalTaskForm.dueDate,
        assignedToAdminId: this.personalTaskForm.assignedToAdminId,
        completionNote: this.personalTaskForm.completionNote
      };
      this.taskService.updatePersonalTask(this.editingPersonalTaskId, update).subscribe({
        next: () => { this.showPersonalTaskModal = false; this.loadPersonalTasks(); if (this.isSuperAdmin) this.loadAllAdminTasks(); }
      });
    } else {
      if (!this.personalTaskForm.assignedToAdminIds || this.personalTaskForm.assignedToAdminIds.length === 0) return;
      const create: CreatePersonalAdminTask = {
        title: this.personalTaskForm.title,
        description: this.personalTaskForm.description,
        priority: this.personalTaskForm.priority,
        dueDate: this.personalTaskForm.dueDate,
        assignedToAdminIds: this.personalTaskForm.assignedToAdminIds
      };
      this.taskService.createPersonalTask(create).subscribe({
        next: () => { this.showPersonalTaskModal = false; this.loadPersonalTasks(); if (this.isSuperAdmin) this.loadAllAdminTasks(); }
      });
    }
  }

  toggleAdminSelection(adminId: number): void {
    const ids: number[] = this.personalTaskForm.assignedToAdminIds || [];
    const idx = ids.indexOf(adminId);
    if (idx >= 0) {
      ids.splice(idx, 1);
    } else {
      ids.push(adminId);
    }
    this.personalTaskForm.assignedToAdminIds = [...ids];
  }

  isAdminSelected(adminId: number): boolean {
    return (this.personalTaskForm.assignedToAdminIds || []).includes(adminId);
  }

  deletePersonalTask(task: PersonalAdminTask): void {
    if (!confirm(`Delete task "${task.title}"?`)) return;
    this.taskService.deletePersonalTask(task.id).subscribe({
      next: () => { this.loadPersonalTasks(); if (this.isSuperAdmin) this.loadAllAdminTasks(); }
    });
    this.openMenuPersonalTaskId = null;
  }

  togglePersonalTaskMenu(taskId: number, event: Event): void {
    event.stopPropagation();
    this.openMenuPersonalTaskId = this.openMenuPersonalTaskId === taskId ? null : taskId;
  }

  // ── Interaction CRUD ──

  openCreateInteraction(): void {
    this.editingInteractionId = null;
    this.interactionForm = { clientName: '', type: '', notes: '', status: 'Pending' };
    this.interactionClientQuery = '';
    this.interactionClientSelected = false;
    this.showInteractionModal = true;
  }

  openEditInteraction(interaction: ClientInteraction): void {
    this.editingInteractionId = interaction.id;
    this.interactionForm = {
      clientName: interaction.clientName,
      clientPhone: interaction.clientPhone,
      clientEmail: interaction.clientEmail,
      type: interaction.type,
      notes: interaction.notes,
      status: interaction.status
    };
    this.interactionClientQuery = interaction.clientName;
    this.interactionClientSelected = !!interaction.clientId;
    this.showInteractionModal = true;
  }

  saveInteraction(): void {
    if (!this.interactionForm.clientName.trim()) return;

    if (this.editingInteractionId) {
      this.taskService.updateClientInteraction(this.editingInteractionId, {
        clientName: this.interactionForm.clientName,
        clientPhone: this.interactionForm.clientPhone,
        clientEmail: this.interactionForm.clientEmail,
        type: this.interactionForm.type,
        notes: this.interactionForm.notes,
        status: this.interactionForm.status
      }).subscribe({
        next: () => { this.showInteractionModal = false; this.loadInteractions(); }
      });
    } else {
      this.taskService.createClientInteraction(this.interactionForm).subscribe({
        next: () => { this.showInteractionModal = false; this.loadInteractions(); }
      });
    }
  }

  deleteInteraction(interaction: ClientInteraction): void {
    if (!confirm(`Delete interaction with "${interaction.clientName}"?`)) return;
    this.taskService.deleteClientInteraction(interaction.id).subscribe({
      next: () => this.loadInteractions()
    });
    this.openMenuInteractionId = null;
  }

  toggleInteractionMenu(interactionId: number, event: Event): void {
    event.stopPropagation();
    this.openMenuInteractionId = this.openMenuInteractionId === interactionId ? null : interactionId;
  }

  // ── Handover Note CRUD ──

  openCreateNote(): void {
    this.noteForm = { content: '', targetAudience: 'ForNextAdmin' };
    this.editingNoteId = null;
    this.showNoteModal = true;
  }

  openEditNote(note: HandoverNote): void {
    this.noteForm = { content: note.content, targetAudience: note.targetAudience };
    this.editingNoteId = note.id;
    this.showNoteModal = true;
  }

  saveNote(): void {
    if (!this.noteForm.content.trim()) return;
    if (this.editingNoteId) {
      this.taskService.updateHandoverNote(this.editingNoteId, {
        content: this.noteForm.content,
        targetAudience: this.noteForm.targetAudience
      }).subscribe({
        next: () => { this.showNoteModal = false; this.loadHandoverNotes(); }
      });
    } else {
      this.taskService.createHandoverNote(this.noteForm).subscribe({
        next: () => { this.showNoteModal = false; this.loadHandoverNotes(); }
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

    if (this.historySearch) {
      const q = this.historySearch.toLowerCase();
      filtered = filtered.filter(i =>
        i.clientName.toLowerCase().includes(q) ||
        (i.clientPhone && i.clientPhone.toLowerCase().includes(q)) ||
        (i.clientEmail && i.clientEmail.toLowerCase().includes(q)) ||
        (i.notes && i.notes.toLowerCase().includes(q))
      );
    }

    if (this.historyStatusFilter) {
      filtered = filtered.filter(i => i.status === this.historyStatusFilter);
    }

    if (this.historyAdminFilter) {
      filtered = filtered.filter(i => i.adminId === +this.historyAdminFilter);
    }

    this.filteredHistory = filtered.filter(i => i.status !== 'Closed');
    this.closedInteractions = filtered.filter(i => i.status === 'Closed');
    this.interactionsPage = 1;
    this.closedInteractionsPage = 1;
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
    const colors = ['#4A90D9', '#7B61FF', '#E74C3C', '#27AE60', '#F39C12', '#8E44AD', '#1ABC9C', '#E67E22'];
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

  formatFullDate(dateStr: string): string {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  formatFullDateTime(dateStr: string): string {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) +
      ' ' + date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
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
    const note = this.completionNoteText.trim() || undefined;

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
    this.showCompletionModal = false;
    this.completionNoteText = '';
    this.pendingCompletionTask = null;
  }


  closeModal(event: MouseEvent): void {
    if ((event.target as HTMLElement).classList.contains('modal-overlay')) {
      this.showTaskModal = false;
      this.showInteractionModal = false;
      this.showNoteModal = false;
      this.showPersonalTaskModal = false;
      this.showViewPersonalTaskModal = false;
      this.closeCompletionModal();
    }
  }
}
