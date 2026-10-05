import { IconDefinition } from './icon-definition';
import { faBroom } from './glyphs/faBroom';
import { faBuilding } from './glyphs/faBuilding';
import { faCalendarCheck } from './glyphs/faCalendarCheck';
import { faHelmetSafety } from './glyphs/faHelmetSafety';
import { faHouse } from './glyphs/faHouse';
import { faShieldHalved } from './glyphs/faShieldHalved';
import { faSliders } from './glyphs/faSliders';
import { faSprayCanSparkles } from './glyphs/faSprayCanSparkles';
import { faTruckMoving } from './glyphs/faTruckMoving';

/** Icon per ServiceType.serviceKey. */
const ICON_BY_SERVICE_KEY: Record<string, IconDefinition> = {
  'residential': faHouse,
  'move-in-out': faTruckMoving,
  'office': faBuilding,
  'custom': faSliders,
  'heavy-condition': faShieldHalved,
  'filthy': faSprayCanSparkles,
  'post-construction': faHelmetSafety
};

/** What the icon is chosen from: the key first, then the custom flag, then (unkeyed only) the name. */
export interface IconServiceType {
  name?: string | null;
  serviceKey?: string | null;
  isCustom?: boolean | null;
}

/** Maps a service type to its icon in the service-type dropdowns (booking page and home hero).
 *  By serviceKey; a keyed type without its own icon gets the broom. An UNKEYED type: the custom
 *  ("Pre-arranged") flag, else its name. Presentation only — does not influence selection logic
 *  or persisted data. */
export function serviceTypeIcon(type: IconServiceType | null | undefined): IconDefinition {
  if (!type) return faBroom;
  const serviceKey = (type.serviceKey ?? '').trim();
  if (serviceKey) return ICON_BY_SERVICE_KEY[serviceKey] ?? faBroom;
  if (type.isCustom) return faCalendarCheck;
  return serviceTypeIconByName(type.name);
}

/** The name rule, for a type with no serviceKey. */
function serviceTypeIconByName(name: string | null | undefined): IconDefinition {
  if (!name) return faBroom;
  const key = name.toLowerCase();
  if (key.includes('residential')) return faHouse;
  if (key.includes('move')) return faTruckMoving;
  if (key.includes('office')) return faBuilding;
  if (key.includes('custom')) return faSliders;
  if (key.includes('heavy')) return faShieldHalved;
  if (key.includes('filthy')) return faSprayCanSparkles;
  if (key.includes('construction')) return faHelmetSafety;
  if (key.includes('pre-arranged') || key.includes('prearranged')) return faCalendarCheck;
  return faBroom;
}
