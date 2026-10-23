/* storage.js — автосохранение, проекты, защита от потери данных.
   ─────────────────────────────────────────────────────────────────────────────
   Принципы:
   • Только localStorage — ни одного сетевого запроса (инварианты I1/I7).
   • Автосохранение — страховка от потери работы (перезагрузка, краш браузера).
   • Явное сохранение проекта — то, что пользователь считает «сохранённым»:
     после него снимается предупреждение о несохранённых изменениях.
   • Любая потенциальная потеря данных (перезагрузка, закрытие вкладки,
     загрузка пресета, импорт) спрашивает подтверждения, если есть
     несохранённые изменения.
   • Если localStorage недоступен (private mode, жёсткие настройки) —
     приложение продолжает работать, но предупреждение о перезагрузке
     становится единственной защитой, поэтому об этом сообщаем явно.
*/
(function () {
  var RMQ = window.RMQ = window.RMQ || {};

  var K = {
    autosave: 'rmqdesigner:autosave:v1',
    projects: 'rmqdesigner:projects:v1',
    prefs: 'rmqdesigner:prefs:v1',
  };
  var DEBOUNCE = 600;        // мс, отложенная запись автосохранения
  var MAX_PROJECTS = 40;     // больше хранить бессмысленно
  var MAX_AUTOSAVES = 8;     // слотов автосохранения (по одному на вкладку)

  // Автосохранение — отдельный слот на вкладку. Иначе две вкладки пишут в один
  // ключ и молча затирают работу друг друга, а после перезагрузки восстанавливается
  // схема «соседней» вкладки. Слот живёт в sessionStorage: перезагрузка той же
  // вкладки возвращает именно её состояние.
  var TAB_ID = '';
  try {
    TAB_ID = window.sessionStorage.getItem('rmqdesigner:tab:v1') || '';
    if (!TAB_ID) {
      TAB_ID = 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      window.sessionStorage.setItem('rmqdesigner:tab:v1', TAB_ID);
    }
  } catch (e) {
    TAB_ID = 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  var st = {
    dirty: false,        // изменения после последнего явного сохранения
    current: '',         // имя текущего сохранённого проекта
    savedAt: null,       // когда сохранён текущий проект
    autoAt: null,        // когда записан автосохранение
    autoEnabled: true,   // автосохранение в браузере
    booted: false,
    suspended: false,    // подавление dirty во время восстановления
    lsOk: true,          // доступен ли localStorage
  };
  var timer = null;
  var pendingAfterSave = null; // действие, выполняемое после успешного сохранения

  function t(k, o) { return I18N.t(k, o); }
  function toast(msg) { if (RMQ.app && RMQ.app.toast) RMQ.app.toast(msg); }
  function $(sel, root) { return (root || document).querySelector(sel); }

  // ------------------------------------------------------------ localStorage ---
  function lsGet(key) {
    try { return window.localStorage.getItem(key); }
    catch (e) { st.lsOk = false; return null; }
  }
  function lsSet(key, val) {
    try { window.localStorage.setItem(key, val); return true; }
    catch (e) {
      st.lsOk = false;
      var full = e && (e.name === 'QuotaExceededError' || e.code === 22 || e.code === 1014);
      toast(t(full ? 'toastStorageFull' : 'toastNoStorage'));
      return false;
    }
  }
  function lsDel(key) { try { window.localStorage.removeItem(key); } catch (e) {} }
  function readJson(key) {
    var raw = lsGet(key);
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (e) { return null; }
  }
  function writeJson(key, obj) { return lsSet(key, JSON.stringify(obj)); }

  function fmtTime(ts) {
    if (!ts) return '';
    var d = new Date(ts), n = new Date();
    var sameDay = d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
    var tm = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return sameDay ? tm : (d.toLocaleDateString() + ' ' + tm);
  }

  // -------------------------------------------------------------------- prefs ---
  function prefs() { return readJson(K.prefs) || {}; }
  function savePrefs(p) { writeJson(K.prefs, p); }

  // Отпечаток схемы: по нему понимаем, что восстановленное из автосохранения
  // состояние — это ровно тот проект, который пользователь уже сохранял
  // (значит, предупреждать о несохранённых изменениях не нужно).
  // Живое состояние симуляции живёт в RMQ.state.messages/counters, а не в узлах,
  // поэтому nodes/links стабильны между сохранениями.
  function fingerprint(data) {
    if (!data) return '';
    try {
      return JSON.stringify([data.vhost || '', data.package || '', !!data.exportIncludeUsers, data.nodes || [], data.links || []]);
    } catch (e) { return ''; }
  }
  function markExplicitlySaved(name, fp) {
    var p = prefs();
    p.lastSavedFp = fp || '';
    p.lastSavedName = name || '';
    p.lastSavedAt = Date.now();
    savePrefs(p);
  }

  // --------------------------------------------------------------- dirty state ---
  // Любое изменение топологии вызывает touched() → markDirty().
  function markDirty() {
    if (!st.booted || st.suspended) return;
    if (!st.dirty) st.dirty = true;
    scheduleAutosave();
    paint();
  }
  function isDirty() { return st.dirty; }

  // Отложенное действие: выполнить сразу после успешного сохранения.
  function runPending() {
    var fn = pendingAfterSave;
    pendingAfterSave = null;
    if (fn) fn();
  }

  function autoKey() { return K.autosave + ':tab:' + TAB_ID; }
  function autoSlots() {
    var out = [];
    try {
      for (var i = 0; i < window.localStorage.length; i++) {
        var k = window.localStorage.key(i);
        if (k && k.indexOf(K.autosave) === 0) out.push(k);
      }
    } catch (e) {}
    return out;
  }
  // Сначала свой слот (перезагрузка этой вкладки), иначе — самый свежий.
  function findAutosave() {
    var own = readJson(autoKey());
    if (own && own.data && Array.isArray(own.data.nodes)) return own;
    var best = null;
    autoSlots().forEach(function (k) {
      var v = readJson(k);
      if (!v || !v.data || !Array.isArray(v.data.nodes)) return;
      if (!best || (v.savedAt || 0) > (best.savedAt || 0)) best = v;
    });
    return best;
  }
  function pruneAutosaves() {
    var items = autoSlots().map(function (k) { return { k: k, v: readJson(k) }; })
      .filter(function (x) { return x.v && x.v.savedAt; })
      .sort(function (a, b) { return b.v.savedAt - a.v.savedAt; });
    var cutoff = Date.now() - 30 * 24 * 3600 * 1000;
    items.forEach(function (x, i) {
      if (i >= MAX_AUTOSAVES || x.v.savedAt < cutoff) lsDel(x.k);
    });
  }

  function scheduleAutosave() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(writeAutosave, DEBOUNCE);
  }
  function writeAutosave() {
    timer = null;
    if (!st.autoEnabled || !st.lsOk) return;
    var data = snapshot();
    if (!data) return;
    if (writeJson(autoKey(), { v: 1, tab: TAB_ID, savedAt: Date.now(), data: data })) {
      st.autoAt = Date.now();
      paint();
    }
  }
  function flushAutosave() {
    if (timer) { clearTimeout(timer); timer = null; }
    if (st.dirty && st.autoEnabled) writeAutosave();
  }
  function snapshot() {
    try { return RMQ.save ? RMQ.save() : null; }
    catch (e) { return null; }
  }

  // ----------------------------------------------------------------- projects ---
  function allProjects() {
    var o = readJson(K.projects);
    return (o && typeof o === 'object') ? o : {};
  }
  function listProjects() {
    var all = allProjects();
    return Object.keys(all).map(function (k) {
      var p = all[k] || {};
      return { name: p.name || k, savedAt: p.savedAt || 0, data: p.data || null };
    }).sort(function (a, b) { return b.savedAt - a.savedAt; });
  }
  function defaultName() {
    var s = RMQ.state || {};
    var base = (s.vhost && s.vhost !== '/') ? s.vhost : 'topology';
    base = String(base).replace(/[\\/:*?"<>|]/g, '-').slice(0, 40);
    var all = allProjects(), name = base, i = 2;
    while (all[name]) { name = base + '-' + i; i++; }
    return name;
  }
  function saveProject(name) {
    name = String(name || '').trim().slice(0, 60) || defaultName();
    var data = snapshot();
    if (!data) return false;
    data.name = name;
    var all = allProjects();
    // Лимит не должен молча удалять старый проект: отказываем и просим освободить место.
    if (!all[name] && Object.keys(all).length >= MAX_PROJECTS) {
      toast(t('toastProjectsLimit', { max: MAX_PROJECTS }));
      return false;
    }
    all[name] = { name: name, savedAt: Date.now(), data: data };
    if (!writeJson(K.projects, all)) return false;
    st.current = name;
    st.savedAt = Date.now();
    st.dirty = false;
    if (RMQ.state) RMQ.state.projectName = name;
    markExplicitlySaved(name, fingerprint(data));
    writeAutosave();          // автосейв приводим к тому же состоянию
    paint();
    toast(t('toastProjectSaved', { name: name }));
    projectsModal.hide();
    runPending();
    return true;
  }
  function openProject(name) {
    var p = allProjects()[name];
    if (!p || !p.data) return false;
    st.suspended = true;
    try { RMQ.load(p.data); } catch (e) { st.suspended = false; toast(t('toastProjectBroken')); return false; }
    st.suspended = false;
    st.current = name;
    st.savedAt = p.savedAt || null;
    st.dirty = false;
    if (RMQ.state) RMQ.state.projectName = name;
    markExplicitlySaved(name, fingerprint(p.data));
    paint();
    toast(t('toastProjectOpened', { name: name }));
    return true;
  }
  function deleteProject(name) {
    var all = allProjects();
    if (!all[name]) return false;
    delete all[name];
    if (!writeJson(K.projects, all)) return false;
    if (st.current === name) { st.current = ''; st.savedAt = null; }
    paint();
    toast(t('toastProjectDeleted', { name: name }));
    return true;
  }

  // ------------------------------------------------------------- file I/O ------
  function fileName() {
    var n = (RMQ.state && RMQ.state.projectName) || st.current || defaultName();
    return String(n).replace(/[\\/:*?"<>|]/g, '-') + '.rmq.json';
  }
  function exportFile() {
    var data = snapshot();
    if (!data) return;
    data.name = (RMQ.state && RMQ.state.projectName) || st.current || '';
    var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = fileName();
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 400);
    // файл на диске = явное сохранение
    st.current = data.name || st.current;
    st.savedAt = Date.now();
    st.dirty = false;
    markExplicitlySaved(st.current, fingerprint(data));
    paint();
    toast(t('toastFileSaved'));
  }
  function uniqueProjectName(base, all) {
    var name = base, i = 2;
    while (all[name]) { name = base + '-' + i; i++; }
    return name;
  }
  function importFile(file) {
    if (!file) return;
    var rd = new FileReader();
    rd.onload = function () {
      var obj;
      try { obj = JSON.parse(rd.result); }
      catch (e) { toast(t('toastFileBad', { err: e.message })); return; }
      if (!obj || obj.app !== 'rabbitmq-designer' || !Array.isArray(obj.nodes)) { toast(t('toastFileNotProject')); return; }
      var name = String(obj.name || file.name.replace(/\.rmq\.json$/i, '').replace(/\.json$/i, '') || 'imported').trim().slice(0, 60) || 'imported';
      st.suspended = true;
      try { RMQ.load(obj); } catch (e) { st.suspended = false; toast(t('toastFileNotProject')); return; }
      st.suspended = false;

      var all = allProjects();
      // Импорт не должен молча затирать одноимённый проект.
      if (all[name] && !window.confirm(t('confirmOverwriteProject', { name: name }))) {
        name = uniqueProjectName(name, all);
      }
      if (!all[name] && Object.keys(all).length >= MAX_PROJECTS) {
        // Схема уже загружена, но в проекты не попала — честно помечаем как несохранённую.
        st.current = ''; st.savedAt = null; st.dirty = true;
        if (RMQ.state) RMQ.state.projectName = '';
        toast(t('toastProjectsLimit', { max: MAX_PROJECTS }));
        paint();
        return;
      }
      all[name] = { name: name, savedAt: Date.now(), data: obj };
      if (!writeJson(K.projects, all)) {
        // Запись не удалась (квота/private mode): не выдаём успех и не снимаем dirty.
        st.current = ''; st.savedAt = null; st.dirty = true;
        if (RMQ.state) RMQ.state.projectName = '';
        paint();
        return;
      }
      st.current = name; st.savedAt = Date.now(); st.dirty = false;
      if (RMQ.state) RMQ.state.projectName = name;
      markExplicitlySaved(name, fingerprint(obj));
      paint();
      toast(t('toastFileLoaded', { name: name }));
      projectsModal.hide();
      runPending();
    };
    rd.readAsText(file);
  }
  function pickFile() {
    var inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = '.json,application/json';
    inp.addEventListener('change', function () { importFile(inp.files[0]); });
    inp.click();
  }

  // ---------------------------------------------------------------- индикатор ---
  function paint() {
    var el = document.getElementById('saveState');
    if (!el) return;
    var cls = 'save-state', txt;
    if (st.dirty) { cls += ' dirty'; txt = t('saveStateDirty'); }
    else if (st.current) { cls += ' saved'; txt = t('saveStateSaved'); }
    else if (st.autoAt) { cls += ' auto'; txt = t('saveStateAuto'); }
    else { cls += ' saved'; txt = t('saveStateSaved'); }
    el.className = cls;
    el.textContent = txt;
    var tip = st.autoAt ? t('saveStateTipAuto', { time: fmtTime(st.autoAt) }) : t('saveStateTip');
    if (st.current) tip += ' ' + t('saveStateTipProject', { name: st.current, time: fmtTime(st.savedAt) });
    el.title = tip;
  }

  // ------------------------------------------------------------- guard: диалог ---
  // Возврат фокуса после закрытия модалки (a11y): запоминаем элемент, с которого
  // её открыли, но не тащим фокус из уже открытой модалки.
  var lastModalFocus = null;
  function rememberFocus() {
    var a = document.activeElement;
    if (!a || a === document.body) return;
    if (a.closest && a.closest('.modal-back')) return;
    lastModalFocus = a;
  }
  function restoreFocus() {
    if (document.querySelector('.modal-back.show')) return; // открыта другая модалка
    var a = lastModalFocus;
    lastModalFocus = null;
    if (a && a.focus && document.contains(a)) a.focus();
  }

  var confirmModal = (function () {
    var root, cb = null;
    function build() {
      root = document.createElement('div'); root.className = 'modal-back';
      root.setAttribute('role', 'dialog');
      root.setAttribute('aria-modal', 'true');
      root.setAttribute('tabindex', '-1');
      root.innerHTML =
        '<div class="modal modal-narrow">' +
        '<div class="modal-hd"><span id="cf-title"></span><button class="x" id="cf-close">×</button></div>' +
        '<div class="modal-bd">' +
        '<div class="cf-text" id="cf-text"></div>' +
        '<div class="cf-actions">' +
        '<button class="btn btn-primary" id="cf-save"></button>' +
        '<button class="btn" id="cf-discard"></button>' +
        '<button class="btn btn-ghost" id="cf-cancel"></button>' +
        '</div></div></div>';
      root.addEventListener('click', function (e) { if (e.target === root) done('cancel'); });
      $('#cf-close', root).addEventListener('click', function () { done('cancel'); });
      $('#cf-save', root).addEventListener('click', function () { done('save'); });
      $('#cf-discard', root).addEventListener('click', function () { done('discard'); });
      $('#cf-cancel', root).addEventListener('click', function () { done('cancel'); });
      document.body.appendChild(root);
    }
    function done(choice) {
      if (root) root.classList.remove('show');
      restoreFocus();
      var fn = cb; cb = null;
      if (fn) fn(choice);
    }
    function open(onChoice) {
      if (!root) build();
      rememberFocus();
      cb = onChoice;
      $('#cf-title', root).textContent = t('unsavedTitle');
      $('#cf-text', root).textContent = t('unsavedText');
      $('#cf-save', root).textContent = t('unsavedSave');
      $('#cf-discard', root).textContent = t('unsavedDiscard');
      $('#cf-cancel', root).textContent = t('unsavedCancel');
      root.classList.add('show');
      var b = $('#cf-save', root); if (b) b.focus();
    }
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && root && root.classList.contains('show')) { e.stopPropagation(); done('cancel'); }
    });
    return { open: open, close: function () { done('cancel'); } };
  })();

  // Выполнить действие, если нет несохранённых изменений; иначе — спросить.
  function guard(fn) {
    if (!st.dirty) { fn(); return; }
    confirmModal.open(function (choice) {
      if (choice === 'discard') {
        st.suspended = true;
        try { fn(); } finally { st.suspended = false; }
        st.dirty = true;  // новое состояние после замены схемы — несохранённое
        paint();
      } else if (choice === 'save') {
        pendingAfterSave = function () {
          st.suspended = true;
          try { fn(); } finally { st.suspended = false; }
          st.dirty = true;
          paint();
        };
        projectsModal.open(true);
      }
      // 'cancel' — ничего не делаем
    });
  }

  // --------------------------------------------------------- модалка проектов ---
  var projectsModal = (function () {
    var root, listEl, nameEl;
    function build() {
      root = document.createElement('div'); root.className = 'modal-back';
      root.setAttribute('role', 'dialog');
      root.setAttribute('aria-modal', 'true');
      root.setAttribute('tabindex', '-1');
      root.innerHTML =
        '<div class="modal modal-narrow">' +
        '<div class="modal-hd"><span id="pm-title"></span><button class="x" id="pm-close">×</button></div>' +
        '<div class="modal-bd">' +
        '<div class="pm-save">' +
        '<div class="frow"><label class="flabel" id="pm-namelabel"></label><input class="in" id="pm-name" type="text" /></div>' +
        '<div class="pm-row"><button class="btn btn-primary" id="pm-save"></button>' +
        '<label class="fcheck pm-auto"><input type="checkbox" id="pm-auto" /><span id="pm-autolabel"></span></label></div>' +
        '</div>' +
        '<div class="pm-list-hd" id="pm-listhd"></div>' +
        '<div class="pm-list" id="pm-list"></div>' +
        '<div class="pm-foot">' +
        '<button class="btn" id="pm-dl"></button>' +
        '<button class="btn" id="pm-ul"></button>' +
        '<span class="pm-info" id="pm-info"></span>' +
        '</div>' +
        '</div></div>';
      root.addEventListener('click', function (e) { if (e.target === root) close(); });
      $('#pm-close', root).addEventListener('click', close);
      $('#pm-save', root).addEventListener('click', function () {
        var name = nameEl.value.trim();
        if (saveProject(name)) { nameEl.value = ''; refresh(); }
      });      $('#pm-auto', root).addEventListener('change', function (e) {
        st.autoEnabled = e.target.checked;
        var p = prefs(); p.autoEnabled = st.autoEnabled; savePrefs(p);
        if (st.autoEnabled) writeAutosave();
        paint(); refresh();
      });
      $('#pm-dl', root).addEventListener('click', function () { exportFile(); });
      $('#pm-ul', root).addEventListener('click', function () { pickFile(); });
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && root && root.classList.contains('show')) { e.stopPropagation(); close(); }
      });
      document.body.appendChild(root);
    }
    function hide() {
      if (root) root.classList.remove('show');
      restoreFocus();
    }
    function close() {
      hide();
      pendingAfterSave = null;   // пользователь закрыл окно без сохранения — действие отменяется
    }
    function open(focusName) {
      if (!root) build();
      rememberFocus();
      var T = t;
      $('#pm-title', root).textContent = T('projectsTitle');
      $('#pm-namelabel', root).textContent = T('projectNameLabel');
      $('#pm-save', root).textContent = T('saveProjectBtn');
      $('#pm-autolabel', root).textContent = T('autosaveLabel');
      $('#pm-listhd', root).textContent = T('savedProjects');
      $('#pm-dl', root).textContent = T('downloadProject');
      $('#pm-ul', root).textContent = T('uploadProject');
      nameEl = $('#pm-name', root);
      nameEl.value = (RMQ.state && RMQ.state.projectName) || st.current || defaultName();
      $('#pm-auto', root).checked = st.autoEnabled;
      refresh();
      root.classList.add('show');
      if (nameEl) { nameEl.focus(); nameEl.select(); }
    }
    function refresh() {
      if (!root) return;
      listEl = $('#pm-list', root);
      listEl.innerHTML = '';
      var list = listProjects();
      if (!list.length) {
        var e = document.createElement('div'); e.className = 'pm-empty'; e.textContent = t('noProjects');
        listEl.appendChild(e);
      } else {
        list.forEach(function (p) {
          var row = document.createElement('div'); row.className = 'pm-item' + (p.name === st.current ? ' current' : '');
          var nm = document.createElement('span'); nm.className = 'pm-name'; nm.textContent = p.name;
          var dt = document.createElement('span'); dt.className = 'pm-date'; dt.textContent = fmtTime(p.savedAt);
          var bOpen = document.createElement('button'); bOpen.className = 'btn tiny'; bOpen.textContent = t('openProject');
          bOpen.addEventListener('click', function () {
            guard(function () { openProject(p.name); close(); });
          });
          var bDel = document.createElement('button'); bDel.className = 'btn tiny danger'; bDel.textContent = t('deleteProject');
          bDel.addEventListener('click', function () {
            if (window.confirm(t('confirmDeleteProject', { name: p.name }))) { deleteProject(p.name); refresh(); }
          });
          row.appendChild(nm); row.appendChild(dt); row.appendChild(bOpen); row.appendChild(bDel);
          listEl.appendChild(row);
        });
      }
      var info = $('#pm-info', root);
      if (info) info.textContent = st.autoAt ? t('autosaveInfo', { time: fmtTime(st.autoAt) }) : t('autosaveInfoEmpty');
    }
    return { open: open, close: close, refresh: refresh, hide: hide };
  })();

  // ------------------------------------------------------------------- init ----
  function init() {
    if (st.booted) return false;
    st.booted = true;

    // настройки
    var p = prefs();
    st.autoEnabled = p.autoEnabled !== false;
    if (p.lang) RMQ.state.lang = p.lang;

    // восстановление автосохранения
    var restored = false;
    pruneAutosaves();
    var as = findAutosave();
    // пустая схема (0 узлов) — тоже валидное состояние, восстанавливаем её
    if (as && as.data && as.data.app === 'rabbitmq-designer' && Array.isArray(as.data.nodes)) {
      st.suspended = true;
      try {
        RMQ.load(as.data);
        st.autoAt = as.savedAt || null;
        if (RMQ.state) {
          RMQ.state.projectName = as.data.name || '';
          RMQ.state.lang = p.lang || RMQ.state.lang;
        }
        restored = true;
      } catch (e) { restored = false; }
      st.suspended = false;
      // Восстановленное состояние считаем несохранённым — ИСКЛЮЧАЯ случая,
      // когда оно в точности совпадает с проектом, который пользователь уже
      // сохранял (тогда предупреждать не о чем).
      if (restored) {
        var fp = fingerprint(as.data);
        if (p.lastSavedFp && p.lastSavedFp === fp) {
          st.current = p.lastSavedName || '';
          st.savedAt = p.lastSavedAt || null;
          st.dirty = false;
        } else {
          st.dirty = true;   // есть несохранённые изменения → предупреждаем
        }
      }
    }

    // кнопка и индикатор в шапке
    var btn = document.getElementById('btnProjects');
    if (btn) btn.addEventListener('click', function () { projectsModal.open(false); });
    var chip = document.getElementById('saveState');
    if (chip) chip.addEventListener('click', function () { projectsModal.open(false); });

    // Другая вкладка изменила список проектов — обновляем открытое окно.
    // Автосохранения у вкладок раздельные, поэтому состояние здесь не трогаем.
    window.addEventListener('storage', function (e) {
      if (e.key === K.projects) projectsModal.refresh();
    });

    // Ctrl+S — сохранить проект
    document.addEventListener('keydown', function (e) {
      if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        if (st.current) { if (saveProject(st.current)) projectsModal.refresh(); }
        else projectsModal.open(true);
      }
    });

    // предупреждение при перезагрузке / закрытии вкладки
    window.addEventListener('beforeunload', function (e) {
      if (!st.dirty) return;
      e.preventDefault();
      e.returnValue = '';     // Chrome / Edge / Firefox
      return '';
    });
    // финальный сброс автосохранения (мобильные браузеры не гарантируют beforeunload)
    window.addEventListener('pagehide', flushAutosave);
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') flushAutosave();
    });

    if (!st.lsOk) toast(t('toastNoStorage'));
    if (restored) {
      toast(st.dirty
        ? t('autosaveRestored', { time: fmtTime(st.autoAt) })
        : t('autosaveRestoredSaved', { time: fmtTime(st.autoAt), name: st.current || '—' }));
    }
    paint();
    return restored;
  }

  function setLang(lang) {
    var p = prefs(); p.lang = lang; savePrefs(p);
  }

  // ----------------------------------------------------------------- public ----
  RMQ.storage = {
    init: init,
    markDirty: markDirty,
    isDirty: isDirty,
    paint: paint,
    setLang: setLang,
    saveProject: saveProject,
    openProject: openProject,
    deleteProject: deleteProject,
    listProjects: listProjects,
    exportFile: exportFile,
    importFile: importFile,
    pickFile: pickFile,
    guard: guard,
    openProjects: function () { projectsModal.open(false); },
    get currentName() { return st.current; },
    get autoSavedAt() { return st.autoAt; },
    get storageAvailable() { return st.lsOk; },
  };
})();
