// js/quiz-ui.js
// quiz.html's screens (accounts-quiz phase, 2026-10-18): setup -> 10 questions -> result.
// Questions and scoring: js/quiz-core.js. Signs and their clips: php/api/quiz.php ?action=pool.
// A clip is the sign's avatar clip (js/avatar-player.js, as Let's Talk plays it). Avatar only since
// the talk-turns-audio phase: the pool lists only signs with avatar data, and no video is played.
// Pi speed: at most one clip plays at a time; Text -> Sign shows the four as still posters and
// only the tapped one plays. The score is POSTed (action "save") only for a logged-in account.
(function () {
  'use strict';

  var A = window.SKAccount;
  var Q = window.QuizCore;
  var user = A.me();
  var COUNT = 10;
  var CAT_NAMES = { letters: 'Letters', numbers: 'Numbers', words: 'Words', phrases: 'Phrases', mixed: 'All' };
  var MODE_NAMES = { 'sign-to-text': 'Sign → Text', 'text-to-sign': 'Text → Sign' };
  var LETTERS = ['A', 'B', 'C', 'D'];

  function svg(path, size) {
    return '<svg width="' + (size || 20) + '" height="' + (size || 20) + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + path + '</svg>';
  }
  var ICON_OK = svg('<path d="M4 12.5l5 5L20 6.5"/>');
  var ICON_BAD = svg('<path d="M6 6l12 12M18 6L6 18"/>');
  var ICON_PLAY = '<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>';
  var ICON_REPLAY = svg('<path d="M3 12a9 9 0 1 0 3-6.7M3 4v5h5"/>', 18);

  function $(id) { return document.getElementById(id); }

  var state = {
    mode: 'sign-to-text', lang: 'FSL', cat: 'words',
    pools: {},            // lang -> signs from the server (or null while loading / 'error')
    questions: [], idx: 0, results: [], score: 0, answered: false, startedAt: 0
  };

  // ── Clips ───────────────────────────────────────────────────────────────────────────────────
  var partsPromise = null;
  var avatarStore = null;
  function avatarParts() {
    if (!partsPromise) partsPromise = window.AvatarRenderer.loadParts();
    return partsPromise;
  }
  function store() {
    if (!avatarStore) avatarStore = window.AvatarStore.create({});
    return avatarStore;
  }

  var views = [];
  function stopOthers(keep) { views.forEach(function (v) { if (v !== keep) v.stop(); }); }
  function destroyViews() { views.slice().forEach(function (v) { v.destroy(); }); views = []; }

  // box: a .clip element. opts.poster: start still with a play button (Text -> Sign);
  // otherwise it plays at once. opts.loop: play again and again (Sign -> Text, Watch).
  function clipView(box, clip, opts) {
    opts = opts || {};
    box.innerHTML = '';
    box.classList.remove('playing');
    var alive = true, playing = false, token = 0, player = null;
    var view = { play: play, stop: stop, destroy: destroy };

    function showErr(text) {
      if (!alive || box.querySelector('.err')) return;
      var e = document.createElement('div');
      e.className = 'err';
      e.textContent = text;
      box.appendChild(e);
    }
    function ended() { playing = false; box.classList.remove('playing'); }

    function startAvatar() {
      var my = ++token;
      store().load(clip.key).then(function (prep) {
        if (!alive || my !== token || !playing) return;
        if (!prep) { showErr('Clip could not be loaded'); ended(); return; }
        return player.play([prep]).then(function () {
          if (!alive || my !== token || !playing) return;
          if (opts.loop) setTimeout(function () { if (alive && my === token && playing) startAvatar(); }, 700);
          else ended();
        });
      });
    }

    function play() {
      if (!alive) return;
      stopOthers(view);
      playing = true;
      box.classList.add('playing');
      if (player) startAvatar();
    }
    function stop() {
      playing = false;
      token++;
      box.classList.remove('playing');
      if (player) player.cancel();
    }
    function destroy() {
      stop();
      alive = false;
      box.innerHTML = '';
      views = views.filter(function (v) { return v !== view; });
    }

    var canvas = document.createElement('canvas');
    canvas.width = 420;
    canvas.height = 302;          // the avatar's "admin" view is 740 x 532
    box.appendChild(canvas);
    avatarParts().then(function (parts) {
      if (!alive) return;
      player = window.AvatarPlayer.create({ canvas: canvas, parts: parts, view: window.AvatarRig.views.admin });
      player.showRest();
      if (playing) startAvatar();
    }).catch(function () { showErr('Avatar not available'); ended(); });
    if (opts.poster) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'play';
      btn.setAttribute('aria-label', 'Play');
      btn.innerHTML = ICON_PLAY;
      btn.addEventListener('click', play);
      box.appendChild(btn);
      box.addEventListener('click', function (e) { if (e.target === box || e.target.tagName === 'VIDEO' || e.target.tagName === 'CANVAS') play(); });
    } else {
      play();
    }
    if (opts.replay) {
      var rb = document.createElement('button');
      rb.type = 'button';
      rb.className = 'replay';
      rb.id = 'replay-btn';
      rb.innerHTML = ICON_REPLAY + 'Replay';
      rb.addEventListener('click', play);
      box.appendChild(rb);
    }
    views.push(view);
    return view;
  }

  // ── Screens and bar ─────────────────────────────────────────────────────────────────────────
  var screen = 'setup';
  function show(name) {
    screen = name;
    ['setup', 'question', 'result'].forEach(function (n) { $('screen-' + n).classList.toggle('on', n === name); });
    var inQuiz = name === 'question';
    $('back-btn').innerHTML = inQuiz ? '&#10005; Quit' : '&#8592; Home';
    $('acct').hidden = inQuiz;
    $('score-txt').hidden = !inQuiz;
    $('bar-title').textContent = name === 'setup' ? 'QUIZ' : name === 'result' ? 'RESULT'
      : (state.mode === 'sign-to-text' ? 'WHAT IS THIS SIGN?' : 'WHICH SIGN IS IT?');
  }

  $('back-btn').addEventListener('click', function () {
    if (screen === 'question') {
      destroyViews();
      show('setup');
      return;
    }
    location.href = 'index.html';
  });

  // ── Setup ───────────────────────────────────────────────────────────────────────────────────
  function bindSeg(id, key) {
    var seg = $(id);
    seg.querySelectorAll('button').forEach(function (b) {
      b.addEventListener('click', function () {
        state[key] = b.dataset.v;
        seg.querySelectorAll('button').forEach(function (x) { x.classList.toggle('on', x === b); });
        if (key === 'lang') loadPool(state.lang);
        updateSetup();
      });
    });
  }
  bindSeg('seg-mode', 'mode');
  bindSeg('seg-lang', 'lang');
  bindSeg('seg-cat', 'cat');

  function loadPool(lang) {
    if (state.pools[lang] && state.pools[lang] !== 'error') return;
    state.pools[lang] = null;
    A.api('php/api/quiz.php?action=pool&lang=' + lang).then(function (data) {
      state.pools[lang] = data && data.success ? data.signs : 'error';
      updateSetup();
    }, function () {
      state.pools[lang] = 'error';
      updateSetup();
    });
  }

  function currentPool() {
    var signs = state.pools[state.lang];
    return Array.isArray(signs) ? Q.poolFor(signs, state.cat) : null;
  }

  function updateSetup() {
    var info = $('setup-info');
    var start = $('start-btn');
    var signs = state.pools[state.lang];
    info.classList.remove('bad');
    start.disabled = true;
    if (signs === null || signs === undefined) { info.textContent = 'Loading signs…'; return; }
    if (signs === 'error') { info.classList.add('bad'); info.textContent = 'Could not load the signs. Check that the kiosk server is running, then pick the language again.'; return; }
    var pool = currentPool();
    var n = pool.length;
    var where = CAT_NAMES[state.cat] === 'All' ? state.lang : CAT_NAMES[state.cat] + ' (' + state.lang + ')';
    if (n < Q.CHOICES) {
      info.classList.add('bad');
      info.textContent = (n === 0 ? 'No signs' : 'Only ' + n + (n === 1 ? ' sign' : ' signs')) + ' with an avatar clip in ' + where +
        '. A quiz needs at least ' + Q.CHOICES + '. Pick another category or language.';
      return;
    }
    info.textContent = n + ' signs in ' + where + (n < COUNT ? ' — some will come up twice.' : '.');
    start.disabled = false;
  }

  $('setup-note').textContent = COUNT + ' questions · ' + (user ? 'your score will be saved' : 'score saved only when logged in');

  function startQuiz() {
    var pool = currentPool();
    var built = pool ? Q.buildQuiz(pool, { count: COUNT }) : { ok: false };
    if (!built.ok) { updateSetup(); show('setup'); return; }
    state.questions = built.questions;
    state.idx = 0;
    state.results = [];
    state.score = 0;
    state.startedAt = Date.now();
    show('question');
    renderQuestion();
  }
  $('start-btn').addEventListener('click', startQuiz);

  // ── Question ────────────────────────────────────────────────────────────────────────────────
  function renderQuestion() {
    destroyViews();
    state.answered = false;
    var q = state.questions[state.idx];
    var total = state.questions.length;
    $('prog-txt').textContent = (state.idx + 1) + ' / ' + total;
    $('prog-bar').style.width = Math.round(((state.idx + 1) / total) * 100) + '%';
    $('score-txt').textContent = 'Score ' + state.score;
    var s2t = state.mode === 'sign-to-text';
    $('s2t').hidden = !s2t;
    $('t2s').hidden = s2t;
    $('t2s-foot').hidden = s2t;
    $('next-btn-s2t').disabled = true;
    $('next-btn-t2s').disabled = true;

    if (s2t) {
      $('prompt').textContent = 'What is this sign?';
      clipView($('s2t-clip'), q.sign.clip, { loop: true, replay: true });
      var box = $('s2t-choices');
      box.innerHTML = '';
      q.choices.forEach(function (c, i) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'ch';
        b.dataset.key = c.key;
        b.innerHTML = '<span class="badge">' + LETTERS[i] + '</span><span class="t">' + A.esc(c.text) + '</span><span class="mark"></span>';
        b.addEventListener('click', function () { answer(i); });
        box.appendChild(b);
      });
    } else {
      $('prompt').innerHTML = 'Which sign is <q>' + A.esc(q.sign.text) + '</q>?';
      var grid = $('t2s');
      grid.innerHTML = '';
      q.choices.forEach(function (c, i) {
        var card = document.createElement('div');
        card.className = 'vc';
        card.dataset.key = c.key;
        var clip = document.createElement('div');
        clip.className = 'clip';
        var choose = document.createElement('button');
        choose.type = 'button';
        choose.className = 'choose';
        choose.textContent = 'Choose ' + LETTERS[i];
        choose.addEventListener('click', function () { answer(i); });
        card.appendChild(clip);
        card.appendChild(choose);
        grid.appendChild(card);
        clipView(clip, c.clip, { poster: true });
      });
    }
  }

  function answer(i) {
    if (state.answered) return;
    state.answered = true;
    var q = state.questions[state.idx];
    var chosen = q.choices[i];
    var correct = i === q.answer;
    if (correct) state.score++;
    state.results.push({ q: q, chosen: chosen, correct: correct, record: Q.answerRecord(q, chosen.key, state.mode, Date.now()) });
    $('score-txt').textContent = 'Score ' + state.score;

    if (state.mode === 'sign-to-text') {
      $('s2t-choices').querySelectorAll('.ch').forEach(function (b, j) {
        b.disabled = true;
        if (j === q.answer) { b.classList.add('ok'); b.querySelector('.mark').innerHTML = ICON_OK; }
        else if (j === i) { b.classList.add('bad'); b.querySelector('.mark').innerHTML = ICON_BAD; }
      });
      $('next-btn-s2t').disabled = false;
    } else {
      $('t2s').querySelectorAll('.vc').forEach(function (card, j) {
        var btn = card.querySelector('.choose');
        btn.disabled = true;
        if (j === q.answer) { card.classList.add('ok'); btn.innerHTML = ICON_OK + LETTERS[j] + ' · ' + A.esc(q.choices[j].text); }
        else if (j === i) { card.classList.add('bad'); btn.innerHTML = ICON_BAD + LETTERS[j] + ' · ' + A.esc(q.choices[j].text); }
      });
      $('next-btn-t2s').disabled = false;
    }
  }

  function next() {
    if (!state.answered) return;
    state.idx++;
    if (state.idx < state.questions.length) renderQuestion();
    else finish();
  }
  $('next-btn-s2t').addEventListener('click', next);
  $('next-btn-t2s').addEventListener('click', next);

  // ── Result ──────────────────────────────────────────────────────────────────────────────────
  function finish() {
    destroyViews();
    var total = state.results.length;
    $('res-big').textContent = state.score + '/' + total;
    $('res-sub').textContent = MODE_NAMES[state.mode] + ' · ' + state.lang + ' · ' + CAT_NAMES[state.cat];
    var missed = state.results.filter(function (r) { return !r.correct; });
    $('missed-lbl').textContent = 'Missed (' + missed.length + ')';
    var list = $('missed-list');
    list.innerHTML = '';
    if (!missed.length) list.innerHTML = '<div class="sk-empty">No mistakes. Well done!</div>';
    missed.forEach(function (r) {
      var li = document.createElement('div');
      li.className = 'sk-li';
      li.innerHTML = '<div class="m"><b>' + A.esc(r.q.sign.text) + '</b><small>You chose: ' + A.esc(r.chosen.text) + '</small></div>';
      var w = document.createElement('button');
      w.type = 'button';
      w.className = 'sk-mini';
      w.innerHTML = '&#9654; Watch';
      w.addEventListener('click', function () { openWatch(r.q.sign); });
      li.appendChild(w);
      list.appendChild(li);
    });

    var note = $('res-note');
    if (!user) {
      note.innerHTML = '<span>Log in to save your score. This score is not saved.</span><a class="sk-mini" href="login.html?next=quiz.html" style="display:inline-flex;align-items:center;text-decoration:none">Log in</a>';
    } else {
      note.innerHTML = '<span>Saving your score…</span>';
      A.api('php/api/quiz.php', {
        action: 'save',
        sign_language: state.lang,
        category: state.cat,
        started_at_ms: state.startedAt,
        answers: state.results.map(function (r) { return r.record; })
      }).then(function (data) {
        if (data && data.success) {
          note.innerHTML = '<span>Score saved.</span><a class="sk-mini" href="quiz-scores.html" style="display:inline-flex;align-items:center;text-decoration:none">' +
            (user.role === 'admin' ? 'Quiz results' : 'My quiz scores') + '</a>';
        } else {
          note.innerHTML = '<span>The score could not be saved' + (data && data.error ? ': ' + A.esc(data.error) : '') + '.</span>';
        }
      }, function () { note.innerHTML = '<span>The score could not be saved (no connection to the kiosk server).</span>'; });
    }
    show('result');
  }

  $('again-btn').addEventListener('click', startQuiz);
  $('new-btn').addEventListener('click', function () { show('setup'); updateSetup(); });

  // ── Watch the right sign ────────────────────────────────────────────────────────────────────
  var watchView = null;
  function openWatch(sign) {
    $('ov-title').textContent = sign.text;
    $('overlay').hidden = false;
    watchView = clipView($('ov-clip'), sign.clip, { loop: true, replay: true });
  }
  function closeWatch() {
    if (watchView) watchView.destroy();
    watchView = null;
    $('overlay').hidden = true;
  }
  $('ov-close').addEventListener('click', closeWatch);
  $('overlay').addEventListener('click', function (e) { if (e.target === $('overlay')) closeWatch(); });

  A.renderAccount($('acct'), { menu: false, next: 'quiz.html' });
  show('setup');
  loadPool(state.lang);
  updateSetup();

  // For tests: the current question (read-only use).
  window.QuizUI = { state: state };
})();
