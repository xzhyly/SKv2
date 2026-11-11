// js/kiosk-touch.js (touch-ux, 2026-11-12) — with css/kiosk-touch.css: no long-press / right-click menu and
// no dragging of images or links on the kiosk touchscreen. Inside text fields the menu is left alone
// (paste and the caret still work there).
(function () {
  'use strict';
  function inField(t) {
    return !!(t && t.closest && t.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]'));
  }
  document.addEventListener('contextmenu', function (e) { if (!inField(e.target)) e.preventDefault(); });
  document.addEventListener('dragstart', function (e) { if (!inField(e.target)) e.preventDefault(); });
  // A long press that started a selection anyway (some Chromium touch modes): drop it unless it is in a field.
  document.addEventListener('selectionchange', function () {
    var sel = window.getSelection && window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;
    var node = sel.anchorNode;
    var el = node && (node.nodeType === 1 ? node : node.parentElement);
    if (!inField(el) && !inField(document.activeElement)) sel.removeAllRanges();
  });
})();
