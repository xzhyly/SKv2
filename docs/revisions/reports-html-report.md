# reports.html Revision Report

Date updated: 2026-06-05

## File Name

`reports.html`

## Current State

`reports.html` is the database-backed reports screen for Sining Kamay. It displays summary counts, tabbed report tables, and print/save-to-PDF behavior.

The file contains inline CSS and inline JavaScript. No source modifications were made during this analysis step.

## Problems Found

## 1. Screen Inventory

Visible sections:

- Main page wrapper: `.page`
- Header area:
  - Title: `Reports`
  - Description: `ESL signs, FSL signs, and translation history from the database.`
  - Header actions.
- Summary/stat card area:
  - ESL Signs count.
  - FSL Signs count.
  - Translations count.
- Tab navigation:
  - ESL Signs tab.
  - FSL Signs tab.
  - Translations tab.
- Report table sections:
  - `#tab-esl`
  - `#tab-fsl`
  - `#tab-translations`

Stat cards:

- `.metric` card for `#eslCount`.
- `.metric` card for `#fslCount`.
- `.metric` card for `#translationCount`.

Tables:

- ESL signs table:
  - Columns: ID, Key, Label, Text, Asset, Created.
  - Body ID: `eslRows`.
- FSL signs table:
  - Columns: ID, Key, Label, Text, Asset, Created.
  - Body ID: `fslRows`.
- Translations table:
  - Columns: ID, Source, Sign, Text, Language, Confidence, Created.
  - Body ID: `translationRows`.

Filters:

- No text search filters.
- No date filters.
- No type/status filters.
- Existing tabs function as category filters.

Buttons:

- Print / Save PDF button.
- ESL Signs tab button.
- FSL Signs tab button.
- Translations tab button.

Navigation controls:

- Dashboard link back to `index.html`.
- Tab buttons for switching visible report tables.

## 2. Layout Map

Current layout structure:

- `body` uses a bright gradient background.
- `.page` is a centered card with max width `1180px`, margin `28px auto`, and `calc(100% - 36px)` width.
- Header uses flex layout with title/description on the left and actions on the right.
- Summary uses a 3-column grid.
- Tabs use a horizontal flex row.
- Each section contains a `.table-wrap` around a full-width table.
- Tables use `min-width:760px`, creating horizontal overflow on narrow displays.

Container hierarchy:

- `body`
  - `.page`
    - `header`
      - title/description block
      - `.header-actions`
    - `.summary`
      - three `.metric` cards
    - `.tabs`
      - three `.tab` buttons
    - `section#tab-esl`
      - `.table-wrap`
        - `table`
          - `tbody#eslRows`
    - `section#tab-fsl`
      - `.table-wrap`
        - `table`
          - `tbody#fslRows`
    - `section#tab-translations`
      - `.table-wrap`
        - `table`
          - `tbody#translationRows`

Space usage review:

- The page margin and header/summary/tabs padding consume significant vertical space for a 600px-tall kiosk.
- The summary cards are readable but large relative to available height.
- Table content gets the remaining space, but no fixed kiosk-height strategy exists.
- Tables are designed for desktop width rather than a 1024 x 600 kiosk frame.
- Print styles are present and should be preserved.

## 3. CSS Inventory

Inline CSS count:

- One inline `<style>` block.
- Estimated CSS size: 3,417 characters.
- Estimated CSS lines: 46.
- Estimated CSS rule blocks: 46.
- Inline style attributes: 0.

Duplicated styling:

- Pill-shaped controls repeat across `.back`, `.tab`, `.pill`, and `.print-btn`.
- Light card surfaces repeat across `.page`, `header`, `.summary`, `.metric`, `.tabs`, `.table-wrap`, and `th`.
- Pink border/color values repeat in several selectors.
- Table cell padding and borders are repeated with light-pink values.

Design-system violations:

- Uses bright gradient background instead of approved dark kiosk background.
- Uses white/pink surfaces instead of approved dark surfaces.
- Uses `border-radius:18px`, `14px`, and `999px`, inconsistent with the approved radius rules.
- Uses desktop-oriented max width `1180px`, wider than the 1024 kiosk target.
- Allows horizontal table scrolling through `.table-wrap{overflow:auto}`.
- Does not use the shared design-system tokens established in `style.css` and the updated camera screen.

Dark-theme inconsistencies:

- Body background is purple/pink gradient.
- Main page/card surfaces are white.
- Metric cards are pale pink.
- Table headers and rows are light pink/white.
- Text colors are dark purple/pink instead of approved dark-theme text colors.

## 4. 1024x600 Kiosk Review

Overflow risks:

- `.page` width can exceed the kiosk target conceptually because it is sized up to 1180px.
- Tables have `min-width:760px`; with page padding, the translation table may push horizontal overflow.
- Long values in Asset, Text, and Created columns may stretch or wrap unpredictably.

