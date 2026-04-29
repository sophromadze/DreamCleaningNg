import { CleaningChecklistSection } from './cleaning-type-details.data';

/** All items are included (check) for move in/out checklist cards. */
function allIncluded(labels: string[]): { label: string; included: boolean }[] {
  return labels.map((label) => ({ label, included: true }));
}

export const MOVE_IN_OUT_CHECKLIST_SECTIONS: CleaningChecklistSection[] = [
  {
    heading: '🍳 Kitchen',
    rows: allIncluded([
      'Cleaning inside and outside of cabinets and drawers (must be empty)',
      'Cleaning inside and outside of refrigerator and freezer',
      'Cleaning inside and outside of microwave',
      'Cleaning inside oven (if included or added as extra)',
      'Degreasing stovetop, backsplash, and all kitchen surfaces',
      'Cleaning countertops and all surfaces',
      'Scrubbing and disinfecting sink',
      'Cleaning appliance exteriors',
      'Vacuuming and mopping floors',
    ]),
  },
  {
    heading: '🚿 Bathroom',
    rows: allIncluded([
      'Full deep cleaning and disinfection of toilet',
      'Cleaning sink, faucet, and vanity surfaces',
      'Mirror and fixture polishing',
      'Thorough shower and bathtub cleaning',
      'Tile and grout cleaning (standard level)',
      'Cleaning inside bathroom cabinets (if empty)',
      'Floor cleaning and sanitizing',
    ]),
  },
  {
    heading: '🛏 Bedroom & Living Areas',
    rows: allIncluded([
      'Cleaning inside closets and shelves (if empty)',
      'Dusting all surfaces, edges, and corners',
      'Cleaning baseboards throughout',
      'Cleaning door frames, handles, and switches',
      'Cleaning window sills',
      'Light wall spot cleaning',
      'Removing light scuff marks (where possible)',
      'Vacuuming and mopping all floors',
      'Trash removal (up to 1–2 bags)',
    ]),
  },
];

export const MOVE_IN_OUT_IMPORTANT_REQUIREMENTS: string[] = [
  'The apartment must be empty or nearly empty',
  'Cabinets, appliances, and closets must be accessible',
  'We do not move heavy furniture',
  'We do not provide ladders or high-reach equipment',
];

export const MOVE_IN_OUT_NOT_INCLUDED: string[] = [
  'Heavy or extreme conditions (hoarding, excessive dirt)',
  'Mold or hazardous material removal',
  'Post-construction cleaning (separate service)',
  'Carpet deep shampooing',
  'Painting, repairs, or restoration.',
];
