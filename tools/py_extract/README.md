# tools/py_extract — fast Hands and avatar passes for the bulk importer

`bulk-import.html` reads each video in the browser at about 1.1x its length, one video at a time.
This tool does the same Hands pass with OpenCV + MediaPipe in Python, several videos at once, and
writes the page's own cache entries (`bulk_import_cache/videos/<id>.meta.json` + `<id>.hands.json`,
format version 2). The page then lists those videos as **already extracted (python)**; its **Start**
only splits them from the cache (no video is read) and, for the avatar signers, runs the Holistic
pass on the best repetition. Review, Import, Compile and the avatar stay in the page.

With `--avatar-signers` (py-avatar phase) the tool also makes those signers' **avatar candidates**:
MediaPipe Holistic on each video's best repetition, written exactly where and how the page writes its
own (`bulk_import_cache/candidates/<key>/<SIGNER>.json` + `.info.json`, and `meta.candidate`). The page
then has only Step 5 (Apply / pick) left for them. It reads HEVC (iPhone) videos, which the browser
cannot. The split, the best-rep rule, the frame packing, auto-trim and the clip format are the page's
own JavaScript, run with **node** (`avatar_node.mjs`), so node must be on the PATH for this pass.

Laptop only (Windows). Offline after the install. Videos are only read: never changed, moved,
copied or uploaded. Nothing outside the cache folder is written.

Report: `docs/reports/2026-10-16-py-extractor.md` (matched settings, owner checklist).

## Install (once)

The environment `E:\ACADSS\IOT\mp_env` (Python 3.12.13, made with uv) already has these packages.
To check it, or to make it again:

```
E:\ACADSS\IOT\mp_env\Scripts\activate
python --version
uv pip install -r tools\py_extract\requirements.txt
python -c "import mediapipe as mp, cv2; print(mp.__version__, cv2.__version__, mp.solutions.hands.Hands)"
```

`python --version` must say 3.12.x and the last line must print `0.10.21`. Do not upgrade
mediapipe: 0.10.35 and 1.x no longer have `mp.solutions`.

## Run

From the repo folder, with the environment active:

```
python tools\py_extract\extract.py "E:\ACADSS\IOT\SK_DATASETS\P05_Lhorwin"
```

- Subfolders are included. Folders named `unzipping` or `_duplicates…` are skipped (the page skips
  them too). Names must be `<SET>_<label>_<SIGNER>.<ext>`; other names are listed as problems,
  never guessed.
- `--workers N`: videos at a time (default: CPU cores - 1).
- A video already in the cache (same name, size and modified time) is skipped, so a stopped run
  (Ctrl+C) carries on where it stopped. `--force` extracts those again.
- `--cache <folder>`: write to another cache folder (default: `bulk_import_cache` in the repo, the
  one the page reads). Used for the parity check below.
- `--list`: only list the videos, the problems and what is already cached.
- One progress line per video: count, %, elapsed time, ETA, videos per minute.

### Avatar candidates (`--avatar-signers`)

```
python tools\py_extract\extract.py "E:\ACADSS\IOT\SK_DATASETS\P03_Janel" --avatar-signers P03
```

- Runs the Hands pass first for videos not in the cache, then Holistic on the best repetition of
  each video of the listed signers (several videos at a time, `--workers`).
- A video the page has not split yet is split first with the page's own splitter (through node) and
  its meta written as the page's Start would write it.
- Same rule as the page for two files of one sign and signer: the first in file-name order makes the
  clip; a later one only when the first gave no clip.
- **Resume / never overwrite:** a sign and signer that already has a candidate in the cache (made by
  the browser or by Python) is skipped, and so is a video whose meta already says "no clip".
  `--overwrite` makes them again.
- `--list` with `--avatar-signers` says how many candidates would be made.
- `saved_gestures/<key>/avatar.json` is never written: Step 5 Apply or "Use this" on Avatar clips
  does that, as before.
- The Source column of the page's Extract table shows `avatar: python mediapipe 0.10.21 holistic`
  for these clips.

Then open `http://localhost/SKR/bulk-import.html`, choose the same folder and press **Start** on
Extract: the Python entries are split from the cache in milliseconds each; avatar signers' videos
also get the avatar clip (Holistic pass on the best repetition, in the page).

## Parity check (browser vs python)

1. Let the page extract a folder (or use its existing cache), e.g. `P01_Rhaiza\ESL\letters`.
2. Extract the same folder with Python into a second cache folder:
   ```
   python tools\py_extract\extract.py "E:\ACADSS\IOT\SK_DATASETS\P01_Rhaiza\ESL\letters" --cache E:\ACADSS\IOT\py_cache_parity
   ```
3. Compare (needs `node` on the PATH, as for the repo's tests):
   ```
   python tools\py_extract\parity.py --browser bulk_import_cache --python E:\ACADSS\IOT\py_cache_parity --folder "E:\ACADSS\IOT\SK_DATASETS\P01_Rhaiza\ESL\letters"
   ```
   It prints one line per video and **PASS** or **FAIL**: hand detected in the same frames
   >= 97 %, the same number of reps on >= 95 % of the videos, and split points within 2 frames.
   The split and the landmark normalisation are the page's own JavaScript, run with node
   (`parity_node.mjs`).

## Avatar parity check (browser vs python)

The P03_Janel and P01_Rhaiza letters already have browser candidates. To compare only Holistic,
give Python the page's own split and best repetition with `--seed-cache` (copies those videos'
Hands entries from the page's cache into a second cache; the page's cache is only read):

```
python tools\py_extract\extract.py "E:\ACADSS\IOT\SK_DATASETS\P03_Janel\ESL\letters" --cache E:\ACADSS\IOT\py_avatar_parity --seed-cache bulk_import_cache --avatar-signers P03
python tools\py_extract\parity_avatar.py --browser bulk_import_cache --python E:\ACADSS\IOT\py_avatar_parity --signer P03
```

It prints one line per sign (frames, rep, shoulder/elbow/wrist distance, continuity in logical px
per 40 ms after retargeting, forearm jumps over 90 degrees) and **PASS** or **FAIL**.

## Tests

```
python -m unittest tools\py_extract\test_skcore.py -v
```

Checks the file-name rules, the skipped folders, the cache id, the frame grid, the letterbox and
the rounding against the page's JavaScript (through node; skipped without node).

```
python -m unittest tools\py_extract\test_avatar.py -v
```

The avatar pass: a Python-written candidate read back through `php/api/bulk_import.php` (php -S on a
temp copy) and the page's `validateClip` / `importClip` / `assignDefaults`; the split; which file
makes the clip; never replacing a stored candidate; the Holistic window reader (needs mediapipe).

## Files

| File | What |
|---|---|
| `extract.py` | the command: folder scan, worker processes, the Hands pass, cache writes, progress |
| `skcore.py` | the page's rules in Python (no MediaPipe, no OpenCV): names, ids, grid, letterbox, cache entry |
| `parity.py`, `parity_node.mjs` | the browser vs python comparison |
| `avatar_pass.py` | the avatar pass (`--avatar-signers`): Holistic on the best rep, candidate files |
| `avatar_node.mjs` | the page's own code for the avatar pass: split + meta, frame packing, clip |
| `parity_avatar.py`, `parity_avatar_node.mjs` | browser vs python avatar candidates |
| `test_avatar.py` | tests of the avatar pass |
| `js_ref.mjs`, `test_skcore.py` | the same inputs through the page's JavaScript and through `skcore.py` |
| `requirements.txt` | the pinned packages of `E:\ACADSS\IOT\mp_env` |