Scroll risks:

- `.table-wrap` uses `overflow:auto`, allowing horizontal and/or vertical table scrolling.
- Body is not locked to a no-scroll kiosk layout.
- With header, summary, tabs, and table padding, table rows can force page overflow at 600px height.

Height utilization:

- Header padding: 22px top/bottom.
- Summary padding: 20px top/bottom.
- Tabs padding: 18px bottom.
- Section padding: 28px bottom.
- These values are comfortable on desktop but too spacious for 1024 x 600.

Width utilization:

- Three metric cards fit at 1024px, but table columns are the main width pressure.
- Translation table has seven columns and is the most likely to overflow.
- No compact table/card alternative exists for kiosk use.

## 5. Touch Usability Review

Button sizing:

- Print button has adequate padding but no explicit min-height.
- Dashboard link has adequate padding but no explicit min-height.
- Tab buttons are likely below the preferred 48px kiosk touch target.
- Three tab buttons are visually clear but could use stronger active/focus states.

Table usability:

- Tables are dense and scan-heavy for kiosk use.
- Small 12px table headers may be hard to read at kiosk distance.
- Horizontal scrolling is not ideal for kiosk touch use.
- Rows do not have strong visual grouping.

Navigation accessibility:

- Dashboard is an anchor and likely works correctly.
- Tab buttons lack explicit `type="button"`.
- Tab state is visual only; no ARIA tab roles or `aria-selected` are present.
- Print action is discoverable but should remain secondary to reading reports.

## 6. Data Presentation Review

Statistics readability:

- Metric numbers are large and readable.
- Labels are uppercase and clear.
- The cards should be converted to dark surfaces with high-contrast numbers.

Table readability:

- Column labels are clear.
- Current table is readable on desktop, but dense for kiosk use.
- Long text, asset paths, and timestamps can reduce readability.
- Empty states are clear but should match dark theme.

Information hierarchy:

- Good high-level hierarchy: title, summary, tabs, table.
- In a 600px kiosk viewport, summary + tabs may leave too little room for tables.
- Reports may benefit from a compact header and denser summary row.

## 7. Architecture Dependency Review

IDs that must not change:

- `eslCount`
- `fslCount`
- `translationCount`
- `tab-esl`
- `tab-fsl`
- `tab-translations`
- `eslRows`
- `fslRows`
- `translationRows`

JavaScript dependencies:

- `esc(value)`
- `renderSigns(target, rows)`
- `renderTranslations(target, rows)`
- `.tab` buttons with `data-tab` values.
- `section` elements whose IDs match `tab-${button.dataset.tab}`.
- `printReport()`
- `body.printing` class.
- `afterprint` event listener.
- `fetch(REPORTS_API)`
- Error insertion into `.page`.

API dependencies:

- `api/reports.php`
- Local-server exception for port 5500:
  - `http://localhost/Sign-Language-Translator/api/reports.php`

Database dependencies:

- Reports API response is expected to provide:
  - `json.success`
  - `json.summary.esl_signs`
  - `json.summary.fsl_signs`
  - `json.summary.translations`
  - `json.data.esl_signs`
  - `json.data.fsl_signs`
  - `json.data.translations`
- Row fields expected by the UI:
  - Signs: `id`, `sign_key`, `sign_label`, `text_value`, `asset_path`, `created_at`
  - Translations: `id`, `source_type`, `sign_label`, `translated_text`, `language`, `confidence`, `created_at`

## 8. Planned UI Changes

Pending approval, revise `reports.html` only to:

- Convert the page to the approved dark kiosk theme.
- Lock the screen toward a 1024 x 600 no-scroll layout.
- Reduce header, summary, tabs, and section padding.
- Constrain the page to the kiosk viewport instead of a desktop max width.
- Standardize buttons, tabs, cards, borders, and radius.
- Improve touch target sizing for tabs, print, and dashboard navigation.
- Make tables more compact and readable.
- Reduce reliance on horizontal table scrolling where practical.
- Add safer tab accessibility attributes if this can be done without changing behavior.
- Preserve print behavior.
- Preserve API endpoint logic and database field expectations.
- Avoid backend, API, database, and deployment changes.

## 9. Risk Assessment

Risk level: Medium.

Reason: The visual file is small, but the report data is populated dynamically from the API. Table IDs, tab IDs, `data-tab` attributes, and API response assumptions must remain unchanged.

Primary risks:

- Breaking tab-to-section mapping.
- Breaking API row rendering by changing IDs.
- Making tables too compact for real data.
- Accidentally degrading print/PDF output.
- Hiding important database data in an attempt to fit 1024 x 600.

## 10. Expected UI Result

- Reports screen matches the dark kiosk theme.
- Summary stats remain prominent and readable.
- Tables fit the 1024 x 600 kiosk layout more gracefully.
- Tabs and navigation controls become touch-friendly.
- Print/Save PDF remains available.
- Existing API and database behavior remain unchanged.

