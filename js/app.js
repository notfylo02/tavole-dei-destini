/* ============================================================
   Tavole dei Destini — logica applicazione
   ============================================================ */
(function () {
  'use strict';

  var state = Store.load();

  /* ---------------- DOM helpers ---------------- */
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function persist() { return Store.save(state); }

  /* ---------------- Stato navigazione ---------------- */
  var navStack = [];
  var currentView = null;
  var currentFolderId = null;   // cartella aperta nella sezione player
  var playerMode = null;        // null | 'move' | 'delete'
  var currentCharId = null;
  var currentSection = 'statistiche';

  function showView(name, isBack) {
    var next = document.getElementById('view-' + name);
    if (!next) return;
    if (typeof closeDrawer === 'function') closeDrawer(); // chiudi il menu sezioni in ogni navigazione
    $all('.view').forEach(function (v) {
      if (v === next || !v.classList.contains('active')) return;
      v.classList.add('leaving-back');
      v.classList.remove('active');
      setTimeout(function () { v.classList.remove('leaving-back'); }, 450);
    });
    next.classList.add('active');
    next.scrollTop = 0;
    currentView = name;
  }

  function go(name) {
    if (currentView) navStack.push(currentView);
    onEnter(name);
    showView(name);
  }
  function back() {
    var prev = navStack.pop();
    if (!prev) { showView('home', true); currentView = 'home'; return; }
    onEnter(prev);
    showView(prev, true);
  }

  // logica all'ingresso di una view
  function onEnter(name) {
    if (name === 'player') { renderPlayer(); }
    if (name === 'sheet') { /* gestito da openSheet */ }
  }

  /* ============================================================
     TOAST
     ============================================================ */
  var toastTimer;
  function toast(msg, type) {
    var t = $('#toast');
    t.textContent = msg;
    t.className = 'toast show' + (type ? ' ' + type : '');
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, 2400);
  }

  /* ============================================================
     MODALE
     ============================================================ */
  function closeModal() {
    var ov = $('#modal-overlay');
    ov.classList.add('closing');
    setTimeout(function () { ov.hidden = true; ov.classList.remove('closing'); }, 240);
  }
  function openModal(opts) {
    var ov = $('#modal-overlay');
    $('#modal-title').textContent = opts.title || '';
    var body = $('#modal-body');
    body.innerHTML = '';
    if (opts.bodyNode) body.appendChild(opts.bodyNode);
    else if (opts.bodyHtml != null) body.innerHTML = opts.bodyHtml;
    var actions = $('#modal-actions');
    actions.innerHTML = '';
    (opts.actions || []).forEach(function (a) {
      var b = document.createElement('button');
      b.className = 'tool-btn ' + (a.cls || '');
      b.textContent = a.label;
      b.addEventListener('click', function () { a.onClick && a.onClick(); });
      actions.appendChild(b);
    });
    ov.hidden = false;
    if (opts.focus) setTimeout(function () { var f = body.querySelector(opts.focus); f && f.focus(); }, 60);
  }
  // chiudi cliccando fuori
  $('#modal-overlay').addEventListener('click', function (e) {
    if (e.target === this) closeModal();
  });

  function confirmDialog(title, message, confirmLabel, danger) {
    return new Promise(function (resolve) {
      openModal({
        title: title,
        bodyHtml: '<p>' + esc(message) + '</p>',
        actions: [
          { label: 'Annulla', cls: '', onClick: function () { closeModal(); resolve(false); } },
          { label: confirmLabel || 'Conferma', cls: danger ? 'danger active' : 'primary',
            onClick: function () { closeModal(); resolve(true); } }
        ]
      });
    });
  }

  /* ============================================================
     HOME — pulsante hold 1,5s
     ============================================================ */
  function initHold() {
    var btn = $('#hold-start');
    var fill = $('#hold-fill');
    var hint = $('#hold-hint');
    fill.style.transform = 'scaleX(0)';
    var DURATION = 750;
    var raf = null, startT = 0, done = false;

    function frame(ts) {
      if (!startT) startT = ts;
      var p = Math.min((ts - startT) / DURATION, 1);
      fill.style.transform = 'scaleX(' + p + ')';
      if (p >= 1) { complete(); return; }
      raf = requestAnimationFrame(frame);
    }
    function start(e) {
      if (done) return;
      e.preventDefault();
      btn.classList.add('holding');
      hint.textContent = 'il destino si avvicina...';
      startT = 0;
      fill.style.transition = 'none'; // riempimento fluido guidato da rAF
      fill.style.transform = 'scaleX(0)';
      raf = requestAnimationFrame(frame);
    }
    function reset() {
      if (done) return;
      cancelAnimationFrame(raf); raf = null; startT = 0;
      btn.classList.remove('holding');
      fill.style.transition = 'transform .2s ease';
      fill.style.transform = 'scaleX(0)';
      hint.textContent = 'tieni premuto per entrare';
      setTimeout(function () { fill.style.transition = ''; }, 220);
    }
    function complete() {
      done = true;
      cancelAnimationFrame(raf);
      btn.classList.remove('holding'); btn.classList.add('done');
      fill.style.transform = 'scaleX(1)';
      if (navigator.vibrate) { try { navigator.vibrate(40); } catch (e) {} }
      setTimeout(function () {
        navStack = [];
        go('choice');
        // reset per ritorni futuri
        done = false; btn.classList.remove('done');
        fill.style.transform = 'scaleX(0)';
        hint.textContent = 'tieni premuto per entrare';
      }, 120);
    }
    btn.addEventListener('pointerdown', start);
    btn.addEventListener('pointerup', reset);
    btn.addEventListener('pointerleave', reset);
    btn.addEventListener('pointercancel', reset);
  }

  /* ============================================================
     SCELTA ruolo
     ============================================================ */
  $all('[data-goto]').forEach(function (c) {
    c.addEventListener('click', function () {
      var target = c.getAttribute('data-goto');
      if (target === 'player') { currentFolderId = null; playerMode = null; }
      go(target);
    });
  });

  /* ============================================================
     PLAYER — lista schede + cartelle
     ============================================================ */
  function charsIn(folderId) {
    return state.characters
      .filter(function (c) { return (c.folderId || null) === (folderId || null); })
      .sort(function (a, b) { return (b.lastPlayed || b.createdAt || 0) - (a.lastPlayed || a.createdAt || 0); });
  }
  function folderById(id) { return state.folders.find(function (f) { return f.id === id; }); }
  function initials(c) {
    var a = (c.nome || '?').trim()[0] || '?';
    var b = (c.cognome || '').trim()[0] || '';
    return (a + b).toUpperCase();
  }

  function renderBreadcrumb() {
    var bc = $('#player-breadcrumb');
    if (!currentFolderId) { bc.innerHTML = ''; return; }
    var f = folderById(currentFolderId);
    bc.innerHTML = '<b data-root>Le tue schede</b><span class="sep"> / </span>' + esc(f ? f.name : '');
    var root = bc.querySelector('[data-root]');
    if (root) root.addEventListener('click', function () { currentFolderId = null; renderPlayer(); });
  }

  function renderPlayer() {
    renderBreadcrumb();
    $('#player-title').textContent = currentFolderId
      ? (folderById(currentFolderId) ? folderById(currentFolderId).name : 'Cartella')
      : 'Le tue schede';

    // stato pulsanti modalità
    $('[data-action="toggle-move"]').classList.toggle('active', playerMode === 'move');
    $('[data-action="toggle-delete"]').classList.toggle('active', playerMode === 'delete');
    // crea cartella solo a livello radice
    $('[data-action="new-folder"]').style.display = currentFolderId ? 'none' : '';

    var list = $('#player-list');
    list.innerHTML = '';

    var delay = 0;
    function stagger(node) { node.style.animationDelay = (delay) + 'ms'; delay += 45; }

    // cartelle (solo a livello radice)
    if (!currentFolderId) {
      state.folders.forEach(function (f) {
        var count = charsIn(f.id).length;
        var card = document.createElement('div');
        card.className = 'card folder' + (playerMode ? ' selectable mode-' + playerMode : '');
        card.innerHTML =
          '<div class="avatar">📁</div>' +
          '<div class="meta"><h4>' + esc(f.name) + '</h4><p>' + count + ' personagg' + (count === 1 ? 'io' : 'i') + '</p></div>' +
          (playerMode === 'delete' ? '<span class="action-tag">elimina</span>'
            : playerMode === 'move' ? '<span class="action-tag"></span>'
            : '<span class="chev">›</span>');
        stagger(card);
        card.addEventListener('click', function () { onFolderClick(f); });
        list.appendChild(card);
      });
    }

    // personaggi del livello corrente
    var chars = charsIn(currentFolderId);
    chars.forEach(function (c, i) {
      var card = document.createElement('div');
      card.className = 'card' + (playerMode ? ' selectable mode-' + playerMode : '');
      var sub = [c.razza, c.classe].filter(Boolean).join(' · ') || 'Personaggio';
      card.innerHTML =
        '<div class="avatar"></div>' +
        '<div class="meta"><h4>' + esc((c.nome || '') + ' ' + (c.cognome || '')).trim() + '</h4>' +
        '<p>' + esc(sub) + '</p></div>' +
        (playerMode === 'move' ? '<span class="action-tag">sposta</span>'
          : playerMode === 'delete' ? '<span class="action-tag">elimina</span>'
          : (i === 0 && !currentFolderId ? '<span class="badge-last">ultimo</span>' : '') + '<span class="chev">›</span>');
      applyAvatar(card.querySelector('.avatar'), c);
      stagger(card);
      card.addEventListener('click', function () { onCharClick(c); });
      list.appendChild(card);
    });

    // vuoto
    if (list.children.length === 0) {
      var e = document.createElement('div');
      e.className = 'empty';
      e.innerHTML = '<span class="big-ico">🗺️</span><p>Nessuna scheda qui.<br>Premi <b>Crea scheda</b> per dare vita al tuo primo personaggio.</p>';
      list.appendChild(e);
    }
  }

  function onFolderClick(f) {
    if (playerMode === 'delete') {
      confirmDialog('Elimina cartella', 'Sei sicuro di voler cancellare la cartella "' + f.name + '"? I personaggi al suo interno torneranno tra le schede principali.', 'Elimina', true)
        .then(function (ok) {
          if (!ok) return;
          state.characters.forEach(function (c) { if (c.folderId === f.id) c.folderId = null; });
          state.folders = state.folders.filter(function (x) { return x.id !== f.id; });
          persist(); renderPlayer(); toast('Cartella eliminata');
        });
      return;
    }
    if (playerMode === 'move') { return; } // le cartelle non si spostano
    currentFolderId = f.id;
    renderPlayer();
  }

  function onCharClick(c) {
    if (playerMode === 'delete') {
      confirmDialog('Elimina personaggio', 'Sei sicuro di voler cancellare "' + ((c.nome || '') + ' ' + (c.cognome || '')).trim() + '"? L\'operazione non è reversibile.', 'Elimina', true)
        .then(function (ok) {
          if (!ok) return;
          state.characters = state.characters.filter(function (x) { return x.id !== c.id; });
          persist(); renderPlayer(); toast('Personaggio eliminato');
        });
      return;
    }
    if (playerMode === 'move') { openMoveDialog(c); return; }
    openSheet(c.id);
  }

  function openMoveDialog(c) {
    var wrap = document.createElement('div');
    wrap.className = 'modal-list';
    function opt(label, icon, folderId) {
      var b = document.createElement('button');
      b.className = 'modal-opt';
      b.innerHTML = '<span>' + icon + '</span> ' + esc(label);
      b.addEventListener('click', function () {
        c.folderId = folderId; persist(); closeModal(); renderPlayer();
        toast('Spostato' + (folderId ? ' in "' + (folderById(folderId) || {}).name + '"' : ' tra le schede principali'));
      });
      if ((c.folderId || null) === (folderId || null)) b.style.opacity = '.5';
      wrap.appendChild(b);
    }
    opt('Schede principali (fuori dalle cartelle)', '🗂️', null);
    state.folders.forEach(function (f) { opt(f.name, '📁', f.id); });
    if (state.folders.length === 0) {
      var p = document.createElement('p');
      p.style.color = 'var(--text-faint)';
      p.textContent = 'Non hai ancora cartelle. Creane una con “Crea cartella”.';
      wrap.appendChild(p);
    }
    openModal({
      title: 'Sposta personaggio',
      bodyNode: wrap,
      actions: [{ label: 'Chiudi', onClick: closeModal }]
    });
  }

  // toolbar player
  $('#player-toolbar').addEventListener('click', function (e) {
    var btn = e.target.closest('[data-action]');
    if (!btn) return;
    var action = btn.getAttribute('data-action');
    if (action === 'create') {
      playerMode = null; $('#create-form').reset();
      go('create');
    } else if (action === 'new-folder') {
      newFolderDialog();
    } else if (action === 'toggle-move') {
      playerMode = playerMode === 'move' ? null : 'move'; renderPlayer();
      if (playerMode) toast('Tocca un personaggio per spostarlo');
    } else if (action === 'toggle-delete') {
      playerMode = playerMode === 'delete' ? null : 'delete'; renderPlayer();
      if (playerMode) toast('Tocca un elemento da eliminare');
    }
  });

  function newFolderDialog() {
    var field = document.createElement('div');
    field.className = 'field';
    field.innerHTML = '<label>Nome cartella</label><input type="text" maxlength="40" placeholder="Es. Campagna del Drago" />';
    var input = field.querySelector('input');
    function create() {
      var name = (input.value || '').trim();
      if (!name) { input.focus(); return; }
      state.folders.unshift({ id: Store.genId(), name: name, createdAt: Date.now() });
      persist(); closeModal(); renderPlayer(); toast('Cartella creata');
    }
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') create(); });
    openModal({
      title: 'Nuova cartella',
      bodyNode: field,
      focus: 'input',
      actions: [
        { label: 'Annulla', onClick: closeModal },
        { label: 'Crea', cls: 'primary', onClick: create }
      ]
    });
  }

  /* ============================================================
     CREAZIONE personaggio
     ============================================================ */
  $('#create-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var f = e.target;
    var nome = f.nome.value.trim();
    if (!nome) { f.nome.focus(); return; }
    var char = {
      id: Store.genId(),
      nome: nome,
      cognome: f.cognome.value.trim(),
      razza: f.razza.value.trim(),
      classe: f.classe.value.trim(),
      descrizione: f.descrizione.value.trim(),
      folderId: currentFolderId || null,
      createdAt: Date.now(),
      lastPlayed: Date.now(),
      sheet: Store.emptySheet()
    };
    state.characters.push(char);
    persist();
    f.reset();
    // sostituisci 'create' con 'player' nello stack: tornando indietro dalla
    // scheda si arriva alla lista, non di nuovo alla schermata di creazione
    navStack = navStack.filter(function (v) { return v !== 'create'; });
    if (navStack[navStack.length - 1] !== 'player') navStack.push('player');
    openSheet(char.id, true); // noPush: lo stack è già corretto
    toast('Personaggio creato');
  });

  /* ============================================================
     SCHEDA personaggio
     ============================================================ */
  function getChar(id) { return state.characters.find(function (c) { return c.id === id; }); }

  function openSheet(id, noPush) {
    var c = getChar(id);
    if (!c) return;
    currentCharId = id;
    c.lastPlayed = Date.now();
    persist();
    renderSheetHero(c);
    setSheetSection('statistiche'); // imposta sezione attiva, etichetta e render
    // noPush: lo stack di navigazione è già stato preparato dal chiamante
    if (noPush) { showView('sheet'); } else { go('sheet'); }
  }

  function renderSheetHero(c) {
    var hero = $('#sheet-hero');
    var name = ((c.nome || '') + ' ' + (c.cognome || '')).trim();
    $('#sheet-title').textContent = c.nome || 'Scheda';
    var tags = [c.razza, c.classe].filter(Boolean)
      .map(function (t) { return '<span class="tag">' + esc(t) + '</span>'; }).join('');
    hero.innerHTML =
      '<div class="big-avatar"></div>' +
      '<div class="hero-meta"><h3>' + esc(name) + '</h3>' +
      (tags ? '<div class="tags">' + tags + '</div>' : '') +
      (c.descrizione ? '<p class="desc">' + esc(c.descrizione) + '</p>' : '') +
      '</div>' +
      '<button class="hero-edit" id="hero-edit-btn" title="Modifica generalità" aria-label="Modifica generalità">✎</button>';
    applyAvatar($('.big-avatar', hero), c);
    var eb = $('#hero-edit-btn', hero);
    if (eb) eb.addEventListener('click', function () { editCharDialog(c); });
  }

  // mostra immagine (se presente) oppure le iniziali
  function applyAvatar(node, c) {
    if (!node) return;
    if (c.image) {
      node.classList.add('has-img');
      node.style.backgroundImage = 'url("' + c.image + '")';
      node.textContent = '';
    } else {
      node.classList.remove('has-img');
      node.style.backgroundImage = '';
      node.textContent = initials(c);
    }
  }

  // ridimensiona e comprime l'immagine prima di salvarla in locale
  function processImage(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        URL.revokeObjectURL(url);
        var max = 512, w = img.width, h = img.height;
        var scale = Math.min(1, max / Math.max(w, h));
        var cw = Math.max(1, Math.round(w * scale)), ch = Math.max(1, Math.round(h * scale));
        var cv = document.createElement('canvas'); cv.width = cw; cv.height = ch;
        cv.getContext('2d').drawImage(img, 0, 0, cw, ch);
        try { resolve(cv.toDataURL('image/jpeg', 0.82)); }
        catch (e) { reject(e); }
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('Immagine non valida')); };
      img.src = url;
    });
  }

  function editCharDialog(c) {
    var tempImage = c.image || null;
    var wrap = document.createElement('div');
    wrap.style.display = 'flex'; wrap.style.flexDirection = 'column'; wrap.style.gap = '12px';
    wrap.innerHTML =
      '<div class="ec-avatar-row">' +
        '<div class="ec-avatar" id="ec-avatar"></div>' +
        '<div class="ec-avatar-actions">' +
          '<button type="button" class="tool-btn" id="ec-pick"><span>🖼</span> Scegli immagine</button>' +
          '<button type="button" class="tool-btn danger" id="ec-clear"><span>×</span> Rimuovi</button>' +
        '</div>' +
      '</div>' +
      '<div class="field"><label>Nome</label><input id="ec-nome" maxlength="40" /></div>' +
      '<div class="field"><label>Cognome</label><input id="ec-cognome" maxlength="40" /></div>' +
      '<div class="field-row">' +
        '<div class="field"><label>Razza</label><input id="ec-razza" maxlength="40" /></div>' +
        '<div class="field"><label>Classe</label><input id="ec-classe" maxlength="40" /></div>' +
      '</div>' +
      '<div class="field"><label>Descrizione</label><textarea id="ec-desc" rows="4" maxlength="800"></textarea></div>' +
      '<input type="file" id="ec-file" accept="image/*" hidden />';
    wrap.querySelector('#ec-nome').value = c.nome || '';
    wrap.querySelector('#ec-cognome').value = c.cognome || '';
    wrap.querySelector('#ec-razza').value = c.razza || '';
    wrap.querySelector('#ec-classe').value = c.classe || '';
    wrap.querySelector('#ec-desc').value = c.descrizione || '';

    var avatar = wrap.querySelector('#ec-avatar');
    function refreshAvatar() {
      if (tempImage) {
        avatar.classList.add('has-img');
        avatar.style.backgroundImage = 'url("' + tempImage + '")';
        avatar.textContent = '';
      } else {
        avatar.classList.remove('has-img');
        avatar.style.backgroundImage = '';
        avatar.textContent = initials(c);
      }
      wrap.querySelector('#ec-clear').style.display = tempImage ? '' : 'none';
    }
    refreshAvatar();
    wrap.querySelector('#ec-pick').addEventListener('click', function () { wrap.querySelector('#ec-file').click(); });
    wrap.querySelector('#ec-clear').addEventListener('click', function () { tempImage = null; refreshAvatar(); });
    wrap.querySelector('#ec-file').addEventListener('change', function (e) {
      var file = e.target.files[0]; e.target.value = '';
      if (!file) return;
      processImage(file).then(function (dataUrl) { tempImage = dataUrl; refreshAvatar(); })
        .catch(function () { toast('Immagine non valida', 'err'); });
    });

    function save() {
      var nome = wrap.querySelector('#ec-nome').value.trim();
      if (!nome) { wrap.querySelector('#ec-nome').focus(); return; }
      c.nome = nome;
      c.cognome = wrap.querySelector('#ec-cognome').value.trim();
      c.razza = wrap.querySelector('#ec-razza').value.trim();
      c.classe = wrap.querySelector('#ec-classe').value.trim();
      c.descrizione = wrap.querySelector('#ec-desc').value.trim();
      c.image = tempImage || null;
      if (!persist()) { toast('Immagine troppo grande per il salvataggio', 'err'); return; }
      closeModal(); renderSheetHero(c); toast('Generalità aggiornate', 'ok');
    }
    openModal({
      title: 'Modifica generalità',
      bodyNode: wrap, focus: '#ec-nome',
      actions: [
        { label: 'Annulla', onClick: closeModal },
        { label: 'Salva', cls: 'primary', onClick: save }
      ]
    });
  }

  // Navigazione sezioni scheda (menu a scomparsa laterale)
  var SECTION_LABELS = {
    statistiche: 'Statistiche', abilita: 'Abilità', armamenti: 'Armamenti',
    zaino: 'Zaino', combattimento: 'Combattimento'
  };

  function setSheetSection(name) {
    currentSection = name;
    $all('.drawer-item').forEach(function (it) {
      it.classList.toggle('active', it.getAttribute('data-section') === name);
    });
    var lbl = $('#sheet-section-label');
    if (lbl) lbl.textContent = SECTION_LABELS[name] || name;
    renderSection();
  }

  function openDrawer() {
    $('#sheet-drawer').classList.add('open');
    $('#drawer-overlay').classList.add('open');
    $('#sheet-menu-btn').setAttribute('aria-expanded', 'true');
    $('#sheet-drawer').setAttribute('aria-hidden', 'false');
  }
  function closeDrawer() {
    $('#sheet-drawer').classList.remove('open');
    $('#drawer-overlay').classList.remove('open');
    $('#sheet-menu-btn').setAttribute('aria-expanded', 'false');
    $('#sheet-drawer').setAttribute('aria-hidden', 'true');
  }

  $('#sheet-menu-btn').addEventListener('click', openDrawer);
  $('#drawer-overlay').addEventListener('click', closeDrawer);
  $('#drawer-close').addEventListener('click', closeDrawer);
  $('#drawer-nav').addEventListener('click', function (e) {
    var it = e.target.closest('.drawer-item');
    if (!it) return;
    setSheetSection(it.getAttribute('data-section'));
    closeDrawer();
  });

  function renderSection() {
    var c = getChar(currentCharId);
    if (!c) return;
    var panel = $('#sheet-panel');
    panel.className = 'sheet-panel';
    void panel.offsetWidth; // reflow per ri-animare
    panel.classList.add('panel-in');

    switch (currentSection) {
      case 'statistiche': panel.innerHTML = ''; panel.appendChild(viewStatistiche(c)); break;
      case 'abilita': panel.innerHTML = ''; panel.appendChild(viewList(c, 'abilita', 'Abilità', '✨', 'Nuova abilità')); break;
      case 'armamenti': panel.innerHTML = ''; panel.appendChild(viewList(c, 'armamenti', 'Armamenti', '🗡️', 'Nuovo armamento')); break;
      case 'zaino': panel.innerHTML = ''; panel.appendChild(viewZaino(c)); break;
      case 'combattimento': panel.innerHTML = ''; panel.appendChild(viewCombattimento(c)); break;
    }
  }

  function sectionHead(title, onAdd) {
    var head = document.createElement('div');
    head.className = 'section-head';
    head.innerHTML = '<h3>' + esc(title) + '</h3>';
    if (onAdd) {
      var b = document.createElement('button');
      b.className = 'tool-btn primary'; b.innerHTML = '<span>＋</span> Aggiungi';
      b.addEventListener('click', onAdd);
      head.appendChild(b);
    }
    return head;
  }

  /* ---- Statistiche: sistema a punti ----
     Si parte con 10 punti (liv. 1), +4 ad ogni livello.
     Ogni stat può scendere fino a -5 per recuperare punti da spendere altrove. */
  function statVal(s) { var n = parseInt(s.value, 10); return isNaN(n) ? 0 : n; }
  function coreStats(c) { return c.sheet.statistiche.filter(function (s) { return s.core; }); }
  function customStats(c) { return c.sheet.statistiche.filter(function (s) { return !s.core; }); }
  function spentPoints(c) {
    return coreStats(c).reduce(function (t, s) { return t + statVal(s); }, 0);
  }
  function availablePoints(c) {
    return Store.pointsBudget(c.sheet.level) - spentPoints(c);
  }

  // Imposta il valore di una stat rispettando i limiti (min -5, max = punti disponibili).
  // Ritorna true se applicato senza clamp, false se è stato corretto.
  function setStatValue(c, s, target) {
    var cur = statVal(s);
    var t = parseInt(target, 10);
    if (isNaN(t)) t = cur;
    var clamped = false;
    if (t < Store.STAT_MIN) { t = Store.STAT_MIN; clamped = true; }
    var avail = availablePoints(c);
    var maxForThis = cur + avail; // quanto posso salire senza sforare il budget
    if (t > maxForThis) { t = maxForThis; clamped = true; }
    s.value = t;
    persist();
    return !clamped;
  }

  // Ritorna true se il livello è cambiato.
  function setLevel(c, delta) {
    var next = Math.max(1, (parseInt(c.sheet.level, 10) || 1) + delta);
    if (next === c.sheet.level) return false;
    if (delta < 0 && Store.pointsBudget(next) < spentPoints(c)) {
      toast('Riduci prima le statistiche per scendere di livello');
      return false;
    }
    c.sheet.level = next;
    persist();
    return true;
  }

  function viewStatistiche(c) {
    var frag = document.createElement('div');
    frag.appendChild(sectionHead('Statistiche'));

    // Barra: livello + punti disponibili
    var bar = document.createElement('div'); bar.className = 'stats-bar';
    bar.innerHTML =
      '<div class="level-box">' +
        '<span class="lvl-label">Livello</span>' +
        '<button class="step-btn" data-lvl="-1" aria-label="Diminuisci livello">−</button>' +
        '<span class="lvl-val"></span>' +
        '<button class="step-btn" data-lvl="1" aria-label="Aumenta livello">+</button>' +
      '</div>' +
      '<div class="points-box">' +
        '<span class="pts-val"></span>' +
        '<span class="pts-label">punti da spendere</span>' +
      '</div>';
    frag.appendChild(bar);

    // Righe statistiche core (aggiornate in-place, niente re-render)
    var list = document.createElement('div'); list.className = 'stat-list';
    var rows = coreStats(c).map(function (s) { return statRow(c, s, refresh); });
    rows.forEach(function (r) { list.appendChild(r.el); });
    frag.appendChild(list);

    // Aggiornamento in-place dell'intera vista (contatore + righe), senza ricostruire il DOM
    function refresh() {
      var avail = availablePoints(c);
      bar.querySelector('.lvl-val').textContent = c.sheet.level;
      bar.querySelector('[data-lvl="-1"]').disabled = c.sheet.level <= 1;
      var pb = bar.querySelector('.points-box');
      pb.querySelector('.pts-val').textContent = avail;
      pb.classList.toggle('no-points', avail === 0);
      rows.forEach(function (r) { r.update(); });
    }

    bar.querySelector('[data-lvl="-1"]').addEventListener('click', function () { if (setLevel(c, -1)) refresh(); });
    bar.querySelector('[data-lvl="1"]').addEventListener('click', function () { if (setLevel(c, 1)) refresh(); });

    // Eventuali statistiche personalizzate legacy (sola lettura/modifica testuale)
    var customs = customStats(c);
    if (customs.length) {
      var grid = document.createElement('div'); grid.className = 'stat-grid';
      customs.forEach(function (s) {
        var cell = document.createElement('div'); cell.className = 'stat-cell';
        var valDisp = (s.value === '' || s.value == null) ? '–' : esc(s.value);
        cell.innerHTML =
          '<button class="e-del" title="Rimuovi">×</button>' +
          '<div class="s-val">' + valDisp + '</div>' +
          '<div class="s-abbr">' + esc(s.name || '—') + '</div>';
        cell.querySelector('.e-del').addEventListener('click', function (ev) {
          ev.stopPropagation();
          c.sheet.statistiche = c.sheet.statistiche.filter(function (x) { return x.id !== s.id; });
          persist(); renderSection();
        });
        cell.addEventListener('click', function () {
          twoFieldDialog('Modifica statistica', 'Nome', 'Es. Fortuna', 'Valore', 'Es. 10', function (name, value) {
            s.name = name; s.value = value; persist(); renderSection();
          }, s.name, s.value);
        });
        grid.appendChild(cell);
      });
      frag.appendChild(grid);
    }

    refresh(); // popola valori iniziali
    return frag;
  }

  // Crea una riga statistica. Ritorna { el, update } per l'aggiornamento in-place.
  function statRow(c, s, refresh) {
    var row = document.createElement('div'); row.className = 'stat-row';
    row.innerHTML =
      '<div class="sr-head">' +
        '<span class="sr-abbr">' + esc(s.abbr || s.name) + '</span>' +
        '<span class="sr-name">' + esc(s.abbr ? s.name : '') + '</span>' +
      '</div>' +
      '<div class="sr-ctrl">' +
        '<button class="step-btn big" data-step="-5" aria-label="-5">−−</button>' +
        '<button class="step-btn" data-step="-1" aria-label="-1">−</button>' +
        '<div class="sr-input">' +
          '<input type="number" inputmode="numeric" class="sr-val" aria-label="Valore ' + esc(s.abbr || s.name) + '" />' +
          '<button class="confirm-btn" aria-label="Conferma">✓</button>' +
        '</div>' +
        '<button class="step-btn" data-step="1" aria-label="+1">+</button>' +
        '<button class="step-btn big" data-step="5" aria-label="+5">++</button>' +
      '</div>';

    var input = row.querySelector('.sr-val');
    var ups = Array.prototype.slice.call(row.querySelectorAll('[data-step="1"],[data-step="5"]'));
    var downs = Array.prototype.slice.call(row.querySelectorAll('[data-step="-1"],[data-step="-5"]'));

    function applyManual() {
      var ok = setStatValue(c, s, input.value);
      if (!ok) toast('Limite raggiunto: corretto al valore massimo possibile');
      input.blur();
      refresh();
    }
    function step(d) {
      var ok = setStatValue(c, s, statVal(s) + d);
      if (!ok && d > 0) toast('Punti insufficienti');
      refresh();
    }

    row.querySelectorAll('.step-btn').forEach(function (b) {
      b.addEventListener('click', function () { step(parseInt(b.getAttribute('data-step'), 10)); });
    });
    row.querySelector('.confirm-btn').addEventListener('click', applyManual);
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') applyManual(); });

    function update() {
      var avail = availablePoints(c);
      var val = statVal(s);
      if (document.activeElement !== input) input.value = val; // non disturbare la digitazione
      ups.forEach(function (b) { b.disabled = avail <= 0; });
      downs.forEach(function (b) { b.disabled = val <= Store.STAT_MIN; });
    }

    return { el: row, update: update };
  }
  function singleFieldDialog(title, label, value, placeholder, onSave) {
    var wrap = document.createElement('div'); wrap.className = 'field';
    wrap.innerHTML = '<label>' + esc(label) + '</label><input id="sf-1" maxlength="20" placeholder="' + esc(placeholder || '') + '" />';
    var inp = wrap.querySelector('#sf-1'); inp.value = (value == null ? '' : value);
    function save() { onSave(inp.value.trim()); closeModal(); }
    inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') save(); });
    openModal({
      title: title, bodyNode: wrap, focus: '#sf-1',
      actions: [{ label: 'Annulla', onClick: closeModal }, { label: 'Salva', cls: 'primary', onClick: save }]
    });
  }

  /* ---- Liste generiche: abilità / armamenti (nome + descrizione) ---- */
  function viewList(c, key, title, icon, addLabel) {
    var frag = document.createElement('div');
    frag.appendChild(sectionHead(title, function () {
      twoFieldDialog(addLabel, 'Nome', 'Es. ' + title, 'Descrizione', 'Effetto, regole, note...', function (name, desc) {
        c.sheet[key].push({ id: Store.genId(), name: name, desc: desc });
        persist(); renderSection();
      }, '', '', true);
    }));
    if (c.sheet[key].length === 0) frag.appendChild(emptyHint('Nessun elemento. Tocca “Aggiungi”.'));
    c.sheet[key].forEach(function (it) {
      var e = document.createElement('div'); e.className = 'entry';
      e.innerHTML = '<span style="font-size:1.3rem">' + icon + '</span>' +
        '<div class="e-main"><div class="e-name">' + esc(it.name) + '</div>' +
        (it.desc ? '<div class="e-sub">' + esc(it.desc) + '</div>' : '') + '</div>' +
        '<button class="e-del" title="Rimuovi">×</button>';
      e.querySelector('.e-del').addEventListener('click', function () {
        c.sheet[key] = c.sheet[key].filter(function (x) { return x.id !== it.id; });
        persist(); renderSection();
      });
      frag.appendChild(e);
    });
    return frag;
  }

  /* ---- Zaino (nome + quantità + descrizione) ---- */
  function viewZaino(c) {
    var frag = document.createElement('div');
    frag.appendChild(sectionHead('Zaino', function () { addZainoDialog(c); }));
    if (c.sheet.zaino.length === 0) frag.appendChild(emptyHint('Lo zaino è vuoto. Aggiungi oggetti e provviste.'));
    c.sheet.zaino.forEach(function (it) {
      var e = document.createElement('div'); e.className = 'entry';
      e.innerHTML = '<div class="e-val">' + esc(it.qty || '1') + '</div>' +
        '<div class="e-main"><div class="e-name">' + esc(it.name) + '</div>' +
        (it.desc ? '<div class="e-sub">' + esc(it.desc) + '</div>' : '') + '</div>' +
        '<button class="e-del" title="Rimuovi">×</button>';
      e.querySelector('.e-del').addEventListener('click', function () {
        c.sheet.zaino = c.sheet.zaino.filter(function (x) { return x.id !== it.id; });
        persist(); renderSection();
      });
      frag.appendChild(e);
    });
    return frag;
  }
  function addZainoDialog(c) {
    var wrap = document.createElement('div');
    wrap.style.display = 'flex'; wrap.style.flexDirection = 'column'; wrap.style.gap = '12px';
    wrap.innerHTML =
      '<div class="field"><label>Oggetto</label><input id="z-name" maxlength="60" placeholder="Es. Pozione di cura" /></div>' +
      '<div class="field"><label>Quantità</label><input id="z-qty" maxlength="6" placeholder="Es. 3" /></div>' +
      '<div class="field"><label>Descrizione</label><textarea id="z-desc" rows="3" maxlength="400" placeholder="Note..."></textarea></div>';
    function save() {
      var name = wrap.querySelector('#z-name').value.trim();
      if (!name) { wrap.querySelector('#z-name').focus(); return; }
      c.sheet.zaino.push({
        id: Store.genId(), name: name,
        qty: wrap.querySelector('#z-qty').value.trim() || '1',
        desc: wrap.querySelector('#z-desc').value.trim()
      });
      persist(); closeModal(); renderSection();
    }
    openModal({
      title: 'Aggiungi allo zaino', bodyNode: wrap, focus: '#z-name',
      actions: [{ label: 'Annulla', onClick: closeModal }, { label: 'Aggiungi', cls: 'primary', onClick: save }]
    });
  }

  /* ---- Combattimento (note libere, autosalvataggio) ---- */
  function viewCombattimento(c) {
    var frag = document.createElement('div');
    frag.appendChild(sectionHead('Combattimento', null));
    var ta = document.createElement('textarea');
    ta.className = 'field note-area';
    ta.placeholder = 'Iniziativa, azioni, manovre, condizioni, attacchi e tutto ciò che ti serve durante lo scontro...';
    ta.value = c.sheet.combattimento || '';
    var saveTimer;
    ta.addEventListener('input', function () {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(function () { c.sheet.combattimento = ta.value; persist(); }, 350);
    });
    var wrap = document.createElement('div'); wrap.className = 'field';
    wrap.appendChild(ta);
    frag.appendChild(wrap);
    return frag;
  }

  /* ---- helper UI scheda ---- */
  function emptyHint(text) {
    var e = document.createElement('div');
    e.className = 'empty'; e.style.padding = '34px 10px';
    e.innerHTML = '<p>' + esc(text) + '</p>';
    return e;
  }

  function twoFieldDialog(title, l1, p1, l2, p2, onSave, v1, v2, multiline) {
    var wrap = document.createElement('div');
    wrap.style.display = 'flex'; wrap.style.flexDirection = 'column'; wrap.style.gap = '12px';
    var second = multiline
      ? '<textarea id="tf-2" rows="3" maxlength="500" placeholder="' + esc(p2) + '"></textarea>'
      : '<input id="tf-2" maxlength="40" placeholder="' + esc(p2) + '" />';
    wrap.innerHTML =
      '<div class="field"><label>' + esc(l1) + '</label><input id="tf-1" maxlength="40" placeholder="' + esc(p1) + '" /></div>' +
      '<div class="field"><label>' + esc(l2) + '</label>' + second + '</div>';
    wrap.querySelector('#tf-1').value = v1 || '';
    wrap.querySelector('#tf-2').value = v2 || '';
    function save() {
      var a = wrap.querySelector('#tf-1').value.trim();
      var b = wrap.querySelector('#tf-2').value.trim();
      if (!a) { wrap.querySelector('#tf-1').focus(); return; }
      onSave(a, b); closeModal();
    }
    wrap.querySelector('#tf-1').addEventListener('keydown', function (e) { if (e.key === 'Enter' && !multiline) save(); });
    openModal({
      title: title, bodyNode: wrap, focus: '#tf-1',
      actions: [{ label: 'Annulla', onClick: closeModal }, { label: 'Salva', cls: 'primary', onClick: save }]
    });
  }

  // esporta scheda corrente
  $('#sheet-export-btn').addEventListener('click', function () {
    var c = getChar(currentCharId);
    if (c) { Store.exportCharacter(c); toast('Scheda esportata', 'ok'); }
  });

  /* ============================================================
     MENU dati (export/import) — nella sezione player
     ============================================================ */
  $('#player-menu-btn').addEventListener('click', function () {
    var wrap = document.createElement('div');
    wrap.className = 'modal-list';
    function opt(label, icon, fn) {
      var b = document.createElement('button'); b.className = 'modal-opt';
      b.innerHTML = '<span>' + icon + '</span> ' + esc(label);
      b.addEventListener('click', fn);
      wrap.appendChild(b);
    }
    opt('Esporta backup completo', '⭳', function () { Store.exportAll(state); closeModal(); toast('Backup esportato', 'ok'); });
    opt('Importa dati / scheda', '⭱', function () { closeModal(); $('#import-file').click(); });
    openModal({ title: 'Dati e backup', bodyNode: wrap, actions: [{ label: 'Chiudi', onClick: closeModal }] });
  });

  $('#import-file').addEventListener('change', function (e) {
    var file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    Store.parseFile(file).then(function (data) {
      if (data && data.kind === 'tdd-character' && data.character) {
        var c = Store.stripChar(data.character);
        c.id = Store.genId(); c.folderId = currentFolderId || null;
        c.createdAt = Date.now(); c.lastPlayed = Date.now();
        c.sheet = Store.mergeSheet(c.sheet);
        state.characters.push(c); persist(); renderPlayer();
        toast('Scheda importata', 'ok');
      } else if (data && data.kind === 'tdd-full' && data.data) {
        confirmDialog('Importa backup', 'Vuoi SOSTITUIRE tutti i dati attuali con quelli del backup? I dati attuali andranno persi.', 'Sostituisci', true)
          .then(function (ok) {
            if (!ok) return;
            state = {
              version: Store.VERSION,
              characters: (data.data.characters || []).map(function (c) { c.sheet = Store.mergeSheet(c.sheet); return c; }),
              folders: data.data.folders || [],
              master: data.data.master || {}
            };
            persist(); currentFolderId = null; renderPlayer();
            toast('Backup importato', 'ok');
          });
      } else {
        toast('File non riconosciuto', 'err');
      }
    }).catch(function () { toast('File non valido', 'err'); });
  });

  /* ============================================================
     Back buttons + tastiera
     ============================================================ */
  $all('[data-back]').forEach(function (b) {
    b.addEventListener('click', function () { playerMode = null; back(); });
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      if (!$('#modal-overlay').hidden) { closeModal(); return; }
      if (currentView && currentView !== 'home') back();
    }
  });

  /* ============================================================
     Sfondo stellato
     ============================================================ */
  function initStars() {
    var box = $('#stars');
    var n = window.innerWidth < 600 ? 40 : 70;
    var html = '';
    for (var i = 0; i < n; i++) {
      var x = Math.random() * 100, y = Math.random() * 100;
      var d = (2 + Math.random() * 4).toFixed(1);
      var delay = (Math.random() * 4).toFixed(1);
      var s = (0.6 + Math.random() * 1.6).toFixed(1);
      html += '<span style="left:' + x + '%;top:' + y + '%;width:' + s + 'px;height:' + s +
        'px;animation-duration:' + d + 's;animation-delay:' + delay + 's"></span>';
    }
    box.innerHTML = html;
  }

  /* ============================================================
     INIT
     ============================================================ */
  initStars();
  initHold();
  showView('home');
  currentView = 'home';
})();
