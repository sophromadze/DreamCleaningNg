import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { Subscription } from 'rxjs';
import {
  CHECKLIST_COMPARISON_SECTIONS,
  CHECKLIST_EXTRAS,
  CHECKLIST_NOT_INCLUDED,
  ChecklistComparisonSection,
  ChecklistRoomKey,
  MOVE_OUT_CHECKLIST_SECTIONS,
  MOVE_OUT_IMPORTANT_REQUIREMENTS,
  MoveOutChecklistSection,
} from '../shared/cleaning-checklist-page.data';

@Component({
  selector: 'app-cleaning-checklist',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './cleaning-checklist.component.html',
  styleUrl: './cleaning-checklist.component.scss',
})
export class CleaningChecklistComponent implements OnInit, OnDestroy {
  readonly comparisonSections = CHECKLIST_COMPARISON_SECTIONS;
  readonly moveOutSections = MOVE_OUT_CHECKLIST_SECTIONS;
  readonly importantRequirements = MOVE_OUT_IMPORTANT_REQUIREMENTS;
  readonly notIncluded = CHECKLIST_NOT_INCLUDED;
  readonly extras = CHECKLIST_EXTRAS;

  activeRoom: ChecklistRoomKey = 'kitchen';
  private fragmentSubscription?: Subscription;

  constructor(private route: ActivatedRoute) {}

  ngOnInit(): void {
    this.fragmentSubscription = this.route.fragment.subscribe((fragment) => {
      if (fragment === 'bathroom' || fragment === 'living' || fragment === 'bedroom') {
        this.activeRoom = fragment;
      }
    });
  }

  ngOnDestroy(): void {
    this.fragmentSubscription?.unsubscribe();
  }

  get activeSection(): ChecklistComparisonSection {
    return this.comparisonSections.find((section) => section.key === this.activeRoom) ?? this.comparisonSections[0]!;
  }

  selectRoom(room: ChecklistRoomKey): void {
    this.activeRoom = room;
  }

  trackComparisonSection(_: number, section: ChecklistComparisonSection): ChecklistRoomKey {
    return section.key;
  }

  trackMoveOutSection(_: number, section: MoveOutChecklistSection): string {
    return section.heading;
  }

  trackByText(_: number, text: string): string {
    return text;
  }
}
