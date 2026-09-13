import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { finalize } from 'rxjs/operators';

import {
  ContractService, ScopeGroup, ScopeItem, ScopeStructure, ScopeTemplate
} from '../../../../services/contract.service';
import { extractApiErrorMessage } from '../../../../utils/http-error.utils';

/**
 * Business types and their scope-of-work templates.
 *
 * A business type IS a scope template: Restaurant, Gym/Studio, Office, Medical/Dental, Retail,
 * Building Common Areas — and whatever an admin adds next. Its checklist is an ordered list of
 * CATEGORIES ("Included Areas", "Kitchen - not included"), each holding ITEMS with a
 * default-selected flag. Nothing about the list is hardcoded; a new premises type is a row.
 *
 * ══ THE RULE THAT MAKES THIS SAFE TO EDIT ══
 *
 * <b>Every change here affects FUTURE contracts only.</b> Choosing a business type on a contract
 * DEEP COPIES its checklist into that contract's own snapshot, and generating a version freezes
 * the copy along with the rest of the document. So renaming a category, retiring an item or
 * archiving a whole business type cannot reach an agreement that already exists — structurally,
 * not by a rule anyone has to remember.
 *
 * That is also why retiring is an ARCHIVE rather than a delete: an archived row stops being
 * offered on new contracts and keeps rendering on the signed ones that used it.
 */
@Component({
  selector: 'app-business-types',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './business-types.component.html',
  styleUrls: ['./business-types.component.scss']
})
export class BusinessTypesComponent implements OnInit {
  private contracts = inject(ContractService);

  templates: ScopeTemplate[] = [];
  selected: ScopeTemplate | null = null;

  loading = true;
  saving = false;
  error = '';
  notice = '';

  /** "Show archived" — retired types, restorable. Off by default. */
  includeArchived = false;

  // New-row inputs, one per category plus one for the type itself.
  newTypeName = '';
  newCategoryTitle = '';
  newItemLabels: Record<number, string> = {};

  ngOnInit(): void {
    this.load();
  }

  private load(selectId?: number): void {
    this.loading = true;
    this.contracts.getScopeTemplates(this.includeArchived)
      .pipe(finalize(() => this.loading = false))
      .subscribe({
        next: rows => {
          this.templates = rows;
          const target = selectId ?? this.selected?.id;
          const match = target ? rows.find(t => t.id === target) : rows[0];
          if (match) this.open(match.id);
          else this.selected = null;
        },
        error: err => this.error = extractApiErrorMessage(err, 'Could not load the business types.')
      });
  }

  onIncludeArchivedChange(): void {
    this.load();
  }

  /**
   * Opens one business type for editing.
   *
   * Always fetched through the SINGLE-template endpoint, which returns archived categories and
   * items too — the list endpoint strips them, because that one feeds the contract form. An editor
   * that could not see what it had archived would have no way to un-archive it.
   */
  open(id: number): void {
    this.error = '';
    this.contracts.getScopeTemplate(id).subscribe({
      next: t => {
        // Deep clone: everything below edits a working copy, so an abandoned edit leaves the
        // loaded list untouched and Save is the only thing that writes.
        this.selected = JSON.parse(JSON.stringify(t)) as ScopeTemplate;
        this.newItemLabels = {};
      },
      error: err => this.error = extractApiErrorMessage(err, 'Could not open that business type.')
    });
  }

  // ── The type itself ────────────────────────────────────────────────────────

  createType(): void {
    const name = this.newTypeName.trim();
    if (!name || this.saving) return;

    this.saving = true;
    this.error = '';

    this.contracts.createScopeTemplate({
      name,
      // A sensible starting noun the admin corrects: it is rendered into the agreement as
      // "the {{PREMISES_TYPE}} operated by Client", so a blank would read badly.
      premisesType: 'premises',
      allowsCustomRows: true,
      sortOrder: this.templates.length + 1,
      structure: { groups: [] }
    })
      .pipe(finalize(() => this.saving = false))
      .subscribe({
        next: created => {
          this.newTypeName = '';
          this.notice = `“${created.name}” created. Add its categories and items below.`;
          this.load(created.id);
        },
        error: err => this.error = extractApiErrorMessage(err, 'Could not create the business type.')
      });
  }

