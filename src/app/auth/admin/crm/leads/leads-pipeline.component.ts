import { Component, OnInit, ChangeDetectionStrategy, inject, signal, input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  CrmLeadService, Lead, LeadDetail, LeadPipelineColumn, LeadStats,
  CreateLead, LEAD_STAGES, LEAD_SOURCES, LEAD_TYPES, LeadStage
} from '../../../../services/crm-lead.service';
import { AuthService } from '../../../../services/auth.service';

@Component({
  selector: 'app-leads-pipeline',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './leads-pipeline.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ['./leads-pipeline.component.scss']
})
export class LeadsPipelineComponent implements OnInit {
  private leadService = inject(CrmLeadService);
  private authService = inject(AuthService);

  /** When set (e.g. from the Calls tab deep-link), auto-open this lead's detail panel on load. */
  readonly openLeadId = input<number>();

  readonly stages = LEAD_STAGES;
  readonly sources = LEAD_SOURCES;
  readonly types = LEAD_TYPES;

  readonly columns = signal<LeadPipelineColumn[]>([]);
  readonly stats = signal<LeadStats | null>(null);
  readonly loading = signal(false);
  readonly errorMessage = signal('');

  // Filters
  readonly searchTerm = signal('');
  readonly sourceFilter = signal('');
  readonly typeFilter = signal('');
  readonly periodFilter = signal('');            // '' | today | week | month | year
  readonly dateFieldFilter = signal('created');  // 'created' | 'activity'
  private searchDebounce: any;

  // Board/stage filter: '' shows every column; a stage shows only that column;
  // 'Archived' hides the board and opens the archive drawer instead. Purely
  // client-side — the pipeline data is already loaded per stage.
  readonly stageFilter = signal<'' | LeadStage | 'Archived'>('');
  readonly visibleStages = signal<LeadStage[]>([...LEAD_STAGES]);

  // Whether the current user may hard-delete leads (SuperAdmin only). Admins archive instead.
  isSuperAdmin = false;

  // Archive drawer (below the board)
  readonly archivedLeads = signal<Lead[]>([]);
  readonly loadingArchived = signal(false);
  readonly showArchived = signal(false);
  readonly archivingLead = signal(false);

  // Detail slide-in panel
  readonly selectedLead = signal<LeadDetail | null>(null, { equal: () => false });
  readonly panelLoading = signal(false);
  readonly savingLead = signal(false);
  readonly newNote = signal('');
  readonly addingNote = signal(false);
  // Inline edit buffer for the panel
  readonly editBuffer = signal<Partial<Lead>>({});

  // Stage-change with lost reason
  readonly pendingLostLeadId = signal<number | null>(null);
  readonly lostReason = signal('');

  // Add-lead modal
  readonly showAddModal = signal(false);
  readonly newLead = signal<CreateLead>({ source: 'Manual', type: 'Residential' }, { equal: () => false });
  readonly creatingLead = signal(false);
  // Optional "fill from order" input: entering an order id fetches that order
  // and prefills every form field (contact, address, cleaning type, value, notes).
  readonly prefillOrderId = signal<number | null>(null);
  readonly prefillLoading = signal(false);
  readonly prefillError = signal('');
  readonly prefillLoadedOrderId = signal<number | null>(null);
  private prefillDebounce: any;

  ngOnInit(): void {
    this.isSuperAdmin = this.authService.currentUserValue?.role === 'SuperAdmin';
    this.loadPipeline();
    this.loadStats();
    this.loadArchived();
    const openLeadId = this.openLeadId();
    if (openLeadId != null) this.openLeadById(openLeadId);
  }

  /** Open a lead's detail panel directly by id (used by the Calls-tab deep-link). */
  openLeadById(id: number): void {
    this.panelLoading.set(true);
    this.leadService.getLead(id).subscribe({
      next: detail => {
        this.selectedLead.set(detail);
        this.editBuffer.set({ ...detail });
        this.panelLoading.set(false);
      },
      error: () => { this.panelLoading.set(false); }
    });
  }

  // ── Loading ──

  /** Shared filter payload for pipeline + archive queries. */
  private currentFilters() {
    return {
      search: this.searchTerm().trim() || undefined,
      source: this.sourceFilter() || undefined,
      type: this.typeFilter() || undefined,
      period: this.periodFilter() || undefined,
      dateField: this.dateFieldFilter() || undefined
    };
  }

