import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { ContractsComponent } from '../crm/contracts/contracts.component';

/**
 * Commercial contracts, as the Contracts tab of the Commercial shell
 * (/admin/commercial/contracts).
 *
 * History, because the URL has moved twice and the redirects only make sense with it: contracts
 * began as a CRM tab, which gave them no real URL — only a sessionStorage tab and a ?contractId=
 * query param. They became their own top-level /admin/contracts section (2026-09) so a contract
 * could be linked to and bookmarked, which is what the revision-request email needs. They then
 * joined Invoices and Clients under Commercial, because those three are one workflow. The old
 * /admin/contracts paths REDIRECT here rather than being removed — links to them are already
 * sitting in people's inboxes.
 *
 * This stays a thin wrapper around the unchanged ContractsComponent, which takes the contract to
 * open as an @Input and so needs something to read the route param for it. The page chrome that
 * used to live here belongs to the Commercial shell now.
 */
@Component({
  selector: 'app-contracts-page',
  standalone: true,
  imports: [CommonModule, ContractsComponent],
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
