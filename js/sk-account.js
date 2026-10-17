// js/sk-account.js
// Accounts (accounts-quiz phase, 2026-10-18): the account chip / Log in button, the account menu,
// Log out, the admin-page guard and small helpers shared by the new pages.
//
// Who is logged in comes from window.SK_ME, set by <script src="php/api/me.php"></script>, which
// every page using this file loads first (a classic script, so it is known before anything draws:
// no flash of the wrong header, and an admin page can send a non-admin away before it shows).
// The server never trusts this value: every PHP endpoint re-checks the PHP session itself.
(function () {
  'use strict';

  // Inline SVG icons, 24x24 stroke icons like the dashboard cards.
  var ICONS = {
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    chat: '<path d="M21 11.5a8.4 8.4 0 0 1-12.2 7.5L3 21l2-5.6A8.4 8.4 0 1 1 21 11.5z"/>',
    quiz: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 9l2 2 4-4M8 16h8"/>',
    train: '<line x1="8" y1="16" x2="16" y2="8"/><path d="M5 14l5 5M4 15l5 5M15 4l5 5M14 5l5 5"/>',
    bars: '<path d="M6 20v-6M12 20V4M18 20v-10"/>',
    upload: '<path d="M12 16V4M7 9l5-5 5 5M4 20h16"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6.5 6.5 0 0 1 3.5 6"/>',
    out: '<path d="M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4M10 17l-5-5 5-5M5 12h11"/>'
  };

  function icon(name, size, color) {
    return '<svg width="' + (size || 20) + '" height="' + (size || 20) + '" viewBox="0 0 24 24" fill="none" stroke="' +
      (color || 'currentColor') + '" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      ICONS[name] + '</svg>';
  }

  function me() { return window.SK_ME || null; }
  function isAdmin() { var u = me(); return !!u && u.role === 'admin'; }

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function initial(name) {
    var s = String(name || '?').trim();
    return s ? s.charAt(0).toUpperCase() : '?';
  }

  function menuItems(user) {
    if (user.role === 'admin') {
      return [
        ['Train Gestures', 'gesture-training.html', 'train'],
        ['View Reports', 'reports.html', 'bars'],
        ['Bulk import', 'bulk-import.html', 'upload'],
        ['Manage users', 'users.html', 'users'],
        ['All conversations', 'conversations.html', 'chat'],
        ['Quiz results', 'quiz-scores.html', 'quiz']
      ];
    }
    return [
      ['My conversations', 'conversations.html', 'chat'],
      ['My quiz scores', 'quiz-scores.html', 'quiz']
    ];
  }

  function chipHtml(user, withCaret) {
    var tag = user.role === 'admin' ? '<span class="sk-tag">ADMIN</span>' : '';
    return '<span class="sk-av">' + esc(initial(user.display_name)) + '</span>' +
      '<span class="sk-chip-name">' + esc(user.display_name) + '</span>' + tag +
      (withCaret ? '<span class="sk-caret">&#9662;</span>' : '');
  }

  // Draws the account area into container.
  //   opts.menu: true  -> logged in: a chip that opens the account menu (dashboard)
  //              false -> logged in: a plain chip (Let's Talk, quiz, lists)
  //   opts.login: show a "Log in" button for a guest (default true); false shows a "Guest" chip.
  function renderAccount(container, opts) {
    opts = opts || {};
    var user = me();
    container.classList.add('sk-acct');
    if (!user) {
      if (opts.login === false) {
        container.innerHTML = '<span class="sk-chip" id="sk-chip"><span class="sk-av">G</span><span class="sk-chip-name">Guest</span></span>';
      } else {
        var next = opts.next ? '?next=' + encodeURIComponent(opts.next) : '';
        container.innerHTML = '<a class="sk-login-btn" id="sk-login-btn" href="login.html' + next + '">' + icon('user', 18) + 'Log in</a>';
      }
      return;
    }
    if (!opts.menu) {
      container.innerHTML = '<span class="sk-chip" id="sk-chip">' + chipHtml(user, false) + '</span>';
      return;
    }
    var items = menuItems(user).map(function (it) {
      return '<a class="sk-menu-item" href="' + it[1] + '">' + icon(it[2], 20) + esc(it[0]) + '</a>';
    }).join('');
    container.innerHTML =
      '<button type="button" class="sk-chip" id="sk-chip" aria-haspopup="true" aria-expanded="false">' + chipHtml(user, true) + '</button>' +
      '<div class="sk-menu" id="sk-menu" hidden>' +
        '<div class="sk-menu-hd">Signed in as <b>' + esc(user.username) + '</b></div>' + items +
        '<button type="button" class="sk-menu-item out" id="sk-logout">' + icon('out', 20) + 'Log out</button>' +
      '</div>';
    var chip = container.querySelector('#sk-chip');
    var menu = container.querySelector('#sk-menu');
    function setOpen(open) {
      menu.hidden = !open;
      chip.setAttribute('aria-expanded', open ? 'true' : 'false');
    }
    chip.addEventListener('click', function (e) { e.stopPropagation(); setOpen(menu.hidden); });
    document.addEventListener('click', function (e) { if (!container.contains(e.target)) setOpen(false); });
    container.querySelector('#sk-logout').addEventListener('click', function () { logout(); });
  }

  function logout() {
    return api('php/auth.php', { action: 'logout' }).catch(function () { /* the page load below shows the truth */ })
      .then(function () {
        location.href = 'index.html';
      });
  }

  // Stops this page from loading any further and goes to url (no flash, no page scripts run).
  function leave(url) {
    document.documentElement.style.visibility = 'hidden';
    try { window.stop(); } catch (e) { /* old browser */ }
    location.replace(url);
  }

  // Admin-only pages call this from <head>: a non-admin goes to the dashboard at once (the page's
  // own scripts never run). An admin stays and the page opens directly: the logged-in admin role is
  // the only gate (owner decision, 2026-10-18: no PIN). The admin APIs check the session themselves
  // (HTTP 403).
  function adminPage() {
    if (!isAdmin()) {
      leave('index.html');
      return false;
    }
    return true;
  }

  // Pages for logged-in accounts only: a guest goes to the login page, and comes back after.
  function loginPage(next) {
    if (me()) return true;
    leave('login.html?next=' + encodeURIComponent(next));
    return false;
  }

  // JSON request helper. GET when body is undefined. Resolves the parsed JSON, also for error
  // statuses (the endpoints answer {success:false, ...}); rejects only on a network/parse failure.
  function api(url, body) {
    var init = { credentials: 'same-origin', cache: 'no-store' };
    if (body !== undefined) {
      init.method = 'POST';
      init.headers = { 'Content-Type': 'application/json' };
      init.body = JSON.stringify(body);
    }
    return fetch(url, init).then(function (res) {
      return res.json().then(function (data) {
        if (data && typeof data === 'object') data.httpStatus = res.status;
        return data;
      });
    });
  }

  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  // "2026-10-17 14:14:05" (MySQL, server-local) -> Date in this machine's local time.
  function parseTs(ts) {
    if (!ts) return null;
    var m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(String(ts));
    if (!m) return null;
    return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  }

  // "Oct 17, 2:14 PM"
  function fmtDateTime(ts) {
    var d = parseTs(ts);
    if (!d) return '';
    var h = d.getHours();
    var mm = d.getMinutes();
    return MONTHS[d.getMonth()] + ' ' + d.getDate() + ', ' + ((h % 12) || 12) + ':' + (mm < 10 ? '0' : '') + mm + ' ' + (h < 12 ? 'AM' : 'PM');
  }

  // "Today" / "Yesterday" / "Oct 16" / "—"
  function fmtDay(ts) {
    var d = parseTs(ts);
    if (!d) return '—';
    var today = new Date();
    var start = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
    var t = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    if (t === start) return 'Today';
    if (t === start - 86400000) return 'Yesterday';
    return MONTHS[d.getMonth()] + ' ' + d.getDate() + (d.getFullYear() !== today.getFullYear() ? ', ' + d.getFullYear() : '');
  }

  window.SKAccount = {
    me: me,
    isAdmin: isAdmin,
    renderAccount: renderAccount,
    logout: logout,
    adminPage: adminPage,
    loginPage: loginPage,
    api: api,
    esc: esc,
    icon: icon,
    fmtDateTime: fmtDateTime,
    fmtDay: fmtDay
  };
})();
