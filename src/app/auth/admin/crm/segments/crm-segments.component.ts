import { Component, EventEmitter, OnInit, Output, ChangeDetectionStrategy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CrmCustomerService, CrmSegment } from '../../../../services/crm-customer.service';

@Component({
  selector: 'app-crm-segments',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './crm-segments.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrls: ['./crm-segments.component.scss']
})
export class CrmSegmentsComponent implements OnInit {
  private customerService = inject(CrmCustomerService);

  /** Emits the segment key when a card is opened, so the shell can switch to the filtered list. */
  @Output() selectSegment = new EventEmitter<string>();

  segments: CrmSegment[] = [];
  loading = false;
  errorMessage = '';

  ngOnInit(): void {
    this.loading = true;
    this.customerService.getSegments().subscribe({
      next: s => { this.segments = s; this.loading = false; },
      error: () => { this.errorMessage = 'Failed to load segments.'; this.loading = false; }
    });
  }

  open(seg: CrmSegment): void {
    if (seg.count === 0) return;
    this.selectSegment.emit(seg.key);
  }

  segClass(key: string): string {
    return 'seg-' + key;
  }
}
