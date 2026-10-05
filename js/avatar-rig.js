// js/avatar-rig.js
// The 2D cut-out avatar's fixed geometry, in the avatar's logical 1024x600 space (the layout of the
// owner's prototype avatar_test_hi_2p5d.html: torso height 330 centred at x=512, top y=262).
// Part sizes and anchors were measured from the PNGs' alpha channel (assets/avatar/*.png,
// docs/reports/2026-10-05-avatar-step1.md (d), Task 2). Pure data + tiny helpers: no DOM, so the
// retarget/timeline math can be unit-tested under node.
(function () {
  'use strict';

  var TORSO_PX = { w: 444, h: 540 };   // assets/avatar/torso.png
  var HEAD_PX = { w: 355, h: 414 };    // assets/avatar/head.png
  var TH = 330;
  var SC = TH / TORSO_PX.h;            // torso.png px -> logical px (0.611)
  var TW = TORSO_PX.w * SC;            // 271.3
  var TX = 512 - TW / 2;
  var TY = 262;
  var HH = 215;
  var HW = HH * HEAD_PX.w / HEAD_PX.h; // 184.4

  // Shoulder sockets: the torso's sleeve puffs are centred ~30 px in from each side, 128 px down
  // (torso.png); the prototype used the same point. Index 0 = the signer's RIGHT arm, which is on
  // the viewer's LEFT (no mirroring, as in the video clips).
  var SOCKETS = [
    { x: TX + 30 * SC, y: TY + 128 * SC },
    { x: TX + TW - 30 * SC, y: TY + 128 * SC }
  ];
  var UPPER_W = 62;
  var FORE_W = 48;
  // The upper arm pivots a quarter sleeve-width inside the socket, under a shoulder cap, so a raised
  // arm never opens a gap between the torso's sleeve and the arm's sleeve (decision 7).
  var PIVOT_INSET = UPPER_W * 0.25;

  // Head: drawn with its bottom-centre (chin) at HEAD_ANCHOR. Measured on head.png: the widest
  // row (ears) spans x 11..342 of 355 at y 250-260; nose tip at about (178, 278); eyes at y 0.56.
  var HEAD_ANCHOR = { x: 512, y: TY + 38 };
  var FACE = {
    noseFromAnchor: { x: 0, y: -(HEAD_PX.h - 278) / HEAD_PX.h * HH },   // -70.6
    earWidth: (342 - 11) / HEAD_PX.w * HW,                              // 171.9
    eyes: [[-0.168, -0.44], [0.156, -0.44]]                              // x HW, y HH from the anchor
  };

  // The prototype's relaxed hand (avatar_test_my_name_is.html RESTSHAPE): 21 points, wrist at the
  // origin, fingers toward -y. Converted below into the forearm-local frame.
  var RESTSHAPE = [0, 0, 0, -0.126, -0.074, -0.031, -0.212, -0.233, -0.05, -0.207, -0.395, -0.071, -0.133, -0.453, -0.093,
    -0.2, -0.473, -0.013, -0.239, -0.661, -0.047, -0.26, -0.776, -0.081, -0.274, -0.879, -0.109, -0.129, -0.507, -0.031,
    -0.168, -0.717, -0.06, -0.193, -0.85, -0.091, -0.216, -0.97, -0.115, -0.051, -0.502, -0.056, -0.082, -0.706, -0.084,
    -0.102, -0.831, -0.107, -0.123, -0.942, -0.126, 0.032, -0.465, -0.086, 0.004, -0.624, -0.111, -0.018, -0.729, -0.122,
    -0.04, -0.823, -0.132];
  var PALM = 54;   // wrist -> middle-finger base, logical px (the prototype's median, 54.4)

  // Relaxed hand in the forearm-local frame: x along the forearm (past the wrist), y = side * the
  // perpendicular (side -1 for arm 0, +1 for arm 1, as the prototype's fallbackHand), z depth.
  function restHandLocal(side) {
    var palmUnits = Math.hypot(RESTSHAPE[27], RESTSHAPE[28]);
    var k = PALM / palmUnits;
    var out = [];
    for (var j = 0; j < 21; j++) {
      out.push({ x: -RESTSHAPE[j * 3 + 1] * k, y: RESTSHAPE[j * 3] * k * side, z: RESTSHAPE[j * 3 + 2] * k });
    }
    return out;
  }

  var RIG = {
    W: 1024,
    H: 600,
    colors: { skin: '#E8B07A', outline: '#1A1A1A', shirt: '#0B2D6B', eyelid: '#DFA66F', background: '#EEF1F7' },
    torso: { x: TX, y: TY, w: TW, h: TH },
    head: { anchor: HEAD_ANCHOR, w: HW, h: HH },
    face: FACE,
    sockets: SOCKETS,
    pivotInset: PIVOT_INSET,
    L1: 128,
    L2: 120,
    upperW: UPPER_W,
    foreW: FORE_W,
    palm: PALM,
    restHand: [restHandLocal(-1), restHandLocal(1)],
    // Rest wrist: elbows bent, hands relaxed in front of the waist. (The prototype's straight-down
    // rest, 34 px outside the socket and 236 px below it, put the fingers below the kiosk panel's
    // visible area, which ends at y=592: Task 2 pose sheet.)
    restWristOffset: [{ x: 60, y: 175 }, { x: -60, y: 175 }],
    // The part of the logical space the kiosk panel shows: head top to waist, centred.
    views: {
      kiosk: { x: 512 - 562, y: 70, w: 1124, h: 522 },
      admin: { x: 512 - 370, y: 70, w: 740, h: 532 }
    }
  };

  // Pivot of arm `i` (socket moved inward by pivotInset), with an optional vertical shrug.
  RIG.pivot = function (i, shrug) {
    var s = SOCKETS[i];
    return { x: s.x + (i === 0 ? PIVOT_INSET : -PIVOT_INSET), y: s.y + (shrug || 0) };
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = RIG;
  if (typeof window !== 'undefined') window.AvatarRig = RIG;
})();
