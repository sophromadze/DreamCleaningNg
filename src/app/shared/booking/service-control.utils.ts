/**
 * Which control a booking surface draws for a service: the Sq.ft slider or the +/- stepper.
 *
 * Exactly two exist. The admin used to set `inputType` ("dropdown" / "slider" / "number") and
 * `isRangeInput` independently, and booking keyed the stepper on "dropdown" and the slider on
 * isRangeInput — so "slider" without the flag, or the never-implemented "number", left the customer
 * with no control at all, and "dropdown" with the flag drew both. Either field saying slider now
 * means the slider; everything else is the stepper. The server stores the pair consistently on
 * save (CatalogInputPolicy.NormalizeInputType); this read is lenient so rows saved before that
 * still get a control.
 */
export function isSliderService(service: { inputType?: string | null; isRangeInput?: boolean | null }): boolean {
  return !!service.isRangeInput || service.inputType === 'slider';
}
