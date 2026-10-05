import { TestBed } from '@angular/core/testing';
import { HttpTestingController } from '@angular/common/http/testing';
import { BeforeAfterPhotoDto, BeforeAfterPhotoService } from './before-after-photo.service';
import { environment } from '../../environments/environment';
import { testProviders } from '../../testing/test-providers';

describe('BeforeAfterPhotoService public list cache', () => {
  let service: BeforeAfterPhotoService;
  let http: HttpTestingController;
  const url = `${environment.apiUrl}/before-after-photos`;
  const photo = { id: 1, title: 'Kitchen', beforePhotoUrl: '/b.jpg', afterPhotoUrl: '/a.jpg', displayOrder: 0, isActive: true, createdAt: '' } as BeforeAfterPhotoDto;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [...testProviders] });
    service = TestBed.inject(BeforeAfterPhotoService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('answers a second request synchronously from memory (Back to the homepage draws the gallery at once)', () => {
    service.getPublic().subscribe();
    http.expectOne(url).flush([photo]);

    let received: BeforeAfterPhotoDto[] | undefined;
    service.getPublic().subscribe(list => received = list);
    expect(received).toEqual([photo]);
    http.expectNone(url);
  });

  it('fetches again after an admin write', () => {
    service.getPublic().subscribe();
    http.expectOne(url).flush([photo]);

    service.delete(1).subscribe();
    http.expectOne(`${environment.apiUrl}/admin/before-after-photos/1`).flush(null);

    service.getPublic().subscribe();
    http.expectOne(url).flush([]);
  });

  it('does not keep a failed request', () => {
    service.getPublic().subscribe({ error: () => {} });
    http.expectOne(url).flush('down', { status: 503, statusText: 'Unavailable' });

    service.getPublic().subscribe();
    http.expectOne(url).flush([photo]);
  });
});