  loadPipeline(): void {
    this.loading.set(true);
    this.errorMessage.set('');
    this.leadService.getPipeline(this.currentFilters()).subscribe({
      next: cols => { this.columns.set(cols); this.loading.set(false); },
      error: () => { this.errorMessage.set('Failed to load the pipeline.'); this.loading.set(false); }
    });
  }

  loadArchived(): void {
    this.loadingArchived.set(true);
    this.leadService.getArchived(this.currentFilters()).subscribe({
      next: leads => { this.archivedLeads.set(leads); this.loadingArchived.set(false); },
      error: () => { this.loadingArchived.set(false); }
    });
  }

  loadStats(): void {
    this.leadService.getStats().subscribe({
      next: s => this.stats.set(s),
      error: () => { /* stats are non-critical */ }
    });
  }

  onSearchChange(): void {
    clearTimeout(this.searchDebounce);
    this.searchDebounce = setTimeout(() => { this.loadPipeline(); this.loadArchived(); }, 300);
  }

  onStageFilterChange(): void {
    const filter = this.stageFilter();
    this.visibleStages.set(filter && filter !== 'Archived'
      ? [filter]
      : [...this.stages]);
    // Choosing "Archived" should reveal the drawer right away, not leave it collapsed.
    if (this.stageFilter() === 'Archived') this.showArchived.set(true);
  }

  onSourceFilterChange(): void {
    this.loadPipeline();
    this.loadArchived();
  }

  onTypeFilterChange(): void {
    this.loadPipeline();
    this.loadArchived();
  }

  onPeriodFilterChange(): void {
    this.loadPipeline();
    this.loadArchived();
  }

  onDateFieldChange(): void {
    // Only re-filter when a period is active (date field is meaningless otherwise).
    if (this.periodFilter()) { this.loadPipeline(); this.loadArchived(); }
  }

  refresh(): void {
    this.loadPipeline();
    this.loadStats();
    this.loadArchived();
  }

  toggleArchived(): void {
    this.showArchived.set(!this.showArchived());
  }

  // ── Column helpers ──

  columnFor(stage: LeadStage): LeadPipelineColumn {
    return this.columns().find(c => c.stage === stage)
      ?? { stage, count: 0, totalEstimatedValue: 0, leads: [] };
  }

  // ── Stage moves (from card buttons) ──

  /** Advance to the next/previous open stage. Index follows LEAD_STAGES order. */
  moveStage(lead: Lead, direction: 1 | -1, event: Event): void {
    event.stopPropagation();
    const idx = this.stages.indexOf(lead.stage);
    const targetIdx = idx + direction;
    if (targetIdx < 0 || targetIdx >= this.stages.length) return;
    const target = this.stages[targetIdx];
    this.applyStage(lead.id, target);
  }

  /** Called from the per-card stage <select>; receives the new stage value (no DOM event). */
  onStageSelect(lead: Lead, stage: LeadStage): void {
    if (stage === lead.stage) return;
    if (stage === 'Lost') {
      // Ask for a reason inline before committing.
      this.pendingLostLeadId.set(lead.id);
      this.lostReason.set('');
      return;
    }
    this.applyStage(lead.id, stage);
  }

  confirmLost(): void {
    if (this.pendingLostLeadId() == null) return;
    this.applyStage(this.pendingLostLeadId()!, 'Lost', this.lostReason().trim() || undefined);
    this.pendingLostLeadId.set(null);
    this.lostReason.set('');
  }

  cancelLost(): void {
    this.pendingLostLeadId.set(null);
    this.lostReason.set('');
  }

  private applyStage(id: number, stage: LeadStage, lostReason?: string): void {
    this.leadService.updateStage(id, { stage, lostReason }).subscribe({
      next: updated => {
        this.refresh();
        if (this.selectedLead()?.id === id) this.selectedLead.set(updated);
      },
      error: () => this.errorMessage.set('Failed to update stage.')
    });
  }

  // ── Detail panel ──

