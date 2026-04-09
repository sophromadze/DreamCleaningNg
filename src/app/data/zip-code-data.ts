/**
 * NYC borough ZIP codes and neighborhood names for service area maps.
 * Used by ServiceAreaMapComponent for tooltips and search results.
 */
export const BROOKLYN_ZIPS: Record<string, string> = {
  '11201': 'Downtown Brooklyn / DUMBO / Brooklyn Heights',
  '11202': 'Downtown Brooklyn (PO Box)',
  '11203': 'East Flatbush / Prospect Lefferts Gardens',
  '11204': 'Bensonhurst / Mapleton',
  '11205': 'Fort Greene / Clinton Hill',
  '11206': 'Williamsburg / Bedford-Stuyvesant',
  '11207': 'East New York',
  '11208': 'East New York / Cypress Hills',
  '11209': 'Bay Ridge / Fort Hamilton',
  '11210': 'Flatlands / Midwood',
  '11211': 'Williamsburg',
  '11212': 'Brownsville',
  '11213': 'Crown Heights',
  '11214': 'Bensonhurst / Bath Beach',
  '11215': 'Park Slope / Gowanus',
  '11216': 'Bedford-Stuyvesant',
  '11217': 'Prospect Heights / Boerum Hill',
  '11218': 'Kensington / Flatbush',
  '11219': 'Borough Park',
  '11220': 'Sunset Park',
  '11221': 'Bushwick / Bedford-Stuyvesant',
  '11222': 'Greenpoint',
  '11223': 'Gravesend / Homecrest',
  '11224': 'Coney Island / Sea Gate',
  '11225': 'Crown Heights / Prospect Lefferts Gardens',
  '11226': 'Flatbush / East Flatbush',
  '11228': 'Dyker Heights',
  '11229': 'Sheepshead Bay / Madison',
  '11230': 'Midwood / Flatbush',
  '11231': 'Carroll Gardens / Red Hook / Cobble Hill',
  '11232': 'Sunset Park / Industry City',
  '11233': 'Brownsville / Ocean Hill',
  '11234': 'Flatlands / Mill Basin / Marine Park',
  '11235': 'Brighton Beach / Manhattan Beach / Sheepshead Bay',
  '11236': 'Canarsie / Flatlands',
  '11237': 'Bushwick',
  '11238': 'Prospect Heights / Crown Heights',
  '11239': 'East New York (Starrett City)',
  '11251': 'Williamsburg (PO Box)',
};

export const MANHATTAN_ZIPS: Record<string, string> = {
  '10001': 'Chelsea / Hudson Yards',
  '10002': 'Lower East Side / Chinatown',
  '10003': 'East Village / Union Square',
  '10004': 'Financial District (South)',
  '10005': 'Financial District',
  '10006': 'Financial District / World Trade Center',
  '10007': 'Tribeca / City Hall',
  '10009': 'East Village / Alphabet City',
  '10010': 'Gramercy Park / Flatiron',
  '10011': 'Chelsea / West Village',
  '10012': 'SoHo / NoHo / NoLita',
  '10013': 'Tribeca / SoHo / Chinatown',
  '10014': 'West Village / Greenwich Village',
  '10016': 'Murray Hill / Kips Bay',
  '10017': 'Midtown East / Grand Central',
  '10018': 'Garment District / Midtown',
  '10019': 'Midtown West / Hell\'s Kitchen',
  '10020': 'Rockefeller Center / Midtown',
  '10021': 'Upper East Side',
  '10022': 'Midtown East / Sutton Place',
  '10023': 'Upper West Side / Lincoln Center',
  '10036': 'Times Square / Theater District',
  '10038': 'Fulton / Seaport / Civic Center',
  '10280': 'Battery Park City',
};

export const QUEENS_ZIPS: Record<string, string> = {
  '11001': 'Floral Park',
  '11004': 'Glen Oaks / New Hyde Park',
  '11040': 'New Hyde Park',
  '11101': 'Long Island City',
  '11102': 'Astoria (West)',
  '11103': 'Astoria',
  '11104': 'Sunnyside',
  '11105': 'Astoria (North) / Ditmars',
  '11106': 'Astoria (South)',
  '11354': 'Flushing (North)',
  '11355': 'Flushing (South)',
  '11356': 'College Point',
  '11357': 'Whitestone',
  '11358': 'Flushing / Broadway',
  '11360': 'Bayside (North)',
  '11361': 'Bayside',
  '11362': 'Little Neck',
  '11363': 'Douglaston',
  '11364': 'Oakland Gardens / Bayside Hills',
  '11365': 'Fresh Meadows',
  '11366': 'Fresh Meadows / Hillcrest',
  '11367': 'Kew Gardens Hills',
  '11368': 'Corona',
  '11369': 'East Elmhurst',
  '11370': 'Jackson Heights (East)',
  '11371': 'LaGuardia Airport',
  '11372': 'Jackson Heights',
  '11373': 'Elmhurst',
  '11374': 'Rego Park',
  '11375': 'Forest Hills',
  '11377': 'Woodside',
  '11378': 'Maspeth',
  '11379': 'Middle Village',
  '11385': 'Ridgewood / Glendale',
  '11411': 'Cambria Heights',
  '11412': 'St. Albans',
  '11413': 'Springfield Gardens / Laurelton',
  '11414': 'Howard Beach / Broad Channel',
  '11415': 'Kew Gardens',
  '11416': 'Ozone Park (North)',
  '11417': 'Ozone Park',
  '11418': 'Richmond Hill',
  '11419': 'South Richmond Hill',
  '11420': 'South Ozone Park',
  '11421': 'Woodhaven',
  '11422': 'Rosedale',
  '11423': 'Hollis',
  '11426': 'Bellerose',
  '11427': 'Queens Village',
  '11428': 'Queens Village (South)',
  '11429': 'Queens Village (Southeast)',
  '11432': 'Jamaica',
  '11433': 'Jamaica (South)',
  '11434': 'Jamaica / JFK Airport area',
  '11435': 'Jamaica / Briarwood',
  '11436': 'South Ozone Park / Jamaica',
};

export type BoroughType = 'brooklyn' | 'manhattan' | 'queens';

export function getZipToNeighborhood(borough: BoroughType): Record<string, string> {
  switch (borough) {
    case 'brooklyn':
      return BROOKLYN_ZIPS;
    case 'manhattan':
      return MANHATTAN_ZIPS;
    case 'queens':
      return QUEENS_ZIPS;
    default:
      return {};
  }
}

/** All ZIP codes we consider valid for each borough (for validation). */
export function getAllZipsForBorough(borough: BoroughType): string[] {
  const map = getZipToNeighborhood(borough);
  return Object.keys(map);
}
