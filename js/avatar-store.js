// js/avatar-store.js
// The avatar clips, loaded on demand (decision 10):
// a clip is fetched from saved_gestures/<key>/avatar.json only when a sentence needs it, validated,
// retargeted once (js/avatar-retarget.js prepare()) and kept in a small LRU cache.
(function () {
  'use strict';

  var LOAD_TIMEOUT_MS = 3000;

  function create(opts) {
    opts = opts || {};
    var base = opts.base || 'saved_gestures/';
    var max = opts.max || 12;
    var rig = opts.rig || window.AvatarRig;
    var cache = new Map();   // key -> Promise<prep|null>, insertion order = LRU order
    // Which words have a clip is decided by js/sign-player.js (signs.php `avatar` flags), not here.

    function fetchClip(key) {
      var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, LOAD_TIMEOUT_MS);
      return fetch(base + encodeURIComponent(key) + '/avatar.json', { cache: 'no-cache', signal: ctrl ? ctrl.signal : undefined })
        .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
        .then(function (clip) {
          var v = window.AvatarClip.validateClip(clip);
          if (!v.ok) throw new Error(v.error);
          if (clip.key !== key) throw new Error('clip belongs to "' + clip.key + '"');
          var prep = window.AvatarRetarget.prepare(clip, rig);
          prep.key = key;
          return prep;
        })
        .finally(function () { clearTimeout(timer); });
    }

    // -> Promise<prepared clip, or null if it could not be loaded (the word then plays as video)>
    function load(key) {
      if (cache.has(key)) {
        var hit = cache.get(key);
        cache.delete(key);
        cache.set(key, hit);
        return hit;
      }
      var p = fetchClip(key).catch(function (e) {
        console.warn('[avatar] clip "' + key + '" not loaded:', e && e.message ? e.message : e);
        if (cache.get(key) === p) cache.delete(key);   // a failure is not cached
        return null;
      });
      cache.set(key, p);
      while (cache.size > max) cache.delete(cache.keys().next().value);
      return p;
    }

    function forget(key) { cache.delete(key); }

    return { load: load, forget: forget, size: function () { return cache.size; } };
  }

  window.AvatarStore = { create: create };
})();
