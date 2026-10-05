Phase: 2D avatar for text-to-sign
Date: 2026-10-05
Status: WAITING FOR APPROVAL
Decision needed from owner: approve the design in (b)–(f) and answer the 16 open questions in (g). Each one has a recommended default.

# 2D avatar for text-to-sign — Step 1: investigation and proposal

Nothing in the repo has changed. No code, schema or data was touched, and no file was written except this report.
To take the measurements I did three things, all outside the repo:

- downloaded the `@mediapipe/holistic` npm package to my scratchpad. The sha512 matched the registry.
- made a throw-away folder `C:\xampp\htdocs\avatar-probe\`. It holds the Holistic files, a copy of
  `my_name_is.mp4` / `.avatar.json`, a copy of the prototype page and a probe page. Task 1 can reuse it. I delete it
  at the end of Step 2.
- ran headless Chrome 1024×600 through the repo's CDP driver, `tests/video-capture/cdp.mjs`.

Unless a line says otherwise, every number below was measured on this laptop.

## Summary of findings

- **Text-to-sign today is per-word video.** The flow is `js/sign-player.js` → phrase matcher → one `<video>` per
  item. A video item ends with the clip's last frame, and a sign from the static map adds a 2,000 ms hold. The avatar
  plugs in at one point: the loop in `playSequence` (`js/sign-player.js:452-455`). Runs of items that have an avatar
  clip go to the avatar. Every other item goes through the existing chain, unchanged.
- **Holistic works fully offline from a local folder.** With every non-localhost hostname blocked, it processed all
  256 frames of `my_name_is.mp4`. Detection counts match the prototype's CDN output: pose 256/256, right hand 196 vs
  197, left hand 63 vs 63. Mean pose difference is 0.0123 in normalized units. Every request went to localhost.
  Vendoring the needed files adds **36,871,967 bytes**.
- **The prototype's arm stretch, measured.** The prototype's frames were mapped outside the page with one uniform
  scale (signer shoulder width → avatar shoulder width). So the avatar's upper arm is drawn at a median of **206.8 px**
  and up to **244.0 px**. The caricature's own upper arm (`L1` in `avatar_test_hi_2p5d.html`) is **128 px**. That is
  1.62× the bone length (median) and up to 1.91×. The signer's upper arm is 0.88× shoulder width; the caricature's is
  0.55×. The mapping code itself is **not in the prototype**: `avatar_test_my_name_is.html` contains only the
  pre-mapped `FR` array. So the retargeting in (d) is new code, not a port.
- **The 2.5D look costs a lot without a GPU.** On a software canvas (`--disable-gpu`), the prototype's 2.5D frame took
  **22.0 ms** median (28.9 fps). The flat look took **4.4 ms**. With Chrome's CPU throttled 4×: 110.8 ms vs 23.2 ms.
  The difference is mostly `ctx.filter = 'blur()'`, used for the hand shadow and the floor shadow. A cheaper shadow
  and an automatic quality step-down are part of the design. None of this was measured on the Pi.
- **Hand tracking is already stopped wherever the avatar would play.** The avatar plays only on Speak or Type.
  Leaving the signing screen calls `TalkSigning.leave()`, which stops the camera tracks and calls
  `GestureDataRecorder.pauseHandLoop()` (`js/talk-signing.js:315-336`, `js/gesture-data.js:434-441`). The design adds
  an explicit pause/resume around playback anyway (decision 10). The test counts `Hands.send` calls during
  playback.

---

## (a) How text-to-sign works today

### Path from the Translate button to a picture

| Step | File:line | What happens |
|---|---|---|
| Player created once | `talk.html:1925-1929` | `SignPlayer.create({container: #speaking-sign-frame, wordLabel: #speaking-sign-word, getLanguage})`. |
| Sign texts registered | `talk.html:1705-1710` → `js/sign-player.js:246-283` | On first entry to Speak or Type, `registerCustomGestures()` fetches `php/api/signs.php` once per page load. Each sign's normalized text, the text without "?", its key and the key with spaces go into the EN map (ESL/Both) or the FIL map (FSL/Both). The value is the sign's `assetPath`, else `<key>.webm`. Existing entries are never overwritten (`:268`). |
| Phrase list | `js/sign-player.js:146-154` | `rebuildKnownPhrases()`: every map key that contains a space, longest first. |
| Translate click | `talk.html:1965-1977` | Blurs the input, switches to `data-speaking="preview"` and calls `speakingPlayer.play(text without "?")`. |
| Normalize | `js/sign-player.js:163-169` | Lower-case, strip `.,/#!$%^&*;:{}=-_\`~'()`, collapse spaces. "?" is kept, which is why Translate strips it first. |
| Word matching | `js/sign-player.js:432-456` with `:172-183` | Splits on spaces. At each position the longest known phrase wins, else the single word. This produces the `sequence` of items. |
| Clip lookup per item | `js/sign-player.js:383-429` | (1) Probes `assets/signs/<en|fil>/<item_with_underscores>.webm` (`:389-402`). (2) Else the static/registered map (`:410-414`); a value starting with `assets/` is used as-is. (3) Else, if the item is longer than one character, fingerspells each letter from `<base><letter>.webm` with an 800 ms minimum (`:417-423`). (4) Else `fallback.png` for 1,200 ms (`:424-425`). A map hit adds `sleep(2000)` (`:426-427`). |
| Playback | `js/sign-player.js:321-380` | A new `<video>` per item. On `loadedmetadata` it replaces the container content and sets the word label (`label.toUpperCase()`). It resolves on `ended`. **The cut between words:** the old clip stays as its last frame until the next clip's metadata loads, then it is swapped out. |
| Cancel | `js/sign-player.js:458-473`; `talk.html:1292-1296`, `:1978-1987` | Edit, Send and leaving the screen call `cancel()`: the token is bumped, waits are aborted, videos released and the label cleared. |
| Frame | `talk.html:826-833`, markup `:1167-1173` | `#speaking-sign-frame` is 560×260 with a `--navy` background. Measured at 1024×600, turn 1: frame at (232,154) 560×260, word label at y=422, `[Edit \| Send]` at y=472, 64 px tall. |

### Where the avatar plugs in

- **Lookup.** `fetchAndRegisterCustomGestures()` already walks every sign. It gains two more maps per language,
  normalized text → sign key, filled only for signs whose `signs.php` row says `avatar: true`. The existing asset maps
  are not changed.
- **Playback.** `playSequence()` keeps the phrase matcher exactly as it is. It then cuts the item list into **runs**.
  A run of items that all have a clip is handed to `AvatarPlayer.play(keys, onWord)`, so they play as one continuous
  movement. Any other item goes to the unchanged `displaySignWithFallback()` (video, then fingerspelling, then
  `fallback.png`). The `wordLabel` is set per sign by `onWord`, so the caption behaves as today.
- **Frame.** The container holds an avatar `<canvas>` (created once) and today's `<video>`/`<img>`. Only one of them
  is visible at a time. `cancel()` also stops the avatar.
- **Not touched:** the thread, the confirm card, Send → Add to Conversation, `js/talk-speaking.js`,
  `js/talk-signing.js`, `js/talk-history.js`, and the loading queue (`js/talk-loader.js`).

---

## (b) Which Holistic build to vendor

**`@mediapipe/holistic` 0.5.1675471629.** This is the npm `latest` tag and the exact build the prototype loads from
jsDelivr (`avatar_extract.html`). License Apache-2.0 (`package.json`). It belongs to the same "legacy solutions"
family as the vendored Hands 0.4.1675469240 (`docs/system/VENDORED.md`: `hands.js:95`).

- Tarball `holistic-0.5.1675471629.tgz`: 52,558,610 bytes. Its sha512 equals the registry's `integrity`
  (`qY+cxtDe…QRSYAw==`).
- The unpacked package has 15 files, 67,411,462 bytes.

**Files to vendor into `js/lib/holistic/`** (9 files, 36,871,967 bytes):

| File | Bytes | Fetched in the offline probe? |
|---|---|---|
| `holistic.js` | 78,139 | yes |
| `holistic.binarypb` | 1,741 | yes |
| `holistic_solution_packed_assets_loader.js` | 9,786 | yes |
| `holistic_solution_packed_assets.data` | 16,877,755 | yes |
| `holistic_solution_simd_wasm_bin.js` | 276,482 | yes |
| `holistic_solution_simd_wasm_bin.wasm` | 6,511,073 | yes |
| `pose_landmark_full.tflite` (`modelComplexity: 1`) | 6,440,512 | yes |
| `holistic_solution_wasm_bin.js` (non-SIMD fallback) | 276,477 | no: this Chrome has SIMD (Q1) |
| `holistic_solution_wasm_bin.wasm` (non-SIMD fallback) | 6,400,002 | no (Q1) |

These are not vendored: `pose_landmark_lite.tflite` (2,819,824), `pose_landmark_heavy.tflite` (27,709,200), the
0-byte `holistic_solution_simd_wasm_bin.data`, `index.d.ts` and `README.md`. Without the non-SIMD pair the total
would be 30,195,488 bytes.

Holistic is loaded **only** by `avatar-clips.html`. `talk.html` and `index.html` never reference it, and Task 7
checks this with the network log.

### Proof it loads offline (measured)

**Setup.**

- Probe page: `http://localhost/avatar-probe/probe.html`. It loads `js/lib/holistic/holistic.js` with
  `locateFile: f => 'js/lib/holistic/' + f` and the prototype's options (`modelComplexity 1`, `smoothLandmarks`,
  no segmentation, no refined face).
- It walks `my_name_is.mp4` at 25 fps by seeking, with the same loop and packing as `avatar_extract.html`.
- Chrome ran with `--host-resolver-rules="MAP * ~NOTFOUND, EXCLUDE localhost"`, so every hostname except localhost
  fails to resolve. CDP `Network` logging was on.

**Results.**

| Check | Result |
|---|---|
| Internet reachable? (a `fetch()` to `cdn.jsdelivr.net/.../holistic.js` from the page) | `BLOCKED: Failed to fetch`. This was the run's only non-localhost request. |
| Requests during load and extraction | 35, all to `localhost`. The 7 Holistic files fetched are marked "yes" in the table above. |
| `holistic.initialize()` | resolved in 762 ms |
| Frames processed | 256 of 256 (1080×1920, 10.24 s) |
| Detections vs. the prototype's CDN run (`my_name_is.avatar.json`) | pose 256 vs 256; right hand 196 vs 197; left hand 63 vs 63 |
| Agreement with the CDN run | pose: mean 0.0123, max 0.2067 (normalized x/y distance per landmark); right hand: mean 0.0027 |
| `holistic.send()` per frame | median 112 ms, p95 125 ms |
| Whole extraction, including seeks | 65,752 ms for a 10.24 s video (about 6.4× real time on this laptop) |
| Console errors / exceptions | 0 / 0 |

The pose max of 0.2067 is a single frame where the low-visibility hip/wrist points differ. Tracking is stateful
(`smoothLandmarks`), and the two runs seek in slightly different order and timing.

---

## (c) The avatar clip format

### What is stored

The raw Holistic landmarks in **signer space**, trimmed, plus enough metadata to retarget at play time. Nothing
avatar-specific is baked in: the retargeting math can improve later without re-extracting any clip.

```json
{
  "format": "sk_avatar_clip_v1",
  "key": "my_name",
  "fps": 25,
  "video": { "w": 1080, "h": 1920, "durationMs": 10240 },
  "trim": { "startMs": 1240, "endMs": 8840, "auto": true },
  "extractor": { "lib": "@mediapipe/holistic 0.5.1675471629", "modelComplexity": 1 },
  "signer": "",
  "createdAt": "2026-10-05T12:00:00+00:00",
  "poseIdx": [0, 7, 8, 11, 12, 13, 14, 15, 16, 23, 24],
  "frames": [ [pose|null, leftHand|null, rightHand|null], ... ]
}
```

- **What a frame holds:**
  - `pose` is 11 points `[x, y, z, visibility]`, in the order nose, left ear, right ear, shoulders, elbows, wrists,
    hips. This is exactly `avatar_extract.html`'s `POSE`.
  - Each hand is 21 points `[x, y, z]`, or `null` when no hand was detected. Missing hands are filled at play time,
    see (d).
- **Coordinate space:**
  - MediaPipe's normalized image coordinates: x and y run 0..1 over the video's width and height, and z is relative
    depth.
  - The player converts them to pixels with `video.w/h`, so aspect is kept.
  - **No mirroring.** The signer's right hand stays on the viewer's left, as in the video clips today and as in the
    prototype (`FR` arm 0 is pose 12, the signer's right).
- **Frames kept:** only the ones inside the trim window, so `frames[0]` is the trim start.
- **fps:** 25. This is the prototype's rate, and the player interpolates between frames.
- **Precision:** 3 decimals for x/y/z (at most about 1 px on a 1920-px video) and 2 for visibility.
- **`signer`:** an optional free-text name (Q8).
- **The source video is never stored, and neither is its file name** (decision 4).

### Size per sign (measured on the sample)

| Variant | Frames | Bytes | Bytes/frame |
|---|---|---|---|
| Prototype output, untrimmed, 4 decimals | 256 | 214,471 | 838 |
| Same clip, trimmed to frames 22–235, 3 decimals, frames only | 214 | 171,038 | 799 |
| gzip of the trimmed 4-decimal version | 215 | 60,428 | — |

XAMPP's `mod_deflate` is commented out (`C:\xampp\apache\conf\httpd.conf:111`), so clips are served uncompressed.
At about 800 B/frame, a 2 s sign is about 40 KB and a 3 s sign about 60 KB. The "my name is" sentence clip (7.6 s
after auto-trim) is about 150 KB.

### Where it lives

- **On disk:** `saved_gestures/<key>/avatar.json`, next to the sign's `sign.json` and samples. It is stored once per
  sign, so it serves ESL, FSL and Both (decision 3).
- **It never mixes with the recognition samples.** Every sample reader globs only `sample_*.json`:
  - `php/api/save_gesture.php:198` (sync);
  - `:326` (list);
  - `:477` and `:543` (save);
  - `php/api/sign_meta.php:80`.
  Saving samples never touches `avatar.json`, and saving a clip never touches samples or `sign.json`. The one reader
  of `*.json` is `delete_gesture` (`save_gesture.php:387`). It deletes the whole sign folder, so deleting a sign also
  deletes its clip (Q3).
- **In the DB: nothing new** (Q2). `php/api/signs.php` GET adds `"avatar": true|false` per sign, from `is_file()`.
  That is 122 stat calls per request, and the timing will be measured in Task 5. Disk stays the source of truth, as
  for `sign.json`, and there is no schema change. A mysqldump is still taken in Task 0 as insurance.
- **How the kiosk reads a clip:** a plain static GET of `saved_gestures/<key>/avatar.json`. Apache serves the repo
  folder through the `C:\xampp\htdocs\SKR` junction, and there is no `.htaccess` in the repo. Writes and deletes go
  through a new `php/api/avatar_clip.php`.

---

## (d) Retargeting math (decision 7) and the blend between signs

**Spaces:**

- **Signer pixels:** `p = (x·w, y·h)`.
- **Avatar space:** the prototype's logical 1024×600 canvas. The parts are laid out as in `avatar_test_hi_2p5d.html`:
  torso height `TH = 330`, avatar shoulder anchors `SL0/SR0` 234.6 px apart, `L1 = 128` (upper arm), `L2 = 120`
  (forearm).
- The renderer scales the logical space into the panel.
- The anchor constants (shoulder sockets, neck, nose, eyes and ears on `head.png`) are measured from the PNGs' alpha
  in Task 2 and kept in one rig file.

### Per-clip calibration (computed once, when the clip is loaded)

- **`σ` (shoulder width):** the median shoulder width. The sample measured 689 px, min 622, max 734.
- **True bone lengths:**
  - upper arm: `U = max(p95 |S→E|, 0.85·σ)`;
  - forearm: `F = max(p95 |E→W|, 0.65·σ)`.
  The near-maximum 2D length is the bone seen side-on. The floor protects clips where the forearm always points at
  the camera. In the sample, the forearm's 2D median is 281 px and its max 518 px, so it is mostly foreshortened.
- **`ε` (ear width):** the median distance between the ears. The sample measured 297 px.
- **`π` (palm length):** the p95 of the 2D distance from wrist to middle-finger base, per hand. The sample's median is
  159 px.

### Per frame, per arm (fixes the "stretched arms")

```
d_u = unit(E − S)        k_u = min(1, |E − S| / U)      // direction + 2D foreshortening of the upper arm
d_f = unit(W − E)        k_f = min(1, |W − E| / F)      // W = hand landmark 0 when the hand is detected, else pose wrist
S'  = avatar shoulder socket (+ breathing offset)
E'  = S' + d_u · k_u · L1
W'  = E' + d_f · k_f · L2                                // "forward kinematics" target, avatar bone lengths
```

- **Why this fixes the stretch:** a bone is never drawn longer than the avatar's own `L1`/`L2`. When the signer
  points an arm at the camera, the avatar's bone shortens by the same ratio. The direction comes from the signer, the
  length from the avatar.
- **Shoulder shrug:** the vertical shoulder offset from the clip's median shoulder height is scaled by `234.6/σ` and
  clamped to ±12 px.
- **Draw order:** pose wrist z decides which arm is drawn first (farther arm first), as in the prototype.

### Fingers

- Hand points relative to the wrist are scaled by **one constant per clip**, `s_h = P_avatar / π`.
- `P_avatar` is the avatar palm length, set to 0.45·L2 = 54 px. It gets a visual check in Task 2.
- So the hand keeps its own foreshortening, and its size does not pump frame to frame.
- The hand is drawn attached at `W'`, so the forearm and the hand always meet.

### Face region (fixes "collides with the larger head")

- **Measured proportions:** the signer's ear width is 0.43× shoulder width (297/689). The caricature head is drawn
  `HW = 184` px wide on a 234.6 px shoulder line, 0.78×. So the head is about 1.8× larger relative to the body, and a
  hand mapped in body space lands *inside* the big head.
- **Scope:** only hands near the face are remapped, and only in position.

```
C_s   = the hand landmark closest to the nose N_s (usually a fingertip)
r     = |C_s − N_s| / ε
w     = 1 − smoothstep(1.2, 2.2, r)                       // 1 at the face, 0 from 2.2 ear-widths out
R     = rotation by (avatar head roll − signer head roll)
C_f   = N_a + R · (C_s − N_s) · (ε_a / ε)                  // the contact point mapped onto the caricature face
W_f   = C_f − R · (C_s − W_s) · s_h                        // wrist placed so the hand keeps body scale
W*    = lerp(W', W_f, w)
```

- **The contact point is mapped, not the wrist.** So a fingertip that touches the chin touches the caricature's chin,
  while the hand keeps its normal size.
- **Elbow:** when `w > 0`, it is re-solved with two-bone IK from `S'` to `W*` with lengths `k_u·L1` and `k_f·L2`
  (clamped to reach). The bend side is the signer's: the sign of `cross(W−S, E−S)`.
- **The sample does not exercise this.** In `my_name_is` the closest fingertip is never nearer than **1.32 ear
  widths** to the nose (median 2.27). So the face-region test uses a face sign extracted from
  `assets/signs/en/hello.webm`. That clip is a salute from the forehead, seen in the measured Let's Talk preview.

### Head

- **Roll** comes from the ear line, and **sideways shift** from the nose relative to the ear midpoint. These are the
  prototype's `hd` values, which it also mapped outside the page.
- Both are low-passed and clamped to ±0.15 rad and ±20 px.

### Missing hands (fixes "the stiff fallback hand")

The sample's hand-detection string has short dropouts, for example `…10001111…` and `…1100110…`. The player fills them
in the forearm's local frame:

- **Gaps of 8 frames (320 ms) or less:** interpolate between the last and next detected shapes.
- **Longer gaps:** hold the nearest detected shape of this clip and ease it toward a relaxed rest shape over 300 ms.
- **A clip with no hand at all for a side:** the relaxed shape. It rotates with the forearm and gets a small wrist
  bend, not the fixed `RESTSHAPE` along the bone.

The stored data stays raw.

### Sleeve (fixes "the sleeve separating from the shoulder")

- **Shoulder cap:** after the torso and before the upper arms, draw an outlined shirt-colour ellipse (`#0B2D6B`,
  outline `#1A1A1A`) at each socket, sized to the sleeve width (62 px).
- **Pivot:** move the upper arm's pivot 0.25 sleeve-width into the torso.
- So a raised arm rotates under a continuous shoulder instead of opening a gap.

### The blend between signs (decision 5)

The timeline for keys `k1..kn` is:

```
rest →(350 ms) k1 →(250 ms) k2 →(250 ms) … kn →(400 ms) rest
```

- **No drop to rest.** A transition is new time inserted between the **last frame of one clip** and the **first frame
  of the next**, in avatar parameter space:
  - shoulder→elbow and elbow→wrist angles, interpolated along the shortest arc;
  - the foreshortening factors `k_u`, `k_f`;
  - the hand points in forearm-local coordinates;
  - head roll and shift.
  The weight is eased with smoothstep. Angles are blended rather than positions, so bones never shrink mid-blend.
- **Rest pose:** arms down along the torso with relaxed hands, defined in the rig file. Every playback starts and
  ends there.
- **Trim, so that a clip starts and ends with the hand up:**
  - A hand is "up" when its pose wrist is above `shoulderY + 0.6·(hipY − shoulderY)`.
  - Start is the first frame of the first run of at least 3 "up" frames; end is the last frame of the last such run.
  - On the sample this gives frames **31–221** (1,240–8,840 ms, 191 frames). In the raw clip the wrist is at y ≈ 0.94–0.97
    at rest and 0.61–0.70 while signing. Hands are first detected at frame 26 and last at 227.
  - The admin page shows the result as the default trim, and the trim handles override it.
- **Continuity threshold for the tests:** no drawn joint (shoulders, elbows, wrists, 2×21 hand points) moves more
  than **60 logical px between consecutive 40 ms frames** across a sign boundary.
  - This is the within-clip **p95** (59.8 px) measured on the prototype's `my_name_is` frames. For reference: median
    18.5, p99 84.6, max 133.9.
  - Plus: at blend start the pose equals the previous clip's last frame, and at blend end it equals the next clip's
    first frame (≤ 0.5 px).
  - Plus: during a blend the lower wrist never goes below the lower of the two end wrists by more than 5 px (no dip
    toward rest).

---

## (e) Module boundaries

Every module is a plain script that attaches one `window.X`. Where marked, it also sets `module.exports` under Node,
the same pattern as `js/video-landmarks.js:239-244`, so the math is unit-tested with `node --test`.

| Module (file) | Pure? | Responsibility | Used by |
|---|---|---|---|
| **Extractor** `js/avatar-extract.js` | DOM | Video `File` → raw clip frames. One Holistic instance. Seeks on the exact `k/fps` grid; it reuses `VideoLandmarks.seekTimes()` (`js/video-landmarks.js:35-42`) without changing that file. Draws each frame into a canvas of at most 720 px (long side) before `send()` (Q15). Reports progress and per-frame results for the skeleton overlay. Abortable. Also computes the auto-trim (pure helper, node-tested). | `avatar-clips.html` only |
| **Clip codec** `js/avatar-clip.js` | yes (node) | Build / validate / round a `sk_avatar_clip_v1` object; trim; per-clip calibration (`σ, U, F, ε, π`). | extractor, player, PHP tests |
| **Retarget** `js/avatar-retarget.js` | yes (node) | Clip frame + calibration + rig → avatar pose (joints, 2×21 hand points, head roll/shift, arm draw order). Face-region mapping, IK, hand gap filling. | timeline |
| **Timeline** `js/avatar-timeline.js` | yes (node) | List of (key, clip) → `duration` and `poseAt(ms)`: rest, clips, 250 ms blends, rest; word boundaries for captions. | player |
| **Rig** `js/avatar-rig.js` | yes (node) | Part sizes, sockets, face anchors, `L1/L2`, rest pose, colours. Measured from the PNGs in Task 2. | retarget, renderer |
| **Renderer** `js/avatar-renderer.js` | canvas | Draws one avatar pose: shaded parts (cached once), shoulder caps, limbs, code-drawn hands, blink, breathing, shadows. Tiers `full` / `lite` / `flat` (`lite` makes the hand shadow from a quarter-size offscreen layer with no `ctx.filter`). Also a `skeleton` overlay for the admin page. | player, admin preview |
| **Clip store** `js/avatar-store.js` | DOM | Which keys have clips (from `signs.php`'s `avatar` flag); `get(key)` fetches `saved_gestures/<key>/avatar.json` on demand into a small LRU cache (12 clips); preloads the four PNGs. | player |
| **Player** `js/avatar-player.js` | DOM | `create({canvas, onWord, onStart, onEnd})` → `play(keys)` / `cancel()` / `isPlaying()`. rAF loop capped at 30 fps. Automatic tier step-down. Calls `onStart` (the page pauses hand tracking) and `onEnd` (the page resumes it if it was running). | `js/sign-player.js` (talk.html), admin preview |
| **Server** `php/api/avatar_clip.php` | PHP | POST `{action:'save', key, clip}`: the key must be an existing sign (`saved_gestures/<key>/sign.json`); validates format, frame count (≤ 500 = 20 s) and size (≤ 1 MB); writes `avatar.json` through a temp file + rename. POST `{action:'delete', key}` unlinks `avatar.json` only. No auth (decision 8, DEBT 72). | admin page |
| `php/api/signs.php` (changed) | PHP | GET adds `avatar: bool` per sign. | dataset table, clip store |

### The kiosk's load budget (decision 10)

- **At page load:** the four PNGs, 450,910 bytes in total (`parts_v2`). They are not added to the `TalkLoader`
  queue, so a failed PNG never gates "Getting ready…"; the words just fall back to video (Q16). The avatar scripts
  are about 6 new small files.
- **At Translate:** the clips the sentence needs, in parallel. The player starts once all the clips of the first run
  are in, or after 1,500 ms. A clip that fails to load makes its word fall back to video.
- **Never on the kiosk:** Holistic.

### Hand tracking during playback (decision 10)

`talk.html` passes these hooks to the player:

- `onStart`: `GestureDataRecorder.pauseHandLoop()`. It is idempotent (`js/gesture-data.js:434-441`).
- `onEnd`: `resumeHandLoop()`, only if `body[data-screen] === 'signing'`. That never happens today: the signing screen
  has already called `pauseHandLoop()` and stopped the camera on leave (`js/talk-signing.js:315-336`).

`js/gesture-data.js` is not changed (Q7).

---

## (f) The admin page and the Let's Talk panel at 1024×600

### Train Gestures, Step 1 (measured today)

- The right column has "Record 3 samples" (528,68 472×72), then **"View Active Gesture Dataset"** (528,154
  472×56), "Export / Load" (y=238) and "Next: Train AI" (y=300).
- **Proposal:** split the dataset row into `[📁 View Active Gesture Dataset · 122 gestures › | 🧍 Avatar clips ›]`,
  about 300 + 12 + 160 px, both 56 px tall. Nothing else moves.
- "Avatar clips" opens `avatar-clips.html`.
- **The dataset modal** (card 32,48 960×504; columns English text | Filipino text | Set | Samples | Edit | Delete)
  gets an **Avatar** column (✓ or —) between Samples and Edit. Text columns shrink by about 40 px each. Rows stay at
  least 44 px.

### `avatar-clips.html`

- **PIN:** the same pad and PIN as Train Gestures (`js/gesture-training-ui.js:23`). It is skipped when opened from the
  Train Gestures button in the same tab session (Q6).
- **Layout:** the gesture-training header bar (`← Train Gestures` back button, title "Avatar clips"), then two 472-px
  columns:

```
┌ ← Train Gestures                Avatar clips                                         ┐ 0–50
│ ┌ LEFT 472 ───────────────────────┐  ┌ RIGHT 472 ───────────────────────────────────┐ │
│ │ [Search signs…            ]     │  │                                              │ │
│ │ ┌ list (scroll) ─────────────┐  │  │   stage canvas 472×340                       │ │
│ │ │ My name        ESL     ✓   │  │  │   • while extracting: video frame +          │ │
│ │ │ How are you    Both    —   │  │  │     skeleton (pose cyan, hands red/green)    │ │
│ │ │ …   rows ≥ 44 px           │  │  │   • after: [Video+skeleton | Avatar] toggle   │ │
│ │ └────────────────────────────┘  │  │                                              │ │
│ │ Selected: "My name" (ESL)       │  ├──────────────────────────────────────────────┤ │
│ │ [ Choose video… ]  (file input) │  │ trim strip 472×56: ◀handle ████████ handle▶  │ │
│ │ Signer: [            ]          │  │ 1.24 s – 8.84 s (auto)   [▶ Preview]          │ │
│ │ ▓▓▓▓▓▓▓░░ 141 / 256 frames      │  ├──────────────────────────────────────────────┤ │
│ │ status line                     │  │ [ Delete ]   [ Redo ]   [   Save   (orange) ] │ │
│ └─────────────────────────────────┘  └──────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

- **Choose video** reads the file through `URL.createObjectURL`. The file never leaves the browser.
- **Extraction** starts on choice and shows progress plus the skeleton overlay. On this laptop it takes about 6.4× the
  video's length (measured above), so the bar matters.
- **Trim** handles are at least 44 px wide.
- **Preview** plays the trimmed clip on the avatar with the same renderer and timeline as the kiosk (rest → clip →
  rest).
- **Save** posts the clip JSON only.
- **Redo** discards the extraction and asks for a video again.
- **Delete** (with a confirm) removes the saved clip for that sign.
- **Nothing else:** no category or text editing here. Texts stay in the dataset view.

### Let's Talk, Speak or Type preview (measured today)

- **Layout:** frame (232,154) 560×260, word label y=422, `[Edit | Send]` (232,472) 560×64. On turn 2+ the preview
  must fit in y=186…600 (`docs/system/UI.md` 3b). So the frame cannot grow by more than about 20 px without breaking
  turn 2+.
- **Proposal:** keep the frame at **560×260** and change no layout (Q5).
- **The avatar canvas fills the frame at 560×260.** Its logical view is the signing space, from the head top to the
  waist (about 500 logical px tall), scaled about 0.52.
- **Background:** the avatar paints its own light background inside the frame. On the `--navy` frame the shirt
  colour `#0B2D6B` would almost disappear.
- **Pixel count:** 145,600 pixels per frame, against the 614,400 of the prototype's 1024×600 canvas (4.2× fewer), so
  every tier gets cheaper.
- **Unchanged:** the word label shows the current sign's text in upper case, as video does today; Edit, Send and
  leaving the screen cancel playback; no new buttons.

---

## (g) Files, tasks, open questions

### Files

| New | Purpose |
|---|---|
| `js/lib/holistic/` (9 files, 36,871,967 bytes) | Vendored Holistic 0.5.1675471629 |
| `assets/avatar/head.png`, `torso.png`, `upper_arm.png`, `forearm.png` (450,910 bytes) | The four parts from `parts_v2` (`ava.png` is not copied: reference only) |
| `js/avatar-rig.js`, `js/avatar-clip.js`, `js/avatar-retarget.js`, `js/avatar-timeline.js` | Pure modules (node-tested) |
| `js/avatar-renderer.js`, `js/avatar-store.js`, `js/avatar-player.js` | Kiosk player |
| `js/avatar-extract.js`, `js/avatar-clips-ui.js`, `avatar-clips.html`, `css/avatar-clips.css` | Admin page |
| `php/api/avatar_clip.php` | Save / delete a clip |
| `tests/avatar/*.test.mjs` | Unit: clip codec, trim, retarget, timeline (continuity, rest ends, missing clip), endpoint |
| `tests/avatar/holistic-offline-check.mjs`, `admin-check.mjs`, `talk-avatar-check.mjs` | CDP checks (offline extraction, Let's Talk, hand-loop pause, 1024×600, screenshots) |
| `tests/avatar/bench.html`, `tests/avatar/pi-bench.sh` | Frame-rate bench for this laptop and for the owner to run on the Pi |

| Changed | Change |
|---|---|
| `js/sign-player.js` | Text → key maps for signs with clips; `playSequence` splits runs (avatar or existing chain); `cancel()` also stops the avatar. The VERBATIM sections and the existing chain are unchanged. |
| `talk.html` | Avatar scripts; canvas in `#speaking-sign-frame`; PNG preload; `onStart`/`onEnd` hand-loop hooks. |
| `php/api/signs.php` | GET adds `avatar`. |
| `gesture-training.html`, `css/gesture-training.css`, `js/gesture-training-ui.js` | "Avatar clips" button; Avatar column in the dataset table; session flag for the PIN (Q6). |
| `docs/system/UI.md`, `DECISIONS.md`, `BACKEND.md`, `VENDORED.md`, `INVENTORY.md`, `HARDWARE_BOOT.md` (bench), `DEBT.md` | Docs commit |

**Not touched:** `knnPredict`, `cosineSimilarity`, `trainModel`, the capture flow (`js/capture-core.js`,
`js/gesture-capture-ui.js` capture states, `js/video-landmarks.js`, `js/gesture-data.js`), the sample formats, the
existing `sign.json` fields, sign-to-text in Let's Talk (`js/talk-signing.js`, `js/sign-to-text-ui.js`),
`archive/**`, your uncommitted `docs/revision/MEMORY.md` and `docs/system/MANUAL-CHECKS.md`.

### Tasks

Each task gets one implementer and a task review (at most 3 rounds, then escalate to you). After the last task there
is a whole-phase review.

| # | Task | Done when |
|---|---|---|
| 0 | Baseline + backup | `mysqldump --single-transaction` to `E:\ACADSS\IOT\backups\2026-10-05-avatar\` (size recorded). Full test suite run and counts recorded (last phase: 188 / 187 pass / 0 fail / 1 skip). |
| 1 | Vendor Holistic | 9 files in `js/lib/holistic/` with byte sizes and sha256 matching the verified tarball. `holistic-offline-check.mjs`: internet fetch blocked, all requests to localhost, `initialize()` resolves, a 25-frame run gives pose on every frame, 0 console errors. `VENDORED.md` entry. |
| 2 | Rig + assets | The four PNGs in `assets/avatar/`. `avatar-rig.js` constants measured from alpha (sockets, neck, nose/eyes/ears, `L1/L2`, palm). The rest pose renders. A screenshot of rest + 4 test poses for your visual check. |
| 3 | Clip codec, retarget, timeline (pure) | Node tests pass for: bone lengths ≤ `L1`/`L2` on every frame of the sample (no stretch); face mapping keeps a fingertip contact within 3 px; gap fill (≤ 8-frame gaps interpolated, no fixed `RESTSHAPE`); auto-trim = 31–221 on the sample; blend continuity (≤ 60 px per 40 ms across every boundary, end/start equality ≤ 0.5 px, no dip); rest pose exactly at t=0 and t=duration; a key with no clip is reported as a fallback item. |
| 4 | Renderer + player + store | `bench.html` plays the sample timeline in each tier at 560×260 and reports fps (median, p5) and tick ms on this laptop, with GPU and with `--disable-gpu`. Tier step-down happens when the measured rate is under 20 fps. Sleeve cap visible in a raised-arm screenshot. LRU cache holds at most 12 clips. |
| 5 | Server | `avatar_clip.php` + the `signs.php` flag. Node tests: save requires an existing sign; rejects bad format, more than 500 frames and over 1 MB; writes atomically; delete removes only `avatar.json`; `sign.json` and samples byte-identical before and after save and delete; `delete_gesture` still removes the whole folder; the full sync ignores `avatar.json`. `signs.php` GET timed before and after. |
| 6 | Admin page | `avatar-clips.html` at 1024×600 with no page scroll, controls ≥ 44 px, PIN gate, button + Avatar column in Train Gestures. `admin-check.mjs`, network blocked except localhost: extracts `my_name_is.mp4` into a zz probe sign; clip saved; no request body larger than the clip JSON, and none with video bytes; no video file written anywhere under the repo or `C:\xampp\htdocs` (file scan before/after); screenshot. |
| 7 | Let's Talk | `talk-avatar-check.mjs` with 3 zz probe signs whose clips are extracted at run time from `assets/signs/en/*.webm` (not committed): **(1)** a 3-sign sentence plays as one avatar run (0 `<video>` created, captions in order, continuity metric logged); **(2)** a mixed sentence plays avatar then video; **(3)** `Hands.send` count is 0 during playback and the loop state is the same after as before; **(4)** 0 console errors and `scrollWidth` 1024 at 1024×600; **(5)** Holistic never requested by `talk.html`; **(6)** screenshot. The earlier checks (`talk-check.mjs`, `verify-e2e.mjs` part 8) still pass. |
| 8 | Verification + docs | All "Verify at the end" items measured; `pi-bench.sh` written; docs updated; DEBT items for anything left open; zz probes removed; `avatar-probe` folder deleted. Final report `docs/reports/2026-10-05-avatar-final.md`. |

**Commits:** code (Tasks 2–7), assets (`js/lib/holistic/` + `assets/avatar/`), docs (this report, the final report,
`docs/system/*`). No clip is committed. Nothing pushed or merged.

### Open questions (recommended default first)

| Q | Question | Recommended default |
|---|---|---|
| 1 | Vendor the non-SIMD Holistic wasm pair too (+6,676,479 bytes)? | **Yes.** Same as Hands (`VENDORED.md`). Extraction then works in a browser without WASM SIMD. |
| 2 | Where is "has an avatar clip" recorded? | **Disk only**: `saved_gestures/<key>/avatar.json`, reported by `signs.php` as `avatar: bool`. No schema change. |
| 3 | Deleting a sign in View Active Gesture Dataset: delete its clip too? | **Yes.** The folder goes, and today's code already deletes every `*.json` in it (`save_gesture.php:387`). Recording more samples, or editing set/texts, never touches the clip. |
| 4 | Store raw landmarks (retarget at play time) at 25 fps, 3 decimals? | **Yes.** About 800 B/frame; the retargeting can improve without re-extracting. |
| 5 | Panel size in Let's Talk | **Keep 560×260**, with the avatar's own light background inside the navy frame. Turn 2+ leaves no room to grow. |
| 6 | PIN on `avatar-clips.html` | Same PIN pad. Skipped if Train Gestures was unlocked in the same tab session (a `sessionStorage` flag set at unlock); a direct URL asks for the PIN. |
| 7 | How to pause hand tracking | Hooks in `talk.html` that call the existing `pauseHandLoop()`/`resumeHandLoop()`; resume only if the signing screen is showing. No change to `js/gesture-data.js`. |
| 8 | Record the signer's name in each clip? | **Yes, optional** free text, remembered in `localStorage` on the admin page. It costs nothing now and lets the later bulk import check "one signer". |
| 9 | Transition timings | Rest→first 350 ms, between signs 250 ms, last→rest 400 ms, smoothstep easing. |
| 10 | A sentence that goes avatar → video → avatar | The avatar returns to rest (400 ms) and hides, the video plays as today, then the avatar comes back from rest. |
| 11 | Quality tiers | Auto: start `full`, step down to `lite` then `flat` when under 20 fps over 1 s; the chosen tier is remembered in `localStorage`; `?avatarTier=` overrides it. |
| 12 | Test clips | **None shipped.** Checks build zz probe signs with clips extracted at run time from `assets/signs/en/*.webm`, and delete them after. The offline admin check reads `my_name_is.mp4` from `C:\Users\ADMIN\Downloads\Avatar\` and is skipped if it is absent. |
| 13 | Use avatar clips for fingerspelled letters? | **No.** Fingerspelling a word with no sign is out of scope; it stays video. |
| 14 | Blend threshold for the test | 60 logical px per 40 ms frame (the sample's within-clip p95), plus end/start equality and no dip. |
| 15 | Extraction input | Draw each video frame into a canvas of at most 720 px (long side) before `send()`, like `gesture-data.js` sends a canvas rather than the video. Task 1 re-measures agreement with the full-resolution run. |
| 16 | Preload the PNGs through the `TalkLoader` queue? | **No.** A separate non-gating preload at page load; a failure only means video fallback. |

STOP — waiting for approval.
