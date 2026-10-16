# tools/py_extract — fast Hands pass for the bulk importer

`bulk-import.html` reads each video in the browser at about 1.1x its length, one video at a time.
This tool does the same Hands pass with OpenCV + MediaPipe in Python, several videos at once, and
writes the page's own cache entries (`bulk_import_cache/videos/<id>.meta.json` + `<id>.hands.json`,
format version 2). The page then lists those videos as **already extracted (python)**; its **Start**
only splits them from the cache (no video is read) and, for the avatar signers, runs the Holistic
pass on the best repetition. Review, Import, Compile and the avatar stay in the page.

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

## Tests

```
python -m unittest tools\py_extract\test_skcore.py -v
```

Checks the file-name rules, the skipped folders, the cache id, the frame grid, the letterbox and
the rounding against the page's JavaScript (through node; skipped without node).

## Files

| File | What |
|---|---|
| `extract.py` | the command: folder scan, worker processes, the Hands pass, cache writes, progress |
| `skcore.py` | the page's rules in Python (no MediaPipe, no OpenCV): names, ids, grid, letterbox, cache entry |
| `parity.py`, `parity_node.mjs` | the browser vs python comparison |
| `js_ref.mjs`, `test_skcore.py` | the same inputs through the page's JavaScript and through `skcore.py` |
| `requirements.txt` | the pinned packages of `E:\ACADSS\IOT\mp_env` |
