import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';

import { ClaudeConnectorComponent } from './claude-connector.component';
import { ClaudeConnectorService, ConnectorSession } from '../../../services/claude-connector.service';
import { testProviders } from '../../../../testing/test-providers';

const session = (id: number, over: Partial<ConnectorSession> = {}): ConnectorSession => ({
  id, userId: 5, userName: 'Sam Super', clientName: 'Claude', clientId: 'mcpc_' + id,
  createdAt: '2026-10-16T10:00:00', lastUsedAt: '2026-10-16T11:30:00', expiresAt: null, toolCalls: 12, ...over
});

describe('ClaudeConnectorComponent (Admin → Claude Connector)', () => {
  let fixture: ComponentFixture<ClaudeConnectorComponent>;
  let api: Record<string, ReturnType<typeof vi.fn>>;

  async function setup(sessions: ConnectorSession[]) {
    api = {
      sessions: vi.fn().mockReturnValue(of({ serverUrl: 'https://dreamcleaningnyc.com/api/mcp', sessions })),
      revoke: vi.fn().mockReturnValue(of(undefined))
    };
    await TestBed.configureTestingModule({
      providers: [...testProviders, { provide: ClaudeConnectorService, useValue: api }],
      imports: [ClaudeConnectorComponent]
    }).compileComponents();
    fixture = TestBed.createComponent(ClaudeConnectorComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  const el = () => fixture.nativeElement as HTMLElement;
  const buttons = (text: string) =>
    Array.from(el().querySelectorAll('button')).filter(b => b.textContent!.trim() === text) as HTMLButtonElement[];

  it('shows the connector URL to paste into Claude', async () => {
    await setup([]);
    expect(el().querySelector('.connector-url-value')!.textContent).toContain('https://dreamcleaningnyc.com/api/mcp');
    expect(el().textContent).toContain('Add custom connector');
    expect(el().textContent).toContain('No Claude sessions are connected.');
  });

  it('lists each session with user, client, created, last used and tool calls', async () => {
    await setup([session(1), session(2, { userName: 'Other Super', clientName: null, lastUsedAt: null, toolCalls: 0 })]);
    const rows = el().querySelectorAll('tbody tr');
    expect(rows.length).toBe(2);
    expect(rows[0].textContent).toContain('Sam Super');
    expect(rows[0].textContent).toContain('Claude');
    expect(rows[0].textContent).toContain('12');
    expect(rows[1].textContent).toContain('Unnamed client');
    expect(rows[1].textContent).toContain('—');
  });

  it('revokes only after a confirm, and drops the row', async () => {
    await setup([session(1), session(2)]);
    buttons('Revoke')[0].click();
    fixture.detectChanges();
    expect(api['revoke']).not.toHaveBeenCalled();

    buttons('Confirm')[0].click();
    fixture.detectChanges();
    expect(api['revoke']).toHaveBeenCalledWith(1);
    expect(el().querySelectorAll('tbody tr').length).toBe(1);
  });

  it('keeps the row and says so when the revoke fails', async () => {
    await setup([session(1)]);
    api['revoke'].mockReturnValue(throwError(() => ({ status: 404, error: { message: 'Session not found or already ended.' } })));
    buttons('Revoke')[0].click();
    fixture.detectChanges();
    buttons('Confirm')[0].click();
    fixture.detectChanges();
    expect(el().querySelector('[role="alert"]')!.textContent).toContain('already ended');
    expect(el().querySelectorAll('tbody tr').length).toBe(1);
  });
});
