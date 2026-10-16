Phase: fast Python extractor for the bulk importer (py-extractor)
Date: 2026-10-16
Status: DONE
Decision needed from owner: none to finish. Run the OWNER CHECKLIST (section 5) and send back the parity output. On the synthetic test folder here parity was FAIL on the rep-count rule (6 of 7 videos), caused by one artificial tiny-hand video; real videos decide.

# Fast Python extractor for the bulk importer — report

Branch `py-extractor`, made from `bulk-reps-fix`. Two commits: code, then docs. Nothing merged; nothing pushed to
`revision` or `main`. No video, no cache and no `saved_gestures` data committed.

**What was run here** (a cloud container: Linux, 4 cores, no laptop, no XAMPP, no MySQL, no real videos):

- MediaPipe 0.10.21 installed in a Python 3.12.3 venv with the pinned `requirements.txt` (the owner has 3.12.13).
- A synthetic test folder built with ffmpeg from the repo's own sign clips (`assets/signs/en`: real hands), 3
  repetitions with 1 s of black between them: 7 WebM and 2 MP4 videos, landscape and portrait, one 2-rep video,
  copies in `unzipping/` and `_duplicates_old/`, a bad name and a `desktop.ini`. Never committed.
- The real `bulk-import.html` in headless Chromium (Playwright's build), served by `php -S` so the real
  `php/api/bulk_import.php` wrote the cache. Folder and Extract steps only: Review, Import and Compile need MySQL.

## 1. What changed

| File | Change |
|---|---|
| `tools/py_extract/extract.py` (new) | The command. Scans the folder with the page's rules, skips videos already cached, runs one video per worker process (`--workers`, default CPU cores - 1), writes `hands.json` then `meta.json` (temp file + rename, as `bulk_import.php` does), one progress line per video with elapsed time, ETA and videos per minute. Options: `--cache`, `--force`, `--limit`, `--list`. A failing video is listed and the run goes on. |
| `tools/py_extract/skcore.py` (new) | The page's rules in Python, standard library only: file names, junk names, skipped folders, cache id, frame grid, letterbox, JS rounding, the cache entry and its carry-over from an older meta. |
| `tools/py_extract/parity.py`, `parity_node.mjs` (new) | Browser vs python comparison (decision 7). Node runs the page's own `recordingToFeatureRows()` and `BulkRepSplit.splitReps()`. |
| `tools/py_extract/test_skcore.py`, `js_ref.mjs` (new) | 13 tests: the same inputs through `skcore.py` and through the page's JavaScript must give the same answers. |
| `tools/py_extract/requirements.txt`, `README.md` (new) | The pinned packages; install, run, parity and test commands. |
| `js/bulk-import-core.js` | `skipFolder(relPath)` (`:52`) and `cacheSource(meta)` (`:64`). |
| `js/bulk-import-ui.js` | Skips `unzipping` / `_duplicates*` sub-folders (`:322`). `meta.source` written on the page's own Hands pass and kept on a re-split (`buildMeta()` `:882`). Python entries: own status texts (`notSplitYet()` `:589`), Review text "not split yet" (`:1623`), "done (split from the cache)" (`:956`). New Source column (`:654`, `:678`). The ETA counts the Holistic pass of a python entry of an avatar signer (`:1043`). |
| `bulk-import.html`, `css/bulk-import.css` | Source column header and style; cache-bust `?v=1.0.7`. |
| `tests/bulk-import/core.test.mjs` | 3 tests for `skipFolder`, `cacheSource`, and `cacheState` on a python entry. |
| `.gitignore` | `__pycache__/`. |

**Not changed:** the split (`js/bulk-rep-split.js`), Review and Import behaviour, `save_gesture.php` and the sample
format, the compile rule and the model files, live capture, `knnPredict`, `cosineSimilarity`,
`recordingToFeatureRows`, `php/api/bulk_import.php`, `archive/**`, `docs/revision/MEMORY.md`,
`docs/system/MANUAL-CHECKS.md`.

### How each owner decision is covered

1. **Python only extracts.** The tool writes `hands.json` (`{id, v: 2, meta, frames: every frame, source}`) and
   `meta.json` with `split: null` and `reps: []`. `BulkImportCore.cacheState()` reads that as `resplit`, so the
   page's **Start** splits it from the cached frames with its own splitter (no video read) and writes the meta
   back. One splitter, one normalisation. The cache id is the page's (section 2, row "identity").
2. **Same input.** Section 2.
3. **Speed, resume, progress.** One video per worker process; videos already in the cache (format 2 with a hands
   file) are skipped, so Ctrl+C and a rerun carry on. A format-1 entry (the first importer) is extracted again, as
   the page would, keeping `imported`, `legacyReps` and the avatar candidate by the page's own rule.
4. **Avatar stays in the browser.** A python entry of a ticked avatar signer reads "already extracted (python):
   Start splits it from the cache, then makes the avatar clip"; Start runs the split and then only the Holistic
   pass on the best repetition (section 3b). This path already existed in `processVideo()`; the ETA now counts it.
5. **Source.** `meta.source` = `"python mediapipe 0.10.21"` (plus `meta.extractor`: versions, options, where the
   duration came from). The page writes `"browser mediapipe hands 0.4.1675469240"` for its own pass and keeps the
   source on a re-split. New **Source** column; the count line says "(K by python)".
6. **File names.** The page's `parseName()`, junk names and duplicate rule, compared character for character with
   the JavaScript (section 3c). `unzipping` and `_duplicates*` sub-folders: **the page did not skip them before**;
   it does now, with the same rule (`BulkImportCore.skipFolder`), so both list the same videos. Problem names are
   printed, never guessed.
7. **Parity tool.** `tools/py_extract/parity.py` (section 3a).
8. **Windows, offline.** Pinned to the owner's versions. Nothing is downloaded at run time (the MediaPipe models
   ship inside the wheel). Not run on Windows (section 4).
