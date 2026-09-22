// Paste into DevTools console on http://localhost/SKR/gesture-training.html (after the page has
// finished loading) to re-check that a post-save reload issues exactly one save_gesture.php fetch.
// Not runnable under `node --test`: mergeSavedGestureSamples/renderSavedDataset/reloadDataset are
// page globals that read the DOM and MediaPipe state via `document`/`window`, not an importable
// module, and this repo adds no build step or test-DOM package (jsdom etc.) to change that — see
// docs/superpowers/plans/2026-09-22-gesture-training-multi-sample.md Task 5.
(async function reloadRegressionCheck() {
  performance.clearResourceTimings();
  const t0 = performance.now();
  await window.reloadDataset();
  await new Promise((r) => setTimeout(r, 500)); // let any stray extra fetch land before counting
  const hits = performance.getEntriesByType('resource').filter((e) => e.name.includes('save_gesture.php'));
  const ms = Math.round(performance.now() - t0);
  const result = { ms, fetches: hits.length, bytesEach: hits.map((h) => h.transferSize) };
  const pass = hits.length === 1;
  console[pass ? 'log' : 'error']('[reload-regression]', pass ? 'PASS' : 'FAIL', result);
  return result;
})();
