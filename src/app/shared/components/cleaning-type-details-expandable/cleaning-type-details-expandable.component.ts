import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  REGULAR_CLEANING_CHECKLIST,
  DEEP_CLEANING_CHECKLIST,
  STANDARD_CLEANING_NOT_INCLUDED,
  DEEP_CLEANING_NOT_INCLUDED,
  CleaningChecklistSection,
} from '../../cleaning-type-details.data';

@Component({
  selector: 'app-cleaning-type-details-expandable',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './cleaning-type-details-expandable.component.html',
  styleUrl: './cleaning-type-details-expandable.component.scss',
})
export class CleaningTypeDetailsExpandableComponent {
  @Input() cleaningType: 'normal' | 'deep' = 'normal';

  expanded = false;

  readonly regularChecklist: CleaningChecklistSection[] = REGULAR_CLEANING_CHECKLIST;
  readonly deepChecklist: CleaningChecklistSection[] = DEEP_CLEANING_CHECKLIST;
  readonly regularNotIncludedFooter: string[] = STANDARD_CLEANING_NOT_INCLUDED;
  readonly deepNotIncludedFooter: string[] = DEEP_CLEANING_NOT_INCLUDED;

  get activeChecklist(): CleaningChecklistSection[] {
    return this.cleaningType === 'deep' ? this.deepChecklist : this.regularChecklist;
  }

  get activeNotIncludedFooter(): string[] {
    return this.cleaningType === 'deep' ? this.deepNotIncludedFooter : this.regularNotIncludedFooter;
  }

  get panelTitle(): string {
    return this.cleaningType === 'deep'
      ? 'Deep cleaning (Additional to Regular)'
      : 'Regular cleaning';
  }

  get notIncludedFooterTitle(): string {
    return this.cleaningType === 'deep' ? 'Not included in deep cleaning' : 'Not included in regular cleaning';
  }

  get toggleButtonLabel(): string {
    if (this.expanded) {
      return "Hide what's included";
    }
    return this.cleaningType === 'deep' ? "What's included - Deep" : "What's included - Regular";
  }

  toggle(): void {
    this.expanded = !this.expanded;
  }
}