  openLead(lead: Lead): void {
    this.panelLoading.set(true);
    this.selectedLead.set({ ...(lead as LeadDetail), activities: [] });
    this.leadService.getLead(lead.id).subscribe({
      next: detail => {
        this.selectedLead.set(detail);
        this.editBuffer.set({ ...detail });
        this.panelLoading.set(false);
      },
      error: () => { this.errorMessage.set('Failed to load lead.'); this.panelLoading.set(false); }
    });
  }

  closePanel(): void {
    this.selectedLead.set(null);
    this.editBuffer.set({});
    this.newNote.set('');
  }

  saveLeadEdits(): void {
    if (!this.selectedLead()) return;
    this.savingLead.set(true);
    const b = this.editBuffer();
    this.leadService.updateLead(this.selectedLead()!.id, {
      firstName: b.firstName ?? '',
      lastName: b.lastName ?? '',
      email: b.email ?? '',
      phone: b.phone ?? '',
      serviceAddress: b.serviceAddress ?? '',
      cleaningType: b.cleaningType ?? '',
      type: b.type,
      message: b.message ?? '',
      estimatedValue: b.estimatedValue != null && b.estimatedValue !== ('' as any) ? Number(b.estimatedValue) : undefined,
      nextFollowUpDate: b.nextFollowUpDate || undefined,
      clearNextFollowUpDate: !b.nextFollowUpDate
    }).subscribe({
      next: updated => {
        this.selectedLead.set(updated);
        this.editBuffer.set({ ...updated });
        this.savingLead.set(false);
        this.refresh();
      },
      error: () => { this.errorMessage.set('Failed to save lead.'); this.savingLead.set(false); }
    });
  }

  addNote(): void {
    if (!this.selectedLead() || !this.newNote().trim()) return;
    this.addingNote.set(true);
    const leadId = this.selectedLead()!.id;
    this.leadService.addActivity(leadId, { type: 'Note', content: this.newNote().trim() }).subscribe({
      next: activity => {
        if (this.selectedLead()?.id === leadId) {
          this.selectedLead()!.activities = [activity, ...this.selectedLead()!.activities];
          this.selectedLead.set(this.selectedLead());
        }
        this.newNote.set('');
        this.addingNote.set(false);
        this.loadStats();
      },
      error: () => { this.errorMessage.set('Failed to add note.'); this.addingNote.set(false); }
    });
  }

  /** Archive the open lead — moves it off the board into the archive drawer (Admins' delete alternative). */
  archiveLead(): void {
    if (!this.selectedLead() || this.archivingLead()) return;
    this.archivingLead.set(true);
    const id = this.selectedLead()!.id;
    this.leadService.archiveLead(id).subscribe({
      next: updated => {
        this.archivingLead.set(false);
        if (this.selectedLead()?.id === id) this.selectedLead.set(updated);
        this.refresh();
      },
      error: () => { this.errorMessage.set('Failed to archive lead.'); this.archivingLead.set(false); }
    });
  }

  /** Restore a lead from the archive back onto the active board. */
  unarchiveLead(lead?: Lead): void {
    const id = lead?.id ?? this.selectedLead()?.id;
    if (id == null || this.archivingLead()) return;
    this.archivingLead.set(true);
    this.leadService.unarchiveLead(id).subscribe({
      next: updated => {
        this.archivingLead.set(false);
        if (this.selectedLead()?.id === id) this.selectedLead.set(updated);
        this.refresh();
      },
      error: () => { this.errorMessage.set('Failed to restore lead.'); this.archivingLead.set(false); }
    });
  }

  /** Hard delete — SuperAdmin only. `lead` lets the archive drawer delete without opening the panel. */
  deleteLead(lead?: Lead): void {
    if (!this.isSuperAdmin) return;
    const id = lead?.id ?? this.selectedLead()?.id;
    if (id == null) return;
    if (!confirm('Delete this lead permanently? This cannot be undone.')) return;
    this.leadService.deleteLead(id).subscribe({
      next: () => {
        if (this.selectedLead()?.id === id) this.closePanel();
        this.refresh();
      },
      error: () => this.errorMessage.set('Failed to delete lead.')
    });
  }

  // ── Add-lead modal ──

  openAddModal(): void {
    this.newLead.set({ source: 'Manual', type: 'Residential' });
    this.prefillOrderId.set(null);
    this.prefillLoading.set(false);
    this.prefillError.set('');
    this.prefillLoadedOrderId.set(null);
    this.showAddModal.set(true);
  }

