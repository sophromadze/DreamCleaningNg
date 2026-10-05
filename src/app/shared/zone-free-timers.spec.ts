import { NgZone } from '@angular/core';
import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { interval } from 'rxjs';
import { setIntervalOutsideZone, setTimeoutOutsideZone, subscribeOutsideZone } from './zone-free-timers';

describe('zone-free timers', () => {
  let zone: NgZone;

  beforeEach(() => { zone = TestBed.inject(NgZone); });

  it('leaves no pending macrotask in the Angular zone between ticks', () => {
    const handle = zone.run(() => setIntervalOutsideZone(zone, () => {}, 1000));
    expect(zone.hasPendingMacrotasks).toBe(false);
    clearInterval(handle);
  });

  it('runs every interval tick inside the Angular zone', fakeAsync(() => {
    const inZone: boolean[] = [];
    const handle = setIntervalOutsideZone(zone, () => inZone.push(NgZone.isInAngularZone()), 1000);
    tick(3000);
    clearInterval(handle);
    expect(inZone).toEqual([true, true, true]);
  }));

  it('runs a delayed callback once, inside the Angular zone', fakeAsync(() => {
    const calls: boolean[] = [];
    setTimeoutOutsideZone(zone, () => calls.push(NgZone.isInAngularZone()), 5000);
    tick(4999);
    expect(calls).toEqual([]);
    tick(1);
    expect(calls).toEqual([true]);
  }));

  it('delivers observable values inside the Angular zone and stops on unsubscribe', fakeAsync(() => {
    const values: number[] = [];
    const sub = subscribeOutsideZone(zone, interval(1000), v => { if (NgZone.isInAngularZone()) values.push(v); });
    tick(2000);
    sub.unsubscribe();
    tick(2000);
    expect(values).toEqual([0, 1]);
  }));
});
