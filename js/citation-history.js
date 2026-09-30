/* Citation generator saved list (citation-generator.html).
 *
 * Saved citations used to live in a plain array: refreshing the page deleted them
 * and they were never attached to the student account. This bridge loads them from
 * StudyLibrary, persists new ones and keeps deletes / clear in sync.
 * It is loaded AFTER the page inline script on purpose.
 */
(function () {
  'use strict';

  var TOOL = 'citation';
  var booted = false;

  function lib() { return window.StudyLibrary || null; }

  function rows() {
    try {
      if (typeof savedCitations !== 'undefined' && Array.isArray(savedCitations)) return savedCitations;
    } catch (e) { /* page script not present */ }
    return null;
  }

  function showSection() {
    var section = document.getElementById('saved-section');
    var items = rows() || [];
    if (section) section.style.display = items.length ? 'block' : 'none';
  }

  function persist(entry) {
    var library = lib();
    if (!library || !entry || entry.id) return;
    library.save(TOOL, { text: entry.text, style: entry.style }, {
      title: (entry.style || 'citation') + ': ' + String(entry.text || '').slice(0, 70)
    }).then(function (result) { entry.id = result.id; });
  }
  function toRow(row) {
    var text = (row.data && row.data.text) || row.title || '';
    return { text: text, style: (row.data && row.data.style) || '', id: row.id };
  }

  // Deletions run through inline onclick handlers that splice the array directly.
  // Listening in the capture phase mirrors the removal to the cloud before the splice.
  function watchDeletes() {
    var list = document.getElementById('saved-list');
    if (!list || list._stCitationWatch) return;
    list._stCitationWatch = true;
    list.addEventListener('click', function (event) {
      var target = event.target;
      if (!target || !target.closest) return;
      var button = target.closest('.btn-del-sm');
      if (!button) return;
      var node = button.closest('.saved-item');
      var index = node ? Array.prototype.indexOf.call(list.children, node) : -1;
      var items = rows();
      var entry = items && index >= 0 ? items[index] : null;
      if (entry && entry.id && lib()) lib().remove(TOOL, entry.id);
    }, true);
  }

  function boot() {
    if (booted) return;
    booted = true;
    showSection();
    watchDeletes();

    var library = lib();
    var items = rows();
    if (!library || !items) return;

    library.list(TOOL, { limit: 50 }).then(function (cloudRows) {
      if (!cloudRows || !cloudRows.length) return;
      var ids = {};
      cloudRows.forEach(function (row) { ids[row.id] = true; });
      var merged = cloudRows.map(toRow).filter(function (row) { return row.text; }).concat(
        items.filter(function (row) { return !row.id || !ids[row.id]; }));
      items.length = 0;
      merged.forEach(function (row) { items.push(row); });
      if (typeof window.renderSaved === 'function') window.renderSaved();
      showSection();
    }).catch(function () { /* the local list stays as it is */ });
  }

  var originalSave = window.saveCitation;
  window.saveCitation = function () {
    var items = rows();
    var before = items ? items.length : 0;
    if (typeof originalSave === 'function') originalSave();
    var after = rows();
    if (after && after.length > before) persist(after[0]);
  };

  var originalClear = window.clearSaved;
  window.clearSaved = function () {
    if (typeof originalClear === 'function') originalClear();
    if (lib()) lib().clear(TOOL);
  };

  window.StudyCitationHistory = { boot: boot, persist: persist, clearAll: function () { if (lib()) lib().clear(TOOL); } };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
  window.addEventListener('load', boot);
})();
