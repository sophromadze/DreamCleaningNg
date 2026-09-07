import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { LeadsPipelineComponent } from './leads/leads-pipeline.component';
import { CrmCustomersComponent } from './customers/crm-customers.component';
import { CrmSegmentsComponent } from './segments/crm-segments.component';
import { CrmAutomationComponent } from './automation/crm-automation.component';
import { CrmCallsComponent } from './calls/crm-calls.component';

// Ads moved to the Company shell (2026-07) and Contracts moved to its own top-level section at
// /admin/contracts (2026-09); neither is a CRM tab any more.
type CrmTab = 'leads' | 'calls' | 'customers' | 'segments' | 'automation';

@Component({
  selector: 'app-crm',
  standalone: true,
  imports: [CommonModule, RouterLink, LeadsPipelineComponent, CrmCustomersComponent, CrmSegmentsComponent, CrmAutomationComponent, CrmCallsComponent],
  templateUrl: './crm.component.html',
  styleUrls: ['./crm.component.scss']
})
export class CrmComponent {
  activeTab: CrmTab = 'leads';

  /** Segment key passed into the customers list when a segment card is opened. */
  customerSegmentFilter = '';

  /** Lead id to auto-open in the Leads tab when a call's linked lead is clicked. */
  leadToOpen?: number;

  setTab(tab: CrmTab): void {
    this.activeTab = tab;
    try { sessionStorage.setItem('crmActiveTab', tab); } catch { /* SSR / privacy mode */ }
  }

  /** From the Segments tab: filter the customer list by the chosen segment and switch tabs. */
  onSegmentSelected(key: string): void {
    this.customerSegmentFilter = key;
    this.setTab('customers');
  }

  /** From the Calls tab: open the linked lead in the Leads pipeline. */
  onCallLeadSelected(leadId: number): void {
    this.leadToOpen = leadId;
    this.setTab('leads');
  }

  private readonly validTabs: CrmTab[] =
    ['leads', 'calls', 'customers', 'segments', 'automation'];

  constructor() {
    try {
      const saved = sessionStorage.getItem('crmActiveTab') as CrmTab | null;
      // Ignore any unknown value left in storage by a tab that has since moved out of the CRM —
      // 'ads' went to Company, 'contracts' to its own top-level section.
      if (saved && this.validTabs.includes(saved)) this.activeTab = saved;
    } catch { /* SSR / privacy mode */ }
  }
}
