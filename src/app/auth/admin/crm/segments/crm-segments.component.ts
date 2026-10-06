import { Component, OnInit, ChangeDetectionStrategy, inject, output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CrmCustomerService, CrmSegment } from '../../../../services/crm-customer.service';

@Component({
  selector: 'app-crm-segments',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './crm-segments.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ['./crm-segments.component.scss']
})
export class CrmSegmentsComponent implements OnInit {
  private customerService = inject(CrmCustomerService);

  /** Emits the segment key when a card is opened, so the shell can switch to the filtered list. */
  readonly selectSegment = output<string>();

  readonly segments = signal<CrmSegment[]>([]);
  readonly loading = signal(false);
  readonly errorMessage = signal('');

  ngOnInit(): void {
    this.loading.set(true);
    this.customerService.getSegments().subscribe({
      next: s => { this.segments.set(s); this.loading.set(false); },
      error: () => { this.errorMessage.set('Failed to load segments.'); this.loading.set(false); }
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
