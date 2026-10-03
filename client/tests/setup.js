// jsdom lacks a few browser APIs Vuetify touches. These stubs only silence missing-API errors;
// they do not fake any application behaviour.
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
globalThis.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } };
window.matchMedia = window.matchMedia || ((q) => ({ matches: false, media: q, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; } }));
window.scrollTo = () => {};
window.visualViewport = window.visualViewport || { width: 1280, height: 800, scale: 1, addEventListener() {}, removeEventListener() {} };
globalThis.CSS = globalThis.CSS || { supports: () => false };
Element.prototype.animate = Element.prototype.animate || (() => ({ finished: Promise.resolve(), cancel() {}, onfinish: null }));
