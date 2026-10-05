import { serviceTypeIcon } from './service-type-icon';
import { faBroom } from './glyphs/faBroom';
import { faBuilding } from './glyphs/faBuilding';
import { faCalendarCheck } from './glyphs/faCalendarCheck';
import { faHelmetSafety } from './glyphs/faHelmetSafety';
import { faHouse } from './glyphs/faHouse';
import { faShieldHalved } from './glyphs/faShieldHalved';
import { faSliders } from './glyphs/faSliders';
import { faSprayCanSparkles } from './glyphs/faSprayCanSparkles';
import { faTruckMoving } from './glyphs/faTruckMoving';

/** GET api/booking/service-types (production, 2026-10-04): name, key, custom flag. */
const PRODUCTION_TYPES = [
  { name: 'Residential Cleaning', serviceKey: 'residential', isCustom: false, icon: faHouse },
  { name: 'Move in/out Cleaning', serviceKey: 'move-in-out', isCustom: false, icon: faTruckMoving },
  { name: 'Office Cleaning', serviceKey: 'office', isCustom: false, icon: faBuilding },
  { name: 'Custom Cleaning', serviceKey: 'custom', isCustom: false, icon: faSliders },
  { name: 'Heavy Condition Cleaning', serviceKey: 'heavy-condition', isCustom: false, icon: faShieldHalved },
  { name: 'Filthy Cleaning', serviceKey: 'filthy', isCustom: false, icon: faSprayCanSparkles },
  { name: 'Post Construction Cleaning', serviceKey: 'post-construction', isCustom: false, icon: faHelmetSafety },
  { name: 'Pre-arranged Cleaning', serviceKey: null, isCustom: true, icon: faCalendarCheck }
];

describe('serviceTypeIcon', () => {
  it('gives every production type the icon it had by name', () => {
    for (const t of PRODUCTION_TYPES) {
      expect(serviceTypeIcon(t)).withContext(t.name).toBe(t.icon);
      // The name rule alone (an unkeyed copy, not flagged custom) agrees.
      expect(serviceTypeIcon({ name: t.name })).withContext(`${t.name} by name`).toBe(t.icon);
    }
  });

  it('keeps each keyed type on its icon after a rename', () => {
    for (const t of PRODUCTION_TYPES.filter(x => x.serviceKey)) {
      expect(serviceTypeIcon({ ...t, name: 'Renamed Service' })).withContext(t.serviceKey!).toBe(t.icon);
    }
  });

  it('never reads the name of a keyed type', () => {
    expect(serviceTypeIcon({ name: 'Office Cleaning', serviceKey: 'some-new-key' })).toBe(faBroom);
  });

  it('uses the custom flag for an unkeyed custom type', () => {
    expect(serviceTypeIcon({ name: 'Arranged by phone', serviceKey: null, isCustom: true })).toBe(faCalendarCheck);
  });

  it('falls back to the broom with nothing to go on', () => {
    expect(serviceTypeIcon(null)).toBe(faBroom);
    expect(serviceTypeIcon({})).toBe(faBroom);
  });
});