  closeAddModal(): void {
    this.showAddModal.set(false);
    clearTimeout(this.prefillDebounce);
  }

  /** Debounced handler for the optional Order ID field — fills the form from the order. */
  onPrefillOrderIdChange(): void {
    clearTimeout(this.prefillDebounce);
    this.prefillError.set('');

    const id = this.prefillOrderId() != null ? Number(this.prefillOrderId()) : null;
    if (id == null || !Number.isFinite(id) || id <= 0) {
      // Cleared or invalid: drop the order link but keep whatever the admin typed.
      this.prefillLoadedOrderId.set(null);
      this.newLead().sourceOrderId = undefined;
      this.newLead.set(this.newLead());
      this.newLead().clientId = undefined;
      this.newLead.set(this.newLead());
      return;
    }

    this.prefillDebounce = setTimeout(() => this.loadOrderPrefill(id), 400);
  }

  private loadOrderPrefill(orderId: number): void {
    this.prefillLoading.set(true);
    this.leadService.getOrderPrefill(orderId).subscribe({
      next: p => {
        // Stale response guard — the admin may have changed the id while loading.
        if (Number(this.prefillOrderId()) !== p.orderId) { this.prefillLoading.set(false); return; }
        this.newLead.set({
          ...this.newLead(),
          firstName: p.firstName ?? '',
          lastName: p.lastName ?? '',
          email: p.email ?? '',
          phone: p.phone ?? '',
          serviceAddress: p.serviceAddress ?? '',
          cleaningType: p.cleaningType ?? '',
          type: p.type,
          message: p.message ?? '',
          estimatedValue: p.estimatedValue,
          source: 'Booking',
          clientId: p.clientId,
          sourceOrderId: p.orderId
        });
        this.prefillLoadedOrderId.set(p.orderId);
        this.prefillLoading.set(false);
      },
      error: err => {
        this.prefillLoading.set(false);
        this.prefillLoadedOrderId.set(null);
        this.newLead().sourceOrderId = undefined;
        this.newLead.set(this.newLead());
        this.newLead().clientId = undefined;
        this.newLead.set(this.newLead());
        this.prefillError.set(err?.status === 404
          ? `Order #${orderId} not found.`
          : 'Failed to load the order.');
      }
    });
  }

  createLead(): void {
    const l = this.newLead();
    if (!l.firstName?.trim() && !l.lastName?.trim() && !l.phone?.trim() && !l.email?.trim()) {
      this.errorMessage.set('Enter at least a name, phone, or email.');
      return;
    }
    this.creatingLead.set(true);
    this.leadService.createLead({
      ...l,
      estimatedValue: l.estimatedValue != null && (l.estimatedValue as any) !== '' ? Number(l.estimatedValue) : undefined
    }).subscribe({
      next: created => {
        this.creatingLead.set(false);
        this.showAddModal.set(false);
        this.refresh();
        this.openLead(created);
      },
      error: () => { this.errorMessage.set('Failed to create lead.'); this.creatingLead.set(false); }
    });
  }

  // ── Display helpers ──

  sourceLabel(source: string): string {
    switch (source) {
      case 'ContactForm': return 'Contact';
      case 'QuoteRequest': return 'Quote';
      case 'LiveChat': return 'Chat';
      case 'Booking': return 'Booking';
      default: return 'Manual';
    }
  }

  stageClass(stage: string): string {
    return 'stage-' + stage.toLowerCase();
  }

  isFollowUpDue(lead: Lead): boolean {
    if (!lead.nextFollowUpDate) return false;
    if (lead.stage === 'Won' || lead.stage === 'Lost') return false;
    return new Date(lead.nextFollowUpDate).getTime() <= Date.now();
  }

  relativeTime(iso: string): string {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    if (days < 30) return `${days}d ago`;
    return new Date(iso).toLocaleDateString();
  }

  canMoveLeft(lead: Lead): boolean {
    return this.stages.indexOf(lead.stage) > 0;
  }

  canMoveRight(lead: Lead): boolean {
    const idx = this.stages.indexOf(lead.stage);
    return idx >= 0 && idx < this.stages.length - 1;
  }

  trackByLeadId(_: number, lead: Lead): number { return lead.id; }
  trackByStage(_: number, stage: string): string { return stage; }
}