9. **Videos** are only opened for reading. The tool writes only under the cache folder.

## 2. Matched settings (decision 2)

| Setting | Page (source) | Python tool |
|---|---|---|
| Sampling rate | `PROCESS_FPS: 15` (`js/capture-core.js:16`), passed by `handsPass()` (`js/bulk-import-ui.js:784`) | `PROCESS_FPS = 15` (`skcore.py:134`) |
| Which frames | `seekTimes()`: t = k / 15 s for k in [0, ceil(duration x 15)) (`js/video-landmarks.js:35`); a seek to t shows the frame on screen at t | the same grid (`skcore.seek_times`, tested equal); for each t the last decoded frame whose timestamp is <= t (+ 0.001 ms); grid times after the last frame use the last frame |
| Frame time stored | `t: Math.round(k * 1000 / fps)` (`js/video-landmarks.js:214`) | the same, with JS `Math.round` (`skcore.js_round`, tested equal) |
| Duration | `video.duration` | the file header: MP4/MOV `moov/mvhd`, WebM/MKV Segment Info Duration; else OpenCV frame count / fps (`extract.py` `container_duration()`). On 7 WebM videos the frame counts equalled the page's on every video. |
| Input picture | 320 x 240 canvas, black, video drawn into `letterboxRect()` (`js/video-landmarks.js:115`, `js/gesture-data.js:59`) | the same rectangle (tested equal on 11 sizes); drawn with bilinear sampling of pixel centres (`cv2.warpAffine`, `INTER_LINEAR`), canvas `drawImage`'s default; RGB |
| Rotation | the browser shows a rotated phone video upright | `CAP_PROP_ORIENTATION_AUTO` on; width/height taken from the decoded frame |
| MediaPipe Hands options | `maxNumHands: 2, modelComplexity: 1, minDetectionConfidence: 0.65, minTrackingConfidence: 0.65` (`js/gesture-data.js:247-252`), video mode (tracking), `selfieMode` not set (false) | `Hands(static_image_mode=False, max_num_hands=2, model_complexity=1, min_detection_confidence=0.65, min_tracking_confidence=0.65)` (`extract.py:31`) |
| Tracking reset | `detector.reset()` before each video (`js/video-landmarks.js`) | `hands.reset()` before each video; one Hands per worker |
| Handedness / mirroring | the picture is not mirrored; `label` and `score` from `multiHandedness` | the picture is not mirrored; `label` and `score` from `multi_handedness[i].classification[0]` — the same convention (the label assumes a mirrored camera in both builds). Matched labels on the test videos (section 3a). |
| Stored landmarks | raw image-space `{x, y, z}` of the 21 points, fractions of the 320 x 240 picture, rounded to 4 decimals; score to 3 (`js/video-landmarks.js:201-210`) | the same rounding (JS halves-up; a whole value written as `0`, not `0.0`) |
| Hand order | as MediaPipe lists them | as MediaPipe lists them (may differ in 2-hand frames: DEBT 149) |
| Cache identity | first 32 hex of SHA-256 of `name|size|lastModified` (`videoIdSource()`, `sha32()`) | the same; `lastModified` = modified time in whole ms, rounded down. Chromium here gave `...123` for a file modified at `.123456789` s, and the page's ids equalled the tool's on all 9 videos. |
| MediaPipe build | JS Hands 0.4.1675469240 (vendored, `docs/system/VENDORED.md`) | Python mediapipe 0.10.21 (`mp.solutions.hands`): **a different build**; the models may differ, which is what parity measures |

