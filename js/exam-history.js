/* Exam Solver saved history (exam-solver.html).
 *
 * The page stored solved questions in a plain array, so the history list was empty
 * after every reload and was rendered with innerHTML (raw student text). This bridge
 * hydrates that array from StudyLibrary, persists new entries and re-renders the list
 * safely. It is loaded AFTER the page inline script on purpose.
 */
(function () {
  'use strict';

  var TOOL = 'exam-question';
  var LIMIT = 20;
  var booted = false;

  function lib() { return window.StudyLibrary || null; }

  function entries() {
    try {
      if (typeof savedHistory !== 'undefined' && Array.isArray(savedHistory)) return savedHistory;
    } catch (e) { /* page script not present */ }
    return null;
  }

  function toEntry(row) {
    var question = (row.data && row.data.question) || row.title || '';
    var when = row.createdAt ? new Date(row.createdAt) : null;
    return {
      q: row.title || question.slice(0, 80),
      full: question,
      time: when && !isNaN(when) ? when.toLocaleString() : '',
      subject: (row.data && row.data.subject) || '',
      id: row.id
    };
  }

  function render() {
    var list = document.getElementById('history-list');
    var section = document.getElementById('history-section');
    if (!list || !section) return;
    var items = entries() || [];
    if (!items.length) {
      list.innerHTML = '';
      section.style.display = 'none';
      return;
    }
    section.style.display = 'block';
    list.innerHTML = '';
    items.forEach(function (entry) {
      var row = document.createElement('div');
      row.className = 'history-item';
      row.setAttribute('role', 'button');
      row.setAttribute('tabindex', '0');
      var text = document.createElement('div');
      text.className = 'history-q';
      text.textContent = entry.q;
      var meta = document.createElement('div');
      meta.className = 'history-meta';
      meta.textContent = entry.time + (entry.id ? ' - guardado' : '');
      row.appendChild(text);
      row.appendChild(meta);
      row.addEventListener('click', function () { restore(entry); });
      row.addEventListener('keydown', function (event) {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); restore(entry); }
      });
      list.appendChild(row);
    });
  }

  function restore(entry) {
    var input = document.getElementById('question-input');
    if (!input) return;
    input.value = entry.full || entry.q || '';
    if (typeof window.onType === 'function') { try { window.onType(); } catch (e) { /* ignore */ } }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  function clearAll() {
    var items = entries();
    if (items) items.length = 0;
    var list = document.getElementById('history-list');
    var section = document.getElementById('history-section');
    if (list) list.innerHTML = '';
    if (section) section.style.display = 'none';
    if (lib()) lib().clear(TOOL);
  }

  function persist(entry, subject) {
    var library = lib();
    if (!library || !entry || entry.id) return;
    library.save(TOOL, {
      question: entry.full || entry.q || '',
      subject: subject || entry.subject || ''
    }, { title: entry.q || 'Pregunta resuelta' }).then(function (result) {
      entry.id = result.id;
    }).catch(function () { /* stays local only */ });
  }

  function boot() {
    if (booted) return;
    booted = true;
    window.renderHistory = render;
    window.clearHistory = clearAll;
    render();

    var library = lib();
    var items = entries();
    if (!library || !items) return;

    library.list(TOOL, { limit: LIMIT }).then(function (cloudRows) {
      if (!cloudRows || !cloudRows.length) return;
      var ids = {};
      cloudRows.forEach(function (row) { ids[row.id] = true; });
      var merged = cloudRows.map(toEntry).concat(items.filter(function (entry) {
        return !entry.id || !ids[entry.id];
      }));
      items.length = 0;
      merged.slice(0, LIMIT).forEach(function (entry) { items.push(entry); });
      render();
    }).catch(function () { /* the local list stays as it is */ });
  }

  window.StudyExamHistory = { boot: boot, persist: persist, clearAll: clearAll, render: render };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
  window.addEventListener('load', boot);
})();
