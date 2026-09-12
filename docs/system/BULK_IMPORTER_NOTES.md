# Bulk Importer — Pre-Deletion Record

Reference material for designing a replacement later. Facts from the code
only (`bulk-importer.html`, `php/api/bulk_importer_api.php`), captured before
Phase 2 deletion.

## What it imported

Raw video files (drag-and-drop or file picker, `multiple`, `accept="video/*"`;
UI text advertised MP4/WebM/MOV/AVI — `bulk-importer.html:358,362`), one gesture
label per file, for one of three targets chosen per batch: ESL, FSL, or BOTH
(`bulk-importer.html:371-373`).

## What it wrote

- **`assets/signs/en/<label>.webm`** or **`assets/signs/fil/<label>.webm`** —
  the uploaded video, ffmpeg-transcoded (`bulk_importer_api.php:378-385` is the
  MyMemory call; the ffmpeg step is `bulk_importer_api.php:114`): WebM, VP8,
  scale to 360px width, 15 fps, 350 kbps, no audio.
- **`saved_gestures/<label>/sample_<ms>_<hex>.json`** or
  **`saved_gestures_fsl/<label>/...`** — MediaPipe Hands landmarks captured
  client-side (dynamic 10–60 frames, wrist-relative + scale-normalized, two
  hands flattened to 126 floats — `bulk-importer.html:550-572,720-809`).
- **`gestures`** table — `(word, sign_language)` upsert
  (`bulk_importer_api.php:471-474`).
- **`esl_signs`** / **`fsl_signs`** table — `(sign_key, sign_label, text_value,
  description, asset_path)` upsert (`bulk_importer_api.php:518-528`).
- **`gesture_recordings`** table — `(gesture_id, sign_language, gesture_type,
  sample_count, sample_path, landmark_json)` insert
  (`bulk_importer_api.php:535-541`).

These are the same shared tables/folders `php/api/save_gesture.php` writes to
(confirmed by identical `INSERT INTO`/folder logic in that file) — the
importer does not own any private data store.

## Local FSL dictionary

`bulk_importer_api.php:207-371` — a hardcoded PHP array of ~100 English
phrase/word → Tagalog translations (e.g. `'thank you' => 'salamat'`), checked
before the network call.

## What ffmpeg was used for

Server-side video transcode only (`bulk_importer_api.php:59-78,114`, action
`convert_video`): converts the uploaded raw video to a browser-playable WebM
so MediaPipe Hands can then read it back client-side frame-by-frame for
landmark extraction. Same `get_ffmpeg_path()` binary-location logic (PATH →
project-root `ffmpeg.exe` → `bin/ffmpeg.exe` → `C:\ffmpeg\bin\ffmpeg.exe`) as
`save_gesture.php:36-52`.

## Network call

`bulk_importer_api.php:378-385` — `https://api.mymemory.translated.net/get`,
called only from `translate_english_to_tagalog()`, only when target is FSL/BOTH
and the label misses the local dictionary. Only reachable via the
`save_landmarks` action, which only `bulk-importer.html:821` calls.

## `convert_video` — the action `gesture-training.html`'s "Upload & Process
Video" button also used (removed in this same phase; no MyMemory involvement)

This action was not exclusive to the standalone importer. `gesture-training.html`
had its own "Or Import Pre-recorded Video" control (`gesture-training.html:220-231`,
wired in `js/gesture-training-ui.js:1009-1123`) that called the same endpoint
to convert an uploaded file before extracting landmarks from it client-side.
Recorded here in full because this is the part hardest to reconstruct from
memory once the file is gone.

**Server-side handler** — `php/api/bulk_importer_api.php:82-129`, action
`convert_video`:

1. Requires `$_FILES['video']` to be present, else
   `fail('No video file uploaded.')` (`bulk_importer_api.php:83-85`).
2. Requires a non-empty `label` (after `clean_label()`, which lowercases,
   collapses whitespace to `_`, strips anything outside `[a-z0-9_-]`, and
   trims leading/trailing `_`/`-` — `bulk_importer_api.php:24-29`), else
   `fail('Label/Word is required.')` (`bulk_importer_api.php:86-89`).
3. Locates ffmpeg via `get_ffmpeg_path()` (`bulk_importer_api.php:59-78`):
   global `ffmpeg` on PATH, else `<project-root>/ffmpeg.exe`, else
   `<project-root>/bin/ffmpeg.exe`, else the literal path
   `C:\ffmpeg\bin\ffmpeg.exe`. If none found:
   `fail('FFmpeg is not installed or not found. Please place ffmpeg.exe inside
   the project root directory.')` (`bulk_importer_api.php:91-94`).
