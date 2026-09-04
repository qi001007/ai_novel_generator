Object.defineProperty(window.HTMLCanvasElement.prototype, "getContext", {
  value: () => ({
    setTransform: () => undefined,
    clearRect: () => undefined,
    fillRect: () => undefined,
    fillText: () => undefined,
  }),
  configurable: true,
});

// Same reason as the canvas stub above: jsdom has no layout, so a Range cannot
// report client rects. CodeMirror measures text with them on every rAF, and without
// this the whole suite dies with "textRange(...).getClientRects is not a function".
const emptyRect = {
  x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0,
  toJSON: () => ({}),
};
Object.defineProperty(window.Range.prototype, "getClientRects", {
  value: () => [],
  configurable: true,
});
Object.defineProperty(window.Range.prototype, "getBoundingClientRect", {
  value: () => emptyRect,
  configurable: true,
});
