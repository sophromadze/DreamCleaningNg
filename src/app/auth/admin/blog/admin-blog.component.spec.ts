import { ComponentFixture, TestBed } from '@angular/core/testing';

import { AdminBlogComponent } from './admin-blog.component';

import { testProviders } from '../../../../testing/test-providers';

describe('AdminBlogComponent', () => {
  let fixture: ComponentFixture<AdminBlogComponent>;
  let component: AdminBlogComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      providers: [...testProviders],
      imports: [AdminBlogComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(AdminBlogComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    fixture.detectChanges();
    expect(component).toBeTruthy();
  });

  // The live preview used to hand marked's output to bypassSecurityTrustHtml, so markup pasted
  // into a draft (an AI-generated one included) ran in the admin's session. It is now bound as a
  // plain string and Angular's sanitizer cleans it; the formatting itself must survive.
  describe('the Markdown preview', () => {
    const renderPreview = async (md: string): Promise<HTMLElement> => {
      component.editingPost.set({ id: 0 } as any);
      component.setTab('editor');
      (component as any).renderPreview(md);
      fixture.detectChanges();
      await fixture.whenStable();
      return fixture.nativeElement.querySelector('.preview-body');
    };

    beforeEach(() => vi.spyOn(console, 'warn').mockImplementation(() => {}));

    it('renders the article formatting', async () => {
      const body = await renderPreview('## Kitchen\n\n- **Oven** inside\n- [Checklist](/cleaning-checklist)\n\n![Sink](/blog-images/sink.webp "Sink")');

      expect(body.querySelector('h2')?.textContent).toBe('Kitchen');
      expect(body.querySelector('li strong')?.textContent).toBe('Oven');
      expect(body.querySelector('a')?.getAttribute('href')).toBe('/cleaning-checklist');
      const img = body.querySelector('img')!;
      expect(img.getAttribute('src')).toBe('/blog-images/sink.webp');
      expect(img.getAttribute('alt')).toBe('Sink');
    });

    it('strips scripts, event handlers and javascript: links', async () => {
      const body = await renderPreview(
        'Hello <script>window.__xss = 1</script>\n\n<img src="x" onerror="window.__xss = 2">\n\n[click](javascript:window.__xss=3)\n\n<iframe src="https://example.com"></iframe>');

      expect(body.innerHTML).not.toContain('<script');
      expect(body.innerHTML).not.toContain('onerror');
      expect(body.innerHTML).not.toContain('<iframe');
      expect(body.querySelector('a')?.getAttribute('href') ?? '').not.toMatch(/^javascript:/);
      expect((window as any).__xss).toBeUndefined();
    });
  });
});