  save(): void {
    if (!this.selected || this.saving) return;

    const name = this.selected.name.trim();
    if (!name) { this.error = 'Enter a name for the business type.'; return; }

    this.saving = true;
    this.error = '';

    this.contracts.updateScopeTemplate(this.selected.id, {
      name,
      premisesType: this.selected.premisesType,
      allowsCustomRows: this.selected.allowsCustomRows,
      sortOrder: this.selected.sortOrder ?? 0,
      structure: this.selected.structure
    })
      .pipe(finalize(() => this.saving = false))
      .subscribe({
        next: saved => {
          this.notice = `Saved. “${saved.name}” applies to contracts created from now on; `
            + 'existing contracts keep the scope they were built with.';
          this.load(saved.id);
        },
        error: err => this.error = extractApiErrorMessage(err, 'Could not save the business type.')
      });
  }

  archiveType(): void {
    if (!this.selected) return;
    if (!confirm(
      `Archive “${this.selected.name}”?\n\n` +
      'It stops being offered on new contracts. Contracts that already use it are completely ' +
      'unaffected — they carry their own frozen copy of the scope.')) return;

    this.contracts.archiveScopeTemplate(this.selected.id).subscribe({
      next: res => { this.notice = res.message; this.load(); },
      error: err => this.error = extractApiErrorMessage(err, 'Could not archive that business type.')
    });
  }

  restoreType(id: number): void {
    this.contracts.restoreScopeTemplate(id).subscribe({
      next: res => { this.notice = res.message; this.load(id); },
      error: err => this.error = extractApiErrorMessage(err, 'Could not restore that business type.')
    });
  }

  // ── Categories ─────────────────────────────────────────────────────────────

  get groups(): ScopeGroup[] {
    return this.selected?.structure?.groups ?? [];
  }

  addCategory(): void {
    if (!this.selected) return;
    const title = this.newCategoryTitle.trim();
    if (!title) return;

    this.selected.structure.groups.push({
      // The KEY is what the agreement body references as {{SCOPE:key}}. Derived from the title
      // once, at creation, and never rewritten afterwards — renaming a category must not silently
      // orphan the token an agreement body inlines it by. A key the body does not know simply gets
      // appended to the document under "Additional scope" rather than dropped.
      key: this.slug(title),
      title,
      kind: 'included',
      inline: true,
      archived: false,
      items: []
    });

    this.newCategoryTitle = '';
  }

  moveCategory(index: number, delta: number): void {
    if (!this.selected) return;
    const groups = this.selected.structure.groups;
    const target = index + delta;
    if (target < 0 || target >= groups.length) return;
    [groups[index], groups[target]] = [groups[target], groups[index]];
  }

  /**
   * Archives a category, or removes it outright when nothing has used it yet.
   *
   * A category the admin has just typed and not saved has no history to protect, so deleting it is
   * the honest action. Anything already saved is archived instead — see the class comment.
   */
  removeCategory(index: number): void {
    if (!this.selected) return;
    const group = this.selected.structure.groups[index];

    if (this.isUnsaved(group)) {
      this.selected.structure.groups.splice(index, 1);
      return;
    }

    group.archived = !group.archived;
  }

  // ── Items ──────────────────────────────────────────────────────────────────

  addItem(groupIndex: number): void {
    if (!this.selected) return;
    const label = (this.newItemLabels[groupIndex] ?? '').trim();
    if (!label) return;

    this.selected.structure.groups[groupIndex].items.push({
      label,
      // Ticked by default: on a MASTER template this flag is the default an admin sees
      // pre-selected when they choose the business type, and most items on a checklist are things
      // that are normally done.
      selected: true,
      archived: false
    });

    this.newItemLabels[groupIndex] = '';
  }

  moveItem(groupIndex: number, index: number, delta: number): void {
    if (!this.selected) return;
    const items = this.selected.structure.groups[groupIndex].items;
    const target = index + delta;
    if (target < 0 || target >= items.length) return;
    [items[index], items[target]] = [items[target], items[index]];
  }

  removeItem(groupIndex: number, index: number): void {
    if (!this.selected) return;
    const items = this.selected.structure.groups[groupIndex].items;
    items[index].archived = !items[index].archived;
  }

  deleteItem(groupIndex: number, index: number): void {
    if (!this.selected) return;
    this.selected.structure.groups[groupIndex].items.splice(index, 1);
  }

  activeItemCount(group: ScopeGroup): number {
    return group.items.filter(i => !i.archived).length;
  }

  selectedItemCount(group: ScopeGroup): number {
    return group.items.filter(i => !i.archived && i.selected).length;
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  /** A category with no items has never been rendered into anything, so it is safe to delete. */
  private isUnsaved(group: ScopeGroup): boolean {
    return group.items.length === 0;
  }

  /** "Kitchen - not included" → "kitchen-not-included". Stable once assigned. */
  private slug(title: string): string {
    return title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'category';
  }

  trackByIndex(index: number): number { return index; }
}
