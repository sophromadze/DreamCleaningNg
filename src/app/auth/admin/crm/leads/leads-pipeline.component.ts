import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  CrmLeadService, Lead, LeadDetail, LeadPipelineColumn, LeadStats,
  CreateLead, LEAD_STAGES, LEAD_SOURCES, LeadStage
} from '../../../../services/crm-lead.service';

@Component({
  selector: 'app-leads-pipeline',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './leads-pipeline.component.html',
  styleUrls: ['./leads-pipeline.component.scss']
})
export class LeadsPipelineComponent implements OnInit {
  readonly stages = LEAD_STAGES;
  readonly sources = LEAD_SOURCES;

  columns: LeadPipelineColumn[] = [];
  stats: LeadStats | null = null;
  loading = false;
  errorMessage = '';

  // Filters
  searchTerm = '';
  sourceFilter = '';
  private searchDebounce: any;

  // Detail slide-in panel
  selectedLead: LeadDetail | null = null;
  panelLoading = false;
  savingLead = false;
  newNote = '';
  addingNote = false;
  // Inline edit buffer for the panel
  editBuffer: Partial<Lead> = {};

  // Stage-change with lost reason
  pendingLostLeadId: number | null = null;
  lostReason = '';

  // Add-lead modal
  showAddModal = false;
  newLead: CreateLead = { source: 'Manual' };
  creatingLead = false;

  constructor(private leadService: CrmLeadService) {}

  ngOnInit(): void {
    this.loadPipeline();
    this.loadStats();
  }

  // ── Loading ──

  loadPipeline(): void {
    this.loading = true;
    this.errorMessage = '';
    this.leadService.getPipeline({
      search: this.searchTerm.trim() || undefined,
      source: this.sourceFilter || undefined
    }).subscribe({
      next: cols => { this.columns = cols; this.loading = false; },
      error: () => { this.errorMessage = 'Failed to load the pipeline.'; this.loading = false; }
    });
  }

  loadStats(): void {
    this.leadService.getStats().subscribe({
      next: s => this.stats = s,
      error: () => { /* stats are non-critical */ }
    });
  }

  onSearchChange(): void {
    clearTimeout(this.searchDebounce);
    this.searchDebounce = setTimeout(() => this.loadPipeline(), 300);
  }

  onSourceFilterChange(): void {
    this.loadPipeline();
  }

  refresh(): void {
    this.loadPipeline();
    this.loadStats();
  }

  // ── Column helpers ──

  columnFor(stage: LeadStage): LeadPipelineColumn {
    return this.columns.find(c => c.stage === stage)
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
      this.pendingLostLeadId = lead.id;
      this.lostReason = '';
      return;
    }
    this.applyStage(lead.id, stage);
  }

  confirmLost(): void {
    if (this.pendingLostLeadId == null) return;
    this.applyStage(this.pendingLostLeadId, 'Lost', this.lostReason.trim() || undefined);
    this.pendingLostLeadId = null;
    this.lostReason = '';
  }

  cancelLost(): void {
    this.pendingLostLeadId = null;
    this.lostReason = '';
  }

  private applyStage(id: number, stage: LeadStage, lostReason?: string): void {
    this.leadService.updateStage(id, { stage, lostReason }).subscribe({
      next: updated => {
        this.refresh();
        if (this.selectedLead?.id === id) this.selectedLead = updated;
      },
      error: () => this.errorMessage = 'Failed to update stage.'
    });
  }

  // ── Detail panel ──

  openLead(lead: Lead): void {
    this.panelLoading = true;
    this.selectedLead = { ...(lead as LeadDetail), activities: [] };
    this.leadService.getLead(lead.id).subscribe({
      next: detail => {
        this.selectedLead = detail;
        this.editBuffer = { ...detail };
        this.panelLoading = false;
      },
      error: () => { this.errorMessage = 'Failed to load lead.'; this.panelLoading = false; }
    });
  }

  closePanel(): void {
    this.selectedLead = null;
    this.editBuffer = {};
    this.newNote = '';
  }

  saveLeadEdits(): void {
    if (!this.selectedLead) return;
    this.savingLead = true;
    const b = this.editBuffer;
    this.leadService.updateLead(this.selectedLead.id, {
      firstName: b.firstName ?? '',
      lastName: b.lastName ?? '',
      email: b.email ?? '',
      phone: b.phone ?? '',
      serviceAddress: b.serviceAddress ?? '',
      cleaningType: b.cleaningType ?? '',
      message: b.message ?? '',
      estimatedValue: b.estimatedValue != null && b.estimatedValue !== ('' as any) ? Number(b.estimatedValue) : undefined,
      nextFollowUpDate: b.nextFollowUpDate || undefined,
      clearNextFollowUpDate: !b.nextFollowUpDate
    }).subscribe({
      next: updated => {
        this.selectedLead = updated;
        this.editBuffer = { ...updated };
        this.savingLead = false;
        this.refresh();
      },
      error: () => { this.errorMessage = 'Failed to save lead.'; this.savingLead = false; }
    });
  }

  addNote(): void {
    if (!this.selectedLead || !this.newNote.trim()) return;
    this.addingNote = true;
    const leadId = this.selectedLead.id;
    this.leadService.addActivity(leadId, { type: 'Note', content: this.newNote.trim() }).subscribe({
      next: activity => {
        if (this.selectedLead?.id === leadId) {
          this.selectedLead.activities = [activity, ...this.selectedLead.activities];
        }
        this.newNote = '';
        this.addingNote = false;
        this.loadStats();
      },
      error: () => { this.errorMessage = 'Failed to add note.'; this.addingNote = false; }
    });
  }

  deleteLead(): void {
    if (!this.selectedLead) return;
    if (!confirm('Delete this lead permanently? This cannot be undone.')) return;
    const id = this.selectedLead.id;
    this.leadService.deleteLead(id).subscribe({
      next: () => { this.closePanel(); this.refresh(); },
      error: () => this.errorMessage = 'Failed to delete lead.'
    });
  }

  // ── Add-lead modal ──

  openAddModal(): void {
    this.newLead = { source: 'Manual' };
    this.showAddModal = true;
  }

  closeAddModal(): void {
    this.showAddModal = false;
  }

  createLead(): void {
    const l = this.newLead;
    if (!l.firstName?.trim() && !l.lastName?.trim() && !l.phone?.trim() && !l.email?.trim()) {
      this.errorMessage = 'Enter at least a name, phone, or email.';
      return;
    }
    this.creatingLead = true;
    this.leadService.createLead({
      ...l,
      estimatedValue: l.estimatedValue != null && (l.estimatedValue as any) !== '' ? Number(l.estimatedValue) : undefined
    }).subscribe({
      next: created => {
        this.creatingLead = false;
        this.showAddModal = false;
        this.refresh();
        this.openLead(created);
      },
      error: () => { this.errorMessage = 'Failed to create lead.'; this.creatingLead = false; }
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
