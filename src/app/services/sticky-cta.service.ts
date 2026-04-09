import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';

/** Tracks whether the sticky mobile CTA bar is visible. Used by header to hide its mobile call icon when CTA is shown. */
@Injectable({
  providedIn: 'root'
})
export class StickyCtaService {
  private visibleSubject = new BehaviorSubject<boolean>(false);
  public visible$: Observable<boolean> = this.visibleSubject.asObservable();

  setVisible(visible: boolean): void {
    this.visibleSubject.next(visible);
  }
}
