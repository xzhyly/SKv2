Phase: one sign, two texts (ESL / FSL / Both)
Date: 2026-10-04
Status: WAITING FOR APPROVAL
Decision needed from owner: approve the design in (b)–(f) and answer the 15 open questions in (g). Each one has a recommended default.

# One sign, two texts — Step 1: investigation and proposal

Nothing has been changed yet: no code, no schema, no files. To take the measurements I
started XAMPP's MariaDB and Apache, which were both stopped. I ran only `SELECT`s and read
files. The 1024×600 numbers in (e) come from the built-in browser on
`http://localhost/SKR/gesture-training.html`.

## Summary of findings

- **All 89 FSL signs are exact copies of ESL recordings.** `saved_gestures_fsl/` has 89 label
  folders with one sample each. Every one of the 89 samples has the same landmark frames as
  exactly one ESL sample. I checked this element by element with exact float equality, not
  only by hash. The files also match in every other field except `label`, `signLanguage` and
  `createdAt`. No FSL folder lacks an ESL twin, and no ESL sample is the twin of two FSL
  folders. So the migration gives **89 Both + 33 ESL-only + 0 FSL-only** signs.
- **There is one stray file:** `saved_gestures_fsl/sample_1784112605537_bec003.json`. It sits
  in the folder root (not in a label folder), has `"label": ""`, and its frames match
  `saved_gestures/my_name/sample_1784112605409_7920b5.json`. No code reads it, because sync
  and list only scan subfolders (`php/api/save_gesture.php:175`, `:300`).
- **The kiosk keyboard can't type punctuation.** `js/virtual-keyboard.js:16-22` has digits,
  letters, caps, backspace, clear, space and hide only. "How are you?" / "Kumusta ka?"
  (decision 2) can't be typed on the Pi without adding keys. This is Q11.
- **The live DB matches the disk.** Measured 2026-10-04: 211 `gestures` rows = 122 ESL (69
  word, 26 letter, 10 number, 17 phrase) + 89 FSL (50 word, 10 number, 29 phrase). 216
  `gesture_recordings` rows = 127 `saved_gestures/…` + 89 `saved_gestures_fsl/…`. The 122
  ESL rows include the owner's two uncommitted folders, `hi` and `yow` (3 samples each,
  untracked).

---

## (a) Every reader and writer today

### `sign_language` / sign set

| File:line | Read/Write | What it does |
|---|---|---|
| `php/api/save_gesture.php:75-126` | W | `save_gesture_word_to_db($label, $signLanguage, $category)`: upserts `gestures(label, sign_language, category)`. The fallback `SELECT … WHERE label=? AND sign_language=?` is at `:105`. |
| `php/api/save_gesture.php:159-243` | R/W | `sync_disk_to_db`: the folder→language map is at `:162-165`. The per-sample `signLanguage` in the JSON wins over the folder (`:183-186`). It inserts missing recordings (`:200-209`), deletes stale recordings (`:216-233`), and deletes gestures with 0 recordings (`:236-242`). |
| `php/api/save_gesture.php:249-276` | R | `build_categories_map`: `SELECT label, sign_language, category` (`:252`). The per-sample set is at `:267`. |
| `php/api/save_gesture.php:278-331` | R | `list_samples`: scans both folders (`:289-292`), keys the result by label across both folders (`:304`), and returns each sample's `signLanguage` (`:317`). |
| `php/api/save_gesture.php:348-382` | W | `delete_gesture`: deletes the label folder in both folders (`:353-361`), then `SELECT id … WHERE label=? LIMIT 1` (one row only, `:366`) and deletes that row's recordings and the row. |
| `php/api/save_gesture.php:384-388` | R | The POST reads `sign_language`/`dataset`. Anything other than ESL/FSL becomes ESL. |
| `php/api/save_gesture.php:418` | W | Picks the target folder: FSL → `saved_gestures_fsl`, otherwise `saved_gestures`. |
| `php/api/save_gesture.php:456`, `:480` | W | Writes `signLanguage` into the v3 and v2 sample file. |
| `php/api/save_gesture.php:503` | W | Picks the video subfolder: FSL → `fil`, otherwise `en` (v2 video path only, never v3). |
| `php/api/save_gesture.php:567`, `:592` | W | DB upsert, and `signLanguage` in the save response. |
| `php/api/gesture_category.php:58-69` | W | `ensure_gestures_columns` adds `sign_language ENUM('ESL','FSL')` if the column is missing (`:62`). |
| `php/api/reports.php:22-28`, `:48-49` | R | `WHERE sign_language = 'ESL'` / `'FSL'`, one call per tab. |
| `reports.html:471`, `:474`, `:669-676`, `:721-724` | R | ESL/FSL tables. Key = `label`, and "Label" and "Text" both show `display_label`. |
| `gesture-training.html:206-210` | UI | Sign Set radios `name="gestureDatasetType"`, ESL/FSL. |
| `js/gesture-training-ui.js:243-247` | R | `updateUI` reads the radio and `sining_kamay_trained_labels_<lang>`. |
| `js/gesture-training-ui.js:268-274` | R | `savedSampleInfo {ESL, FSL}`, `selectedSignSet()`. |
| `js/gesture-training-ui.js:283-294` | R | `autoSelectCategory`: `saved[set][label]`. |
| `js/gesture-training-ui.js:298-312` | R | `rebuildSampleInfo` / `noteSampleSaved`: set from each sample's `signLanguage`. |
| `js/gesture-training-ui.js:350-356` | R | `renderSavedDataset`: set = `samples[0].signLanguage`. |
| `js/gesture-training-ui.js:384` | W | `deleteGesture` clears both sets' tally. |
| `js/gesture-training-ui.js:486-510` | R | **`mergeSavedGestureSamples`**: `targetLang` comes from the Sign Set radio. Only rows whose `signLanguage === targetLang` go into `trainData`. |
| `js/gesture-training-ui.js:559-560` | R | **`trainModel`**: `targetLang` comes from the Sign Set radio and becomes part of the localStorage keys. |
| `js/gesture-training-ui.js:1207-1208`, `:1216-1218` | R | Sign Set change handlers; the initial cache load uses the radio's language. |
| `js/gesture-training-ui.js:1337` | W | `openRecordingMode` passes `signSet: selectedSignSet()`. |
| `js/gesture-capture-ui.js:192` | W | `session.signSet = opts.signSet === 'FSL' ? 'FSL' : 'ESL'`, so a "BOTH" would silently become ESL. |
| `js/gesture-capture-ui.js:198`, `:593`, `:640`, `:700`, `:709`, `:725` | R/W | Chip text, the pending save, `saveGestureSample(…, p.signSet, …)`, `invalidateCaches(p.signSet)`, the `onCaptureSamplesSaved` payload. |
| `js/gesture-data.js:621-640` | W | `saveGestureSample`: `sign_language: signLanguage === "FSL" ? "FSL" : "ESL"` (`:624`). |
| `js/gesture-data.js:662-671` | R | `loadSavedGestureDataset`: stores `json.categories` (default `{ESL:{},FSL:{}}`). |
| `js/gesture-data.js:705-716` | R | `recordingsToTrainingRows`: each row's `signLanguage` comes from its sample. |
| `js/sign-to-text-ui.js:96-118` | R | **`mergeSavedGestureSamples`** (talk.html copy): `targetLang` from `signLang`. It loads rows of that language plus `start`/`stop` from either language (`:113`). |
| `js/sign-to-text-ui.js:303`, `:342`, `:826` | R | `autoTrainForTranslate` / loader / init: `signLang === 'fil' ? 'FSL' : 'ESL'`. |
| `js/talk-signing.js:127` | W | Message meta `signLanguage` (ESL/FSL) → history. |
| `js/talk-history.js:72`, `:85`, `talk.html:1399`, `:1423`, `:1850` | W | Pass the message's `sign_language` to `save_conversation.php`. **This is about messages, not gestures. It does not change.** |
| `js/sign-player.js:248-261` | R | Text-to-sign registers every label under each sample's `signLanguage` map (`signAssetMapEn`/`Fil`). |
| `php/api/save_conversation.php`, `php/api/conversations.php`, `reports.html:834` | R/W | `messages.sign_language`. **Does not change.** |
| `db-schema/database_setup.sql:30-40` | DDL | `gestures` table, `UNIQUE (label, sign_language)` at `:39`. |
| `db-schema/migrations/2026-09-24-*.php` | DDL/R | Migrations that already ran. **Not changed** (same rule as the saved-conversations phase). |

