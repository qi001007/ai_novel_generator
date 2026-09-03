Object.defineProperty(window.HTMLCanvasElement.prototype, "getContext", {
  value: () => ({
    setTransform: () => undefined,
    clearRect: () => undefined,
    fillRect: () => undefined,
  }),
  configurable: true,
});
