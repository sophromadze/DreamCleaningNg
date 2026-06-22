import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { LeadsPipelineComponent } from './leads/leads-pipeline.component';
import { CrmCustomersComponent } from './customers/crm-customers.component';
import { CrmSegmentsComponent } from './segments/crm-segments.component';
import { CrmAutomationComponent } from './automation/crm-automation.component';

type CrmTab = 'leads' | 'customers' | 'segments' | 'automation';

@Component({
  selector: 'app-crm',
  standalone: true,
  imports: [CommonModule, RouterLink, LeadsPipelineComponent, CrmCustomersComponent, CrmSegmentsComponent, CrmAutomationComponent],
  templateUrl: './crm.component.html',
  styleUrls: ['./crm.component.scss']
})
export class CrmComponent {
  activeTab: CrmTab = 'leads';

  /** Segment key passed into the customers list when a segment card is opened. */
  customerSegmentFilter = '';

  setTab(tab: CrmTab): void {
    this.activeTab = tab;
    try { sessionStorage.setItem('crmActiveTab', tab); } catch { /* SSR / privacy mode */ }
  }

  /** From the Segments tab: filter the customer list by the chosen segment and switch tabs. */
  onSegmentSelected(key: string): void {
    this.customerSegmentFilter = key;
    this.setTab('customers');
  }

  constructor() {
    try {
      const saved = sessionStorage.getItem('crmActiveTab') as CrmTab | null;
      if (saved) this.activeTab = saved;
    } catch { /* SSR / privacy mode */ }
  }
}