## 3. Verification (measured in this container)

### 3a. Parity: the page vs the tool on the same 7 WebM videos

The page extracted the folder in headless Chromium; the tool extracted it into a second cache folder;
`parity.py --browser <page cache> --python <tool cache> --folder <folder>`:

```
video                                 frames  hand det   hands n   lm diff    order     reps  split max  result
---------------------------------------------------------------------------------------------------------------
letters/ESL_a_P03.webm                   147     99.3%     99.3%    0.0064      0/3      3/3          2  ok
letters/ESL_good_morning_P02.webm        228     94.3%     94.3%    0.1574        —    2?/1?          —  DIFF hands,reps
letters/ESL_hello_P01.webm               150    100.0%    100.0%    0.0029      0/3      3/3          0  ok
letters/ESL_help_P01.webm                135    100.0%     99.3%    0.0063     0/31    2?/2?          0  ok
letters/sub/ESL_name_P02.webm            156    100.0%     98.1%    0.0085    67/67      3/3          0  ok
letters/ESL_two_reps_P01.webm            105    100.0%    100.0%    0.0022      0/2    2?/2?          0  ok
letters/FSL_thank_you_P03.webm           168     99.4%     99.4%    0.0036        —      3/3          0  ok

Videos compared: 7; frames compared: 1089.
Hand detected agreement:  98.62 %   (need >= 97 %)  ok
Hands count agreement:    98.26 %   (shown only)
Mean landmark difference: 0.00744   over 358 frames with the same hands count, after the system normalisation, hands matched (shown only)
  ... as is (hand order as stored): 0.06828; 2-hand frames with the hands in the other order: 67 of 106 (shown only)
Same rep count:           85.7 %   (6 of 7 videos; need >= 95 %)  FAIL
Split points within 2 frames: 6 of 6 videos with the same rep count  ok
Work per second of video (one video at a time, from meta.hands.ms): browser 8.76 s, python 0.36 s per worker

FAIL
```

What this says:

- **The one failing video is artificial.** `ESL_good_morning_P02.webm` is a 360x202 clip padded into a 720x1280
  portrait frame, then pillarboxed into 135x240 pixels of the input: the hand is a few pixels wide. Both builds
  scored it near the 0.65 threshold (browser scores 0.55–0.65 on the frames that differ) and only 12 frames of 228
  had a hand. Both called it a problem row ("2 ?" / "1 ?"). Real phone videos have far larger hands; real videos
  decide (checklist step 2).
- **Frame counts** equal on all 7 (an earlier version of the tool took the WebM duration from the decoded frames
  and had one frame more on 6 videos; fixed by reading the header).
- **Landmarks** agree closely: mean feature difference 0.0074 with the hands matched, against a mean feature size of
  0.311 (non-zero features of the page's own frames).
- **Hand order** (DEBT 149): on `ESL_name_P02` the tool found both hands in frame 20, the page found the second one
  in frame 21, and from then on each build kept its own order: all 67 two-hand frames have hand 1 and hand 2
  swapped. It changes which half of the 126 features a hand fills. Live capture has the same arbitrary order; this
  phase does not change `knnPredict`. `parity.py` counts it ("order") but does not judge it.
- An alternative picture filter (`--resample area`, hidden option) gave 98.81 % hand agreement and the same rep
  failure: the bilinear default stays.
- The 2 MP4 videos could not be compared: Playwright's Chromium cannot decode H.264 (the page's own Hands pass
  failed on them with "video error while waiting for loadedmetadata"). Real Chrome on the laptop decodes them.

### 3b. The page with python entries (decisions 1, 4, 5, 6)

The tool's cache for all 9 videos was put where the page reads it; avatar signers = `["P03"]`; Start:

