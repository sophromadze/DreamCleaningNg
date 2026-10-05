import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  MOVE_IN_OUT_CHECKLIST_SECTIONS,
  MOVE_IN_OUT_IMPORTANT_REQUIREMENTS,
  MOVE_IN_OUT_NOT_INCLUDED,
} from '../../move-in-out-checklist.data';
import { CleaningChecklistSection } from '../../cleaning-type-details.data';
import { IconComponent } from '../../icons/icon.component';
import { faCheck } from '../../icons/glyphs/faCheck';
import { faChevronDown } from '../../icons/glyphs/faChevronDown';
import { faChevronUp } from '../../icons/glyphs/faChevronUp';
import { faExclamation } from '../../icons/glyphs/faExclamation';
import { faXmark } from '../../icons/glyphs/faXmark';

@Component({
  selector: 'app-move-in-out-checklist',
  standalone: true,
  imports: [CommonModule, IconComponent],
  templateUrl: './move-in-out-checklist.component.html',
  styleUrl: './move-in-out-checklist.component.scss',
})
export class MoveInOutChecklistComponent {
  protected readonly icons = { faCheck, faChevronDown, faChevronUp, faExclamation, faXmark };

  expanded = false;

  readonly sections: CleaningChecklistSection[] = MOVE_IN_OUT_CHECKLIST_SECTIONS;
  readonly importantRequirements: string[] = MOVE_IN_OUT_IMPORTANT_REQUIREMENTS;
  readonly notIncluded: string[] = MOVE_IN_OUT_NOT_INCLUDED;

  toggle(): void {
    this.expanded = !this.expanded;
  }
}
