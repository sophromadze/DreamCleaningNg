import { Component, ChangeDetectionStrategy, input, signal } from '@angular/core';
import {
  REGULAR_CLEANING_CHECKLIST,
  DEEP_CLEANING_CHECKLIST,
  STANDARD_CLEANING_NOT_INCLUDED,
  DEEP_CLEANING_NOT_INCLUDED,
  CleaningChecklistSection,
} from '../../cleaning-type-details.data';
import { IconComponent } from '../../icons/icon.component';
import { faCheck } from '../../icons/glyphs/faCheck';
import { faChevronDown } from '../../icons/glyphs/faChevronDown';
import { faChevronUp } from '../../icons/glyphs/faChevronUp';
import { faXmark } from '../../icons/glyphs/faXmark';

@Component({
  selector: 'app-cleaning-type-details-expandable',
  standalone: true,
  imports: [IconComponent],
  templateUrl: './cleaning-type-details-expandable.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './cleaning-type-details-expandable.component.scss',
})
export class CleaningTypeDetailsExpandableComponent {
  protected readonly icons = { faCheck, faChevronDown, faChevronUp, faXmark };

  readonly cleaningType = input<'normal' | 'deep'>('normal');

  readonly expanded = signal(false);

  readonly regularChecklist: CleaningChecklistSection[] = REGULAR_CLEANING_CHECKLIST;
  readonly deepChecklist: CleaningChecklistSection[] = DEEP_CLEANING_CHECKLIST;
  readonly regularNotIncludedFooter: string[] = STANDARD_CLEANING_NOT_INCLUDED;
  readonly deepNotIncludedFooter: string[] = DEEP_CLEANING_NOT_INCLUDED;

  get activeChecklist(): CleaningChecklistSection[] {
    return this.cleaningType() === 'deep' ? this.deepChecklist : this.regularChecklist;
  }

  get activeNotIncludedFooter(): string[] {
    return this.cleaningType() === 'deep' ? this.deepNotIncludedFooter : this.regularNotIncludedFooter;
  }

  get panelTitle(): string {
    return this.cleaningType() === 'deep'
      ? 'Deep cleaning (Additional to Regular)'
      : 'Regular cleaning';
  }

  get notIncludedFooterTitle(): string {
    return this.cleaningType() === 'deep' ? 'Not included in deep cleaning' : 'Not included in regular cleaning';
  }

  get toggleButtonLabel(): string {
    if (this.expanded()) {
      return "Hide what's included";
    }
    return this.cleaningType() === 'deep' ? "What's included - Deep" : "What's included - Regular";
  }

  toggle(): void {
    this.expanded.set(!this.expanded());
  }
}