| Check | Result |
|---|---|
| Folder line | "letters · 13 files (1 ignored) (2 in unzipping / _duplicates folders, skipped)"; problem: `hello_final.webm` "bad file name" |
| Before Start | "9 videos · 9 extracted (9 by python)"; every row "already extracted (python): Start splits it from the cache", the 3 P03 rows "…, then makes the avatar clip"; Source column "python mediapipe 0.10.21" |
| Start | "Finished: 0 extracted, 8 split again from the cache, …, 1 failed". The 2 MP4 videos were split although this Chromium cannot open them: **no video was read for the split**. Requests: 9 `GET ?action=hands`, metas written back with `put_video`; every `hands.json` byte-identical afterwards (sha1). |
| Avatar step | P03 WebM videos: Holistic only, candidates 39 and 37 frames, written under `candidates/<key>/P03.json`. P03 MP4: "avatar clip failed: This video cannot be read by the browser (recognition data kept)" (the codec, see above). P01/P02: no Holistic. |
| After Start | meta: `split.version 1`, reps found, `source` still "python mediapipe 0.10.21", `savedAt` kept. Reloaded and the folder chosen again: "already extracted (python)" on every row. |
| Console | 0 errors apart from a 404 for `/favicon.ico` (php -S serves no favicon). Every request went to 127.0.0.1. |

Not run: Review, Import and Compile (they need MySQL). The Review text "not split yet" is a string branch, untested
in a browser.

### 3c. Tests

| Suite | Result |
|---|---|
| `python -m unittest tools/py_extract/test_skcore.py` | 13 tests OK. Compared with the page's JavaScript through node: `parseName` on 49 names (cases, Unicode, white space, line breaks, emoji, the Kelvin sign), `cleanLabel` on 10, junk names on 13, `skipFolder` on 13 paths, the cache id on 4, `letterboxRect` on 11 sizes, `seekTimes` on 8, `Math.round` on 10 (the first version used `floor(x + 0.5)`, which is 1 for 0.49999999999999994 where `Math.round` gives 0: fixed). Plus folder scan, carry-over, cache state and atomic write. |
| `node --test tests/bulk-import/core.test.mjs tests/bulk-import/rep-split.test.mjs` | 77 tests, 77 pass (74 before + 3 new). |
| All node tests (`tests/*/*.test.mjs`) | The only failures are the PHP endpoint suites `tests/avatar/avatar-clip-endpoint.test.mjs`, `tests/bulk-import/cache-endpoint.test.mjs`, `tests/bulk-import/save-import.test.mjs`: their helper needs `php-cgi`, which this container lacks (the same failures the bulk-reps-fix report lists). |
| Resume | A second run on the same folder: "9 already extracted (skipped), 0 to extract". |
| Old entry | A format-1 meta for one video: extracted again; `imported`, `legacyReps` (from the old reps) and the candidate (old `seg.ok` and candidate ok) carried over; `savedAt` new, as `buildMeta()` does. |
| Same result twice | Two runs of the tool on the same folder: every `hands.json` byte-identical. |
| Other containers | an AVI (MJPEG) and an MKV (VP9): 150 frames each, duration 10,000 ms, from OpenCV's frame count and from the Segment Info. |

### 3d. Speed here (not the laptop)

| | Videos | Video length | Time | Videos per minute |
|---|---|---|---|---|
| Page, headless Chromium, one at a time | 7 | 72.6 s | 636 s of Hands work (`meta.hands.ms`) | 0.66 |
| Tool, 3 workers on 4 cores | 9 | 91.6 s | 13.9 s wall | 38.8 |

This container's headless Chromium was 8.76 s per second of video, far slower than the 1.1–1.2 measured on the
laptop (`docs/reports/2026-10-13-bulk-import-final.md` section 3); the tool was 0.36 s per second of video per
worker. Neither number is the laptop's: checklist step 4 measures it.

## 4. What I could not run

