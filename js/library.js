/* StudyTools Library - unified save / history layer for every tool.
 *
 * One API instead of five half-finished save mechanisms:
 *   window.StudyLibrary.save('tutor-chat', payload, { title: 'My session' })
 *   await window.StudyLibrary.list('tutor-chat')
 *   await window.StudyLibrary.remove('tutor-chat', id)
 *
 * Logged out  -> item is stored in localStorage (works instantly, no account needed).
 * Logged in   -> item is stored in localStorage AND mirrored to Firestore at
 *               users/{uid}/items/{itemId}, so it follows the student across devices.
 * Offline save is queued and flushed automatically on the next login.
 *
 * Load order matters: this file must come AFTER the Firebase compat SDK and AFTER
 * /js/firebase-config.js. It degrades to localStorage-only when Firebase is absent.
 */
(function () {
  'use strict';

  var PREFIX = 'studytools_library_v1_';
  var PENDING_KEY = PREFIX + 'pending';
  var MAX_LOCAL_PER_TOOL = 60;
  var MAX_REMOTE_FETCH = 50;
  var MAX_PENDING = 50;

  function hasFirebase() {
    return typeof window.firebase !== 'undefined' && window.firebase &&
      Array.isArray(window.firebase.apps) && window.firebase.apps.length > 0;
  }

  function auth() { try { return hasFirebase() ? firebase.auth() : null; } catch (e) { return null; } }
  function db() { try { return hasFirebase() ? firebase.firestore() : null; } catch (e) { return null; } }

  function currentUser() {
    var a = auth();
    try { return a ? a.currentUser : null; } catch (e) { return null; }
  }

  function currentUid() {
    var user = currentUser();
    return user && user.uid ? user.uid : null;
  }

  function itemsCollection(uid) {
    var store = db();
    if (!store || !uid) return null;
    return store.collection('users').doc(uid).collection('items');
  }
  function storageKey(tool) { return PREFIX + tool; }

  function safeParse(raw, fallback) {
    try {
      var value = JSON.parse(raw);
      return value === null || value === undefined ? fallback : value;
    } catch (e) { return fallback; }
  }

  function makeId() {
    return 'i' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function timestampMs(item) {
    if (!item) return 0;
    if (typeof item.ts === 'number') return item.ts;
    var parsed = Date.parse(item.createdAt || '');
    return isNaN(parsed) ? 0 : parsed;
  }

  function newestFirst(a, b) { return timestampMs(b) - timestampMs(a); }

  function readLocal(tool) {
    try {
      var stored = localStorage.getItem(storageKey(tool));
      var items = stored ? safeParse(stored, []) : [];
      return Array.isArray(items) ? items.filter(function (i) { return i && i.id; }) : [];
    } catch (e) { return []; }
  }

  function writeLocal(tool, items) {
    try {
      localStorage.setItem(storageKey(tool), JSON.stringify(items.slice(0, MAX_LOCAL_PER_TOOL)));
      return true;
    } catch (e) {
      console.warn('[StudyLibrary] storage is full, trimming cached items for ' + tool);
      try { localStorage.setItem(storageKey(tool), JSON.stringify(items.slice(0, 15))); } catch (e2) { /* nothing else we can do */ }
      return false;
    }
  }

  function upsertLocal(tool, item) {
    var items = readLocal(tool);
    var index = -1;
    for (var i = 0; i < items.length; i++) { if (items[i].id === item.id) { index = i; break; } }
    if (index >= 0) items[index] = Object.assign({}, items[index], item);
    else items.unshift(item);
    items.sort(newestFirst);
    writeLocal(tool, items);
  }

  function dropLocal(tool, id) {
    writeLocal(tool, readLocal(tool).filter(function (item) { return item.id !== id; }));
  }

  function markSynced(tool, id) {
    var items = readLocal(tool);
    for (var i = 0; i < items.length; i++) {
      if (items[i].id === id) { items[i].synced = true; writeLocal(tool, items); return; }
    }
  }

  function readPending() {
    try {
      var stored = localStorage.getItem(PENDING_KEY);
      var queue = stored ? safeParse(stored, []) : [];
      return Array.isArray(queue) ? queue : [];
    } catch (e) { return []; }
  }

  function writePending(queue) {
    try { localStorage.setItem(PENDING_KEY, JSON.stringify(queue.slice(-MAX_PENDING))); } catch (e) { /* ignore */ }
  }

  function isSameAction(a, b) { return a.tool === b.tool && a.id === b.id && a.op === b.op; }

  function queuePending(action) {
    writePending(readPending().filter(function (a) { return !isSameAction(a, action); }).concat([action]));
  }

  function dequeuePending(action) {
    writePending(readPending().filter(function (a) { return !isSameAction(a, action); }));
  }
  function toast(message, tone) {
    try {
      var host = document.getElementById('st-library-toast');
      if (!host) {
        host = document.createElement('div');
        host.id = 'st-library-toast';
        host.setAttribute('role', 'status');
        host.setAttribute('aria-live', 'polite');
        host.style.cssText = 'position:fixed;left:50%;bottom:28px;transform:translateX(-50%) translateY(12px);' +
          'background:#0f172a;color:#f8fafc;padding:11px 18px;border-radius:10px;font:600 .9rem system-ui,sans-serif;' +
          'box-shadow:0 12px 30px rgba(15,23,42,.28);opacity:0;transition:opacity .2s ease,transform .2s ease;' +
          'z-index:2147483000;max-width:min(90vw,420px);text-align:center;pointer-events:none';
        document.body.appendChild(host);
      }
      host.textContent = message;
      host.style.background = tone === 'error' ? '#b91c1c' : '#0f172a';
      requestAnimationFrame(function () {
        host.style.opacity = '1';
        host.style.transform = 'translateX(-50%) translateY(0)';
      });
      clearTimeout(host._stTimer);
      host._stTimer = setTimeout(function () {
        host.style.opacity = '0';
        host.style.transform = 'translateX(-50%) translateY(12px)';
      }, 2600);
    } catch (e) { /* feedback must never break the caller */ }
  }

  var StudyLibrary = {
    // Persist one item. Always succeeds locally, mirrors to Firestore when signed in.
    save: function (tool, data, options) {
      options = options || {};
      var id = options.id || makeId();
      var now = new Date().toISOString();
      var title = String(options.title || (data && data.title) || tool).slice(0, 140);
      var item = { id: id, tool: tool, title: title, data: data, createdAt: now, ts: Date.now(), synced: false };

      upsertLocal(tool, item);

      var collection = itemsCollection(currentUid());
      if (!collection) {
        queuePending({ op: 'save', tool: tool, id: id });
        promptSignIn(tool);
        return Promise.resolve({ ok: true, id: id, synced: false });
      }

      return collection.doc(id).set({
        tool: tool,
        title: title,
        data: data,
        createdAtLocal: now,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      }).then(function () {
        markSynced(tool, id);
        dequeuePending({ op: 'remove', tool: tool, id: id });
        return { ok: true, id: id, synced: true };
      }).catch(function (error) {
        console.warn('[StudyLibrary] cloud save failed, kept locally: ' + (error && error.message));
        queuePending({ op: 'save', tool: tool, id: id });
        return { ok: true, id: id, synced: false };
      });
    },

    // Items for a tool, newest first. Merges cloud + local cache when signed in.
    list: function (tool, options) {
      options = options || {};
      var limit = options.limit || MAX_LOCAL_PER_TOOL;
      var local = readLocal(tool);
      var collection = itemsCollection(currentUid());

      if (!collection) {
        return Promise.resolve(local.slice().sort(newestFirst).slice(0, limit));
      }

      return collection.where('tool', '==', tool).limit(MAX_REMOTE_FETCH).get()
        .then(function (snapshot) {
          var remote = [];
          snapshot.forEach(function (docSnap) {
            var value = docSnap.data() || {};
            var createdAt = value.createdAtLocal || new Date().toISOString();
            remote.push({
              id: docSnap.id,
              tool: tool,
              title: value.title || tool,
              data: value.data,
              createdAt: createdAt,
              ts: Date.parse(createdAt) || Date.now(),
              synced: true
            });
          });
          var remoteIds = {};
          remote.forEach(function (item) { remoteIds[item.id] = true; });
          var merged = remote.concat(local.filter(function (item) { return !remoteIds[item.id]; })).sort(newestFirst);
          writeLocal(tool, merged);
          return merged.slice(0, limit);
        })
        .catch(function (error) {
          console.warn('[StudyLibrary] cloud list failed, serving local cache: ' + (error && error.message));
          return local.slice().sort(newestFirst).slice(0, limit);
        });
    },
    // Delete one item locally and in the cloud.
    remove: function (tool, id) {
      dropLocal(tool, id);
      var collection = itemsCollection(currentUid());
      if (!collection) {
        queuePending({ op: 'remove', tool: tool, id: id });
        return Promise.resolve({ ok: true, synced: false });
      }
      return collection.doc(id).delete()
        .then(function () { dequeuePending({ op: 'remove', tool: tool, id: id }); return { ok: true, synced: true }; })
        .catch(function (error) {
          console.warn('[StudyLibrary] cloud delete failed: ' + (error && error.message));
          queuePending({ op: 'remove', tool: tool, id: id });
          return { ok: true, synced: false };
        });
    },

    // Remove every item of a tool (local + cloud).
    clear: function (tool) {
      var removed = readLocal(tool).length;
      writeLocal(tool, []);
      var collection = itemsCollection(currentUid());
      if (!collection) return Promise.resolve({ ok: true, removed: removed });
      return collection.where('tool', '==', tool).limit(MAX_REMOTE_FETCH * 4).get()
        .then(function (snapshot) {
          var batch = db().batch();
          snapshot.forEach(function (docSnap) { batch.delete(docSnap.ref); });
          return batch.commit();
        })
        .catch(function (error) {
          console.warn('[StudyLibrary] cloud clear failed: ' + (error && error.message));
        })
        .then(function () { return { ok: true, removed: removed }; });
    },

    // How many items are cached on this device.
    count: function (tool) { return readLocal(tool).length; },

    // One-time import of a legacy localStorage array. The old value is preserved
    // under <key>_migrated so nothing can be lost by the migration itself.
    migrate: function (legacyKey, tool, mapItem) {
      var doneKey = PREFIX + 'migrated:' + legacyKey;
      var raw = null;
      try { raw = localStorage.getItem(legacyKey); } catch (e) { raw = null; }
      if (localStorage.getItem(doneKey) || !raw) {
        try { localStorage.setItem(doneKey, '1'); } catch (e) { /* ignore */ }
        return Promise.resolve({ ok: true, migrated: 0 });
      }
      var rows = safeParse(raw, []);
      if (!Array.isArray(rows)) {
        try { localStorage.setItem(doneKey, '1'); } catch (e) { /* ignore */ }
        return Promise.resolve({ ok: true, migrated: 0 });
      }
      rows.forEach(function (row, position) {
        var mapped = typeof mapItem === 'function' ? mapItem(row, position) : row;
        if (!mapped) return;
        var id = 'm' + Date.now().toString(36) + position;
        var now = new Date(Date.now() - position * 1000).toISOString();
        upsertLocal(tool, {
          id: id,
          tool: tool,
          title: String(mapped.title || tool).slice(0, 140),
          data: mapped.data || mapped,
          createdAt: now,
          ts: Date.parse(now) || Date.now(),
          synced: false
        });
        queuePending({ op: 'save', tool: tool, id: id });
      });
      try {
        localStorage.setItem(doneKey, '1');
        localStorage.setItem(legacyKey + '_migrated', raw);
        localStorage.removeItem(legacyKey);
      } catch (e) { /* ignore */ }
      return Promise.resolve({ ok: true, migrated: rows.length });
    },
    // Flush everything queued while logged out. Safe to call repeatedly.
    sync: function () {
      var collection = itemsCollection(currentUid());
      if (!collection) return Promise.resolve({ ok: false, flushed: 0 });
      var queue = readPending();
      if (!queue.length) return Promise.resolve({ ok: true, flushed: 0 });

      var done = 0;
      var step = function (index) {
        if (index >= queue.length) return Promise.resolve({ ok: true, flushed: done });
        var action = queue[index];
        var work;
        if (action.op === 'remove') {
          work = collection.doc(action.id).delete();
        } else {
          var matches = readLocal(action.tool).filter(function (item) { return item.id === action.id; });
          if (!matches.length) { dequeuePending(action); return step(index + 1); }
          var local = matches[0];
          work = collection.doc(action.id).set({
            tool: action.tool,
            title: local.title,
            data: local.data,
            createdAtLocal: local.createdAt,
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
          }).then(function () { markSynced(action.tool, action.id); });
        }
        return work.then(function () { done++; dequeuePending(action); })
          .catch(function () { /* keep it queued for the next attempt */ })
          .then(function () { return step(index + 1); });
      };

      return step(0).then(function (result) {
        document.dispatchEvent(new CustomEvent('studytoolsLibrarySynced', { detail: result }));
        return result;
      });
    },

    toast: toast,
    isSignedIn: function () { return Boolean(currentUid()); }
  };

  // Soft gate: saving without an account always works (localStorage + queue),
  // so this is only a one-time nudge, never a wall. Shown at most once per
  // session and remembered if the student dismisses it.
  var nudgeShown = false;
  function promptSignIn(tool) {
    if (nudgeShown) return;
    try {
      if (sessionStorage.getItem('st_signin_nudge') === 'dismissed') return;
    } catch (e) { /* private mode: still show once */ }
    nudgeShown = true;
    try {
      var here = encodeURIComponent(location.pathname + location.search);
      var overlay = document.createElement('div');
      overlay.id = 'st-signin-nudge';
      overlay.setAttribute('style', 'position:fixed;inset:0;background:rgba(15,23,42,.55);display:flex;align-items:center;justify-content:center;z-index:4000;font-family:Arial,system-ui,sans-serif');
      overlay.innerHTML = '<div style="background:#fff;border-radius:14px;max-width:380px;width:92%;padding:24px;box-shadow:0 18px 50px rgba(15,23,42,.35);text-align:center">' +
        '<div style="font-size:1.7rem">&#128190;</div>' +
        '<h3 style="margin:8px 0 6px;color:#0f172a;font-size:1.05rem">Saved. Sign in to keep it everywhere.</h3>' +
        '<p style="margin:0 0 16px;color:#475569;font-size:.9rem;line-height:1.55">Your work is safe on this device. Sign in once and it follows you to every device automatically from then on.</p>' +
        '<div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap">' +
        '<a href="/login.html?redirect=' + here + '" style="background:#2563eb;color:#fff;text-decoration:none;padding:10px 18px;border-radius:9px;font-weight:700;font-size:.9rem">Sign in</a>' +
        '<button type="button" id="st-nudge-later" style="background:none;border:1px solid #cbd5e1;color:#475569;padding:10px 18px;border-radius:9px;font-size:.9rem;cursor:pointer">Not now</button>' +
        '</div>' +
        '<p style="margin:14px 0 0;font-size:.78rem;color:#94a3b8">No account yet? <a href="/register.html?redirect=' + here + '" style="color:#2563eb;font-weight:700">Create one free</a></p>' +
        '</div>';
      document.body.appendChild(overlay);
      overlay.addEventListener('click', function (event) {
        if (event.target === overlay || event.target.id === 'st-nudge-later') {
          try { sessionStorage.setItem('st_signin_nudge', 'dismissed'); } catch (e) { /* ignore */ }
          if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
        }
      });
    } catch (e) { /* never break saving */ }
    if (tool) { /* tool is shown in nothing: kept for future copy */ }
  }

  function listen() {
    var a = auth();
    if (!a || a._stLibraryListener) return false;
    a._stLibraryListener = true;
    a.onAuthStateChanged(function (user) {
      if (user) {
        StudyLibrary.sync().then(function (result) {
          if (result && result.flushed) toast('Sincronizado con tu cuenta (' + result.flushed + ' elementos)');
        });
      }
      document.dispatchEvent(new CustomEvent('studytoolsLibraryAuth', { detail: { user: user } }));
    });
    return true;
  }

  if (!listen()) document.addEventListener('DOMContentLoaded', listen);
  window.addEventListener('load', listen);

  window.StudyLibrary = StudyLibrary;
})();