4. Reads `sign_language` from `$_POST` (default `ESL`; anything other than
   `ESL`/`FSL` is forced to `ESL` — `bulk_importer_api.php:98-101`) and maps it
   to a subfolder: `FSL` → `fil`, else → `en` (`bulk_importer_api.php:102`).
   Creates `assets/signs/<subfolder>/` if missing (`bulk_importer_api.php:104-107`).
5. Output path is always `assets/signs/<subfolder>/<label>.webm`
   (`bulk_importer_api.php:110-111`) — no timestamp/uniqueness suffix, so
   re-importing the same label silently overwrites the previous file (ffmpeg
   is run with `-y`).
6. Runs this exact command (`bulk_importer_api.php:114`, values
   shell-escaped via `escapeshellarg()`):
   ```
   <ffmpeg> -i <temp_upload_path> -vf "scale=360:-2" -c:v libvpx -r 15 -b:v 350k -an <output_path> -y 2>&1
   ```
   i.e. WebM container, VP8 video codec, scaled to 360px wide (height
   auto-computed, even-constrained via `-2`), 15 fps, ~350 kbps target
   bitrate, audio stream dropped (`-an`). Stderr is redirected into stdout so
   `$output` captures ffmpeg's full log.
7. Success check: `exec()` return code must be `0` AND the output file must
   exist AND be non-empty (`bulk_importer_api.php:117-119`); otherwise
   `fail('FFmpeg conversion failed: ' . implode("\n", $output))`, i.e. the raw
   ffmpeg log is returned verbatim to the caller as the error message
   (`bulk_importer_api.php:120`).
8. On success: `echo json_encode(['success' => true, 'label' => $label,
   'video_url' => 'assets/signs/' . $subFolder . '/' . $output_filename])`
   (`bulk_importer_api.php:123-127`).

**No size, duration, or frame-rate limit is enforced anywhere in this path** —
neither in `convert_video` itself nor in the `gesture-training-ui.js` caller.
The only input-format constraint is client-side: the file `<input>` element
gesture-training.html used was restricted to
`accept="video/mp4,video/webm"` (`gesture-training.html:222`), but the PHP
handler does not itself check MIME type or extension before invoking ffmpeg
on whatever was uploaded.

**Request shape** (as sent by `gesture-training-ui.js:1063-1076`, before its
removal):
```
POST php/api/bulk_importer_api.php?action=convert_video
Content-Type: multipart/form-data
  video          — the File object
  label          — cleaned gesture label (string)
  sign_language  — "ESL" or "FSL" (string)
```
(When opened via `file://` instead of served over Apache, the caller used the
absolute fallback `http://localhost/Sining_kamay/php/api/bulk_importer_api.php?action=convert_video`
— `js/gesture-training-ui.js:1064-1066`.)

**Response shape:**
- Success (HTTP 200): `{"success": true, "label": "<label>", "video_url":
  "assets/signs/<en|fil>/<label>.webm"}`
- Failure (HTTP 400, via `fail()` — `bulk_importer_api.php:18-22`):
  `{"success": false, "error": "<message>"}`, one of the four messages listed
  in steps 2, 3, 7 above.

**Caller-side failure handling** (`gesture-training-ui.js:1077-1080,1113-1115`):
the response is parsed as JSON; if `success` is falsy, an `Error` is thrown
with `convertData.error` (falling back to a generic
`'Failed to convert video on server.'` if the field is missing), caught by an
outer `try/catch` that shows a toast `❌ Error: <message>` for 6 seconds and,
in a `finally` block, resets the button label/state and clears the file input.
There was no retry logic and no partial-progress recovery — a failed
conversion required the operator to pick the file again from scratch.

## Removal note

Both callers of this action are gone as of this phase: `bulk-importer.html`
was deleted outright, and `gesture-training.html`'s "Upload & Process Video"
button, its markup, and its handler in `gesture-training-ui.js` were removed
because they had no working endpoint left to call. **After this phase there is
no way to upload a pre-recorded video for gesture training** — this is
intentional (the gesture-training flow is being redesigned in the next phase,
which will need to decide whether and how to reintroduce video import), not an
oversight. See `docs/system/DEBT.md` for the tracking entry.
