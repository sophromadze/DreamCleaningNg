import { buildOrderChangeEntries } from './order-changes.util';

/**
 * The Changes tab. Rows arrive from `orders/{id}/changes` with values as raw JSON STRINGS (the
 * same shape as the Audits feed); the first version received Newtonsoft objects that
 * System.Text.Json flattened to empty arrays, so every entry read "Order · Updated" with nothing
 * under it. These pin down that each kind of change says what actually moved.
 */
describe('buildOrderChangeEntries', () => {
  const at = (s: number) => new Date(Date.UTC(2026, 8, 29, 10, 0, s)).toISOString();

  it('lists the fields an order edit moved, from string payloads', () => {
    const [entry] = buildOrderChangeEntries([{
      id: 1, entityType: 'Order', action: 'Update', createdAt: at(0) as any, changedBy: 'Ana Admin',
      oldValues: JSON.stringify({ SubTotal: 734.79, Total: 800, ServiceAddress: '1 Main St', TotalDuration: 480 }),
      newValues: JSON.stringify({ SubTotal: 826.64, Total: 900, ServiceAddress: '2 Main St', TotalDuration: 540 })
    } as any]);

    expect(entry.title).toBe('Order edited');
    expect(entry.lines.length).toBe(4);
    expect(entry.lines.some(l => l.includes('800') && l.includes('900'))).toBe(true);
    expect(entry.lines.some(l => l.includes('1 Main St') && l.includes('2 Main St'))).toBe(true);
  });

  it('folds the services row written by the same edit into it, naming added and removed extras', () => {
    const entries = buildOrderChangeEntries([
      {
        id: 2, entityType: 'Order', action: 'Update', createdAt: at(0) as any, changedBy: 'Ana Admin',
        oldValues: JSON.stringify({ Total: 800 }), newValues: JSON.stringify({ Total: 900 })
      },
      {
        id: 3, entityType: 'OrderServicesUpdate', action: 'Update', createdAt: at(1) as any, changedBy: 'Ana Admin',
        oldValues: JSON.stringify({
          Services: [{ ServiceId: 1, ServiceName: 'Bedrooms', Quantity: 1, Cost: 22.5 }],
          ExtraServices: [{ ExtraServiceId: 7, ExtraServiceName: 'Oven Cleaning', Quantity: 1, Hours: 0, Cost: 30 }]
        }),
        newValues: JSON.stringify({
          Services: [{ ServiceId: 1, ServiceName: 'Bedrooms', Quantity: 2, Cost: 45 }],
          ExtraServices: [{ ExtraServiceId: 4, ExtraServiceName: 'Windows', Quantity: 6, Hours: 0, Cost: 60 }]
        })
      }
    ] as any);

    expect(entries.length).toBe(1);
    const lines = entries[0].lines.join('\n');
    expect(lines).toContain('Extra added: Windows ×6');
    expect(lines).toContain('Extra removed: Oven Cleaning');
    expect(lines).toContain('Bedrooms: qty 1 → 2');
  });

  it('names the cleaner on an assignment or removal', () => {
    const entries = buildOrderChangeEntries([
      { id: 4, entityType: 'CleanerAssignment', action: 'Assigned', createdAt: at(0) as any,
        newValues: JSON.stringify({ CleanerEmail: 'maria@example.com', OrderId: 390 }) },
      { id: 5, entityType: 'CleanerAssignment', action: 'Removed', createdAt: at(5) as any,
        newValues: JSON.stringify({ CleanerEmail: 'john@example.com', OrderId: 390 }) }
    ] as any);

    expect(entries[0].title).toBe('Cleaner assigned');
    expect(entries[0].lines).toEqual(['maria@example.com']);
    expect(entries[1].title).toBe('Cleaner removed');
  });
});
