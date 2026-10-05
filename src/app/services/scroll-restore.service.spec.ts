import { TestBed } from '@angular/core/testing';
import { NavigationEnd, NavigationStart, Router, Scroll } from '@angular/router';
import { Subject } from 'rxjs';
import { ScrollRestoreService } from './scroll-restore.service';

describe('ScrollRestoreService', () => {
  let events: Subject<unknown>;
  let service: ScrollRestoreService;
  let scrollY = 0;

  const navigate = (id: number, url: string, trigger: 'imperative' | 'popstate', restoredId?: number) => {
    events.next(new NavigationStart(id, url, trigger, restoredId ? { navigationId: restoredId } : null));
    events.next(new NavigationEnd(id, url, url));
  };

  beforeEach(() => {
    events = new Subject();
    TestBed.configureTestingModule({ providers: [{ provide: Router, useValue: { events } }] });
    spyOnProperty(window, 'scrollY', 'get').and.callFake(() => scrollY);
    spyOnProperty(window, 'scrollX', 'get').and.returnValue(0);
    service = TestBed.inject(ScrollRestoreService);
    service.start();
  });

  // The homepage reads this before its first paint; it has to be the position the router will
  // restore a moment later, or the router would move the page again.
  it('hands Back the position the page had when it was left, keyed like the router keys it', () => {
    navigate(1, '/', 'imperative');
    scrollY = 4200;
    navigate(2, '/faq', 'imperative');
    scrollY = 300;

    events.next(new NavigationStart(3, '/', 'popstate', { navigationId: 1 }));

    expect(service.pendingRestore()).toEqual([0, 4200]);
  });

  it('has nothing to restore on a forward navigation, which still starts at the top', () => {
    navigate(1, '/', 'imperative');
    scrollY = 4200;
    events.next(new NavigationStart(2, '/faq', 'imperative'));

    expect(service.pendingRestore()).toBeNull();
  });

  // styles.scss sets `scroll-behavior: smooth`, which turned the router's restore into an animated
  // scroll from the top of the page.
  it('applies a restored position instantly, ignoring the smooth-scroll CSS', () => {
    const scrollTo = spyOn(window, 'scrollTo') as jasmine.Spy;
    navigate(1, '/', 'imperative');
    const end = new NavigationEnd(2, '/', '/');

    events.next(new Scroll(end, [0, 4200], null));

    expect(scrollTo).toHaveBeenCalledWith({ left: 0, top: 4200, behavior: 'instant' });
  });

  it('leaves a forward navigation\'s scroll to the router', () => {
    const scrollTo = spyOn(window, 'scrollTo') as jasmine.Spy;

    events.next(new Scroll(new NavigationEnd(2, '/faq', '/faq'), null, null));

    expect(scrollTo).not.toHaveBeenCalled();
  });
});
