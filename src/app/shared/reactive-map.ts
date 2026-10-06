import { signal } from '@angular/core';

/**
 * A Map whose reads are tracked by Angular: a template (or computed) that calls has/get/size/iterates
 * re-renders when the map changes. For service state that templates read through a method such as
 * `isUnviewed(id)` - an OnPush view has nothing else to tell it the answer changed.
 */
export class ReactiveMap<K, V> extends Map<K, V> {
  // Map's constructor calls set() for initial entries before field initialisers run, so the version
  // signal is created lazily.
  private version?: ReturnType<typeof signal<number>>;

  private track(): void {
    (this.version ??= signal(0))();
  }

  private bump(): void {
    (this.version ??= signal(0)).update(v => v + 1);
  }

  override get(key: K): V | undefined { this.track(); return super.get(key); }
  override has(key: K): boolean { this.track(); return super.has(key); }
  override get size(): number { this.track(); return super.size; }
  override entries(): MapIterator<[K, V]> { this.track(); return super.entries(); }
  override keys(): MapIterator<K> { this.track(); return super.keys(); }
  override values(): MapIterator<V> { this.track(); return super.values(); }
  override forEach(cb: (value: V, key: K, map: Map<K, V>) => void, thisArg?: unknown): void { this.track(); super.forEach(cb, thisArg); }
  override [Symbol.iterator](): MapIterator<[K, V]> { this.track(); return super[Symbol.iterator](); }

  override set(key: K, value: V): this { super.set(key, value); this.bump(); return this; }
  override delete(key: K): boolean { const removed = super.delete(key); if (removed) this.bump(); return removed; }
  override clear(): void { const had = super.size > 0; super.clear(); if (had) this.bump(); }
}