## Planned Changes

See section 8 above.

## Expected UI Result

See section 10 above.

## Risk Assessment

See section 9 above.

## Approval Status

Modification approved by user. Completion report waiting for user approval.

## Changes Applied

- Converted the reports screen to the approved dark kiosk theme.
- Replaced the desktop-style bright gradient and white report card with dark surfaces and shared accent colors.
- Converted `.page` from a generic `div` into a `main` landmark while preserving `class="page"` for JavaScript error handling.
- Constrained the report shell to the kiosk viewport with `height: calc(100vh - 32px)` and `max-width: 992px`.
- Rebuilt the page shell as a grid: header, summary metrics, tabs, active table region.
- Improved metric cards with stronger contrast, larger gold count values, and compact spacing.
- Standardized buttons, tabs, cards, borders, and radii around the approved design system.
- Added explicit `type="button"` to tab controls.
- Changed tables to `table-layout: fixed` with ellipsis behavior to reduce horizontal scrolling.
- Preserved print media styles and existing print behavior.
- Preserved all protected IDs, tab `data-tab` values, API endpoint logic, and database field assumptions.

## UI Improvement Summary

- `reports.html` now visually matches `style.css`, `index.html`, and `camera-translator.html`.
- The summary dashboard is more immediately readable in kiosk conditions.
- Tables now use a compact dark presentation with stronger row separation.
- Navigation back to the Welcome Screen remains clear and visible.

## Layout Changes

- The page now uses a full kiosk shell with `body` padding of 16px and a fixed-height report container.
- Header, metric summary, tabs, and table areas are organized in a four-row grid.
- Section/table areas use the remaining available height instead of relying on desktop margins.
- The main report container now targets the 1024px kiosk width with `max-width: 992px`.

## Statistics Dashboard Improvements

- Summary cards use dark elevated surfaces.
- Metric labels remain compact and uppercase.
- Metric values are larger and use the approved gold accent.
- Card padding was reduced so all three metrics remain visible above the table.

## Table Improvements

- Tables now use fixed layout instead of a desktop `min-width`.
- Cell text uses ellipsis to avoid horizontal overflow.
- Row borders and alternating row shading improve record separation.
- Header cells use compact uppercase labels with improved contrast.
- Key/source pills now match the dark design system.

## Navigation Improvements

- Dashboard link remains pointed at `index.html`.
- Print / Save PDF remains available.
- Tabs are touch-sized and now explicitly use `type="button"`.
- The page wrapper is now a `main` landmark for clearer document structure.

## 1024x600 Verification Results

- CSS includes `height: calc(100vh - 32px)` for the main report shell.
- CSS uses `overflow:hidden` at the body, page, section, and table-wrap levels.
- The report shell is constrained to `max-width: 992px`, fitting inside a 1024px viewport with 16px side padding.
- Header, summary, tabs, and active table are arranged to keep critical report information visible.

## Scroll Reduction Results

- Removed table `min-width: 760px`.
- Replaced `.table-wrap{overflow:auto}` with hidden overflow and fixed table layout.
- Added cell ellipsis to prevent long text from forcing horizontal scrolling.
- Remaining limitation: large data sets cannot all be visible at once in 600px height; the kiosk view prioritizes summary metrics and visible top rows.

## Remaining Issues

- Very long report values are clipped with ellipsis instead of fully shown.
- Large datasets still exceed what can be fully displayed in 1024 x 600.
- No search/date filters exist.
- Print styling remains separate and should be rechecked visually when print/PDF is used.
- Browser visual verification was not run because local preview was previously blocked by the in-app browser policy.

## Risk Assessment

Risk level: Low to Medium.

Reason: changes were limited to UI markup/CSS and tab button types. Protected IDs, API endpoint logic, render functions, and database response assumptions were preserved.

## Next Recommended Phase

After user approval of this completion report: Phase 2 UI Review.

## Verification Results

- Confirmed one inline CSS block of about 3,417 characters and 46 lines.
- Confirmed one inline script block of about 2,972 characters and 67 lines.
- Confirmed 0 inline `style=` attributes.
- Confirmed 4 buttons, 3 tables, and 3 report sections.
- Confirmed all 4 buttons now have explicit `type="button"`.
- Confirmed structural `div` and `section` tags are balanced.
- Confirmed print media styles exist.
- Confirmed reports API endpoint is `api/reports.php` except under port 5500.
- Confirmed all 9 protected report IDs remain present.
- Confirmed CSS brace count is balanced: 67 opening braces and 67 closing braces.
- Confirmed `fetch(REPORTS_API)` and `printReport()` remain present.
- `reports.html` was modified after user approval for the UI-first revision.

## Screens Impacted

Reports screen.

## Next Recommended File

After approved `reports.html` completion approval: Phase 2 UI Review.
