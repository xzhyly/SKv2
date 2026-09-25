// js/talk-history.js
// Fire-and-forget save hooks for talk.html's Let's Talk conversation, per
// docs/reports/2026-09-25-saved-conversations-step1.md section (a). Every message the person
// confirms into the thread (Add to Conversation) is POSTed to php/api/save_conversation.php,
// and the conversation's end (End Conversation / idle timeout / idle card's End Now / the page
// unloading at all, `pagehide`) is POSTed too. This must never block, delay or break the live
// conversation (docs/revision proposal's "Global Constraints"): every request is
// `fetch(..., {keepalive:true})`, never awaited by any caller, and any failure — a rejected
// fetch, a non-2xx status, unparsable JSON, or a body that isn't `{success:true}` — is a single
// `console.warn`, never a thrown error and never UI.
(function () {
  'use strict';

  // 32 lowercase hex chars from crypto.getRandomValues — works in any context (no HTTPS/
  // secure-context requirement the way crypto.randomUUID() has), per the plan.
  function makeClientKey() {
    var bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    var hex = '';
    for (var i = 0; i < bytes.length; i++) {
      var h = bytes[i].toString(16);
      if (h.length < 2) h = '0' + h;
      hex += h;
    }
    return hex;
  }

  var clientKey = makeClientKey();
  var seq = 0;
  var confirmed = 0;
  var ended = false;

  function warn(message, detail) {
    if (detail !== undefined) {
      console.warn('[talk-history] ' + message, detail);
    } else {
      console.warn('[talk-history] ' + message);
    }
  }

  // Fire-and-forget POST. Never returns anything callers need to act on; every failure path
  // ends in a console.warn only, never a throw.
  function post(body) {
    try {
      fetch('php/api/save_conversation.php', {
        method: 'POST',
        keepalive: true,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      }).then(function (res) {
        if (!res.ok) {
          warn('save_conversation.php responded ' + res.status + ' for action "' + body.action + '"');
          return;
        }
        return res.json().then(function (data) {
          if (!data || data.success !== true) {
            warn('save_conversation.php did not return success for action "' + body.action + '"', data);
          }
        }, function (err) {
          warn('save_conversation.php returned unparsable JSON for action "' + body.action + '"', err);
        });
      }, function (err) {
        warn('fetch failed for action "' + body.action + '"', err);
      });
    } catch (err) {
      // Covers a synchronous fetch TypeError (e.g. an overridden window.fetch that throws
      // instead of rejecting) so this can never throw into a caller's click handler.
      warn('fetch threw for action "' + body.action + '"', err);
    }
  }

  // msg: { from: 'deaf'|'hearing', source: 'sign'|'speech'|'typed', signLanguage: 'ESL'|'FSL'|null|undefined, text }
  function saveMessage(msg) {
    try {
      msg = msg || {};
      var speaker = msg.from === 'deaf' ? 'signer' : 'hearing';
      seq += 1;
      confirmed += 1;
      post({
        action: 'message',
        client_key: clientKey,
        seq: seq,
        speaker: speaker,
        source: msg.source,
        sign_language: msg.signLanguage || null,
        text: msg.text
      });
    } catch (err) {
      warn('saveMessage failed', err);
    }
  }

  // reason: 'ended'|'idle'|'left'. No-op if no message was ever confirmed on this page, or if
  // an end was already sent — so opening Let's Talk and leaving without confirming a message
  // sends zero requests, and pagehide after an explicit End sends nothing more.
  function end(reason) {
    try {
      if (confirmed === 0 || ended) return;
      ended = true;
      post({ action: 'end', client_key: clientKey, reason: reason });
    } catch (err) {
      warn('end failed', err);
    }
  }

  window.addEventListener('pagehide', function () { end('left'); });

  window.TalkHistory = { saveMessage: saveMessage, end: end };
})();
