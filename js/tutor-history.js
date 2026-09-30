/* AI Tutor save + history for study-assistant.html.
 *
 * The Guardar / Historial buttons used to call saveCurrentConversation() and
 * loadSavedConversations(), which did not exist anywhere in the codebase, so the
 * clicks did nothing at all. This file implements them on top of StudyLibrary.
 * Requires /js/library.js to be loaded first.
 */
(function () {
  'use strict';

  var TOOL = 'tutor-chat';
  var MAX_MESSAGES = 40;
  var cached = [];

  function lib() { return window.StudyLibrary || null; }
  function say(message, tone) { if (lib()) lib().toast(message, tone); }

  // The chat keeps its transcript in a page level array. Read it defensively so
  // this file works regardless of where the script tag is placed.
  function readTranscript() {
    try {
      if (typeof messages !== 'undefined' && Array.isArray(messages) && messages.length) {
        return messages.slice(-MAX_MESSAGES).map(function (m) {
          return { role: m.role, content: String(m.content || '') };
        }).filter(function (m) { return m.content; });
      }
    } catch (e) { /* fall through to the DOM snapshot */ }
    var box = document.getElementById('msgs');
    if (!box) return [];
    return Array.prototype.slice.call(box.children).map(function (node) {
      var role = node.classList.contains('user') ? 'user' : (node.classList.contains('ai') ? 'assistant' : null);
      if (!role) return null;
      return { role: role, content: node.textContent || '' };
    }).filter(Boolean);
  }

  function writeTranscript(items) {
    try {
      if (typeof messages !== 'undefined' && Array.isArray(messages)) {
        messages.length = 0;
        items.forEach(function (m) { messages.push({ role: m.role, content: m.content }); });
      }
    } catch (e) { /* the DOM snapshot below still shows the conversation */ }
    var box = document.getElementById('msgs');
    if (!box) return;
    box.innerHTML = '';
    items.forEach(function (m) {
      var row = document.createElement('div');
      row.className = 'msg ' + (m.role === 'user' ? 'user' : 'ai');
      row.textContent = m.content;
      box.appendChild(row);
    });
    box.scrollTop = box.scrollHeight;
    var status = document.getElementById('status');
    if (status) status.textContent = 'Ready';
  }

  function titleFor(items) {
    var first = items.filter(function (m) { return m.role === 'user'; })[0];
    var text = first ? String(first.content).replace(/\s+/g, ' ').trim() : 'Sesion del tutor';
    return text.slice(0, 60) + (text.length > 60 ? '...' : '');
  }

  function flash(button, label) {
    if (!button) return;
    var original = button.textContent;
    button.textContent = label;
    button.disabled = true;
    setTimeout(function () { button.textContent = original; button.disabled = false; }, 1600);
  }

  window.saveCurrentConversation = function () {
    var library = lib();
    if (!library) { say('Guardado no disponible todavia', 'error'); return; }
    var items = readTranscript();
    var hasQuestion = items.some(function (m) { return m.role === 'user'; });
    if (!items.length || !hasQuestion) {
      say('Hazme una pregunta primero y luego podras guardarla', 'error');
      return;
    }
    var button = document.getElementById('save-chat-btn');
    if (button) { button.disabled = true; }
    library.save(TOOL, { messages: items }, { title: titleFor(items) }).then(function (result) {
      if (button) { button.disabled = false; }
      flash(button, result.synced ? '✅ Guardada' : '💾 En este equipo');
      say(result.synced ? 'Conversacion guardada en tu cuenta' : 'Conversacion guardada en este dispositivo');
    }).catch(function () {
      if (button) { button.disabled = false; }
      say('No se pudo guardar la conversacion', 'error');
    });
  };
  function closePanel() {
    var panel = document.getElementById('st-chat-history');
    if (panel) panel.style.display = 'none';
  }

  function ensurePanel() {
    var panel = document.getElementById('st-chat-history');
    if (panel) return panel;
    panel = document.createElement('div');
    panel.id = 'st-chat-history';
    panel.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.62);display:none;align-items:center;' +
      'justify-content:center;z-index:2147482000;padding:18px';
    panel.addEventListener('click', function (event) { if (event.target === panel) closePanel(); });

    var card = document.createElement('div');
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-label', 'Conversaciones guardadas');
    card.style.cssText = 'background:#fff;border-radius:14px;max-width:640px;width:100%;max-height:80vh;overflow:auto;' +
      'padding:20px 22px;box-shadow:0 24px 60px rgba(15,23,42,.32);color:#0f172a';

    var head = document.createElement('div');
    head.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:6px';
    var title = document.createElement('strong');
    title.textContent = 'Conversaciones guardadas';
    title.style.cssText = 'font-size:1.1rem;font-weight:800';
    var close = document.createElement('button');
    close.type = 'button';
    close.textContent = String.fromCharCode(10005);
    close.style.cssText = 'background:none;border:none;font-size:1.1rem;cursor:pointer;color:#64748b';
    close.addEventListener('click', closePanel);
    head.appendChild(title);
    head.appendChild(close);

    var hint = document.createElement('p');
    hint.textContent = 'Se sincronizan con tu cuenta y puedes abrirlas desde cualquier dispositivo.';
    hint.style.cssText = 'color:#64748b;font-size:.88rem;margin:0 0 14px';

    var list = document.createElement('div');
    list.id = 'st-chat-history-list';

    card.appendChild(head);
    card.appendChild(hint);
    card.appendChild(list);
    panel.appendChild(card);
    document.body.appendChild(panel);
    return panel;
  }

  function row(item) {
    var wrap = document.createElement('div');
    wrap.style.cssText = 'border:1px solid #e2e8f0;border-radius:10px;padding:12px 14px;margin-bottom:10px;display:flex;' +
      'gap:12px;align-items:center;justify-content:space-between;flex-wrap:wrap';

    var text = document.createElement('div');
    text.style.cssText = 'flex:1;min-width:200px';
    var name = document.createElement('div');
    name.textContent = item.title;
    name.style.cssText = 'font-weight:700;margin-bottom:2px;word-break:break-word';
    var meta = document.createElement('div');
    var when = item.createdAt ? new Date(item.createdAt) : null;
    var turns = item.data && item.data.messages ? item.data.messages.length : 0;
    meta.textContent = (when && !isNaN(when) ? when.toLocaleString() : 'Guardado recientemente') +
      ' - ' + turns + ' mensajes' + (item.synced ? ' - sincronizado' : '');
    meta.style.cssText = 'color:#64748b;font-size:.8rem';
    text.appendChild(name);
    text.appendChild(meta);

    var actions = document.createElement('div');
    actions.style.cssText = 'display:flex;gap:8px';
    var open = document.createElement('button');
    open.type = 'button';
    open.textContent = 'Abrir';
    open.style.cssText = 'background:#2563eb;color:#fff;border:none;border-radius:8px;padding:8px 14px;font-weight:700;cursor:pointer';
    open.addEventListener('click', function () { openSaved(item.id); });
    var del = document.createElement('button');
    del.type = 'button';
    del.textContent = 'Eliminar';
    del.style.cssText = 'background:#fff;color:#b91c1c;border:1px solid #fecaca;border-radius:8px;padding:8px 12px;font-weight:700;cursor:pointer';
    del.addEventListener('click', function () { removeSaved(item.id); });
    actions.appendChild(open);
    actions.appendChild(del);

    wrap.appendChild(text);
    wrap.appendChild(actions);
    return wrap;
  }
  function render() {
    var list = document.getElementById('st-chat-history-list');
    if (!list) return;
    list.innerHTML = '';
    if (!cached.length) {
      var empty = document.createElement('p');
      empty.textContent = 'Aun no has guardado ninguna conversacion. Pulsa Guardar al final de una sesión.';
      empty.style.cssText = 'color:#64748b;font-size:.9rem;padding:8px 0 4px';
      list.appendChild(empty);
      return;
    }
    cached.forEach(function (item) { list.appendChild(row(item)); });
  }

  function refresh() {
    var library = lib();
    if (!library) return;
    library.list(TOOL).then(function (items) {
      cached = items || [];
      render();
    }).catch(function () {
      cached = [];
      render();
      say('No se pudo leer el historial en la nube, mostrando lo local', 'error');
    });
  }

  function openSaved(id) {
    var item = cached.filter(function (i) { return i.id === id; })[0];
    if (!item || !item.data || !item.data.messages) {
      say('Esa conversacion esta vacia', 'error');
      return;
    }
    writeTranscript(item.data.messages);
    closePanel();
    say('Conversacion cargada en el chat');
  }

  function removeSaved(id) {
    var library = lib();
    if (!library) return;
    library.remove(TOOL, id).then(function () {
      cached = cached.filter(function (i) { return i.id !== id; });
      render();
      say('Conversacion eliminada');
    }).catch(function () {
      say('No se pudo eliminar', 'error');
    });
  }

  window.loadSavedConversations = function () {
    var panel = ensurePanel();
    panel.style.display = 'flex';
    var list = document.getElementById('st-chat-history-list');
    if (list && !cached.length) {
      list.textContent = 'Cargando conversaciones...';
      list.style.cssText = 'color:#64748b;font-size:.9rem';
    }
    refresh();
  };

  window.closeSavedConversations = closePanel;

  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') closePanel();
  });
})();
