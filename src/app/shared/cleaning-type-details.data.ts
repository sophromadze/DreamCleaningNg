/** Row in the included / not included checklist (✓ or ✗). */
export interface CleaningChecklistRow {
  label: string;
  included: boolean;
}

export interface CleaningChecklistSection {
  heading: string;
  rows: CleaningChecklistRow[];
}

/** Standard / regular cleaning — own list (per original service copy). */
export const REGULAR_CLEANING_CHECKLIST: CleaningChecklistSection[] = [
  {
    heading: 'Kitchen',
    rows: [
      { label: 'Wiping and disinfecting countertops and surfaces', included: true },
      { label: 'Cleaning the sink', included: true },
      { label: 'Wiping the faucet', included: true },
      { label: 'Cleaning cabinet exteriors', included: true },
      { label: 'Cleaning appliance exteriors (refrigerator, stove, dishwasher)', included: true },
      { label: 'Cleaning microwave exterior', included: true },
      { label: 'Light cleaning of stovetop', included: true },
      { label: 'Removing dust from accessible areas', included: true },
      { label: 'Taking out the trash', included: true },
      { label: 'Vacuuming floors', included: true },
      { label: 'Mopping floors', included: true },
    ],
  },
  {
    heading: 'Bathroom',
    rows: [
      { label: 'Cleaning and disinfecting the toilet (inside and outside)', included: true },
      { label: 'Cleaning the sink', included: true },
      { label: 'Wiping the faucet', included: true },
      { label: 'Cleaning mirrors', included: true },
      { label: 'Light cleaning of shower/bathtub', included: true },
      { label: 'Wiping surfaces', included: true },
      { label: 'Taking out the trash', included: true },
      { label: 'Cleaning floors', included: true },
    ],
  },
  {
    heading: 'Bedroom & living areas',
    rows: [
      { label: 'Dusting all accessible surfaces', included: true },
      { label: 'Cleaning mirrors', included: true },
      { label: 'Making beds (if applicable)', included: true },
      { label: 'Light straightening of visible areas', included: true },
      { label: 'Taking out the trash', included: true },
      { label: 'Vacuuming floors', included: true },
      { label: 'Mopping floors', included: true },
    ],
  },
];

/** Deep cleaning — own list (additional deep tasks; all included in deep tier rows). */
export const DEEP_CLEANING_CHECKLIST: CleaningChecklistSection[] = [
  {
    heading: 'Kitchen (Deep)',
    rows: [
      { label: 'Cleaning inside microwave', included: true },
      { label: 'Cleaning inside refrigerator', included: true },
      { label: 'Cleaning inside freezer', included: true },
      { label: 'Removing grease from stovetop area', included: true },
      { label: 'Detailed backsplash cleaning', included: true },
      { label: 'Cleaning cabinet handles and detailed areas', included: true },
      { label: 'Cleaning baseboards', included: true },
    ],
  },
  {
    heading: 'Bathroom (Deep)',
    rows: [
      { label: 'Detailed tile cleaning', included: true },
      { label: 'Removing soap scum buildup', included: true },
      { label: 'Cleaning behind the toilet', included: true },
      { label: 'Cleaning baseboards', included: true },
    ],
  },
  {
    heading: 'Bedroom & Living Areas (Deep)',
    rows: [
      { label: 'Cleaning baseboards', included: true },
      { label: 'Cleaning door frames', included: true },
      { label: 'Cleaning light switches', included: true },
      { label: 'Detailed cleaning of corners and hard-to-reach areas', included: true },
    ],
  },
];

export const STANDARD_CLEANING_NOT_INCLUDED: string[] = [
  'Inside refrigerator, freezer, or oven',
  'Washing dishes',
  'Inside cabinets or drawers',
  'Heavy grease, buildup, or deep scrubbing',
  'Mold or mildew removal',
  'Moving heavy furniture',
  'Interior window cleaning',
  'Laundry or organizing',
];

export const DEEP_CLEANING_NOT_INCLUDED: string[] = [
  'Inside oven (unless added as extra)',
  'Inside cabinets (unless included in move-out or added)',
  'Severe or hazardous conditions (hoarding, biohazard, etc.)',
  'Mold removal requiring special treatment',
  'Moving heavy furniture',
  'High-reach cleaning without proper equipment',
];
