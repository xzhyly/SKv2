// js/avatar-renderer.js
// Draws one avatar param pose on a 2D canvas. FLAT look only (owner decision at Step 1 approval):
// solid colours as in the PNG parts, no gradients, no blur, no shadows, no ctx.filter. Kept: the
// blink, the slight breathing, and depth ordering (the farther arm, and the farther fingers of each
// hand, are drawn first). The avatar paints its own light background so the navy shirt stays
// visible inside talk.html's navy frame. Drawing code ported from the owner's prototype
// (avatar_test_my_name_is.html: limb(), hand() in flat mode, the blink).
(function () {
  'use strict';

  var FINGERS = [[1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12], [13, 14, 15, 16], [17, 18, 19, 20]];
  var PALM = [0, 1, 5, 9, 13, 17];

  // Loads the four parts once per page (the first call's base wins). Resolves {head, torso, upper, fore}.
  var partsPromise = null;
  function loadParts(base) {
    if (partsPromise) return partsPromise;
    base = base || 'assets/avatar/';
    var files = { head: 'head.png', torso: 'torso.png', upper: 'upper_arm.png', fore: 'forearm.png' };
    partsPromise = Promise.all(Object.keys(files).map(function (k) {
      return new Promise(function (resolve, reject) {
        var img = new Image();
        img.onload = function () { resolve([k, img]); };
        img.onerror = function () { reject(new Error('avatar part failed to load: ' + files[k])); };
        img.src = base + files[k];
      });
    })).then(function (list) {
      var out = {};
      list.forEach(function (e) { out[e[0]] = e[1]; });
      return out;
    });
    partsPromise.catch(function () { partsPromise = null; });   // allow a retry later
    return partsPromise;
  }

  function create(canvas, parts, opts) {
    opts = opts || {};
    var rig = opts.rig || window.AvatarRig;
    var Retarget = window.AvatarRetarget;
    var view = opts.view || rig.views.kiosk;
    var g = canvas.getContext('2d');
    var C = rig.colors;
    var blinkAt = 1800;

    function setView() {
      var s = Math.min(canvas.width / view.w, canvas.height / view.h);
      var ox = (canvas.width - view.w * s) / 2, oy = (canvas.height - view.h * s) / 2;
      g.setTransform(s, 0, 0, s, ox - view.x * s, oy - view.y * s);
    }

    function limb(img, a, b, w, flip) {
      var dx = b.x - a.x, dy = b.y - a.y, L = Math.sqrt(dx * dx + dy * dy), r = w / 2;
      g.save();
      g.translate(a.x, a.y);
      g.rotate(Math.atan2(dy, dx) - Math.PI / 2);
      if (flip) g.scale(-1, 1);
      g.drawImage(img, -w / 2, -r, w, L + 2 * r);
      g.restore();
    }

    function path(pts) {
      g.beginPath();
      g.moveTo(pts[0].x, pts[0].y);
      for (var i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
    }
    function cap(pts, w, col) {
      g.strokeStyle = col; g.lineWidth = w; g.lineCap = 'round'; g.lineJoin = 'round';
      path(pts); g.stroke();
    }

    // Code-drawn hand: palm + five fingers, farther parts first (MediaPipe z: larger = farther).
    function hand(P) {
      var s = Math.hypot(P[9].x - P[0].x, P[9].y - P[0].y), fw = Math.max(7, s * 0.26), ol = 5;
      var items = [{ k: 'p', z: PALM.reduce(function (a, i) { return a + P[i].z; }, 0) / PALM.length, i: PALM }];
      FINGERS.forEach(function (f) { items.push({ k: 'f', z: f.reduce(function (a, i) { return a + P[i].z; }, 0) / 4, i: f }); });
      items.sort(function (a, b) { return b.z - a.z; });
      items.forEach(function (it) {
        var pts = it.i.map(function (i) { return P[i]; });
        if (it.k === 'p') {
          var loop = pts.concat([pts[0]]);
          cap(loop, fw * 0.9 + ol, C.outline);
          g.fillStyle = C.skin; path(pts); g.closePath(); g.fill();
          cap(loop, fw * 0.9, C.skin);
        } else {
          var w = it.i[0] === 17 ? fw * 0.85 : fw;
          cap(pts, w + ol, C.outline);
          cap(pts, w, C.skin);
        }
      });
    }

    // pose: a param pose (js/avatar-retarget.js). clock: ms, drives breathing and blinking.
    function draw(pose, clock) {
      clock = clock || 0;
      var br = Math.sin(clock / 1050);
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.fillStyle = C.background;
      g.fillRect(0, 0, canvas.width, canvas.height);
      setView();

      // breathing: the torso stretches 0.6% from its bottom edge; shoulders and head follow
      var t = rig.torso;
      g.save();
      g.translate(512, t.y + t.h);
      g.scale(1, 1 + 0.006 * br);
      g.drawImage(parts.torso, -t.w / 2, -t.h, t.w, t.h);
      g.restore();
      var breathe = -0.006 * br * (t.y + t.h - rig.sockets[0].y);
      var p2 = { arms: pose.arms.map(function (a) { return Object.assign({}, a, { shrug: a.shrug + breathe }); }), head: pose.head };
      var J = Retarget.toJoints(p2, rig);

      // shoulder caps under the arms: the sleeve never separates from the shoulder (decision 7)
      J.arms.forEach(function (a) {
        g.beginPath();
        g.ellipse(a.S.x, a.S.y, rig.upperW / 2, rig.upperW / 2, 0, 0, Math.PI * 2);
        g.fillStyle = C.shirt; g.fill();
        g.lineWidth = 4; g.strokeStyle = C.outline; g.stroke();
      });

      var h = rig.head;
      g.save();
      g.translate(h.anchor.x + J.head.dx, h.anchor.y - 1.8 * br);
      g.rotate(J.head.roll);
      g.drawImage(parts.head, -h.w / 2, -h.h, h.w, h.h);
      if (clock > blinkAt + 140) blinkAt = clock + 2600 + Math.random() * 2600;
      if (opts.forceBlink || (clock > blinkAt && clock < blinkAt + 140)) {
        rig.face.eyes.forEach(function (e) {
          var ex = e[0] * h.w, ey = e[1] * h.h;
          g.fillStyle = C.eyelid;
          g.beginPath(); g.ellipse(ex, ey, h.w * 0.088, h.h * 0.036, 0, 0, Math.PI * 2); g.fill();
          g.strokeStyle = C.outline; g.lineWidth = 2.4; g.lineCap = 'round';
          g.beginPath(); g.arc(ex, ey - h.h * 0.03, h.w * 0.085, 0.25 * Math.PI, 0.75 * Math.PI); g.stroke();
        });
      }
      g.restore();

      // arms, the farther one (larger wrist z) first; each arm with its own hand
      var order = J.arms[0].z > J.arms[1].z ? [0, 1] : [1, 0];
      order.forEach(function (i) {
        var a = J.arms[i];
        limb(parts.upper, a.S, a.E, rig.upperW, i === 1);
        limb(parts.fore, a.E, a.W, rig.foreW, false);
        hand(a.hand);
      });
      g.setTransform(1, 0, 0, 1, 0, 0);
    }

    return { draw: draw, setView: function (v) { view = v; } };
  }

  window.AvatarRenderer = { create: create, loadParts: loadParts };
})();
