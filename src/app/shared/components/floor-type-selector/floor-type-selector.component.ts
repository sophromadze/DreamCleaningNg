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
  @Output() selectionChange = new EventEmitter<FloorTypeSelection>();

  /**
   * Mirrors the Order.FloorTypeOther column (varchar(100)). The value is also
   * embedded into Order.FloorTypes as "other:<text>"; with all 8 other floor
   * values selected that string peaks at 181 chars, well inside varchar(300).
   * Keep this in sync with the [StringLength] attributes on the booking and
   * order-update DTOs — an overflow fails the INSERT/UPDATE after the card has
   * already been charged.
   */
  readonly maxOtherLength = 100;

  private _otherText = '';
  private otherTextWasClamped = false;

  /**
   * Clamped in the setter rather than the field so it holds for every write
   * path: the parent's binding (re-pushed on each change-detection pass),
   * ngModel keystrokes, and restored values. The input's maxlength only guards
   * typing and paste.
   */
  @Input()
  set otherText(value: string) {
    const clamped = this.clampOtherText(value);
    if (clamped !== (value ?? '')) {
      this.otherTextWasClamped = true;
    }
    this._otherText = clamped;
  }
  get otherText(): string {
    return this._otherText;
  }

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
    // A restored draft or an existing order can arrive longer than the column
    // allows. The setter already trimmed what we display — push it back up so
    // the parent submits the same value. Deferred to avoid NG0100, since the
    // parent feeds this straight back down through [otherText].
    if (this.otherTextWasClamped) {
      queueMicrotask(() => this.emitChange());
    }
  }

  get otherLength(): number {
    return this._otherText.length;
  }

  private clampOtherText(value: string): string {
    if (!value) return '';
    return value.length > this.maxOtherLength ? value.slice(0, this.maxOtherLength) : value;
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
    // ngModel writes through the clamping setter, so the value is already capped.
    this.emitChange();
  }

  private emitChange(): void {
    this.selectionChange.emit({
      types: [...this.selectedTypes],
      otherText: this.otherText
    });
  }
}
