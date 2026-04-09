declare namespace google.maps {
  function importLibrary(library: string): Promise<any>;
  namespace places {
    class PlaceAutocompleteElement extends HTMLElement {
      constructor(options?: any);
      addEventListener(event: string, callback: (e: any) => void): void;
      style: CSSStyleDeclaration;
      setAttribute(name: string, value: string): void;
    }
  }
}
