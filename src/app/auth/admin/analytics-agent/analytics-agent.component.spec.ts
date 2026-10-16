import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Subject, of } from 'rxjs';

import { AGENT_EXAMPLE_PROMPTS, AGENT_POLL_MS, AnalyticsAgentComponent } from './analytics-agent.component';
import { AgentMessage, AgentSession, AgentStatus, AnalyticsAgentService } from './analytics-agent.service';
import { AgentChartComponent } from './agent-chart.component';
import { AdminAgentEvent, SignalRService } from '../../../services/signalr.service';
import { testProviders } from '../../../../testing/test-providers';

const session = (id: number, title = 'Chat'): AgentSession => ({
  id, title, createdAt: '2026-10-16T10:00:00', updatedAt: '2026-10-16T10:00:00',
  inputTokens: 1200, outputTokens: 80, cacheReadTokens: 900, cacheWriteTokens: 800, estimatedCostUsd: 0.00538
});

const message = (over: Partial<AgentMessage>): AgentMessage => ({
  id: 1, role: 'assistant', content: '', status: 'complete', inputTokens: 0, outputTokens: 0,
  cacheReadTokens: 0, cacheWriteTokens: 0, createdAt: '2026-10-16T10:00:00', ...over
});

describe('AnalyticsAgentComponent', () => {
  let fixture: ComponentFixture<AnalyticsAgentComponent>;
  let component: AnalyticsAgentComponent;
  let api: Record<string, ReturnType<typeof vi.fn>>;
  let events: Subject<AdminAgentEvent>;
  const configured: AgentStatus = { isConfigured: true, sqlConfigured: true, model: 'claude-sonnet-5-5', costEstimateAvailable: true };

  async function setup(status: AgentStatus, sessions: AgentSession[] = []) {
    events = new Subject<AdminAgentEvent>();
    api = {
      status: vi.fn().mockReturnValue(of(status)),
      sessions: vi.fn().mockReturnValue(of(sessions)),
      session: vi.fn().mockReturnValue(of({ session: sessions[0] ?? session(1), messages: [] })),
      createSession: vi.fn().mockReturnValue(of(session(7, 'New chat'))),
      ask: vi.fn(),
      message: vi.fn(),
      rename: vi.fn(),
      delete: vi.fn()
    };
    await TestBed.configureTestingModule({
      providers: [
        ...testProviders,
        { provide: AnalyticsAgentService, useValue: api },
        { provide: SignalRService, useValue: { adminAgentEvents$: events.asObservable() } }
      ],
      imports: [AnalyticsAgentComponent]
    }).compileComponents();
    // jsdom has no canvas; Chart.js is not what these specs check.
    vi.spyOn(AgentChartComponent.prototype as any, 'draw').mockReturnValue(undefined);
    fixture = TestBed.createComponent(AnalyticsAgentComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  const el = () => fixture.nativeElement as HTMLElement;

  afterEach(() => vi.useRealTimers());

  it('says plainly when no API key is configured, and does not let a question be sent', async () => {
    await setup({ ...configured, isConfigured: false });
    expect(el().querySelector('.agent-banner.warn')?.textContent).toContain('not configured');
    expect((el().querySelector('textarea') as HTMLTextAreaElement).disabled).toBe(true);
    component.draft.set('Revenue?');
    component.send();
    expect(api['ask']).not.toHaveBeenCalled();
  });

  it('notes when ad-hoc SQL is unavailable but still works', async () => {
    await setup({ ...configured, sqlConfigured: false });
    expect(el().querySelector('.agent-banner.info')?.textContent).toContain('AgentReadOnly');
    expect((el().querySelector('textarea') as HTMLTextAreaElement).disabled).toBe(false);
  });

  it('offers example prompts, Georgian included, on an empty chat', async () => {
    await setup(configured);
    const chips = Array.from(el().querySelectorAll('.agent-chip')).map(c => c.textContent?.trim());
    expect(chips).toEqual([...AGENT_EXAMPLE_PROMPTS]);
    expect(chips.some(c => /[ა-ჿ]/.test(c ?? ''))).toBe(true);
  });

  it('starts a chat on the first question, then follows the answer from progress to result', async () => {
    await setup(configured);
    const running = message({ id: 11, status: 'running', progressLabel: 'Thinking…' });
    api['ask'].mockReturnValue(of({
      userMessage: message({ id: 10, role: 'user', content: 'Revenue this month?' }),
      assistantMessage: running,
      session: session(7, 'Revenue this month?')
    }));

    component.draft.set('Revenue this month?');
    component.send();
    fixture.detectChanges();

    expect(api['createSession']).toHaveBeenCalled();
    expect(api['ask']).toHaveBeenCalledWith(7, 'Revenue this month?');
    expect(component.draft()).toBe('');
    expect(el().querySelector('.agent-progress')?.textContent).toContain('Thinking…');

    // A step label arrives over SignalR.
    events.next({ kind: 'progress', sessionId: 7, messageId: 11, label: 'Running query…' });
    fixture.detectChanges();
    expect(el().querySelector('.agent-progress')?.textContent).toContain('Running query…');
    expect(component.canSend()).toBe(false);

    // The answer lands: the page re-reads it and shows text, chart, table and the calculation.
    api['message'].mockReturnValue(of(message({
      id: 11,
      content: 'Company Revenue (Statistics) was **$1,234.00**. <img src="https://evil.example/x?d=1"> <script>alert(1)</script>',
      parts: [
        { type: 'chart', chart_type: 'bar', title: 'By week', labels: ['W1'], series: [{ name: 'Revenue', data: [1234] }], format: 'currency' },
        { type: 'table', title: 'Admins', columns: [{ key: 'name', label: 'Admin', format: 'text' }, { key: 'net', label: 'Net', format: 'currency' }], rows: [{ name: 'Nino', net: 96.3 }] }
      ],
      calculation: [{
        tool: 'get_company_statistics', label: 'Reading the Statistics report',
        date_range: '2026-10-01 to 2026-10-16 (service dates, inclusive)', definition: 'Statistics Net Income', filters: [], duration_ms: 42
      }, {
        tool: 'run_sql', label: 'Running query', sql: 'SELECT COUNT(*) FROM agent_orders', row_count: 1, filters: ['count orders'], duration_ms: 5
      }],
      model: 'claude-sonnet-5-5', inputTokens: 1200, outputTokens: 80, costUsd: 0.00538
    })));
    events.next({ kind: 'completed', sessionId: 7, messageId: 11, status: 'complete' });
    fixture.detectChanges();

    const answer = el().querySelector('.agent-answer')!;
    expect(answer.querySelector('strong')?.textContent).toBe('$1,234.00');
    // Raw HTML and images in an answer are never rendered.
    expect(answer.querySelector('img')).toBeNull();
    expect(answer.querySelector('script')).toBeNull();
    expect(answer.querySelector('app-agent-chart')).not.toBeNull();
    expect(answer.querySelector('.agent-table td.num')?.textContent?.trim()).toBe('$96.30');

    const calc = el().querySelector('details.agent-calc')!;
    expect(calc.querySelector('summary')?.textContent).toContain('How this was calculated');
    expect(calc.textContent).toContain('Statistics Net Income');
    expect(calc.textContent).toContain('2026-10-01 to 2026-10-16');
    expect(calc.querySelector('pre.agent-sql')?.textContent).toContain('SELECT COUNT(*) FROM agent_orders');
    expect(calc.textContent).toContain('~$0.0054');
    expect(component.canSend()).toBe(false); // empty draft
  });

  it('polls a running answer when SignalR stays silent', async () => {
    vi.useFakeTimers();
    await setup(configured, [session(3)]);
    api['session'].mockReturnValue(of({ session: session(3), messages: [message({ id: 5, status: 'running' })] }));
    api['message'].mockReturnValue(of(message({ id: 5, status: 'complete', content: 'Done.' })));

    component.openSession(3);
    expect(api['message']).not.toHaveBeenCalled();
    vi.advanceTimersByTime(AGENT_POLL_MS);
    expect(api['message']).toHaveBeenCalledWith(3, 5);
    expect(component.runningMessage()).toBeNull();
  });

  it('ignores progress for a chat that is not open', async () => {
    await setup(configured);
    component.messages.set([message({ id: 2, status: 'running', progressLabel: 'Thinking…' })]);
    component.activeSessionId.set(1);
    events.next({ kind: 'progress', sessionId: 99, messageId: 2, label: 'Elsewhere' });
    expect(component.messages()[0].progressLabel).toBe('Thinking…');
  });

  it('sends on Enter but not on Shift+Enter or while an IME is composing', async () => {
    await setup(configured);
    const send = vi.spyOn(component, 'send').mockImplementation(() => {});
    const key = (init: KeyboardEventInit) => component.onComposerKeydown(new KeyboardEvent('keydown', init));
    key({ key: 'Enter', shiftKey: true });
    key({ key: 'Enter', isComposing: true });
    expect(send).not.toHaveBeenCalled();
    key({ key: 'Enter' });
    expect(send).toHaveBeenCalledTimes(1);
  });

  describe('expanded view', () => {
    afterEach(() => { document.body.style.overflow = ''; });

    it('covers the page from the Expand button and locks the page scroll behind it', async () => {
      await setup(configured);
      const btn = el().querySelector('.agent-expand-btn') as HTMLButtonElement;
      expect(btn.textContent).toContain('Expand');
      btn.click();
      fixture.detectChanges();

      expect(el().querySelector('.agent-page')!.classList).toContain('is-expanded');
      expect(el().querySelector('.agent-page')!.getAttribute('role')).toBe('dialog');
      expect(el().querySelector('.agent-backdrop')).not.toBeNull();
      expect(btn.getAttribute('aria-pressed')).toBe('true');
      expect(document.body.style.overflow).toBe('hidden');
    });

    it('closes on Escape and on the backdrop, and gives the page its scroll back', async () => {
      await setup(configured);
      component.toggleExpanded();
      fixture.detectChanges();
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      fixture.detectChanges();
      expect(component.expanded()).toBe(false);
      expect(document.body.style.overflow).toBe('');

      component.toggleExpanded();
      fixture.detectChanges();
      (el().querySelector('.agent-backdrop') as HTMLElement).click();
      fixture.detectChanges();
      expect(component.expanded()).toBe(false);
      expect(el().querySelector('.agent-backdrop')).toBeNull();
    });

    it('lets Escape in the rename box cancel the rename only', async () => {
      await setup(configured, [session(3)]);
      component.toggleExpanded();
      component.startRename(session(3));
      component.onEscape();
      expect(component.expanded()).toBe(true);
    });

    it('does not leave the page scroll locked when the tab is left while expanded', async () => {
      await setup(configured);
      component.toggleExpanded();
      fixture.destroy();
      expect(document.body.style.overflow).toBe('');
    });
  });

  it('shows the running cost and token count of the open chat', async () => {
    await setup(configured, [session(4)]);
    api['session'].mockReturnValue(of({ session: session(4), messages: [] }));
    component.openSession(4);
    fixture.detectChanges();
    const meta = el().querySelector('.agent-chat-meta')!.textContent!;
    expect(meta).toContain('3.0k tokens');
    expect(meta).toContain('~$0.0054');
  });
});
