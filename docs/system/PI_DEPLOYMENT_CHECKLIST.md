# Pi deployment checklist

Checks that need the actual Raspberry Pi 4B hardware/Chromium kiosk — local
XAMPP dev (see `CLAUDE.md`) can't stand in for these. Tick each off once
verified there.

## Font loading in kiosk mode

- [ ] Boot the kiosk normally (`start_kiosk.sh`) and check every screen
      (`index.html`, `sign-to-text.html`, `gesture-training.html`,
      `reports.html`, `learn-signs.html`) renders text in Inter, not a
      fallback font (`Segoe UI`/`Nunito`/system sans).
      `css/fonts.css` self-hosts it from `assets/fonts/Inter-Variable-latin.woff2`
      (48,256 bytes) — confirm that file is present and readable at the Pi's
      deployed path, and that Chromium's kiosk profile isn't blocking local
      `@font-face` loads.

## Confirm true offline behavior

- [ ] With the Pi's network interface disabled (or no route to the internet),
      load each of the six root screens above in the kiosk and confirm the
      DevTools Network panel (or `chrome://net-export`) shows **zero** requests
      leaving `localhost` — no DNS lookups, no failed external requests, no
      hangs waiting on a timeout. This is the practical test of the "offline
      only" hard rule in `CLAUDE.md`; local dev under XAMPP can't distinguish
      "never tries" from "tries and fails fast," since both look the same with
      network access present.
- [ ] Specifically watch `index.html` on first load — confirm no request to
      `fonts.googleapis.com` or any other external host fires before the
      dashboard renders (regression check for `docs/system/DEBT.md` item 1).
- [ ] Known, accepted exception: `learn-signs.html` embeds a live Netlify
      iframe (`docs/system/DEBT.md` item 29) — this **will** attempt a network
      request and is expected to fail/blank with the Pi offline. Not a
      regression; a separate, already-tracked defect.
