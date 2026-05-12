export type ChecklistRoomKey = 'kitchen' | 'bathroom' | 'living' | 'bedroom';

export interface ChecklistComparisonRow {
  task: string;
  standard: boolean;
  deep: boolean;
}

export interface ChecklistComparisonSection {
  key: ChecklistRoomKey;
  label: string;
  icon: string;
  heading: string;
  rows: ChecklistComparisonRow[];
}

export interface MoveOutChecklistRow {
  task: string;
  note?: string;
}

export interface MoveOutChecklistSection {
  heading: string;
  rows: MoveOutChecklistRow[];
}

function included(task: string, note?: string): MoveOutChecklistRow {
  return { task, note };
}

export const CHECKLIST_COMPARISON_SECTIONS: ChecklistComparisonSection[] = [
  {
    key: 'kitchen',
    label: 'Kitchen',
    icon: 'fa-utensils',
    heading: 'Kitchen',
    rows: [
      { task: 'Wiping and disinfecting countertops and surfaces', standard: true, deep: true },
      { task: 'Cleaning the sink', standard: true, deep: true },
      { task: 'Wiping the faucet', standard: true, deep: true },
      { task: 'Cleaning cabinet exteriors', standard: true, deep: true },
      { task: 'Cleaning appliance exteriors (refrigerator, stove, dishwasher)', standard: true, deep: true },
      { task: 'Cleaning microwave exterior', standard: true, deep: true },
      { task: 'Light cleaning of stovetop', standard: true, deep: true },
      { task: 'Removing dust from accessible areas', standard: true, deep: true },
      { task: 'Taking out the trash', standard: true, deep: true },
      { task: 'Vacuuming floors', standard: true, deep: true },
      { task: 'Mopping floors', standard: true, deep: true },
      { task: 'Cleaning inside microwave', standard: false, deep: true },
      { task: 'Cleaning inside refrigerator', standard: false, deep: true },
      { task: 'Cleaning inside freezer', standard: false, deep: true },
      { task: 'Removing grease from stovetop area', standard: false, deep: true },
      { task: 'Detailed backsplash cleaning', standard: false, deep: true },
      { task: 'Cleaning cabinet handles and detailed areas', standard: false, deep: true },
      { task: 'Cleaning baseboards', standard: false, deep: true },
    ],
  },
  {
    key: 'bathroom',
    label: 'Bathroom',
    icon: 'fa-bath',
    heading: 'Bathroom',
    rows: [
      { task: 'Cleaning and disinfecting the toilet (inside and outside)', standard: true, deep: true },
      { task: 'Cleaning the sink', standard: true, deep: true },
      { task: 'Wiping the faucet', standard: true, deep: true },
      { task: 'Cleaning mirrors', standard: true, deep: true },
      { task: 'Light cleaning of shower/bathtub', standard: true, deep: true },
      { task: 'Wiping surfaces', standard: true, deep: true },
      { task: 'Taking out the trash', standard: true, deep: true },
      { task: 'Cleaning floors', standard: true, deep: true },
      { task: 'Detailed tile cleaning', standard: false, deep: true },
      { task: 'Removing soap scum buildup', standard: false, deep: true },
      { task: 'Cleaning behind the toilet', standard: false, deep: true },
      { task: 'Cleaning baseboards', standard: false, deep: true },
    ],
  },
  {
    key: 'living',
    label: 'Living Room',
    icon: 'fa-couch',
    heading: 'Living Room',
    rows: [
      { task: 'Dusting all accessible surfaces', standard: true, deep: true },
      { task: 'Cleaning mirrors', standard: true, deep: true },
      { task: 'Light straightening of visible areas', standard: true, deep: true },
      { task: 'Taking out the trash', standard: true, deep: true },
      { task: 'Vacuuming floors', standard: true, deep: true },
      { task: 'Mopping floors', standard: true, deep: true },
      { task: 'Cleaning baseboards', standard: false, deep: true },
      { task: 'Cleaning door frames', standard: false, deep: true },
      { task: 'Cleaning light switches', standard: false, deep: true },
      { task: 'Detailed cleaning of corners and hard-to-reach areas', standard: false, deep: true },
    ],
  },
  {
    key: 'bedroom',
    label: 'Bedroom',
    icon: 'fa-bed',
    heading: 'Bedroom',
    rows: [
      { task: 'Dusting all accessible surfaces', standard: true, deep: true },
      { task: 'Cleaning mirrors', standard: true, deep: true },
      { task: 'Making beds (if applicable)', standard: true, deep: true },
      { task: 'Light straightening of visible areas', standard: true, deep: true },
      { task: 'Taking out the trash', standard: true, deep: true },
      { task: 'Vacuuming floors', standard: true, deep: true },
      { task: 'Mopping floors', standard: true, deep: true },
      { task: 'Cleaning baseboards', standard: false, deep: true },
      { task: 'Cleaning door frames', standard: false, deep: true },
      { task: 'Cleaning light switches', standard: false, deep: true },
      { task: 'Detailed cleaning of corners and hard-to-reach areas', standard: false, deep: true },
    ],
  },
];

export const MOVE_OUT_CHECKLIST_SECTIONS: MoveOutChecklistSection[] = [
  {
    heading: 'Kitchen',
    rows: [
      included('Cleaning inside and outside of cabinets and drawers', 'must be empty'),
      included('Cleaning inside and outside of refrigerator and freezer'),
      included('Cleaning inside and outside of microwave'),
      included('Cleaning inside oven', 'if included or added as extra'),
      included('Degreasing stovetop, backsplash, and all kitchen surfaces'),
      included('Cleaning countertops and all surfaces'),
      included('Scrubbing and disinfecting sink'),
      included('Cleaning appliance exteriors'),
      included('Vacuuming and mopping floors'),
    ],
  },
  {
    heading: 'Bathroom',
    rows: [
      included('Full deep cleaning and disinfection of toilet'),
      included('Cleaning sink, faucet, and vanity surfaces'),
      included('Mirror and fixture polishing'),
      included('Thorough shower and bathtub cleaning'),
      included('Tile and grout cleaning', 'standard level'),
      included('Cleaning inside bathroom cabinets', 'if empty'),
      included('Floor cleaning and sanitizing'),
    ],
  },
  {
    heading: 'Bedroom & Living Areas',
    rows: [
      included('Cleaning inside closets and shelves', 'must be empty'),
      included('Dusting all surfaces, edges, and corners'),
      included('Cleaning baseboards throughout'),
      included('Cleaning door frames, handles, and switches'),
      included('Cleaning window sills'),
      included('Light wall spot cleaning'),
      included('Removing light scuff marks', 'where possible'),
      included('Vacuuming and mopping all floors'),
      included('Trash removal', 'up to 1-2 bags'),
    ],
  },
];

export const MOVE_OUT_IMPORTANT_REQUIREMENTS: string[] = [
  'The apartment must be empty or nearly empty',
  'Cabinets, appliances, and closets must be accessible',
  'We do not move heavy furniture',
  'We do not provide ladders or high-reach equipment',
];

export const CHECKLIST_NOT_INCLUDED: string[] = [
  'Heavy or extreme conditions (hoarding, excessive dirt)',
  'Mold or hazardous material removal',
  'Post-construction cleaning (separate service)',
  'Carpet deep shampooing',
  'Painting, repairs, or restoration',
  'Washing dishes',
  'Laundry or organizing',
];

export const CHECKLIST_EXTRAS: string[] = [
  'Cleaning inside oven',
  'Interior window cleaning',
  'Laundry or organizing',
];
