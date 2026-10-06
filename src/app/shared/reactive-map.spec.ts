import { computed } from '@angular/core';

import { ReactiveMap } from './reactive-map';

describe('ReactiveMap', () => {
  it('behaves as a Map', () => {
    const map = new ReactiveMap<string, number>([['a', 1]]);
    map.set('b', 2);
    expect(map.get('a')).toBe(1);
    expect([...map.keys()]).toEqual(['a', 'b']);
    expect(map.delete('a')).toBe(true);
    expect(map.delete('a')).toBe(false);
    expect(map.size).toBe(1);
  });

  it('re-evaluates what reads it when an entry is added, removed or cleared', () => {
    const map = new ReactiveMap<number, string>();
    const hasOne = computed(() => map.has(1));
    const count = computed(() => map.size);

    expect(hasOne()).toBe(false);
    map.set(1, 'start');
    expect(hasOne()).toBe(true);
    expect(count()).toBe(1);

    map.delete(1);
    expect(hasOne()).toBe(false);

    map.set(2, 'end');
    map.clear();
    expect(count()).toBe(0);
  });
});