- **Windows, the owner's venv and real videos.** Not available here. Python 3.12.3 on Linux was used, with the same
  pinned packages. `multiprocessing` uses `spawn` (Windows' only mode) in both places.
- **MP4 in a browser.** Playwright's Chromium has no H.264; the MP4 path of the tool (the `mvhd` duration) was
  checked only against ffprobe (10.000 s and 9.000 s, the tool's values).
- **`File.lastModified` on Windows.** Rounded down on Linux Chromium (measured). If Windows Chrome differed, the
  page would show python entries as not extracted and `parity.py` would print `ID MISMATCH` with both values
  (DEBT 147).
- **Review, Import, Compile** with python entries (no MySQL). They read only the split meta, which the page itself
  writes.
- **Non-ASCII paths** with OpenCV on Windows (DEBT 150).

## 5. OWNER CHECKLIST (laptop)

Before you start: `git fetch origin` and `git checkout py-extractor` in the repo (`C:\xampp\htdocs\SKR` points at
it). XAMPP Apache and MySQL running. Leave the laptop idle and plugged in. Open a Command Prompt in the repo folder.

1. **Install check**
   ```
   E:\ACADSS\IOT\mp_env\Scripts\activate
   python --version
   uv pip install -r tools\py_extract\requirements.txt
   python -c "import mediapipe as mp, cv2; print(mp.__version__, cv2.__version__, mp.solutions.hands.Hands)"
   python -m unittest tools\py_extract\test_skcore.py -v
   ```
   Expect `Python 3.12.13`, then `0.10.21 4.x.x <class ...Hands>`, then 13 tests OK (they need `node` on the PATH;
   without it 8 are skipped).
2. **Parity run** on `E:\ACADSS\IOT\SK_DATASETS\P01_Rhaiza\ESL\letters`
   - If the page has not extracted this folder since bulk-reps-fix: open `http://localhost/SKR/bulk-import.html`
     (Ctrl+F5 once), choose the folder, press Start, wait for "Finished". Otherwise its cache is used as it is.
   - Extract the same folder with Python into a SECOND cache folder (not the page's):
     ```
     python tools\py_extract\extract.py "E:\ACADSS\IOT\SK_DATASETS\P01_Rhaiza\ESL\letters" --cache E:\ACADSS\IOT\py_cache_parity
     ```
   - Compare:
     ```
     python tools\py_extract\parity.py --browser bulk_import_cache --python E:\ACADSS\IOT\py_cache_parity --folder "E:\ACADSS\IOT\SK_DATASETS\P01_Rhaiza\ESL\letters" > parity-P01.txt
     ```
   - **Send `parity-P01.txt`** (and the last lines of the extract run). If it prints `ID MISMATCH` or `NOT IN BOTH`,
     send that too.
3. **If PASS:** fill the real cache for P05 and P06 (default cache, the page's):
   ```
   python tools\py_extract\extract.py "E:\ACADSS\IOT\SK_DATASETS\P05_Lhorwin"
   python tools\py_extract\extract.py "E:\ACADSS\IOT\SK_DATASETS\P06_Schenly"
   ```
   - Check the PROBLEM lines it prints first (bad names are listed, never guessed).
   - Open `bulk-import.html`, choose `P05_Lhorwin`: the Extract table should read **"already extracted (python)…"**
     with Source "python mediapipe 0.10.21", and the folder line counts the skipped `unzipping` / `_duplicates`
     files.
   - Tick the signers (P05 for recognition; P03 stays your default avatar signer). Press **Start**: the python
     rows are split from the cache in moments; only avatar signers' videos take time (Holistic).
   - **Review**, **Import**, then **Compile** ESL and FSL on Train Gestures (Step 2), as after any import.
   - Repeat for `P06_Schenly`.
   - If FAIL: do not use the Python entries for P05/P06; send the parity output first.
4. **Timing.** From the extract run's last line: "N videos per minute". For the browser, the page's Extract step shows
   "s per video s"; or time one folder by hand. Send both: videos per minute, browser vs python, and how many
   workers (`--workers`) the run used.

**Send back:** `parity-P01.txt`; the P05 / P06 extract summaries (problems, failed videos); any red message or console
error on the page; the timing of step 4.

## 6. Files

- **New:** `tools/py_extract/` (`extract.py`, `skcore.py`, `parity.py`, `parity_node.mjs`, `js_ref.mjs`,
  `test_skcore.py`, `requirements.txt`, `README.md`).
- **Changed:** `js/bulk-import-core.js`, `js/bulk-import-ui.js`, `bulk-import.html`, `css/bulk-import.css`,
  `tests/bulk-import/core.test.mjs`, `.gitignore`.
- **Docs:** `CLAUDE.md`, `docs/system/BACKEND.md`, `UI.md`, `DECISIONS.md`, `INVENTORY.md`, `DEBT.md` (146–150), this
  report.
