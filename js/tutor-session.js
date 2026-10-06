/* StudyTools AI session memory for study-assistant.html.
 *
 * Keeps the student profile and the live transcript in localStorage (so the
 * conversation survives a reload even for anonymous visitors), renders the
 * profile chips in the sidebar, builds the action cards that come back from
 * /api/chat and runs the inline focus timer. Plain script, no dependencies.
 */
(function () {
  'use strict';

  var PROFILE_KEY = 'studytools_ai_profile';
  var LAST_KEY = 'studytools_tutor_last';
  var MAX_TURNS = 40;
  var RESTORE_WINDOW_MS = 12 * 3600 * 1000; // conversations older than 12h start fresh

  function readJSON(key) {
    try {
      var raw = window.localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (error) {
      return null;
    }
  }

  function writeJSON(key, value) {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch (error) { /* private mode: memory simply does not persist */ }
  }

  // Mirror of the server-side shape in lib/tutor.js so both sides agree.
  function normaliseProfile(value) {
    var v = value && typeof value === 'object' ? value : {};
    var subjects = Array.isArray(v.subjects)
      ? v.subjects.filter(function (s) { return typeof s === 'string' && s.trim(); })
          .map(function (s) { return s.trim().slice(0, 40); }).slice(0, 8)
      : [];
    var examDate = typeof v.examDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v.examDate.trim())
      ? v.examDate.trim() : '';
    var hours = Number(v.hoursPerDay);
    if (!isFinite(hours) || hours <= 0) hours = 0;
    hours = Math.min(24, Math.round(hours * 2) / 2);
    return {
      name: typeof v.name === 'string' ? v.name.trim().slice(0, 60) : '',
      goal: typeof v.goal === 'string' ? v.goal.trim().slice(0, 160) : '',
      subjects: subjects,
      examDate: examDate,
      hoursPerDay: hours,
      material: typeof v.material === 'string' ? v.material.trim().slice(0, 160) : '',
      updatedAt: typeof v.updatedAt === 'string' ? v.updatedAt.slice(0, 40) : ''
    };
  }

  function hasProfile(p) {
    return Boolean(p.name || p.goal || p.examDate || p.subjects.length || p.hoursPerDay);
  }

  var profile = normaliseProfile(readJSON(PROFILE_KEY) || {});
  var timerId = null;

  function saveProfile() { writeJSON(PROFILE_KEY, profile); }

  function examDaysLeft() {
    if (!profile.examDate) return null;
    var examAt = Date.parse(profile.examDate + 'T23:59:59');
    if (!isFinite(examAt)) return null;
    return Math.ceil((examAt - Date.now()) / 86400000);
  }

  function chip(text, title) {
    var el = document.createElement('span');
    el.className = 'chip';
    if (title) el.title = title;
    el.textContent = text;
    return el;
  }

  function renderChips() {
    var box = document.getElementById('profile-chips');
    if (!box) return;
    box.innerHTML = '';
    if (!hasProfile(profile)) {
      var hint = document.createElement('span');
      hint.className = 'chip hint';
      hint.textContent = 'Tell me your name, goal and exam date — I will remember it.';
      box.appendChild(hint);
      return;
    }
    if (profile.name) box.appendChild(chip(profile.name, 'Your name'));
    if (profile.goal) box.appendChild(chip(profile.goal, 'Your goal'));
    profile.subjects.forEach(function (subject) { box.appendChild(chip(subject, 'Subject')); });
    if (profile.examDate) {
      var days = examDaysLeft();
      var label = profile.examDate;
      if (days !== null) {
        label = days > 0
          ? 'Exam ' + profile.examDate + ' (' + days + 'd)'
          : (days === 0 ? 'Exam is TODAY' : 'Exam was ' + profile.examDate);
      }
      box.appendChild(chip(label, 'Next exam'));
    }
    if (profile.hoursPerDay) box.appendChild(chip(profile.hoursPerDay + ' h/day', 'Available study time'));
  }

  var TutorSession = {
    profile: function () { return profile; },

    // The server answers with the full merged profile; adopt it and repaint.
    applyProfile: function (next) {
      if (!next || typeof next !== 'object') return;
      var merged = normaliseProfile(Object.assign({}, profile, next));
      profile = merged;
      saveProfile();
      renderChips();
    },

    actionRow: function (actions) {
      var row = document.createElement('div');
      row.className = 'msg-actions';
      (Array.isArray(actions) ? actions : []).forEach(function (action) {
        if (!action || !action.type) return;
        if (action.type === 'timer') {
          var btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'action-card';
          btn.textContent = (action.label || 'Start focus timer') + ' (' + (action.minutes || 25) + ' min)';
          btn.addEventListener('click', function () {
            TutorSession.startTimer(Number(action.minutes) || 25);
          });
          row.appendChild(btn);
        } else if (action.href) {
          var link = document.createElement('a');
          link.className = 'action-card';
          link.href = action.href;
          link.textContent = (action.label || 'Open') + ' →';
          row.appendChild(link);
        }
      });
      return row.children.length ? row : null;
    },

    startTimer: function (minutes) {
      TutorSession.stopTimer();
      var total = Math.max(5, Math.min(180, Math.round(Number(minutes) || 25)));
      var end = Date.now() + total * 60000;
      var pill = document.getElementById('session-timer');
      var value = document.getElementById('timer-value');
      if (pill) pill.classList.add('on');
      function tick() {
        var left = Math.max(0, end - Date.now());
        var m = Math.floor(left / 60000);
        var s = Math.floor((left % 60000) / 1000);
        if (value) value.textContent = m + ':' + (s < 10 ? '0' : '') + s;
        if (left <= 0) {
          TutorSession.stopTimer();
          var detail = { minutes: total };
          try {
            document.dispatchEvent(new CustomEvent('studytools-timer-end', { detail: detail }));
          } catch (error) {
            var legacy = document.createEvent('CustomEvent');
            legacy.initCustomEvent('studytools-timer-end', false, false, detail);
            document.dispatchEvent(legacy);
          }
        }
      }
      tick();
      timerId = window.setInterval(tick, 1000);
    },

    stopTimer: function () {
      if (timerId) { window.clearInterval(timerId); timerId = null; }
      var pill = document.getElementById('session-timer');
      if (pill) pill.classList.remove('on');
    },

    // Transcript of the current tab, capped, so a reload keeps the session.
    persist: function (list) {
      var items = (Array.isArray(list) ? list : []).slice(-MAX_TURNS).map(function (m) {
        return {
          role: m.role === 'user' ? 'user' : 'assistant',
          content: String(m.content || ''),
          actions: Array.isArray(m.actions) && m.actions.length ? m.actions.slice(0, 3) : undefined
        };
      }).filter(function (m) { return m.content; });
      writeJSON(LAST_KEY, { t: Date.now(), m: items });
    },

    restore: function () {
      var data = readJSON(LAST_KEY);
      if (!data || !Array.isArray(data.m) || !data.m.length) return null;
      if (Date.now() - Number(data.t || 0) > RESTORE_WINDOW_MS) {
        TutorSession.clear();
        return null;
      }
      return data.m.filter(function (m) {
        return m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content;
      }).slice(-MAX_TURNS);
    },

    clear: function () {
      try { window.localStorage.removeItem(LAST_KEY); } catch (error) { /* ignore */ }
    },

    greeting: function () {
      if (profile.name) {
        return 'Welcome back, ' + profile.name + '!' +
          (profile.goal ? ' Last time you were working on ' + profile.goal + '.' : '') +
          ' Where do you want to start today?';
      }
      return 'Hi! I\'m your StudyTools AI tutor, a study assistant with a memory. ' +
        'Tell me your name, what you\'re studying and any exam coming up — I\'ll remember it and build sessions around you. ' +
        'Or just ask me anything right away.';
    },

    renderChips: renderChips
  };

  window.TutorSession = TutorSession;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', renderChips);
  } else {
    renderChips();
  }
})();
