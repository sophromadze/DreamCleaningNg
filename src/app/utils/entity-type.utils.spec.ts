import { applyInferredEntityType, inferEntityType } from './entity-type.utils';

describe('entity-type inference', () => {
  describe('the recognized suffixes', () => {
    const cases: [string, string][] = [
      ['Chick Tastic LLC', 'a limited liability company'],
      ['Chick Tastic L.L.C.', 'a limited liability company'],
      ['Flatbush Diner Inc.', 'a corporation'],
      ['Flatbush Diner Incorporated', 'a corporation'],
      ['Kings County Foods Corp.', 'a corporation'],
      ['Kings County Foods Corporation', 'a corporation'],
      ['Brooklyn Dental PLLC', 'a professional limited liability company'],
      ['Ozer & Sons LLP', 'a limited liability partnership'],
      ['Flatbush Realty LP', 'a limited partnership'],
      ['Ozer Dental P.C.', 'a professional corporation'],
      ['Ozer Dental PC', 'a professional corporation']
    ];

    for (const [name, expected] of cases) {
      it(`reads "${name}" as ${expected}`, () => {
        expect(inferEntityType(name)).toBe(expected);
      });
    }
  });

  it('is case-insensitive, including on a fully lower-case or mixed-case name', () => {
    expect(inferEntityType('chick tastic llc')).toBe('a limited liability company');
    expect(inferEntityType('Chick Tastic lLc')).toBe('a limited liability company');
    expect(inferEntityType('FLATBUSH DINER INC')).toBe('a corporation');
  });

  it('ignores surrounding whitespace and a trailing comma', () => {
    expect(inferEntityType('  Chick Tastic   LLC  ')).toBe('a limited liability company');
    expect(inferEntityType('Ozer & Sons, Inc.')).toBe('a corporation');
  });

  // THE POINT OF SUFFIX MATCHING. Each of these contains a suffix as a substring and is not that
  // kind of entity — being told otherwise on your own contract is not a cosmetic mistake.
  it('never matches a suffix that only appears inside the name', () => {
    expect(inferEntityType('Incognito Cleaning')).toBeNull();
    expect(inferEntityType('Delp Holdings')).toBeNull();
    expect(inferEntityType('Corporation Bay Diner')).toBeNull();
    expect(inferEntityType('LLC Movers of Brooklyn')).toBeNull();
    expect(inferEntityType('Pconnect Services')).toBeNull();
  });

  it('has no opinion about a name with no recognized suffix', () => {
    expect(inferEntityType('Flatbush Diner')).toBeNull();
    expect(inferEntityType('Ozer & Sons Ltd')).toBeNull();
    expect(inferEntityType('')).toBeNull();
    expect(inferEntityType('   ')).toBeNull();
    expect(inferEntityType(null)).toBeNull();
    expect(inferEntityType(undefined)).toBeNull();
  });

  it('does not treat a one-word name as its own suffix', () => {
    expect(inferEntityType('Incorporated')).toBeNull();
    expect(inferEntityType('LLC')).toBeNull();
  });

  describe('applying it to a form', () => {
    it('fills the field while the admin has not touched it', () => {
      expect(applyInferredEntityType('Chick Tastic LLC', false))
        .toBe('a limited liability company');
    });

    it('NEVER overwrites a manual answer, even when the suffix disagrees', () => {
      expect(applyInferredEntityType('Chick Tastic LLC', true)).toBeNull();
      expect(applyInferredEntityType('Flatbush Diner Inc.', true)).toBeNull();
    });

    it('leaves an untouched field alone when the name says nothing', () => {
      expect(applyInferredEntityType('Flatbush Diner', false)).toBeNull();
    });
  });
});
