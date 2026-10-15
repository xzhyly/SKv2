// js/knn-model-store.js
// Loads a compact k-NN model file (`models/knn_<LANG>.bin`, format: .git/sdd/cm-plan.md "Model file",
// decoded by js/knn-compile.js) through an IndexedDB copy, so a kiosk downloads the ~1 MB file only
// when it changed, and keeps the last good file when the new one is missing or broken
// (docs/reports/2026-10-14-compact-model-step1.md section 6.2, decision 7).
//
// Plain script, no modules; load it after js/knn-compile.js. Attaches window.KnnModelStore with
// load(lang, opts), remove(lang, opts) and info(opts). It never touches localStorage and never
// requests anything except the model file's own URL (one HEAD, plus one GET when the stored copy
// is missing or out of date). The caller decides what "usable" means (fewer than 2 labels is not).
(function () {
  'use strict';

  var DEFAULT_DB = 'sining_kamay_models'; // plan "IndexedDB cache"; tests pass their own dbName
  var DB_VERSION = 1;
  var STORE = 'models'; // key 'ESL' | 'FSL', value { etag, length, lastModified, savedAt, buffer }
  var LANGS = ['ESL', 'FSL'];
  var TAG = '[KnnModelStore]';

  function errText(e) {
    return (e && e.message) || String(e);
  }

  // One IndexedDB connection for the length of one load()/remove()/info() call. Any failure
  // (indexedDB missing or throwing in private mode, open refused or blocked, a transaction error)
  // switches storage off for the rest of the call with ONE console.warn; the caller then carries
  // on network-only. None of these functions ever rejects: a failed read gives null, a failed
  // write gives false.
  function openStorage(dbName) {
    var warned = false;
    var dbPromise = null;

    function off(what, e) {
      if (!warned) {
        warned = true;
        console.warn(TAG + ' IndexedDB ' + what + ' failed (' + errText(e) + '); working without the stored copy');
      }
      var prev = dbPromise;
      dbPromise = Promise.resolve(null);
      if (prev) prev.then(function (d) { if (d) d.close(); }); // a connection opened before the failure
      return null;
    }

    function db() {
      if (!dbPromise) {
        dbPromise = new Promise(function (resolve, reject) {
          var req = window.indexedDB.open(dbName, DB_VERSION); // throws synchronously when blocked by policy
          req.onupgradeneeded = function () {
            if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
          };
          req.onsuccess = function () {
            var d = req.result;
            // A later page version that upgrades the database must not be blocked by this one.
            d.onversionchange = function () { d.close(); };
            resolve(d);
          };
          req.onerror = function () { reject(req.error); };
          req.onblocked = function () { reject(new Error('open blocked by another connection')); };
        }).catch(function (e) {
          return off('open', e);
        });
      }
      return dbPromise;
    }

    // Runs fn(objectStore) in one transaction; resolves with the request's result once the
    // transaction completes (so a put is really stored), or with `failed` on any error.
    function run(mode, what, fn, failed) {
      return db().then(function (d) {
        if (!d) return failed;
        return new Promise(function (resolve, reject) {
          var tx = d.transaction(STORE, mode);
          var req = fn(tx.objectStore(STORE));
          var result;
          req.onsuccess = function () { result = req.result; };
          tx.oncomplete = function () { resolve(result); };
          tx.onerror = function () { reject(tx.error || req.error); };
          tx.onabort = function () { reject(tx.error || new Error('transaction aborted')); };
        }).catch(function (e) {
          off(what, e);
          return failed;
        });
      });
    }

    return {
      get: function (key) {
        return run('readonly', 'read', function (s) { return s.get(key); }, null).then(function (v) {
          return v === undefined ? null : v;
        });
      },
      put: function (key, value) {
        return run('readwrite', 'save', function (s) { return s.put(value, key); }, false).then(function (r) {
          return r !== false;
        });
      },
      del: function (key) {
        return run('readwrite', 'delete', function (s) { return s.delete(key); }, false).then(function (r) {
          return r !== false;
        });
      },
      available: function () {
        return db().then(function (d) { return !!d; });
      },
      close: function () {
        if (!dbPromise) return;
        dbPromise.then(function (d) {
          if (d) d.close();
        });
      }
    };
  }

  // The headers that say which file the server has now. Content-Length is kept as a number.
  function validators(res) {
    var len = res.headers.get('Content-Length');
    return {
      etag: res.headers.get('ETag') || null,
      length: len !== null && /^\s*\d+\s*$/.test(len) ? Number(len) : null,
      lastModified: res.headers.get('Last-Modified') || null
    };
  }

  // Apache sends a weak ETag (W/"...") for a file changed within the last second and the strong
  // one ("...", same text) afterwards (measured: tests/compact-model/store-check.mjs check 4). The
  // file is the same, so the W/ prefix is ignored when comparing; Content-Length is compared too.
  function etagCore(etag) {
    return etag ? String(etag).replace(/^W\//, '') : null;
  }

  // Is the stored entry the file the HEAD describes? ETag + Content-Length when the server sends an
  // ETag; otherwise Content-Length + Last-Modified; with neither header there is nothing to compare,
  // so the file is always downloaded.
  function sameFile(entry, v) {
    if (!entry) return false;
    var etag = entry.etag || null;
    var length = typeof entry.length === 'number' ? entry.length : null;
    var lastModified = entry.lastModified || null;
    if (v.etag !== null) return etagCore(etag) === etagCore(v.etag) && length === v.length;
    if (v.length === null && v.lastModified === null) return false;
    return etag === null && length === v.length && lastModified === v.lastModified;
  }

  function checkLang(lang) {
    if (LANGS.indexOf(lang) < 0) throw new Error(TAG + ' lang must be ESL or FSL, got ' + JSON.stringify(lang));
  }

  // Decodes a stored or downloaded buffer; throws "knn model file: ..." from KnnCompile.decode.
  function decodeTo(buffer, source, etag) {
    var d = window.KnnCompile.decode(buffer);
    return {
      header: d.header,
      model: d.model,
      // Header order. Not Object.keys(model): that would move integer-like keys ("1", "10") first.
      labels: d.header.labels.map(function (L) { return L.key; }),
      source: source,
      bytes: buffer.byteLength,
      etag: etag || null
    };
  }

  // load(lang, opts) -> Promise<{ header, model, labels, source, bytes, etag }>.
  // source: 'cache' (stored copy matches the server's file), 'network' (downloaded, decoded and
  // stored), 'cache-fallback' (the server's file is missing or broken; the last good stored copy is
  // used, with one console.warn naming why). Rejects only when there is no usable file at all.
  // opts.url: default 'models/knn_<lang>.bin', page-relative like every other asset.
  // opts.dbName: default 'sining_kamay_models' (only tests change it).
  function load(lang, opts) {
    opts = opts || {};
    try {
      checkLang(lang);
      if (!window.KnnCompile || typeof window.KnnCompile.decode !== 'function') {
        throw new Error(TAG + ' js/knn-compile.js must be loaded first');
      }
    } catch (e) {
      return Promise.reject(e);
    }
    var url = opts.url || 'models/knn_' + lang + '.bin';
    var storage = openStorage(opts.dbName || DEFAULT_DB);
    var entry = null; // the stored entry as read at the start (null once found not to decode)

    // Step 5: no good file from the server. Use the stored copy if it decodes, else reject.
    function fallback(reason) {
      if (!entry) {
        return Promise.reject(new Error(TAG + ' ' + lang + ' model unavailable: ' + reason + '; no stored copy'));
      }
      var r;
      try {
        r = decodeTo(entry.buffer, 'cache-fallback', entry.etag);
      } catch (e) {
        entry = null;
        return storage.del(lang).then(function () {
          throw new Error(TAG + ' ' + lang + ' model unavailable: ' + reason + '; the stored copy does not decode either (' + errText(e) + ')');
        });
      }
      console.warn(TAG + ' using the stored ' + lang + ' model (saved ' + entry.savedAt + ') because ' + reason);
      return r;
    }

    // Step 4: GET, decode, store. A failed GET or a file that does not decode goes to fallback().
    function download() {
      var v = null;
      return fetch(url, { cache: 'no-store' }).then(function (res) {
        if (!res.ok) {
          var notOk = new Error('GET ' + url + ' returned ' + res.status);
          notOk.isReason = true;
          throw notOk;
        }
        v = validators(res);
        return res.arrayBuffer();
      }).then(function (buffer) {
        var r;
        try {
          r = decodeTo(buffer, 'network', v.etag);
        } catch (e) {
          return fallback(url + ' does not decode (' + errText(e) + ')');
        }
        // Without Content-Length the next HEAD cannot match by length; the buffer size is the
        // best stand-in (equal to Content-Length for an uncompressed response, which Apache sends).
        var value = {
          etag: v.etag,
          length: v.length !== null ? v.length : buffer.byteLength,
          lastModified: v.lastModified,
          savedAt: new Date().toISOString(),
          buffer: buffer
        };
        return storage.put(lang, value).then(function () { return r; }); // a failed put only warns
      }, function (e) {
        return fallback(e && e.isReason ? e.message : 'GET ' + url + ' failed (' + errText(e) + ')');
      });
    }

    // Steps 1 and 2 run side by side: the HEAD and the stored-entry read do not depend on each other.
    var head = fetch(url, { method: 'HEAD', cache: 'no-store' }).then(function (res) {
      return res.ok
        ? { ok: true, v: validators(res) }
        : { ok: false, why: 'HEAD ' + url + ' returned ' + res.status };
    }, function (e) {
      return { ok: false, why: 'HEAD ' + url + ' failed (' + errText(e) + ')' };
    });

    return Promise.all([head, storage.get(lang)]).then(function (r) {
      var h = r[0];
      entry = r[1] && typeof r[1] === 'object' ? r[1] : null;
      if (!h.ok) return fallback(h.why);
      // Step 3: the stored copy is the server's file -> no download.
      if (sameFile(entry, h.v)) {
        try {
          return decodeTo(entry.buffer, 'cache', entry.etag);
        } catch (e) {
          console.warn(TAG + ' stored ' + lang + ' model does not decode (' + errText(e) + '); downloading it again');
          entry = null;
          return storage.del(lang).then(download);
        }
      }
      return download();
    }).then(function (result) {
      storage.close();
      return result;
    }, function (e) {
      storage.close();
      throw e;
    });
  }

  // remove(lang, opts) -> Promise<boolean>: deletes the stored copy of `lang`. false only when
  // IndexedDB is unavailable (one console.warn); removing a copy that is not there is true.
  function remove(lang, opts) {
    opts = opts || {};
    try {
      checkLang(lang);
    } catch (e) {
      return Promise.reject(e);
    }
    var storage = openStorage(opts.dbName || DEFAULT_DB);
    return storage.del(lang).then(function (ok) {
      storage.close();
      return ok;
    });
  }

  // info(opts) -> Promise<{ available, ESL, FSL }>: per language what is stored, as
  // { etag, length, lastModified, savedAt, bytes } (bytes = the stored buffer's size), or null.
  // available is false when IndexedDB cannot be used (one console.warn).
  function info(opts) {
    opts = opts || {};
    var storage = openStorage(opts.dbName || DEFAULT_DB);
    return storage.available().then(function (available) {
      return Promise.all(LANGS.map(function (lang) { return storage.get(lang); })).then(function (entries) {
        var out = { available: available };
        LANGS.forEach(function (lang, i) {
          var e = entries[i];
          out[lang] = e && typeof e === 'object' ? {
            etag: e.etag || null,
            length: typeof e.length === 'number' ? e.length : null,
            lastModified: e.lastModified || null,
            savedAt: e.savedAt || null,
            bytes: e.buffer && typeof e.buffer.byteLength === 'number' ? e.buffer.byteLength : null
          } : null;
        });
        storage.close();
        return out;
      });
    });
  }

  window.KnnModelStore = { load: load, remove: remove, info: info };
})();
