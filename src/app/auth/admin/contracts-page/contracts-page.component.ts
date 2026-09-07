import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ContractsComponent } from '../crm/contracts/contracts.component';

/**
 * Commercial contracts as their own top-level admin section at /admin/contracts.
 *
 * Moved out of the CRM shell (2026-09): contracts are their own body of work rather than a stage
 * in the sales pipeline, and being a CRM tab meant they had no real URL — only a sessionStorage
 * tab selection and a ?contractId= query param. A dedicated route means a contract can be linked
 * to, bookmarked and opened directly, which is what the revision-request email needs.
 *
 * Matches the /admin/crm and /admin/company pattern: a thin page shell with a back link to the
 * admin panel, wrapping the existing feature component unchanged.
 */
@Component({
  selector: 'app-contracts-page',
  standalone: true,
  imports: [CommonModule, RouterLink, ContractsComponent],
  templateUrl: './contracts-page.component.html',
  styleUrls: ['./contracts-page.component.scss']
})
export class ContractsPageComponent implements OnInit {
  private route = inject(ActivatedRoute);

  /** From /admin/contracts/:id — opens that contract's detail view directly. */
  openContractId?: number;

  ngOnInit(): void {
    const id = Number(this.route.snapshot.paramMap.get('id'));
    if (id > 0) this.openContractId = id;
  }
}
