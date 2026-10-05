import { TestBed } from '@angular/core/testing';

import { OrdersComponent } from './orders/orders.component';
import { UserManagementComponent } from './user-management/user-management.component';
import { testProviders } from '../../../testing/test-providers';
import { isResidentialServiceTypeOrKey, resolveServiceTypeShortLabel } from '../../shared/admin/service-type-short-label';
import { buildCustomServiceTypeNameOptions } from '../../shared/booking/custom-service-type.util';

/**
 * The admin tables recognise a service type by its serviceKey; the name is read only when the
 * key is null (an unkeyed type, or a custom order - the API never sends a custom type's key).
 * Fixture: GET api/booking/service-types (production, 2026-10-04). Every keyed row must label and
 * filter exactly as it did by name, and keep doing so after a rename.
 */
const PRODUCTION_TYPES = [
  { name: 'Residential Cleaning', key: 'residential', filter: 'regular', compact: 'Regular' },
  { name: 'Move in/out Cleaning', key: 'move-in-out', filter: 'move-in-out', compact: 'Move In/Out' },
  { name: 'Office Cleaning', key: 'office', filter: 'office', compact: 'Office' },
  { name: 'Custom Cleaning', key: 'custom', filter: 'custom', compact: 'Custom' },
  { name: 'Heavy Condition Cleaning', key: 'heavy-condition', filter: 'heavy', compact: 'Heavy' },
  { name: 'Filthy Cleaning', key: 'filthy', filter: 'filthy', compact: 'Filthy' },
  { name: 'Post Construction Cleaning', key: 'post-construction', filter: 'other', compact: 'Construction' }
];

describe('service types in the admin tables are recognised by key', () => {
  let orders: OrdersComponent;
  let users: UserManagementComponent;

  beforeEach(async () => {
    sessionStorage.clear();
    await TestBed.configureTestingModule({
      imports: [OrdersComponent, UserManagementComponent],
      providers: [...testProviders]
    }).compileComponents();
    orders = TestBed.createComponent(OrdersComponent).componentInstance;
    users = TestBed.createComponent(UserManagementComponent).componentInstance;
  });

  const order = (name: string, key: string | null, id = 1) => ({
    id, serviceTypeName: name, serviceTypeKey: key, isCustomServiceType: false
  }) as any;

  it('filters every production type into the same category it got by name', () => {
    for (const t of PRODUCTION_TYPES) {
      expect(orders.getServiceTypeFilterKey(order(t.name, t.key))).withContext(t.name).toBe(t.filter);
      expect(orders.getServiceTypeFilterKey(order(t.name, null))).withContext(`${t.name} unkeyed`).toBe(t.filter);
    }
  });

  it('keeps each keyed type in its category after a rename', () => {
    PRODUCTION_TYPES.forEach((t, i) => {
      expect(orders.getServiceTypeFilterKey(order('Renamed Service', t.key, 100 + i))).withContext(t.key).toBe(t.filter);
    });
  });

  it('still files a custom order by its chosen label', () => {
    expect(orders.getServiceTypeFilterKey({
      id: 2, serviceTypeName: 'Deep Cleaning', serviceTypeKey: null, isCustomServiceType: true,
      customServiceDisplayName: 'Deep'
    } as any)).toBe('deep');
  });

  it('gives the Users table the same short label by key as by name, and after a rename', () => {
    PRODUCTION_TYPES.forEach((t, i) => {
      const user = { id: 500 + i, lastCleaningServiceType: t.name, lastCleaningServiceTypeKey: t.key };
      expect(users.getCompactServiceType(t.name, user)).withContext(t.name).toBe(t.compact);
      expect(users.getCompactServiceType(t.name, { id: 600 + i, lastCleaningServiceType: t.name }))
        .withContext(`${t.name} unkeyed`).toBe(t.compact);
      if (t.key !== 'filthy' && t.key !== 'custom') {
        // Filthy/Custom have no short label of their own - their (renamed) name is what shows.
        const renamed = { id: 700 + i, lastCleaningServiceType: 'Renamed', lastCleaningServiceTypeKey: t.key };
        expect(users.getCompactServiceType('Renamed', renamed)).withContext(`${t.key} renamed`).toBe(t.compact);
      }
    });
  });

  it('decides Residential by key in the shared short label', () => {
    expect(isResidentialServiceTypeOrKey('Home Cleaning', 'residential')).toBeTrue();
    expect(isResidentialServiceTypeOrKey('Residential Cleaning', 'office')).toBeFalse();
    expect(isResidentialServiceTypeOrKey('Residential Cleaning', null)).toBeTrue();
    expect(resolveServiceTypeShortLabel({ serviceTypeName: 'Home Cleaning', serviceTypeKey: 'residential', isDeepCleaning: true }))
      .toBe('Deep');
  });

  it('builds the custom-order name options from the residential KEY', () => {
    const types = [
      { name: 'Home Cleaning', serviceKey: 'residential' },
      { name: 'Office Cleaning', serviceKey: 'office' },
      { name: 'Pre-arranged Cleaning', serviceKey: null, isCustom: true }
    ];
    expect(buildCustomServiceTypeNameOptions(types)).toEqual(['Regular', 'Deep', 'Office']);
    // Unkeyed: by name, as before.
    expect(buildCustomServiceTypeNameOptions([{ name: 'Residential Cleaning' }])).toEqual(['Regular', 'Deep']);
  });
});
