// Test helper: loads a given js/gesture-data.js source string into a node:vm context with a
// minimal DOM stub, and returns window.GestureDataRecorder. gesture-data.js is a plain
// browser <script> (IIFE) with no module.exports, so it can't be require()'d directly under
// node; instead we give it just enough of a fake window/document/location to run its
// module-top-level code and its init() (readyState 'complete' -> init() runs synchronously
// at load) without touching a real DOM or network.
//
// Only stub what the file touches at load time (module scope + init()'s synchronous path):
// document.createElement (an offscreen <canvas> at module scope), document.readyState,
// document.getElementById/querySelector/querySelectorAll (all return "nothing found" so
// init()'s video lookup no-op), document.addEventListener, location.search/
// protocol, and URLSearchParams. This intentionally does NOT stub anything from
// setupMediaPipe/runHandLoop (window.Hands, canvas 2D context drawing, etc.) since
// those never run when getElementById("videoFeed"|"video") returns null. Keeping the stub
// this narrow means it kept working after Task 5 removed the live-capture functions: the
// smaller gesture-data.js still only touches this same small set of DOM entry points at load.
import vm from 'node:vm';

function noop() {}

function makeStubDocument() {
  return {
    readyState: 'complete',
    activeElement: { tagName: 'BODY' },
    createElement: () => ({ getContext: () => ({}), style: {} }),
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: noop,
    removeEventListener: noop,
    body: { appendChild: noop },
  };
}

// Loads `source` (the text of js/gesture-data.js) into a fresh vm context and returns the
// window.GestureDataRecorder object it installs.
export function loadGestureData(source) {
  const window = {
    SK_DISABLE_GESTURE_HOTKEY: true, // harmless: gesture-data.js no longer reads it (its G hotkey was removed in Task 5)
  };
  const document = makeStubDocument();
  const location = { search: '', protocol: 'http:', href: 'http://localhost/' };

  const context = {
    window,
    document,
    location,
    navigator: {},
    URLSearchParams,
    console,
    setTimeout,
    clearTimeout,
    fetch: () => Promise.reject(new Error('network disabled in test')),
    Array,
    Object,
    Math,
    Number,
    String,
    Boolean,
    JSON,
    Promise,
    Blob: class {},
    FileReader: class { readAsDataURL() {} },
  };
  context.self = window;
  context.globalThis = context;

  vm.createContext(context);
  vm.runInContext(source, context, { filename: 'js/gesture-data.js' });

  return window.GestureDataRecorder;
}
