import { removeNoscriptStylesheet } from './noscript-stylesheet';

describe('removeNoscriptStylesheet (index template)', () => {
  const head = '<link rel="stylesheet" href="styles-U4PDXJY7.css" media="print" data-beasties-media="all">'
    + '<noscript><link rel="stylesheet" href="styles-U4PDXJY7.css"></noscript></head>';
  const gtm = '<noscript><iframe src="https://www.googletagmanager.com/ns.html?id=GTM-PMSDXVF3" height="0" width="0"></iframe></noscript>';

  it('drops the generated stylesheet fallback and keeps the deferred stylesheet', () => {
    expect(removeNoscriptStylesheet(head))
      .toBe('<link rel="stylesheet" href="styles-U4PDXJY7.css" media="print" data-beasties-media="all"></head>');
  });

  it('leaves every other noscript alone', () => {
    expect(removeNoscriptStylesheet(gtm)).toBe(gtm);
    const other = '<noscript><link rel="stylesheet" href="x.css" media="all"></noscript>';
    expect(removeNoscriptStylesheet(other)).toBe(other);
  });

  it('is a no-op on a template without the fallback', () => {
    const html = '<html><head></head><body></body></html>';
    expect(removeNoscriptStylesheet(html)).toBe(html);
  });
});
