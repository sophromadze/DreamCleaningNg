import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';

import { ConnectAuthorizeComponent } from './connect-authorize.component';
import { ClaudeConnectorService, ConnectorAuthorizeCheck } from '../services/claude-connector.service';
import { testProviders } from '../../testing/test-providers';

describe('ConnectAuthorizeComponent (Claude connector consent)', () => {
  let fixture: ComponentFixture<ConnectAuthorizeComponent>;
  let component: ConnectAuthorizeComponent;
  let api: Record<string, ReturnType<typeof vi.fn>>;
  const query = 'response_type=code&client_id=mcpc_1&redirect_uri=https%3A%2F%2Fclaude.ai%2Fapi%2Fmcp%2Fauth_callback&state=s';

  async function setup(check: ConnectorAuthorizeCheck | 'error') {
    window.history.replaceState({}, '', '/connect/authorize?' + query);
    api = {
      check: vi.fn().mockReturnValue(check === 'error'
        ? throwError(() => ({ status: 400, error: { message: 'Unknown client. Remove the connector in Claude and add it again.' } }))
        : of(check)),
      decide: vi.fn().mockReturnValue(of({ redirectUrl: 'https://claude.ai/api/mcp/auth_callback?code=abc&state=s' }))
    };
    await TestBed.configureTestingModule({
      providers: [...testProviders, { provide: ClaudeConnectorService, useValue: api }],
      imports: [ConnectAuthorizeComponent]
    }).compileComponents();
    fixture = TestBed.createComponent(ConnectAuthorizeComponent);
    component = fixture.componentInstance;
    vi.spyOn(component, 'navigate').mockImplementation(() => undefined);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  const el = () => fixture.nativeElement as HTMLElement;
  const button = (text: string) =>
    Array.from(el().querySelectorAll('button')).find(b => b.textContent!.trim() === text) as HTMLButtonElement | undefined;

  afterEach(() => window.history.replaceState({}, '', '/'));

  it('sends the server the exact query string it was opened with', async () => {
    await setup({ clientName: 'Claude', redirectHost: 'claude.ai', signedIn: true, canApprove: true, userName: 'Sam' });
    expect(api['check']).toHaveBeenCalledWith(query);
  });

  it('shows a SuperAdmin who is asking and where the answer goes, and Allow sends them back with a code', async () => {
    await setup({ clientName: 'Claude', redirectHost: 'claude.ai', signedIn: true, canApprove: true, userName: 'Sam' });
    expect(el().textContent).toContain('Allow Claude to use Dream Cleaning data?');
    expect(el().textContent).toContain('claude.ai');
    expect(el().textContent).toContain('Sam');

    button('Allow')!.click();
    expect(api['decide']).toHaveBeenCalledWith(query, true);
    expect(component.navigate).toHaveBeenCalledWith('https://claude.ai/api/mcp/auth_callback?code=abc&state=s');
  });

  it('Deny sends Claude a refusal rather than a code', async () => {
    await setup({ clientName: 'Claude', redirectHost: 'claude.ai', signedIn: true, canApprove: true, userName: 'Sam' });
    button('Deny')!.click();
    expect(api['decide']).toHaveBeenCalledWith(query, false);
  });

  it('refuses a non-SuperAdmin clearly and offers no Allow button', async () => {
    await setup({ clientName: 'Claude', redirectHost: 'claude.ai', signedIn: true, canApprove: false, userName: 'Ada' });
    expect(el().textContent).toContain('Only SuperAdmin accounts can connect Claude');
    expect(button('Allow')).toBeUndefined();

    button('Back to Claude')!.click();
    expect(api['decide']).toHaveBeenCalledWith(query, false);
  });

  it('explains an invalid request with the server message and offers nothing to click', async () => {
    await setup('error');
    expect(el().textContent).toContain("can't be completed");
    expect(el().textContent).toContain('Unknown client');
    expect(el().querySelectorAll('button').length).toBe(0);
  });

  it('shows the server refusal if Allow is refused after all', async () => {
    await setup({ clientName: 'Claude', redirectHost: 'claude.ai', signedIn: true, canApprove: true, userName: 'Sam' });
    api['decide'].mockReturnValue(throwError(() => ({ status: 403, error: { message: 'Only SuperAdmin accounts can connect Claude to this site.' } })));
    button('Allow')!.click();
    fixture.detectChanges();
    expect(component.navigate).not.toHaveBeenCalled();
    expect(el().querySelector('[role="alert"]')!.textContent).toContain('Only SuperAdmin accounts');
  });
});
