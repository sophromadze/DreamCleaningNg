import { Component, Input, Output, EventEmitter, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

export interface FloorTypeOption {
  value: string;
  label: string;
}

export interface FloorTypeSelection {
  types: string[];
  otherText: string;
}

@Component({
  selector: 'app-floor-type-selector',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './floor-type-selector.component.html',
  styleUrl: './floor-type-selector.component.scss'
})
export class FloorTypeSelectorComponent implements OnInit {
  @Input() selectedTypes: string[] = [];
  @Input() otherText: string = '';
  @Output() selectionChange = new EventEmitter<FloorTypeSelection>();

  readonly floorTypeOptions: readonly FloorTypeOption[] = [
    { value: 'hardwood', label: 'Hardwood' },
    { value: 'engineered-wood', label: 'Engineered Wood' },
    { value: 'laminate', label: 'Laminate' },
    { value: 'vinyl', label: 'Vinyl (LVP/LVT)' },
    { value: 'tile', label: 'Tile (Ceramic/Porcelain)' },
    { value: 'natural-stone', label: 'Natural Stone (Marble/Granite)' },
    { value: 'carpet', label: 'Carpet' },
    { value: 'concrete', label: 'Concrete' },
    { value: 'other', label: 'Other' }
  ];

  ngOnInit(): void {
    // Clone inputs so we don't mutate parent data
    this.selectedTypes = [...this.selectedTypes];
  }

  toggleFloorType(type: string): void {
    const index = this.selectedTypes.indexOf(type);
    if (index > -1) {
      this.selectedTypes.splice(index, 1);
      if (type === 'other') {
        this.otherText = '';
      }
    } else {
      this.selectedTypes.push(type);
    }
    this.emitChange();
  }

  isFloorTypeSelected(type: string): boolean {
    return this.selectedTypes.includes(type);
  }

  showOtherInput(): boolean {
    return this.selectedTypes.includes('other');
  }

  onOtherTextChange(): void {
    this.emitChange();
  }

  private emitChange(): void {
    this.selectionChange.emit({
      types: [...this.selectedTypes],
      otherText: this.otherText
    });
  }
}