### `label`

| File:line | What |
|---|---|
| `php/api/save_gesture.php:30-35` | `clean_label`: lowercase, whitespace→`_`, strips anything outside `[a-z0-9_-]`. |
| `php/api/save_gesture.php:384` | POST `label`/`word` → `clean_label`. |
| `php/api/save_gesture.php:428-436` | Label folder plus a path-traversal guard. |
| `php/api/save_gesture.php:451`, `:476` | `label` written into the sample file. |
| `php/api/save_gesture.php:61-69`, `:511`, `:521-525`, `:552` | Video asset name `assets/signs/<en|fil>/<label>.(mp4|webm)`. |
| `php/api/save_gesture.php:176`, `:301` | Sync and list take the label from the **folder name**, not from the file. |
| `php/api/save_gesture.php:349-376` | Delete by label. |
| `php/api/gesture_category.php` (`gesture_category($label)`) | Category heuristic on the label. |
| `js/gesture-category.js` | The JS copy of the heuristic (parity-tested). |
| `js/gesture-data.js:94-99` | `cleanLabel`, the JS copy of `clean_label`. |
| `gesture-training.html:202`, `js/gesture-training-ui.js:275-278`, `:1326-1327` | Gesture Name input → `currentLabelClean()` → recording. |
| `js/gesture-training-ui.js:143-148` | Dataset modal row: label, set, samples, `deleteGesture('<label>')`. |
| `js/gesture-training-ui.js:197-207`, `js/sign-to-text-ui.js:62-72` | **`translateGestureLabel(label, lang)`**: a hardcoded `SIGN_TRANSLATIONS` lookup, otherwise `_`→space and Title Case. This is the only place a k-NN label becomes on-screen text in Let's Talk (`js/talk-signing.js:184`, `:205`) and in gesture-training Step 4 (`js/gesture-training-ui.js:853`). |
| `js/gesture-training-ui.js:781`, `:788`, `:798`, `:815` | Step 3 Predict shows `detected.replace(/_/g,' ')`. |
| `js/sign-to-text-ui.js:904-1065` | `formulateSmartSentence`: lowercases for phrase lookup, otherwise keeps the words, capitalizes the first letter, and leaves a sentence that already ends in `. ? !` alone (`:1054-1056`). |
| `js/sign-player.js:248-262`, `:372-417` | Text-to-sign: label → `${label}.webm` relative to `assets/signs/<en|fil>/`, and a `<base><normalized_text>.webm` probe (`:378`). |
| `php/api/reports.php:31-43` | `display_label = str_replace('_',' ',label)`, plus the `.mp4` backfill by label. |
| `tests/**` | Every test probe saves by `label` (zz-prefixed). |

### The two sample folders

| File:line | What |
|---|---|
| `php/api/save_gesture.php:15-22` | `$datasetRoot = saved_gestures` (only used to create the folder). |
| `php/api/save_gesture.php:162-165`, `:289-292`, `:353`, `:418` | sync / list / delete / save (above). |
| `php/api/save_gesture.php:151-157` | `sync_db_to_disk` is a no-op: disk is the source of truth. |
| `tests/categorization/heuristic-parity.test.mjs:59-73` | Scans both folders, guarded by `existsSync`. |
| `tests/categorization/list-categories.test.mjs:18-21` | Cleanup `rmSync` in both folders. |
| `tests/normalization/schema-guard.test.mjs:28` | Cleanup in `saved_gestures_fsl`. |
| `tests/video-capture/feature-rows.test.mjs:51-67` | Golden test over every sample in both folders (guarded). |

### localStorage keys built from the language

`sining_kamay_knn_<ESL|FSL>`, `sining_kamay_labels_<…>`, `sining_kamay_trained_labels_<…>`:
`js/gesture-training-ui.js:247`, `:455-467`, `:513-530`, `:588-609`, `:676-678`;
`js/sign-to-text-ui.js:121-157`, `:242-252`, `:288-289`; `js/gesture-capture-ui.js:683`
(removes `labels_<lang>` only).

Not readers of either: `diagnostic.html:110-125` (a GET of `save_gesture.php` only, which runs
a full sync), `js/capture-core.js`, `js/video-landmarks.js`.

---

## (b) Proposed schema, disk layout, and how sync keeps working

### Disk (still the source of truth)

1. **One folder per sign: `saved_gestures/<key>/`, whatever its set.** It holds the sample
   files, unchanged, plus one new small file **`sign.json`**:
   ```json
   {"key":"how_are_you","set":"BOTH","textEn":"How are you","textFil":"Kamusta ka","updatedAt":"2026-10-04T…Z"}
   ```
   A Both sign's samples live in exactly one place. Changing a sign's set only rewrites
   `sign.json`: nothing is moved or copied.
2. **`saved_gestures_fsl/` is no longer written to.** Sync and list still read it, so an
   un-migrated copy keeps working: a folder there with no `sign.json` counts as FSL. After
   the migration it is empty on this machine.
3. **Sample files stay byte-identical in format (v2/v3 untouched).** New samples still carry
   `signLanguage`, kept to its current values: `"ESL"` for ESL and Both signs, `"FSL"` for
   FSL signs. `sign.json`, not the sample, decides the set (Q5).
4. `delete_gesture` already deletes `*.json` in the folder (`save_gesture.php:356`). That
   removes `sign.json` too, so the existing `rmdir` still works.
5. Sync and list already ignore anything that isn't `sample_*.json` (`:177`, `:302`), so
   `sign.json` is never mistaken for a sample.

### DB (DDL, after the 89 merges)

```sql
ALTER TABLE gestures
  MODIFY `sign_language` ENUM('ESL','FSL','BOTH') NOT NULL DEFAULT 'ESL',
  ADD COLUMN `text_en`  VARCHAR(255) NULL AFTER `sign_language`,
  ADD COLUMN `text_fil` VARCHAR(255) NULL AFTER `text_en`;
-- …merge step (see c)…
ALTER TABLE gestures
  DROP INDEX `uq_gestures_label_language`,
  ADD UNIQUE KEY `uq_gestures_label` (`label`),
  ADD CONSTRAINT `chk_gestures_texts` CHECK (
    (`sign_language` = 'FSL' OR (`text_en`  IS NOT NULL AND `text_en`  <> '')) AND
    (`sign_language` = 'ESL' OR (`text_fil` IS NOT NULL AND `text_fil` <> '')));
```

Resulting table (as it will go into `db-schema/database_setup.sql` and the ERD):

```sql
CREATE TABLE `gestures` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `label` varchar(255) NOT NULL,                        -- the derived key, = folder name
  `sign_language` enum('ESL','FSL','BOTH') NOT NULL DEFAULT 'ESL',
  `text_en` varchar(255) DEFAULT NULL,
  `text_fil` varchar(255) DEFAULT NULL,
  `category` enum('word','letter','number','phrase') NOT NULL DEFAULT 'word',
  `asset_path` varchar(255) DEFAULT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT 1,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_gestures_label` (`label`),
  CONSTRAINT `chk_gestures_texts` CHECK (…as above…)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
```

`gesture_recordings`, `conversations`, `messages` and `users` don't change.

- **Why keep the name `sign_language`:** every existing test that queries it
  (`tests/categorization/save-category.test.mjs:32,56,127`, `tests/normalization/schema-guard.test.mjs:93,106`,
  `tests/video-capture/e2e.mjs:318,444,447`) keeps working unchanged. Renaming it to
  `sign_set` would touch all of them for no behavior change (Q1).
- **The CHECK enforces "each shown text is required".** A text that's hidden is allowed to
  stay stored. For example, a Both sign narrowed to ESL keeps its Filipino text, unused
  (Q10). MariaDB 10.4.32 enforces CHECK constraints: the saved-conversations phase already
  relies on two, `database_setup.sql:86-87`.
- **`category`** stays DB-only, as now (DEBT 65). Moving it into `sign.json` would be scope
  creep (Q3).

### Sync (`sync_disk_to_db`) with disk still the source of truth

For each label folder in `saved_gestures/`, then the legacy `saved_gestures_fsl/`:

1. Read `sign.json` if it exists. Otherwise derive one: set = ESL for `saved_gestures/` and FSL
   for `saved_gestures_fsl/` (or the first sample's `signLanguage`), and text = folder label
   with `_` → space for that language.
2. Upsert `gestures` **by label** with `sign_language`/`text_en`/`text_fil` from step 1. These
   are always overwritten, so disk wins over DB, while category keeps today's
   "only if explicit" rule (`:89`).
3. Recordings: same as today (`:193-209`).
4. Delete stale recordings and orphan gestures: same as today (`:216-242`).

A sign edited in the dataset view writes `sign.json` first, then the DB row. A later full
sync therefore re-derives the same values.

### API shape

- **`GET save_gesture.php`** (list, both forms): samples unchanged, plus a new top-level
  `signs: {key: {set, textEn, textFil}}`. `categories` lists a Both sign under both `ESL` and
  `FSL`, so the existing response contract still holds
  (`tests/categorization/list-categories.test.mjs:38-75`).
- **`POST save_gesture.php`** (save a sample) gets three new optional fields:
  `sign_language` may be `BOTH`, plus `text_en` and `text_fil`.
  - **Key:** `clean_label(text_en)` for ESL/BOTH, `clean_label(text_fil)` for FSL. If no text
    is sent, the old `label` is used, so every existing caller and test keeps working.
  - **Same key, same set:** the sample is added and the texts are updated.
  - **Same key, different set:** **409** `{error, existingSet}`, and nothing is written (Q4).
  - **Response:** adds `set`, `textEn`, `textFil`. `signLanguage` stays and equals the set.
- **New `php/api/signs.php`:**
  - `GET` → `{success, signs: {key: {set, textEn, textFil, category, assetPath, samples}}}`.
    One `SELECT` over `gestures` + `COUNT` of recordings. It's light, and Let's Talk uses it
    (see f).
  - `POST {action:"update", key, set, textEn, textFil}` validates: set in ESL/FSL/BOTH, each
    required text non-empty after `trim`, ≤ 255 chars. It returns 404 if no
    `saved_gestures/<key>/` exists. Then it writes `sign.json` (`LOCK_EX`), runs `UPDATE
    gestures`, and returns the stored sign. No sample is touched.
  - No auth, same posture as `save_gesture.php` and `conversations.php` (decision 7, DEBT 72).
- **`delete_gesture`:** unchanged in shape. It now removes the one row for the key, so a Both
  sign leaves both models.

---

## (c) Migration plan for decision 6

### How the pairs were matched

- I parsed every `sample_*.json` in both folders (127 + 89 + the stray file).
- For each FSL sample, I searched for an ESL sample whose `frames` array is identical. First
  by SHA-256 of `JSON.stringify(frames)`, then confirmed **element by element with exact
  equality (`Object.is`)** on every float.
- **Result:** 89 of 89 FSL samples have exactly one twin, 0 have two or more, and 0 have none.
  For all 89, every other field also matches (`format`, `frameCount`, and so on), except
  `label`, `signLanguage` and `createdAt`.
- The twin was always written 8–245 ms before the FSL copy (compare the `sample_<ms>`
  filenames below), which fits machine copying.
- The matching is by data, not by name. No translation table was used.

The migration script repeats this proof file by file before it moves anything. It aborts if
the pairs it computes differ from the committed fixture
`db-schema/migrations/2026-10-04-sign-texts-pairs.json` (the 89 pairs below with their
hashes).

### The 89 pairs

How to read the table:

- **FSL folder** is the FSL copy, and its current Tagalog label becomes the draft Filipino
  text.
- **frames sha256** shows only the first 12 hex characters.
- **identical** is the element-by-element check.
- **cat.** is the category the merged sign keeps (the ESL one). Where the FSL copy had a
  different category, that is shown in brackets (Q7).
- **video** compares the two signs' `asset_path` files byte for byte.
- **Draft English / Draft Filipino** are the proposed draft texts (Q6). The owner corrects
  them.

| # | FSL folder | ESL twin | frames | frames sha256 | identical | cat. (kept = ESL) | video | Draft English | Draft Filipino |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `alam` | `know` | 13 | 710f5a9e5cf1 | yes | word | same | Know | Alam |
| 2 | `alin` | `which` | 17 | aa381f66be62 | yes | word | same | Which | Alin |
| 3 | `amin_ng_dati` | `usual` | 12 | 6359099eecad | yes | word (FSL: phrase) | same | Usual | Amin ng dati |
| 4 | `anim` | `six` | 20 | 87083b101933 | yes | number | same | Six | Anim |
| 5 | `ano_ba_ang_sabi_mo` | `what_did_you_say` | 18 | 422d06e95370 | yes | phrase | same | What did you say | Ano ba ang sabi mo |
| 6 | `anong_oras_na` | `what_time_is_it` | 17 | 7bea9c2164b9 | yes | phrase | same | What time is it | Anong oras na |
| 7 | `apat` | `four` | 15 | 30f445bd662c | yes | number | same | Four | Apat |
| 8 | `araw` | `day` | 17 | 2efcf3066989 | yes | word | same | Day | Araw |
| 9 | `bakit` | `why` | 10 | 3b93901da05a | yes | word | same | Why | Bakit |
| 10 | `banyo` | `bathroom` | 13 | eb77d34ea08d | yes | word | same | Bathroom | Banyo |
| 11 | `bigyan_mo_pa_ako_ng_isang_pagkakataon` | `fine` | 9 | b039ab0c2374 | yes | word (FSL: phrase) | same | Fine | Bigyan mo pa ako ng isang pagkakataon |
| 12 | `boso` | `bored` | 15 | 222a03b2aaf8 | yes | word | same | Bored | Boso |
| 13 | `bukas` | `tomorrow` | 21 | 56bd28d2fe21 | yes | word | same | Tomorrow | Bukas |
| 14 | `buwan` | `month` | 20 | 550af2c49395 | yes | word | same | Month | Buwan |
| 15 | `dalawa` | `two` | 14 | 417fa75ed8b9 | yes | number | same | Two | Dalawa |
| 16 | `gabi` | `night` | 13 | 07ebb79d9ae3 | yes | word | same | Night | Gabi |
| 17 | `gagawa` | `will` | 14 | a7ad4ab6cc7c | yes | word | same | Will | Gagawa |
| 18 | `ganon_din` | `scared` | 8 | edf4a488ceed | yes | word (FSL: phrase) | same | Scared | Ganon din |
| 19 | `halika` | `come` | 8 | 885d6564f47a | yes | word | same | Come | Halika |
| 20 | `hapon` | `afternoon` | 11 | 9819e3d04a46 | yes | word | same | Afternoon | Hapon |
| 21 | `hibaru` | `learn` | 21 | 5bcfaa9557e1 | yes | word | same | Learn | Hibaru |
| 22 | `higit_pa` | `more` | 13 | aa3f0c1d2bf0 | yes | word (FSL: phrase) | same | More | Higit pa |
| 23 | `hindi` | `no` | 14 | a72602fd79bc | yes | word | same | No | Hindi |
| 24 | `hindi_ko_alam` | `dont_know` | 14 | 3080d97a5529 | yes | phrase | same | Dont know | Hindi ko alam |
| 25 | `hinihintay_ang_kanan` | `excited` | 13 | b44620e0398b | yes | word (FSL: phrase) | same | Excited | Hinihintay ang kanan |
| 26 | `host_dad` | `confused` | 15 | 066070d55a74 | yes | word (FSL: phrase) | same | Confused | Host dad |
| 27 | `huli` | `late` | 13 | ca090542cf4c | yes | word | same | Late | Huli |
| 28 | `ibigay` | `give` | 12 | 1827198c49ce | yes | word | same | Give | Ibigay |
| 29 | `ikinagagalak_kitang_makilala` | `nice_to_meet_you` | 20 | 2eff5467daaa | yes | phrase | same | Nice to meet you | Ikinagagalak kitang makilala |
| 30 | `im_so_sick` | `sick` | 14 | 1686151b7848 | yes | word (FSL: phrase) | same | Sick | Im so sick |
| 31 | `ingat` | `take_care` | 32 | f77520b5efa9 | yes | phrase (FSL: word) | same | Take care | Ingat |
| 32 | `ipadala_ito` | `busy` | 17 | cf7ab1570180 | yes | word (FSL: phrase) | same | Busy | Ipadala ito |
| 33 | `isa` | `one` | 15 | 043c6bf026e8 | yes | number | same | One | Isa |
| 34 | `kahapon` | `yesterday` | 19 | d936f257d94f | yes | word | same | Yesterday | Kahapon |
| 35 | `kailan` | `when` | 20 | b0588c4c100c | yes | word | same | When | Kailan |
| 36 | `kailangan` | `need` | 16 | 1a612d28c874 | yes | word | same | Need | Kailangan |
| 37 | `kainan` | `restaurant` | 11 | d33d972975a6 | yes | word | same | Restaurant | Kainan |
| 38 | `kamusta` | `hello` | 10 | 39d8dfd96c25 | yes | word | same | Hello | Kamusta |
| 39 | `kamusta_ka` | `how_are_you` | 23 | 3313fdf2add5 | yes | phrase | same | How are you | Kamusta ka |
| 40 | `katapusan_ng_linggo` | `weekend` | 20 | 9a4922d7724e | yes | word (FSL: phrase) | same | Weekend | Katapusan ng linggo |
| 41 | `kaya` | `so_so` | 8 | 62b5e773d265 | yes | phrase (FSL: word) | same | So so | Kaya |
| 42 | `kita_tayo_mamaya` | `see_you_later` | 19 | 1a8a4950086d | yes | phrase | same | See you later | Kita tayo mamaya |
| 43 | `kwentuhan` | `chat` | 12 | 1f4a7a73e20a | yes | word | same | Chat | Kwentuhan |
| 44 | `lima` | `five` | 18 | 56b1305bd5a4 | yes | number | same | Five | Lima |
| 45 | `linggo` | `week` | 15 | 15d68b974ed2 | yes | word | same | Week | Linggo |
| 46 | `mabuti` | `good` | 20 | 34fe107abca1 | yes | word | same | Good | Mabuti |
| 47 | `maganda` | `nice` | 10 | 57ce2ae71cd4 | yes | word | same | Nice | Maganda |
| 48 | `magandang_umaga` | `good_morning` | 22 | ac5e81caecbc | yes | phrase | same | Good morning | Magandang umaga |
| 49 | `magkasingkahulugan_ng_galit` | `angry` | 9 | ac0883ef9cb6 | yes | word (FSL: phrase) | same | Angry | Magkasingkahulugan ng galit |
| 50 | `magsanay` | `practice` | 24 | cb6a4f382d01 | yes | word | same | Practice | Magsanay |
| 51 | `mahirap_makarinig` | `hard_of_hearing` | 12 | a701f900a900 | yes | phrase | same | Hard of hearing | Mahirap makarinig |
| 52 | `makipagkita` | `meet` | 14 | d4cd35494793 | yes | word | same | Meet | Makipagkita |
| 53 | `makita` | `see` | 15 | b5ad34b7bd26 | yes | word | **differs** | See | Makita |
| 54 | `malalim_na_tagalog` | `deaf` | 12 | 98a07ea91fc1 | yes | word (FSL: phrase) | same | Deaf | Malalim na tagalog |
| 55 | `mamaya` | `later` | 10 | d6e94f6664fc | yes | word | same | Later | Mamaya |
| 56 | `masama` | `bad` | 19 | 14d7f77bfc19 | yes | word | same | Bad | Masama |
| 57 | `masaya` | `happy` | 8 | 734a5b97e220 | yes | word | same | Happy | Masaya |
| 58 | `matalusan` | `understand` | 11 | 2b4371c794ea | yes | word | same | Understand | Matalusan |
| 59 | `nag-aantok` | `sleepy` | 12 | 7b424509d7a0 | yes | word | same | Sleepy | Nag-aantok |
| 60 | `nakakaintindi_ba_sila_ng_english` | `do_you_understand` | 22 | 7174fddade12 | yes | phrase | same | Do you understand | Nakakaintindi ba sila ng english |
| 61 | `nakaraan` | `past` | 2 | ad6d4d32ce3e | yes | word | same | Past | Nakaraan |
| 62 | `naririnig_mo_ba` | `are_you_hearing` | 26 | 559f13f7f228 | yes | phrase | same | Are you hearing | Naririnig mo ba |
| 63 | `nasaan_ang_banyo` | `where_is_the_bathroom` | 21 | 4c2c7d51dc61 | yes | phrase | same | Where is the bathroom | Nasaan ang banyo |
| 64 | `nasasabik_ako` | `im_excited` | 23 | e40e5e876bb7 | yes | phrase | same | Im excited | Nasasabik ako |
| 65 | `oras` | `time` | 17 | bf7fa2d67a9a | yes | word | same | Time | Oras |
| 66 | `paalam` | `goodbye` | 20 | 6e12a1311983 | yes | word | same | Goodbye | Paalam |
| 67 | `paano` | `how` | 16 | 3774506ecc0f | yes | word | same | How | Paano |
| 68 | `paborito` | `favorite` | 11 | 4716d4d370a7 | yes | word | same | Favorite | Paborito |
| 69 | `paggawa_ng_kahulugan` | `live` | 8 | 8f5e7c06ac72 | yes | word (FSL: phrase) | same | Live | Paggawa ng kahulugan |
| 70 | `pangalan` | `name` | 17 | 4964686a6ac1 | yes | word | same | Name | Pangalan |
| 71 | `pito` | `seven` | 18 | 452b1f9c8734 | yes | number | same | Seven | Pito |
| 72 | `pumunta` | `go` | 10 | b59eeb679afa | yes | word | same | Go | Pumunta |
| 73 | `saan` | `where` | 11 | 503d809ee350 | yes | word | same | Where | Saan |
| 74 | `sabihin` | `say` | 18 | 62403c3d9068 | yes | word | same | Say | Sabihin |
| 75 | `sampu` | `ten` | 15 | 6bff6ffc7f70 | yes | number | same | Ten | Sampu |
| 76 | `sana_basahin_mo_chat_ko_sa_u` | `want` | 10 | 72c8ba05f804 | yes | word (FSL: phrase) | same | Want | Sana basahin mo chat ko sa u |
| 77 | `sino` | `who` | 14 | e178659621c3 | yes | word | same | Who | Sino |
| 78 | `siyam` | `nine` | 15 | 78c4f9811fef | yes | number | same | Nine | Siyam |
| 79 | `tanong` | `ask` | 12 | 0adc7b27c9ed | yes | word | same | Ask | Tanong |
| 80 | `taon` | `year` | 23 | 533cd775d395 | yes | word | same | Year | Taon |
| 81 | `tapos` | `done` | 10 | dfcc7392ecec | yes | word | same | Done | Tapos |
| 82 | `tapos_na` | `finished` | 13 | 284de5103160 | yes | word (FSL: phrase) | same | Finished | Tapos na |
| 83 | `tatlo` | `three` | 14 | 61847758eac6 | yes | number | same | Three | Tatlo |
| 84 | `tulong` | `help` | 11 | 10d5f6b77672 | yes | word | same | Help | Tulong |
| 85 | `tulungan_mo_akong_magsanay` | `help_me_practice_please` | 45 | 7955a1102e74 | yes | phrase | same | Help me practice please | Tulungan mo akong magsanay |
| 86 | `umaga` | `morning` | 16 | 3ac03247fa5c | yes | word | same | Morning | Umaga |
| 87 | `wala_akong_nahanap` | `nothing` | 15 | 5304d5f55dcf | yes | word (FSL: phrase) | same | Nothing | Wala akong nahanap |
| 88 | `wala_naman_mangyayari_kung_hindi_ko_susubukan` | `hearing` | 11 | ee7257ee9d24 | yes | word (FSL: phrase) | same | Hearing | Wala naman mangyayari kung hindi ko susubukan |
| 89 | `walo` | `eight` | 14 | 6bc3c66adaa4 | yes | number | same | Eight | Walo |

Every FSL sample file is
`saved_gestures_fsl/<FSL folder>/sample_<ms>_<hex>.json`. Every ESL twin is the only sample in
`saved_gestures/<ESL twin>/`. The full per-file list (both filenames, `createdAt`, full
hashes) is in the fixture the migration commits. From that list: each twin's `<ms>` is 8–245
ms lower than its FSL copy's.

**Drafts that are probably wrong (to check first).** This is my reading, not verified. Each
item shows the ESL meaning first, then the draft Filipino text:

- Not Filipino at all: `hibaru` (learn), `host_dad` (confused), `im_so_sick` (sick).
- Filipino, but a different meaning: `boso` (bored), `ganon_din` (scared), `matalusan`
  (understand), `bigyan_mo_pa_ako_ng_isang_pagkakataon` (fine), `hinihintay_ang_kanan`
  (excited), `ipadala_ito` (busy), `amin_ng_dati` (usual), `malalim_na_tagalog` (deaf),
  `magkasingkahulugan_ng_galit` (angry), `paggawa_ng_kahulugan` (live),
  `sana_basahin_mo_chat_ko_sa_u` (want), `wala_akong_nahanap` (nothing),
  `wala_naman_mangyayari_kung_hindi_ko_susubukan` (hearing), `kaya` (so so),
  `nakakaintindi_ba_sila_ng_english` (do you understand).

These are only drafts, as decision 6 says. The owner edits them in the dataset view after the
migration.

**#53 `makita` ↔ `see`:**

- The landmarks are identical.
- The display videos differ: `assets/signs/fil/makita.webm` is 93,388 B and
  `assets/signs/en/see.webm` is 83,105 B.
- The merged row keeps the ESL `asset_path` (`assets/signs/en/see.webm`).
- FSL text-to-sign for "Makita" still plays `fil/makita.webm`, because
  `js/sign-player.js:378` first checks `assets/signs/fil/<normalized_text>.webm`.
- `assets/signs/**` is untouched, so nothing is lost (Q8).

**The stray root file:**

- `saved_gestures_fsl/sample_1784112605537_bec003.json` has 20 frames.
- Its frames are identical to `saved_gestures/my_name/sample_1784112605409_7920b5.json`
  (same proof).
- It is moved to the backup with the 89 (Q9).

### Signs that do NOT pair

- **FSL with no ESL twin: none** (0 of 89 folders).
- **ESL with no FSL copy, 33 signs. They stay ESL-only:** `a b c d e f g h i j k l m n o p q
  r s t u v w x y z` (26 letters), `my_name`, `no_i_dont_understand`, `sad`, `start`,
  `tired`, and the owner's uncommitted `hi` and `yow`.

### Script: `db-schema/migrations/2026-10-04-sign-texts.php`

The script follows the same pattern as `2026-09-24-normalize.php`: CLI-only guard, MariaDB
check, idempotent checked steps, resume after interruption. It takes these options:
`--db`, `--root=<dataset root>` (default the repo), `--backup-dir` (default
`E:\ACADSS\IOT\backups\2026-10-04-sign-texts\`), `--stop-after=N`, `--verify-only`.

1. **Preconditions.** Refuse to run unless `--backup-dir` holds a mysqldump taken today (Task
   0 makes it). Snapshot the counts and every recording's
   `(label, sign_language, sample_path, sha256(frames))` to `snapshot.json` in the backup
   dir.
2. **Prove pairs.** Recompute all pairs from the files (deep equality) and compare them with
   the committed fixture. Any difference means stop; nothing has changed yet.
3. **Schema part 1.** Add `text_en`/`text_fil` and widen the enum.
4. **Write `sign.json`** for every folder in `saved_gestures/`: the 89 twins as BOTH
   (`textEn` = draft English, `textFil` = draft Filipino), the other 33 as ESL. Then the DB
   rows: the twins become `BOTH` with both texts, the 33 get `text_en` only.
5. **Move the duplicates.** For each of the 90 files (89 + stray):
   - copy it to `<backup-dir>/saved_gestures_fsl/<folder>/<file>`;
   - check that the copy's SHA-256 equals the original's;
   - check again, deep-equal, that the twin is still on disk;
   - delete the original and remove the empty folder;
   - append `{source, backup, sha256, twin}` to `<backup-dir>/moved-manifest.json`.
6. **DB.** Delete the 89 FSL `gesture_recordings` rows (by `sample_path`), then the 89 FSL
   `gestures` rows. Recordings go first because the FK is `ON DELETE RESTRICT`.
7. **Schema part 2.** Swap the unique key to `(label)` and add the CHECK.
8. **Verify.** Expected (measured before, then predicted):

   | | before | after |
   |---|---|---|
   | `gestures` | 211 | 122 (89 BOTH, 33 ESL, 0 FSL) |
   | `gesture_recordings` | 216 | 127 |

   The script also checks that:
   - every remaining `sample_path` exists on disk;
   - every one of the 216 snapshot frame hashes is still reachable, either from an active
     sample or (for the 89 moved ones) from its twin's identical active sample, with the
     backup copy present;
   - a full sync run afterwards changes nothing.

   It then prints `SHOW CREATE TABLE gestures`.

### Tests

**`tests/sign-texts/migration.test.mjs`** (new). It uses a clone DB via the existing
`tests/normalization/clone-helper.mjs` and a temp copy of both folders under the scratch
directory, never live. It runs the migration and checks:

- the counts and the manifest;
- the backup hashes;
- that a second run is a no-op;
- that an interruption after each step resumes to the same end state;
- a tampered FSL sample (one float changed) makes step 2 abort with 0 files moved.

---

## (d) Per-language model and localStorage keys

- **The k-NN key stays the sign's key (the folder slug).** `knnPredict`/`cosineSimilarity`
  are untouched and still return a key. Text is looked up only at display time, so editing
  a text never requires retraining.
- **What goes into each model.** The rows from `recordingsToTrainingRows`
  (`js/gesture-data.js:705-716`) carry the sign's **set** (`ESL|FSL|BOTH`, from the
  response's `signs` map). Each copy of `mergeSavedGestureSamples` changes only its filter:
  - `js/gesture-training-ui.js:505`: `itemLang === targetLang` becomes
    `itemLang === targetLang || itemLang === 'BOTH'`;
  - `js/sign-to-text-ui.js:113`: the same change, keeping its `start`/`stop` exception.

  So the ESL model = ESL + Both signs (122 after migration) and the FSL model = FSL + Both
  signs (89, plus `start`/`stop` in the talk.html copy, as today).
- **Where the training language comes from.** `trainModel` (`:559-560`) and
  `mergeSavedGestureSamples` (`:486-487`) read `targetLang` from the Step 1 Sign Set radio,
  and that radio can now say BOTH. Both lines change to read a new **Step 2 "AI model: ESL |
  FSL" toggle** (`modelLanguage()`). It defaults to the Step 1 set, with Both → ESL (Q12).
  `updateUI` (`:243-244`) and the start-up cache load (`:1216-1218`) read the same helper.
  **That is the whole change to `trainModel` and `mergeSavedGestureSamples`:** the source of
  `targetLang`, and the set filter. Nothing else in either function changes.
- **The localStorage keys don't change:** `sining_kamay_knn_<ESL|FSL>`,
  `sining_kamay_labels_<…>`, `sining_kamay_trained_labels_<…>`. Their existing self-repair
  already handles a key that disappears or appears: removed labels are pruned at
  `gesture-training-ui.js:512-543` and `:594-614`, and talk.html rebuilds when label or frame
  counts differ (`sign-to-text-ui.js:133-162`).
- **One gap: talk.html never revalidates a cache it found.** `autoTrainForTranslate` returns
  as soon as `loadKnnFromCache` succeeds (`sign-to-text-ui.js:305-307`). A pre-migration FSL
  cache keyed by the old Tagalog slugs would therefore survive there. To close the gap,
  `gesture-data.js` gets a one-time **model-schema reset**: if
  `sining_kamay_model_schema !== '2'`, it removes the six knn/labels/trained_labels keys and
  sets it to `'2'` (Q13).
- **Edits and new recordings clear the affected caches.**
  - A set edit in the dataset view clears the caches of the languages whose membership
    changed. A text-only edit clears nothing.
  - `invalidateCaches` (`js/gesture-capture-ui.js:682-689`) is called for **both** ESL and FSL
    when a Both sign is recorded. That is a one-line loop, and no capture state changes.

---

## (e) The Step 1 form and the dataset edit UI at 1024×600

### Measured now (built-in browser, viewport 1024×600, Step 1 open)

| What | Measurement |
|---|---|
| `.tr-left-panel` | y=52, 1024×548 |
| Two-column grid `#step1CaptureControls` | x=24, y=68, 976×524 |
| Left column | 472 px wide |
| Field groups (label 21 + control 48) | at y=94 / 177 / 260, each 69 tall, a pitch of **83 px** |
| Last group ends at | y=329 |
| "Back to Instructions" | starts at y=548 |
| Right column: Record | 72 tall |
| Right column: dataset button | y=154 |
| Right column: Next: Train AI | y=300–352 |
| `scrollWidth` / `scrollHeight` | 1024 / 600 (no page scroll) |

- The on-screen keyboard is 280 px tall (`css/virtual-keyboard.css:8`), so with it open it
  covers y ≥ 320.
- The dataset modal card is 475×479 at x=275, y=61. With the keyboard open it measures
  y=16–305 (289 tall).
- Modal rows are 29 px. The Delete button is **45×17**, below the 44 px touch minimum. That
  was already the case before this phase.

### Proposed Step 1 form (two columns, no page scroll)

```
┌ left column (472) ─────────────────────┐ ┌ right column (472) ──────────────────────┐
│ Sign Set   [ ESL ][ FSL ][ Both ]   y68 │ │ [ Record 3 samples ]  72 px          y68 │
│ English text  [How are you?_______] 151 │ │ "how_are_you" — new sign, no samples…    │
│ Filipino text [Kumusta ka?________] 234 │ │ [📁 View Active Gesture Dataset  122 ›]  │
│ Type [Word][Letter][Number][Phrase] 317 │ │ [Export Data] [Load Saved]                │
│                                  ↓386 │ │ [ Next: Train AI → ]                      │
└────────────────────────────────────────┘ └──────────────────────────────────────────┘
                     [ ← Back to Instructions ]  y548
```

- **Groups.** The decorative "Gesture Sample Capture" label (12 px + 14 px gap) is removed,
  so the first group starts at y=68. With the measured 83 px pitch, Both (4 groups) ends at
  y=386, which leaves 162 px clear above y=548. ESL or FSL (3 groups) ends at y=303.
- **Keyboard.** The Filipino text input is the lowest text field. It ends at y=303, which is
  17 px above the open keyboard's top edge (y=320), so typing in either field never needs a
  scroll.
- **Which fields show.** ESL shows English only, FSL shows Filipino only, and Both shows both
  (decision 2). Each shown field is required: Record shows the toast "Enter the English text
  first." / "Enter the Filipino text first."
- **Texts are kept as typed.** No trimming of case or punctuation, apart from a leading and
  trailing `trim()`.
- **The key is derived, never typed.** It is `cleanLabel(English)` for ESL/Both and
  `cleanLabel(Filipino)` for FSL, and the sample-count line shows it.
- **If the key already exists with a different set**, the line says, for example: "“hello”
  already exists as ESL — change it to Both in View Active Gesture Dataset first.", and
  Record is disabled (Q4).
- **If it exists with the same set**, the line shows today's sample count and the
  "aim for 5" target.
- **Type.** Auto-select keys off the derived key, using the same heuristic as today.
- **Recording.** The recording-mode chip shows `How are you? · Both · Phrase`.

### Proposed dataset view (View Active Gesture Dataset)

- **Size.** The card widens from 475 px to `min(960px, 100vw − 32px)`, which is 960 at
  1024×600.
- **Table columns.** English text | Filipino text | Set (ESL / FSL / Both) | Samples |
  **Edit** | Delete.
  - Rows grow to 44 px. Edit and Delete become 44×44 (which also fixes the 45×17 Delete).
  - A text the sign doesn't use shows as "—".
  - The table scrolls inside the modal body. The page itself never scrolls.
- **Search** matches the key, the English text or the Filipino text.
- **Tabs** keep Words / Letters / Numbers / Phrases, and count signs (122 after migration).
- **Edit** swaps the table for an edit panel in the same card:

```
┌ Edit sign — key: how_are_you · 1 sample ───────────────────────────── ✕ ┐
│ Sign Set  [ ESL ][ FSL ][ Both ]        │ English text  [How are you?__] │
│ Type: Phrase (unchanged here)           │ Filipino text [Kumusta ka?___] │
│                              [ Cancel ]  [ Save ]  (48 px)               │
└──────────────────────────────────────────────────────────────────────────┘
```

  Height budget with the keyboard open:

  | Part | Height |
  |---|---|
  | Header | 43 |
  | Right column (2 × 69 + 14) | 152 |
  | Buttons | 48 |
  | Paddings (3 × 12) | 36 |
  | **Total** | **279** |

  279 is less than the measured 289 px card height with the keyboard open, so it fits.
- **Save behavior.**
  - Save posts to `signs.php` `update` and shows the toast "Saved.". Fields follow the same
    show/required rules as Step 1.
  - The panel returns to the table on the same tab and search.
  - The table re-renders from a fresh list.
- **Delete** keeps `deleteGesture()`. Its confirm text gains "(ESL and FSL)" for a Both sign.

---

## (f) How Let's Talk and text-to-sign read the texts

- **Text lookup.**
  - `gesture-data.js` gains `loadSigns()`, which fetches `php/api/signs.php` (GET) once, and
    `getSignText(key, lang)` (`'en'` → `textEn`, `'fil'` → `textFil`).
  - `loadSavedGestureDataset` fills the same map from the list response's `signs`, so
    gesture-training makes no second request.
  - TalkLoader's existing `gestures` item (`js/talk-loader.js:48-53`) runs
    `Promise.all([autoTrainForTranslate(), GestureDataRecorder.loadSigns()])`. It is still
    one queue item, and the Guide gating is unchanged.
- **Sign-to-text.**
  - Both copies of `translateGestureLabel(label, lang)`
    (`js/sign-to-text-ui.js:62`, `js/gesture-training-ui.js:197`) first return
    `getSignText(label, lang)` if it exists. The old `SIGN_TRANSLATIONS` / Title Case
    fallback stays for `start`/`stop` and for a sign with no text.
  - Let's Talk's live caption (`js/talk-signing.js:184`) and its word list (`:205`) already
    go through `translateGestureLabel(confirmed, signLang)`. ESL therefore shows `textEn` and
    FSL shows `textFil`, and **`talk-signing.js` itself is not changed.**
  - `formulateSmartSentence` keeps the casing. It leaves a sentence ending in `. ? !` alone
    (`sign-to-text-ui.js:1054-1056`), so the single sign "How are you?" stays "How are you?".
  - The history row's `sign_language` stays the active model's language (ESL/FSL).
- **Gesture-training Steps 3–4.** The four `detected.replace(/_/g,' ')` sites
  (`js/gesture-training-ui.js:781,788,798,815`) become
  `translateGestureLabel(detected, modelLanguage()==='FSL' ? 'fil' : 'en')`. Predict then
  shows the English text in ESL and the Filipino text in FSL (decision 4 and the "Verify at
  the end" check).
- **Text-to-sign** (`js/sign-player.js`).
  - **Registration.** `fetchAndRegisterCustomGestures` (`:242-267`) reads `signs.php` instead
    of the frame-heavy dataset list:
    - an ESL/Both sign registers `normalizeSpeechText(textEn)` in `signAssetMapEn`;
    - an FSL/Both sign registers `normalizeSpeechText(textFil)` in `signAssetMapFil`;
    - the value is the sign's `asset_path` (for example `assets/signs/en/how_are_you.webm`).
      If it has none, the value is `<key>.webm`, as today;
    - stock entries still win (`if (!targetMap[…])`, unchanged);
    - multi-word texts become known phrases through the existing `rebuildKnownPhrases()`.
  - **Playback.** `displaySignWithFallback` (`:399-402`) uses a value that already starts
    with `assets/` as-is instead of prefixing the language folder. That way a Both sign whose
    only clip is under `en/` plays in FSL too.
  - Both edits are inside sections marked "VERBATIM". They will be listed as departures in
    that file's header, the way earlier ones were.
- **Reports** (`php/api/reports.php`, `reports.html`).
  - The ESL tab lists `sign_language IN ('ESL','BOTH')` with Text = `text_en`. The FSL tab
    lists `IN ('FSL','BOTH')` with Text = `text_fil`.
  - Columns change from ID | Key | Label | Text | Asset | Created to
    ID | Key | Set | Text | Asset | Created (Q14).
  - Without this change, Both signs would vanish from both tabs.

---

## (g) Files, tasks, open questions

### Files changed (planned)

| File | Change |
|---|---|
| `php/api/save_gesture.php` | Save (set/texts/key/409/single folder/`sign.json`), list (`signs` map, Both in both `categories`), sync (`sign.json` → DB, upsert by label), delete (by unique label) |
| `php/api/gesture_category.php` | `ensure_gestures_columns`: enum with BOTH, plus `text_en`/`text_fil` if missing |
| `php/api/signs.php` | **new**: GET list, POST update |
| `php/api/reports.php`, `reports.html` | Both in both tabs, Set and Text columns |
| `db-schema/database_setup.sql` | New `gestures` DDL |
| `db-schema/migrations/2026-10-04-sign-texts.php` | **new**: the migration |
| `db-schema/migrations/2026-10-04-sign-texts-pairs.json` | **new**: the 89-pair fixture |
| `gesture-training.html` | Sign Set gains Both. Gesture Name becomes two text fields. Section label removed. Step 2 model toggle. Dataset modal markup (edit panel). |
| `css/gesture-training.css` | Three-way Sign Set toggle, wider modal, 44 px rows, edit panel. `?v=` bump. |
| `js/gesture-training-ui.js` | Form logic and key derivation, dataset table/edit, `modelLanguage()`, the `targetLang` source and set filter in `mergeSavedGestureSamples`/`trainModel`, Predict text, `translateGestureLabel` lookup |
| `js/gesture-data.js` | `saveGestureSample` sends set/texts. Sign map + `loadSigns`/`getSignText`. Rows carry the set. Model-schema reset. |
| `js/gesture-capture-ui.js` | `open()` accepts `signSet:'BOTH'` and `textEn`/`textFil` and passes them into the save. `invalidateCaches` for both languages. **No state or flow change.** |
| `js/sign-to-text-ui.js` | Set filter in `mergeSavedGestureSamples` and the `translateGestureLabel` lookup |
| `js/talk-loader.js` | `gestures` item also runs `loadSigns()` |
| `js/sign-player.js` | Registration from `signs.php`, and asset values with a full path |
| `js/virtual-keyboard.js` | Punctuation keys (only if Q11 = yes) |
| `saved_gestures/*/sign.json` | **new**: 120 tracked folders, plus `hi`/`yow` locally (untracked, never committed) |
| `saved_gestures_fsl/**` | 90 files removed from the repo (moved to the backup folder) |
| `tests/sign-texts/*.test.mjs` | **new**: endpoint, save, migration, JS units |
| `tests/categorization/save-category.test.mjs` | Only if its scratch-table check of `ensure_gestures_columns` breaks because of the added columns. It will be verified, not assumed. |
| `docs/system/BACKEND.md` (schema, ERD, endpoints), `UI.md`, `DECISIONS.md`, `DEBT.md`, `INVENTORY.md`, `docs/reports/2026-10-04-sign-texts-*.md` | Docs |

### Not changed

- `knnPredict`, `cosineSimilarity`
- `js/capture-core.js`, `js/video-landmarks.js`, and `gesture-capture-ui.js`'s states and
  flow
- The v2/v3 sample formats and every existing sample file. The ESL files are never
  rewritten, and the FSL duplicates are moved byte-for-byte.
- `assets/signs/**`, `archive/**`
- `docs/revision/MEMORY.md`, `docs/system/MANUAL-CHECKS.md`
- `js/talk-signing.js`, `js/talk-speaking.js`, `js/talk-history.js`, `talk.html`
- `php/api/save_conversation.php`, `php/api/conversations.php`, the `messages` table
- `diagnostic.html`
- The 2026-09-24 migration scripts
- `saved_gestures/hi`, `saved_gestures/yow` (beyond adding a local `sign.json`)

### Tasks (subagent-driven, max 3 review rounds each)

0. **Backup and baseline.**
   - Run `mysqldump --single-transaction` to
     `E:\ACADSS\IOT\backups\2026-10-04-sign-texts\sining_kamay_db_before-sign-texts.sql`.
   - Copy all of `saved_gestures/` and `saved_gestures_fsl/` into the same folder.
   - Record the counts (211/216; 122+89 folders; 127+89+1 files) and run the existing serial
     suite plus the conversations suite as a baseline.
   - *Done when* the dump size and the file count are recorded and the baseline pass/fail
     list is written down.
1. **Migration script, fixture, and clone test.**
   - *Done when* `tests/sign-texts/migration.test.mjs` passes on a clone: the counts are
     122/127, the manifest has 90 entries with matching hashes, a re-run is a no-op,
     resume-after-every-step works, and the tamper case aborts with 0 moved.
2. **Server.** `save_gesture.php`, `gesture_category.php`, `signs.php`, `database_setup.sql`.
   - *Done when* new endpoint tests pass: Both saves land in one folder with `sign.json` and a
     BOTH row; FSL keys come from the Filipino text; the 409 collision case works; update
     rejects missing required texts; an edit survives a full sync. The existing serial suite
     must also pass unchanged.
3. **Run the migration on live.**
   - *Done when* the printed verify output matches (c) step 8, a following full GET changes
     nothing, and `moved-manifest.json` lists 90 files with backup paths.
4. **Training UI.** Step 1 form, key and collision line, capture open opts, Step 2 model
   toggle, merge/train filter, Predict text, schema reset.
   - *Done when* at 1024×600, Step 1 has no scroll in ESL/FSL/Both, the inputs end at
     y ≤ 320, and every control is ≥ 44 px.
   - Recording a Both sign gives 3 samples in one folder. Train AI ESL then FSL both include
     it. Predict shows English in ESL and Filipino in FSL. 0 console errors.
5. **Dataset view.** Columns, edit panel, `signs.php` update, cache invalidation.
   - *Done when* an edit of set and texts survives reload and a full sync without
     re-recording, the edit panel fits with the keyboard open, and there is no page scroll.
6. **Let's Talk and text-to-sign.**
   - *Done when* in talk.html sign-to-text shows the sign's English text in EN and its
     Filipino text in FIL, and Speak or Type plays a Both sign's clip for its English text
     (EN) and its Filipino text (FIL). Measured with `?devqueue` and 0 console errors.
7. **Reports and keyboard** (keyboard only if Q11 = yes).
   - *Done when* a Both sign shows in both Reports tabs with the right text. If the keyboard
     changes: `? ! , . ' -` type correctly, talk.html Speak or Type has no layout regression
     at 1024×600, and the keyboard is still 280 px tall.
8. **Verify, review, document, commit.**
   - Run the full "Verify at the end" list with measured numbers, then a whole-phase review.
   - Update the docs, write `docs/reports/2026-10-04-sign-texts-final.md`, and check that
     `git diff --stat` matches the file list above.
   - Commits: code, then data (`sign.json` adds plus `saved_gestures_fsl` removals), then
     docs. No push, no merge.

### Open questions, each with my recommended default

1. **Column name:** keep `gestures.sign_language` and widen it to `('ESL','FSL','BOTH')`, or
   rename it to `sign_set`? → **Keep** (no test churn, see (b)).
2. **Folder for new signs:** use one folder, `saved_gestures/<key>/`, for every set, and stop
   writing to `saved_gestures_fsl/`? → **Yes.**
3. **Where set and texts live on disk:** in a per-sign `sign.json` (disk is the truth),
   leaving `category` DB-only? → **Yes**, `category` unchanged.
4. **Key collisions.** If the same key has the same set, add the samples and update the
   texts. If the set differs, block it (409, and a message in the UI) and edit in the dataset
   view first. → **Yes.**
5. **New sample files:** keep `signLanguage` as `"ESL"` (for ESL and Both) or `"FSL"`, so the
   format stays unchanged? → **Yes.**
6. **Draft texts:** label with `_` → space and a capital first letter (for example
   "Kamusta ka", "Dont know"). The owner then corrects them, including apostrophes like
   "Don't". → **Yes.**
7. **18 category conflicts** (marked in the table): keep the ESL sign's category? → **Yes.**
8. **`makita`/`see`:** merge as Both on the proof of identical landmarks, keeping
   `asset_path` `en/see.webm` (`fil/makita.webm` stays on disk and still plays for FSL
   "Makita")? → **Yes.** The alternative is leaving it FSL-only, which would contradict the
   data proof.
9. **Stray root file:** move it to the backup as a proven duplicate of `my_name`? → **Yes.**
10. **Narrowing a sign's set** (Both → ESL): keep its now-hidden Filipino text stored, unused,
    so that switching back restores it? → **Keep.**
11. **Keyboard punctuation:** add `- ' , . ? !` to the bottom row of `js/virtual-keyboard.js`
    (same 5 rows, height unchanged at 280)? This also affects talk.html's keyboard. → **Yes.**
    Without it, decision 2's punctuation can't be typed on the kiosk.
12. **Step 2 "AI model: ESL | FSL" toggle** (it defaults from Step 1, with Both → ESL), so Train
    AI and Predict know which model to use? → **Yes.**
13. **One-time localStorage model reset** (`sining_kamay_model_schema` = 2) so no stale
    Tagalog-keyed cache survives in talk.html? → **Yes.**
14. **Reports columns** become ID | Key | Set | Text | Asset | Created. → **Yes.**
15. **Commits:** three of them, code / data / docs. That matches "code and docs separately"
    and keeps the 90 file removals and 120 `sign.json` adds out of the code diff. → **Yes.**
