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
  var armSubpage = null;        // Armamenti: null=hub | 'weapons' | 'armor' | 'elmo' | 'accessory'
  var masterSection = null;     // Plancia Master: null=hub | 'bestiario' | 'note' | 'arsenale'
  var arsenalSub = null;        // Arsenale: null=hub | 'weapons' | 'armor' | 'elmo' | 'accessory'
  var appRole = 'player';       // 'master' | 'player' — ruolo corrente (per menu e sessione)
  var activeCharId = null;      // PG con cui il giocatore è in sessione (riceve abilità/punti)
  var editingClassId = null;    // classe aperta nell'editor master
  var editingAbilityId = null;  // abilità aperta nell'editor master
  var linkMode = false;         // editor albero: modalità "collega bolle"
  var linkFrom = null;          // editor albero: prima bolla selezionata per il collegamento
  var masterProgress = {};      // progressi ricevuti: { memberId: {treeId,ranks,points,charName} }
  // Combattimento (Fight)
  var fight = { ongoing: false, myInit: null, enemies: [], inits: {}, order: [] };

  function showView(name, isBack) {
    var next = document.getElementById('view-' + name);
    if (!next) return;
    if (typeof closeDrawer === 'function') closeDrawer(); // chiudi il menu sezioni in ogni navigazione
    if (typeof closeAppDrawer === 'function') closeAppDrawer(); // chiudi il menu app
    if (typeof closeAbilityOverlay === 'function' && typeof aoCtx !== 'undefined' && aoCtx) closeAbilityOverlay();
    var leaveClass = isBack ? 'leaving-back' : 'leaving';
    $all('.view').forEach(function (v) {
      if (v === next || !v.classList.contains('active')) return;
      v.classList.add(leaveClass);
      v.classList.remove('active');
      setTimeout(function () { v.classList.remove('leaving', 'leaving-back'); }, 520);
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
    if (name === 'master') { renderMaster(); }
    if (name === 'session') { renderSession(); }
    if (name === 'messages') { renderMessages(); clearUnread(); }
    if (name === 'ability-editor') { renderAbilityEditor(); }
    if (name === 'fight') { renderFight(); }
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
  var modalCloseTimer = null;
  function closeModal() {
    var ov = $('#modal-overlay');
    ov.classList.add('closing');
    clearTimeout(modalCloseTimer);
    modalCloseTimer = setTimeout(function () { ov.hidden = true; ov.classList.remove('closing'); modalCloseTimer = null; }, 240);
  }
  function openModal(opts) {
    var ov = $('#modal-overlay');
    // se c'è una chiusura in corso, annullala: stiamo riaprendo subito (es. scelta -> form)
    clearTimeout(modalCloseTimer); modalCloseTimer = null; ov.classList.remove('closing');
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
      // zoom "dentro": la home si ingrandisce e sfuma, poi la scelta entra con zoom-in
      var home = $('#view-home');
      var choice = $('#view-choice');
      home.classList.add('warp-out');
      setTimeout(function () {
        navStack = [];
        choice.classList.add('warp-in'); // aggiunto subito prima di mostrarla, così lo zoom parte da 0
        go('choice');
        setTimeout(function () { choice.classList.remove('warp-in'); home.classList.remove('warp-out'); }, 700);
        // reset per ritorni futuri
        done = false; btn.classList.remove('done');
        fill.style.transform = 'scaleX(0)';
        hint.textContent = 'tieni premuto per entrare';
      }, 260);
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
      if (target === 'player') { currentFolderId = null; playerMode = null; appRole = 'player'; }
      if (target === 'master') { appRole = 'master'; }
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
    setSheetSection('home'); // apre sulla panoramica del personaggio
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

  // ridimensiona e comprime l'immagine prima di salvarla/inviarla
  function processImage(file, max, quality) {
    max = max || 512; quality = quality || 0.82;
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        URL.revokeObjectURL(url);
        var w = img.width, h = img.height;
        var scale = Math.min(1, max / Math.max(w, h));
        var cw = Math.max(1, Math.round(w * scale)), ch = Math.max(1, Math.round(h * scale));
        var cv = document.createElement('canvas'); cv.width = cw; cv.height = ch;
        cv.getContext('2d').drawImage(img, 0, 0, cw, ch);
        try { resolve(cv.toDataURL('image/jpeg', quality)); }
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
    home: 'Panoramica', statistiche: 'Statistiche', abilita: 'Abilità', armamenti: 'Armamenti',
    zaino: 'Zaino', combattimento: 'Combattimento'
  };

  function setSheetSection(name) {
    currentSection = name;
    if (name === 'armamenti') armSubpage = null; // entrando dal menu si parte dall'hub
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

  // l'hamburger della scheda apre lo STESSO menu completo delle altre sezioni
  $('#sheet-menu-btn').addEventListener('click', function () { if (typeof openAppDrawer === 'function') openAppDrawer(); });
  $('#drawer-overlay').addEventListener('click', closeDrawer);
  $('#drawer-close').addEventListener('click', closeDrawer);
  $('#drawer-nav').addEventListener('click', function (e) {
    var it = e.target.closest('.drawer-item');
    if (!it) return;
    var nav = it.getAttribute('data-nav');
    if (nav) { closeDrawer(); if (typeof navTo === 'function') navTo(nav); return; }
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
      case 'home': panel.innerHTML = ''; panel.appendChild(viewSheetHome(c)); break;
      case 'statistiche': panel.innerHTML = ''; panel.appendChild(viewStatistiche(c)); break;
      case 'abilita': panel.innerHTML = ''; panel.appendChild(viewAbilita(c)); break;
      case 'armamenti': panel.innerHTML = ''; panel.appendChild(viewArmamenti(c)); break;
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
    if (c.id === activeCharId) sendWhoami(c); // aggiorna il livello mostrato al master
    return true;
  }

  // Panoramica del personaggio: info principali + pulsanti di navigazione
  function viewSheetHome(c) {
    var frag = document.createElement('div');
    var pts = c.sheet.abilityPoints || 0;
    var tags = [c.razza, c.classe].filter(Boolean).join(' · ');
    var info = document.createElement('div'); info.className = 'panel-card home-info';
    info.innerHTML =
      '<div class="hi-row"><span class="hi-k">Livello</span><span class="hi-v">' + (c.sheet.level || 1) + '</span></div>' +
      '<div class="hi-row"><span class="hi-k">Punti abilità</span><span class="hi-v">' + pts + '</span></div>' +
      (tags ? '<div class="hi-row"><span class="hi-k">Profilo</span><span class="hi-v small">' + esc(tags) + '</span></div>' : '');
    frag.appendChild(info);

    var grid = document.createElement('div'); grid.className = 'home-nav';
    function navBtn(sec, ico, label) {
      var b = document.createElement('button'); b.className = 'home-btn';
      b.innerHTML = '<span class="hb-ico">' + ico + '</span><span class="hb-lbl">' + label + '</span>';
      b.addEventListener('click', function () { setSheetSection(sec); });
      return b;
    }
    grid.appendChild(navBtn('statistiche', '📊', 'Statistiche'));
    grid.appendChild(navBtn('abilita', '🌳', 'Abilità'));
    grid.appendChild(navBtn('armamenti', '🗡️', 'Armamenti'));
    grid.appendChild(navBtn('zaino', '🎒', 'Zaino'));
    grid.appendChild(navBtn('combattimento', '🔥', 'Combattimento'));
    frag.appendChild(grid);

    var sc = document.createElement('div'); sc.className = 'home-shortcuts';
    var msgB = document.createElement('button'); msgB.className = 'tool-btn'; msgB.innerHTML = '💬 Messaggi';
    msgB.addEventListener('click', function () { navTo('messages'); });
    var sesB = document.createElement('button'); sesB.className = 'tool-btn'; sesB.innerHTML = '🔗 Sessione';
    sesB.addEventListener('click', function () { navTo('session'); });
    sc.appendChild(msgB); sc.appendChild(sesB);
    frag.appendChild(sc);
    return frag;
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

    // Griglia core: 3 per riga, compatte; tap su una cella la espande coi dettagli
    var grid = document.createElement('div'); grid.className = 'core-grid';
    var cells = coreStats(c).map(function (s) { return statCell(c, s, refresh); });
    cells.forEach(function (cc) { grid.appendChild(cc.el); });
    frag.appendChild(grid);

    // Aggiornamento in-place dell'intera vista (contatore + celle), senza ricostruire il DOM
    function refresh() {
      var avail = availablePoints(c);
      bar.querySelector('.lvl-val').textContent = c.sheet.level;
      bar.querySelector('[data-lvl="-1"]').disabled = c.sheet.level <= 1;
      var pb = bar.querySelector('.points-box');
      pb.querySelector('.pts-val').textContent = avail;
      pb.classList.toggle('no-points', avail === 0);
      cells.forEach(function (cc) { cc.update(); });
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

  // Crea una cella statistica compatta che si espande al tap. Ritorna { el, update }.
  function statCell(c, s, refresh) {
    var cell = document.createElement('div'); cell.className = 'core-cell';
    cell.innerHTML =
      '<button class="cc-head" type="button">' +
        '<span class="cc-abbr">' + esc(s.abbr || s.name) + '</span>' +
        '<span class="cc-val"></span>' +
      '</button>' +
      '<div class="cc-detail">' +
        (s.abbr && s.name ? '<div class="cc-name">' + esc(s.name) + '</div>' : '') +
        '<div class="sr-ctrl">' +
          '<button class="step-btn big" data-step="-5" aria-label="-5">−−</button>' +
          '<button class="step-btn" data-step="-1" aria-label="-1">−</button>' +
          '<div class="sr-input">' +
            '<input type="number" inputmode="numeric" class="sr-val" aria-label="Valore ' + esc(s.abbr || s.name) + '" />' +
            '<button class="confirm-btn" aria-label="Conferma">✓</button>' +
          '</div>' +
          '<button class="step-btn" data-step="1" aria-label="+1">+</button>' +
          '<button class="step-btn big" data-step="5" aria-label="+5">++</button>' +
        '</div>' +
        '<div class="cc-bonus"><span class="cc-bonus-lbl">Bonus equipaggiamento</span>' + statBonusHtml(c, s) + '</div>' +
      '</div>';

    var head = cell.querySelector('.cc-head');
    var valEl = cell.querySelector('.cc-val');
    var input = cell.querySelector('.sr-val');
    var ups = Array.prototype.slice.call(cell.querySelectorAll('[data-step="1"],[data-step="5"]'));
    var downs = Array.prototype.slice.call(cell.querySelectorAll('[data-step="-1"],[data-step="-5"]'));

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
    cell.querySelectorAll('.step-btn').forEach(function (b) {
      b.addEventListener('click', function (e) { e.stopPropagation(); step(parseInt(b.getAttribute('data-step'), 10)); });
    });
    cell.querySelector('.confirm-btn').addEventListener('click', function (e) { e.stopPropagation(); applyManual(); });
    input.addEventListener('click', function (e) { e.stopPropagation(); });
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') applyManual(); });
    head.addEventListener('click', function () {
      var wasOpen = cell.classList.contains('open');
      var gridEl = cell.parentNode;
      if (gridEl) $all('.core-cell.open', gridEl).forEach(function (x) { x.classList.remove('open'); });
      if (!wasOpen) cell.classList.add('open');
    });

    function update() {
      var avail = availablePoints(c);
      var val = statVal(s);
      valEl.textContent = val;
      if (document.activeElement !== input) input.value = val;
      ups.forEach(function (b) { b.disabled = avail <= 0; });
      downs.forEach(function (b) { b.disabled = val <= Store.STAT_MIN; });
    }

    return { el: cell, update: update };
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

  /* ============================================================
     ABILITÀ — alberi a punti (create/sbloccate dal Master)
     ============================================================ */
  function ranksOf(c, treeId) {
    if (!c.sheet.abilityRanks) c.sheet.abilityRanks = {};
    if (!c.sheet.abilityRanks[treeId]) c.sheet.abilityRanks[treeId] = {};
    return c.sheet.abilityRanks[treeId];
  }
  function nodeRank(c, treeId, nodeId) { var r = ranksOf(c, treeId)[nodeId]; return r ? parseInt(r, 10) || 0 : 0; }
  // Punti spesi DENTRO questo albero (somma costo×rango di ogni nodo preso).
  function spentInAbility(c, ability) {
    return (ability.nodes || []).reduce(function (t, n) { return t + n.cost * nodeRank(c, ability.id, n.id); }, 0);
  }
  // Collegamenti entranti in un nodo (to === node.id).
  function incomingLinks(ability, nodeId) {
    return (ability.links || []).filter(function (l) { return l.to === nodeId; });
  }
  // Un link è soddisfatto? prereq: il nodo "from" ha rango ≥1; points: punti spesi ≥ value.
  function linkSatisfied(c, ability, link) {
    if (link.type === 'points') return spentInAbility(c, ability) >= link.value;
    return nodeRank(c, ability.id, link.from) >= 1;
  }
  function linksSatisfied(c, ability, nodeId) {
    return incomingLinks(ability, nodeId).every(function (l) { return linkSatisfied(c, ability, l); });
  }
  // Ritorna { rank, max, taken, locked, parentsOk, affordable, atMax, canTake, reason }
  function nodeStatus(c, ability, node) {
    var rank = nodeRank(c, ability.id, node.id);
    var max = (node.maxRank == null) ? Infinity : node.maxRank;
    var parentsOk = linksSatisfied(c, ability, node.id);
    var atMax = rank >= max;
    var affordable = (c.sheet.abilityPoints || 0) >= node.cost;
    var canTake = parentsOk && !atMax && affordable;
    var reason = '';
    if (!parentsOk) {
      var unmet = incomingLinks(ability, node.id).filter(function (l) { return !linkSatisfied(c, ability, l); })[0];
      if (unmet && unmet.type === 'points') reason = 'Servono ' + unmet.value + ' punti spesi (ne hai ' + spentInAbility(c, ability) + ')';
      else reason = 'Richiede prima il nodo collegato';
    }
    else if (atMax) reason = 'Rango massimo raggiunto';
    else if (!affordable) reason = 'Punti abilità insufficienti';
    return { rank: rank, max: max, taken: rank >= 1, locked: false, parentsOk: parentsOk,
      atMax: atMax, affordable: affordable, canTake: canTake, reason: reason };
  }
  function takeNode(c, tree, node) {
    var st = nodeStatus(c, tree, node);
    if (!st.canTake) { toast(st.reason || 'Non disponibile', 'err'); return false; }
    c.sheet.abilityPoints = Math.max(0, (c.sheet.abilityPoints || 0) - node.cost);
    ranksOf(c, tree.id)[node.id] = st.rank + 1;
    persist();
    if (typeof Net !== 'undefined') {
      try { Net.sendProgress(tree.id, ranksOf(c, tree.id), c.sheet.abilityPoints, charLabel(c)); } catch (e) {}
    }
    return true;
  }
  function charLabel(c) { return ((c.nome || '') + ' ' + (c.cognome || '')).trim() || c.nome || 'PG'; }
  // comunica al master il PG attivo + il suo livello
  function sendWhoami(ch) {
    if (ch && typeof Net !== 'undefined') { try { Net.whoami(charLabel(ch), ch.sheet.level || 1); } catch (e) {} }
  }

  function abilityProgress(c, ability) {
    var nodes = ability.nodes || [];
    var taken = nodes.filter(function (n) { return nodeRank(c, ability.id, n.id) >= 1; }).length;
    return { taken: taken, total: nodes.length };
  }

  // Sezione Abilità del giocatore: punti + LISTA di abilità (ognuna apre il suo albero).
  function viewAbilita(c) {
    var frag = document.createElement('div');
    frag.appendChild(sectionHead('Abilità'));

    var bar = document.createElement('div'); bar.className = 'stats-bar ability-bar';
    bar.innerHTML =
      '<div class="ab-points"><span class="ap-label">Punti abilità</span>' +
      '<span class="ap-val">' + (c.sheet.abilityPoints || 0) + '</span></div>' +
      '<span class="ab-hint">Tocca un’abilità per aprire il suo albero</span>';
    frag.appendChild(bar);

    var abilities = c.sheet.abilita || [];
    if (abilities.length === 0) {
      frag.appendChild(emptyHint('Nessuna abilità ancora. Il Master crea e sblocca le abilità durante il gioco e te le invia.'));
      return frag;
    }
    abilities.forEach(function (ability) {
      var pr = abilityProgress(c, ability);
      var card = document.createElement('button'); card.className = 'ability-card';
      card.innerHTML =
        '<span class="ac-ico">🌿</span>' +
        '<span class="ac-main"><span class="ac-name">' + esc(ability.name || 'Abilità') + '</span>' +
        (ability.desc ? '<span class="ac-sub">' + esc(ability.desc) + '</span>' : '') +
        '<span class="ac-prog">' + pr.taken + '/' + pr.total + ' nodi presi</span></span>' +
        '<span class="chev">›</span>';
      card.addEventListener('click', function () { openAbilityOverlay(c.id, ability.id); });
      frag.appendChild(card);
    });
    return frag;
  }

  /* ---- Overlay albero abilità (vero skill-tree a tutto schermo) ---- */
  var aoCtx = null; // { charId, abilityId, readOnly, ability(preview) }

  function findAbility(c, abilityId) {
    return (c.sheet.abilita || []).filter(function (a) { return a.id === abilityId; })[0];
  }
  function openAbilityOverlay(charId, abilityId) {
    var c = getChar(charId); if (!c) return;
    var ability = findAbility(c, abilityId); if (!ability) return;
    aoCtx = { charId: charId, abilityId: abilityId, readOnly: false };
    $('#ability-overlay').hidden = false;
    refreshAbilityOverlay();
  }
  // Anteprima per il Master (sola lettura), usa un personaggio fittizio senza progressi.
  function openAbilityPreview(ability) {
    aoCtx = { preview: true, readOnly: true, ability: ability,
      fakeChar: { sheet: { abilityRanks: {}, abilityPoints: 0 } } };
    $('#ability-overlay').hidden = false;
    refreshAbilityOverlay();
  }
  function closeAbilityOverlay() { $('#ability-overlay').hidden = true; aoCtx = null; }

  function aoChar() { return aoCtx.preview ? aoCtx.fakeChar : getChar(aoCtx.charId); }
  function aoAbility() { return aoCtx.preview ? aoCtx.ability : findAbility(getChar(aoCtx.charId), aoCtx.abilityId); }

  function refreshAbilityOverlay() {
    if (!aoCtx) return;
    var c = aoChar(); var ability = aoAbility();
    if (!c || !ability) { closeAbilityOverlay(); return; }
    $('#ao-title').textContent = ability.name || 'Abilità';
    $('#ao-sub').textContent = ability.desc || '';
    var pts = $('#ao-points');
    pts.textContent = aoCtx.readOnly ? '' : ('★ ' + (c.sheet.abilityPoints || 0) + ' punti');
    var scroll = $('#ao-scroll');
    scroll.innerHTML = '';
    scroll.appendChild(buildTreeCanvas(c, ability, aoCtx.readOnly));
    scheduleOverlayDraw();
  }

  function buildTreeCanvas(c, ability, readOnly) {
    var canvas = document.createElement('div'); canvas.className = 'tree-canvas';
    canvas.setAttribute('data-tree', ability.id);
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'tree-links');
    canvas.appendChild(svg);
    var tiersWrap = document.createElement('div'); tiersWrap.className = 'tree-tiers';
    canvas.appendChild(tiersWrap);
    var byTier = {};
    (ability.nodes || []).forEach(function (n) { (byTier[n.tier] = byTier[n.tier] || []).push(n); });
    var tiers = Object.keys(byTier).map(Number).sort(function (a, b) { return a - b; });
    if (tiers.length === 0) {
      var empty = document.createElement('p'); empty.className = 'muted'; empty.style.textAlign = 'center';
      empty.textContent = 'Questa abilità non ha ancora nodi.';
      tiersWrap.appendChild(empty);
    }
    tiers.forEach(function (t) {
      var row = document.createElement('div'); row.className = 'tree-tier';
      byTier[t].forEach(function (node) { row.appendChild(abilityNodeEl(c, ability, node, readOnly)); });
      tiersWrap.appendChild(row);
    });
    return canvas;
  }

  // Disegna i connettori quando la tela ha una larghezza misurabile (riprova finché serve).
  function scheduleOverlayDraw() {
    var tries = 0;
    (function attempt() {
      var cv = $('#ao-scroll .tree-canvas');
      if (cv && cv.getBoundingClientRect().width > 0) { redrawOverlayLinks(); return; }
      if (tries++ < 40) requestAnimationFrame(attempt);
    })();
  }

  function abilityNodeEl(c, ability, node, readOnly) {
    var st = nodeStatus(c, ability, node);
    var el = document.createElement('button');
    el.className = 'ability-node' + (st.locked ? ' locked' : '') + (st.taken ? ' taken' : '') +
      (!readOnly && st.canTake ? ' available' : '') + (st.atMax && st.taken ? ' maxed' : '');
    el.setAttribute('data-node', node.id);
    var rankBadge = '';
    if (node.repeatable) {
      var maxTxt = (node.maxRank == null) ? '∞' : node.maxRank;
      rankBadge = '<span class="nd-rank">' + st.rank + '/' + maxTxt + '</span>';
    } else if (st.taken) {
      rankBadge = '<span class="nd-rank">✓</span>';
    }
    el.innerHTML =
      '<span class="nd-orb"><span class="nd-ico">' + (st.locked ? '🔒' : (st.taken ? '★' : '✦')) + '</span>' + rankBadge + '</span>' +
      '<span class="nd-name">' + esc(node.name || 'Nodo') + '</span>' +
      '<span class="nd-cost">' + (node.cost ? (node.cost + ' pt') : 'gratis') + '</span>';
    el.addEventListener('click', function () { openNodeDialog(c, ability, node, readOnly); });
    return el;
  }

  function openNodeDialog(c, ability, node, readOnly) {
    var st = nodeStatus(c, ability, node);
    var body = document.createElement('div');
    var info = [];
    info.push('<p>' + (node.desc ? esc(node.desc) : '<i>Nessuna descrizione.</i>') + '</p>');
    var bits = [];
    bits.push('Costo: <b>' + node.cost + '</b> punt' + (node.cost === 1 ? 'o' : 'i'));
    if (node.repeatable) bits.push('Rango: <b>' + st.rank + '/' + (node.maxRank == null ? '∞' : node.maxRank) + '</b>');
    else bits.push(st.taken ? 'Stato: <b>presa</b>' : 'Stato: <b>non presa</b>');
    var reqs = incomingLinks(ability, node.id).map(function (l) {
      if (l.type === 'points') return l.value + ' punti spesi';
      var p = (ability.nodes || []).filter(function (x) { return x.id === l.from; })[0];
      return p ? esc(p.name) : '?';
    });
    if (reqs.length) bits.push('Richiede: ' + reqs.join(', '));
    info.push('<p class="nd-bits">' + bits.join(' · ') + '</p>');
    if (!readOnly && !st.canTake) info.push('<p class="nd-warn">' + esc(st.reason) + '</p>');
    body.innerHTML = info.join('');

    var actions = [{ label: 'Chiudi', onClick: closeModal }];
    if (!readOnly && st.canTake) {
      actions.push({
        label: 'Prendi (−' + node.cost + ')', cls: 'primary',
        onClick: function () { if (takeNode(c, ability, node)) { closeModal(); refreshAbilityOverlay(); } }
      });
    }
    openModal({ title: node.name || 'Nodo abilità', bodyNode: body, actions: actions });
  }

  // Connettori SVG seguendo ability.links (posizioni misurate dopo il layout).
  // linkClick(link) opzionale: rende le linee cliccabili (editor).
  function drawTreeLinks(canvas, ability, c, linkClick) {
    var svg = canvas.querySelector('.tree-links');
    if (!svg) return;
    var crect = canvas.getBoundingClientRect();
    if (!crect.width) return;
    svg.setAttribute('width', crect.width);
    svg.setAttribute('height', crect.height);
    svg.setAttribute('viewBox', '0 0 ' + crect.width + ' ' + crect.height);
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    function anchorOf(nodeId) {
      var elx = canvas.querySelector('.ability-node[data-node="' + cssEsc(nodeId) + '"]');
      if (!elx) return null;
      var orb = elx.querySelector('.nd-orb') || elx;
      var r = orb.getBoundingClientRect();
      return { x: r.left - crect.left + r.width / 2, top: r.top - crect.top, bottom: r.top - crect.top + r.height };
    }
    (ability.links || []).forEach(function (link) {
      var a = anchorOf(link.from), b = anchorOf(link.to);
      if (!a || !b) return;
      var upper = (a.top <= b.top) ? a : b, lower = (a.top <= b.top) ? b : a;
      var x1 = upper.x, y1 = upper.bottom, x2 = lower.x, y2 = lower.top;
      var on = linkSatisfied(c, ability, link);
      var cls = 'lnk' + (on ? ' on' : '') + (link.type === 'points' ? ' points' : '');
      var line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', x1); line.setAttribute('y1', y1);
      line.setAttribute('x2', x2); line.setAttribute('y2', y2);
      line.setAttribute('class', cls);
      svg.appendChild(line);
      if (linkClick) {
        var hit = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        hit.setAttribute('x1', x1); hit.setAttribute('y1', y1);
        hit.setAttribute('x2', x2); hit.setAttribute('y2', y2);
        hit.setAttribute('class', 'lnk-hit');
        hit.addEventListener('click', function (e) { e.stopPropagation(); linkClick(link); });
        svg.appendChild(hit);
      }
    });
  }
  function cssEsc(s) { return String(s).replace(/"/g, '\\"'); }

  function redrawOverlayLinks() {
    if (!aoCtx) return;
    var c = aoChar(); var ability = aoAbility(); if (!c || !ability) return;
    var cv = $('#ao-scroll .tree-canvas');
    if (cv) drawTreeLinks(cv, ability, c);
  }
  window.addEventListener('resize', function () { redrawOverlayLinks(); redrawEditorLinks(); });

  function redrawEditorLinks() {
    if (currentView !== 'ability-editor' || !editingAbilityId) return;
    var cv = $('#ability-editor-body .tree-canvas'); if (!cv) return;
    var cls = getClass(editingClassId); if (!cls) return;
    var ability = getAbilityIn(cls, editingAbilityId); if (!ability) return;
    drawTreeLinks(cv, ability, { sheet: { abilityRanks: {}, abilityPoints: 0 } }, function (link) { linkDialog(ability, link); });
  }

  $('#ao-close').addEventListener('click', closeAbilityOverlay);

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

  /* ============================================================
     ARMAMENTI / EQUIPAGGIAMENTO
     ============================================================ */
  var ARM_CATS = [
    { key: 'weapons', cats: ['weapon', 'shield'], ico: '⚔️', label: 'Armi e scudi' },
    { key: 'armor', cats: ['armor'], ico: '🛡️', label: 'Armature' },
    { key: 'elmo', cats: ['elmo'], ico: '⛑️', label: 'Elmi' },
    { key: 'accessory', cats: ['accessory'], ico: '💍', label: 'Accessori' }
  ];
  function eqItems(c) {
    if (!c.sheet.armamenti || Array.isArray(c.sheet.armamenti) || !c.sheet.armamenti.items) c.sheet.armamenti = Store.normalizeEquip(c.sheet.armamenti);
    return c.sheet.armamenti.items;
  }
  function itemsByCat(c, cats) { var arr = Array.isArray(cats) ? cats : [cats]; return eqItems(c).filter(function (it) { return arr.indexOf(it.cat) >= 0; }); }
  function handsUsed(c) { return itemsByCat(c, ['weapon', 'shield']).filter(function (i) { return i.equipped; }).reduce(function (t, i) { return t + (i.hands || 1); }, 0); }
  function equippedCount(c, cat) { return itemsByCat(c, cat).filter(function (i) { return i.equipped; }).length; }
  function equippedAcc(c, accType) { return itemsByCat(c, 'accessory').filter(function (i) { return i.equipped && i.accType === accType; }).length; }
  function accDisplay(t) { return t === 'ring' ? 'Anello' : (t === 'collana' ? 'Collana' : 'Extra'); }
  function itemDefaultName(it) { return it.tipo || ({ weapon: 'Arma', shield: 'Scudo', armor: 'Armatura', elmo: 'Elmo', accessory: 'Accessorio' }[it.cat] || 'Oggetto'); }

  function canEquip(c, it) {
    if (it.equipped) return true;
    if (it.cat === 'weapon' || it.cat === 'shield') return handsUsed(c) + (it.hands || 1) <= 2;
    if (it.cat === 'armor' || it.cat === 'elmo') return true; // sostituisce l'altro
    if (it.cat === 'accessory') return equippedAcc(c, it.accType) < (it.accType === 'ring' ? 2 : 1);
    return true;
  }
  function toggleEquip(c, it) {
    if (it.equipped) { it.equipped = false; persist(); renderSection(); refreshAbilitaIfOpen(); return; }
    if (!canEquip(c, it)) {
      if (it.cat === 'weapon' || it.cat === 'shield') toast('Mani occupate (max 2)', 'err');
      else if (it.cat === 'accessory') toast('Slot ' + accDisplay(it.accType) + ' al massimo', 'err');
      return;
    }
    if (it.cat === 'armor' || it.cat === 'elmo') itemsByCat(c, it.cat).forEach(function (o) { o.equipped = false; });
    it.equipped = true; persist(); renderSection(); refreshAbilitaIfOpen();
  }

  // contributi dei boost degli oggetti equipaggiati per una statistica (abbr)
  function boostsForStat(c, abbr) {
    var out = [];
    eqItems(c).forEach(function (it) {
      if (!it.equipped) return;
      (it.boosts || []).forEach(function (b) { if (b.stat === abbr && b.amount) out.push({ name: it.name || itemDefaultName(it), amount: b.amount }); });
    });
    return out;
  }
  // HTML dei bonus equipaggiamento per il dettaglio di una statistica
  function statBonusHtml(c, s) {
    var contribs = boostsForStat(c, s.abbr || s.id);
    if (!contribs.length) return '<p class="muted">Nessun bonus dagli oggetti equipaggiati.</p>';
    var total = contribs.reduce(function (t, x) { return t + x.amount; }, 0);
    var base = statVal(s);
    var rows = contribs.map(function (x) {
      return '<div class="bn-row"><span>' + esc(x.name) + '</span><span class="bn-amt">' + (x.amount >= 0 ? '+' : '') + x.amount + '</span></div>';
    }).join('');
    return rows +
      '<div class="bn-row bn-total"><span>Totale</span><span class="bn-amt">' + (total >= 0 ? '+' : '') + total + '</span></div>' +
      '<div class="bn-eff">Valore effettivo: <b>' + (base + total) + '</b></div>';
  }

  function statOptions(selected, withNone) {
    var o = withNone ? '<option value="">— nessuna —</option>' : '<option value="">— stat —</option>';
    o += Store.STAT_DEFS.map(function (d) { return '<option value="' + d.abbr + '"' + (d.abbr === selected ? ' selected' : '') + '>' + d.abbr + ' — ' + esc(d.name) + '</option>'; }).join('');
    return o;
  }
  function weaponTypeOptions(magic, selected) {
    var arr = magic ? Store.WEAPON_CAT.magiche : Store.WEAPON_CAT.fisiche;
    return '<option value="">— tipo —</option>' + arr.map(function (w) { return '<option' + (w === selected ? ' selected' : '') + '>' + esc(w) + '</option>'; }).join('');
  }

  // metadato compatto per uno slot
  function slotMeta(it) {
    if (it.cat === 'weapon' || it.cat === 'shield') { var d = (it.dmgBase || 0) + (it.scaleStat ? '+' + it.scaleStat : ''); return (it.dmgBase || it.scaleStat ? '💥' + d : (it.cat === 'shield' ? 'Scudo' : '')); }
    if (it.cat === 'armor') return it.classe || 'Armatura';
    if (it.cat === 'elmo') return it.hp ? '❤️+' + it.hp : 'Elmo';
    if (it.cat === 'accessory') return accDisplay(it.accType);
    return '';
  }
  function slotSquare(o) {
    var s = document.createElement('button');
    s.className = 'eq-slot' + (o.wide ? ' wide' : '') + (o.item ? ' full' : ' empty');
    if (o.item) {
      s.innerHTML = '<span class="es-x" aria-hidden="true">✕</span>' +
        '<span class="es-name">' + esc(o.item.name || itemDefaultName(o.item)) + '</span>' +
        '<span class="es-meta">' + esc(slotMeta(o.item)) + '</span>';
      s.title = 'Tocca per togliere';
    } else {
      s.innerHTML = '<span class="es-plus">＋</span><span class="es-lbl">' + esc(o.label || 'Vuoto') + '</span>';
      s.title = 'Tocca per equipaggiare';
    }
    s.addEventListener('click', o.onClick);
    return s;
  }
  // griglia di slot di equipaggiamento per la categoria corrente
  function buildEquipSlots(c, key) {
    var box = document.createElement('div'); box.className = 'eq-slots';
    if (key === 'weapons') {
      var eqW = itemsByCat(c, ['weapon', 'shield']).filter(function (i) { return i.equipped; });
      var used = 0;
      eqW.forEach(function (it) { var sp = it.hands === 2 ? 2 : 1; used += sp; box.appendChild(slotSquare({ item: it, wide: sp === 2, onClick: function () { toggleEquip(c, it); } })); });
      for (var i = used; i < 2; i++) box.appendChild(slotSquare({ label: 'Mano libera', onClick: function () { openEquipPicker(c, 'weapons'); } }));
    } else if (key === 'armor' || key === 'elmo') {
      var eqd = itemsByCat(c, key).filter(function (i) { return i.equipped; })[0];
      box.appendChild(slotSquare({ item: eqd, label: key === 'armor' ? 'Armatura' : 'Elmo', onClick: eqd ? function () { toggleEquip(c, eqd); } : function () { openEquipPicker(c, key); } }));
    } else if (key === 'accessory') {
      var specs = [{ t: 'ring', l: 'Anello' }, { t: 'ring', l: 'Anello' }, { t: 'collana', l: 'Collana' }, { t: 'extra', l: 'Extra' }];
      var byType = { ring: [], collana: [], extra: [] };
      itemsByCat(c, 'accessory').filter(function (i) { return i.equipped; }).forEach(function (i) { (byType[i.accType] || byType.ring).push(i); });
      var idx = { ring: 0, collana: 0, extra: 0 };
      specs.forEach(function (sp) {
        var it = byType[sp.t][idx[sp.t]++];
        box.appendChild(slotSquare({ item: it, label: sp.l, onClick: it ? function () { toggleEquip(c, it); } : function () { openEquipPicker(c, 'accessory', sp.t); } }));
      });
    }
    return box;
  }
  // selettore degli oggetti posseduti equipaggiabili in uno slot
  function openEquipPicker(c, key, accType) {
    var cats = key === 'weapons' ? ['weapon', 'shield'] : [key];
    var avail = itemsByCat(c, cats).filter(function (it) {
      if (it.equipped) return false;
      if (accType && it.accType !== accType) return false;
      return canEquip(c, it);
    });
    var wrap = document.createElement('div'); wrap.className = 'modal-list';
    if (!avail.length) {
      var p = document.createElement('p'); p.className = 'muted'; p.style.cssText = 'padding:8px 2px;margin:0;';
      p.textContent = 'Nessun oggetto disponibile. Creane uno con “Crea” qui sotto.';
      wrap.appendChild(p);
    } else {
      avail.forEach(function (it) {
        var b = document.createElement('button'); b.className = 'modal-opt';
        b.innerHTML = '<span>' + esc(it.name || itemDefaultName(it)) + '</span><span class="mo-meta">' + itemMeta(it) + '</span>';
        b.addEventListener('click', function () { closeModal(); toggleEquip(c, it); });
        wrap.appendChild(b);
      });
    }
    openModal({ title: 'Equipaggia', bodyNode: wrap, actions: [{ label: 'Chiudi', onClick: closeModal }] });
  }

  // dettaglio completo di un oggetto (riusato nell'anteprima dell'equipaggiato)
  function itemDetailHtml(it) {
    var rows = [];
    if (it.cat === 'weapon' || it.cat === 'shield') {
      if (it.tipo) rows.push('Tipo: ' + esc(it.tipo));
      rows.push('Mani: ' + (it.hands === 2 ? '2' : '1'));
      if (it.dmgBase || it.scaleStat) rows.push('Danni: ' + (it.dmgBase || 0) + (it.scaleStat ? ' + ' + esc(it.scaleStat) + '/2' : ''));
    }
    if (it.cat === 'armor' && it.classe) rows.push('Classe: ' + esc(it.classe));
    if (it.cat === 'elmo' && it.hp) rows.push('HP: +' + it.hp);
    if (it.cat === 'accessory') rows.push('Tipo: ' + accDisplay(it.accType));
    var html = rows.length ? '<div class="id-meta">' + rows.map(function (r) { return '<span>' + r + '</span>'; }).join('') + '</div>' : '';
    if (it.boosts && it.boosts.length) html += '<div class="id-boosts">' + it.boosts.map(function (b) { return '<span class="id-boost">' + (b.amount >= 0 ? '+' : '') + b.amount + ' ' + esc(b.stat) + '</span>'; }).join('') + '</div>';
    if (it.abilities && it.abilities.length) html += '<div class="id-abils">' + it.abilities.map(function (a) { var el = effLabel(a); return '<div class="id-ab"><b>' + esc(a.name || 'Abilità') + '</b>' + (el ? ' · ' + esc(el) : '') + (a.countdown ? ' · ⏳' + a.countdown : '') + (a.note ? '<div class="id-ab-note">' + esc(a.note) + '</div>' : '') + '</div>'; }).join('') + '</div>';
    if (it.note) html += '<p class="id-note">' + esc(it.note) + '</p>';
    return html || '<p class="muted" style="margin:0">Nessun dettaglio.</p>';
  }
  // anteprima di tutto ciò che è equipaggiato, apribile nei dettagli
  function equippedOverview(c) {
    var eq = eqItems(c).filter(function (i) { return i.equipped; });
    var box = document.createElement('div'); box.className = 'eq-overview';
    var h = document.createElement('div'); h.className = 'eq-ov-head'; h.innerHTML = '<span>🎖️ Equipaggiato</span><span class="eq-ov-count">' + eq.length + '</span>';
    box.appendChild(h);
    if (!eq.length) {
      var p = document.createElement('p'); p.className = 'muted'; p.style.cssText = 'margin:4px 2px 0;font-size:.86rem;';
      p.textContent = 'Niente equipaggiato. Apri una categoria e tocca uno slot.';
      box.appendChild(p); return box;
    }
    eq.forEach(function (it) {
      var row = document.createElement('div'); row.className = 'eq-ov-item';
      var head = document.createElement('button'); head.className = 'eq-ov-row';
      head.innerHTML = '<span class="eq-ov-ico">' + ({ weapon: '⚔️', shield: '🛡️', armor: '🛡️', elmo: '⛑️', accessory: '💍' }[it.cat] || '❖') + '</span>' +
        '<span class="eq-ov-main"><span class="eq-ov-name">' + esc(it.name || itemDefaultName(it)) + '</span><span class="eq-ov-meta">' + itemMeta(it) + '</span></span>' +
        '<span class="eq-ov-chev">▾</span>';
      var det = document.createElement('div'); det.className = 'eq-ov-det'; det.innerHTML = itemDetailHtml(it); det.hidden = true;
      head.addEventListener('click', function () { det.hidden = !det.hidden; row.classList.toggle('open', !det.hidden); });
      row.appendChild(head); row.appendChild(det); box.appendChild(row);
    });
    return box;
  }

  function viewArmamenti(c) {
    eqItems(c); // normalizza
    var frag = document.createElement('div');

    if (!armSubpage) {
      frag.appendChild(sectionHead('Armamenti'));
      var hint = document.createElement('p'); hint.className = 'muted'; hint.style.cssText = 'margin:0 2px 6px;font-size:.86rem;';
      hint.textContent = 'Ottieni bonus e abilità solo dagli oggetti equipaggiati.';
      frag.appendChild(hint);
      frag.appendChild(equippedOverview(c));
      var grid = document.createElement('div'); grid.className = 'home-nav';
      ARM_CATS.forEach(function (cfg) {
        var all = itemsByCat(c, cfg.cats);
        var eqd = all.filter(function (i) { return i.equipped; }).length;
        var b = document.createElement('button'); b.className = 'home-btn';
        b.innerHTML = '<span class="hb-ico">' + cfg.ico + '</span><span class="hb-lbl">' + cfg.label + '</span>' +
          '<span class="hb-sub">' + eqd + ' equip. · ' + all.length + ' tot</span>';
        b.addEventListener('click', function () { armSubpage = cfg.key; renderSection(); });
        grid.appendChild(b);
      });
      frag.appendChild(grid);
      return frag;
    }

    var cfg = ARM_CATS.filter(function (x) { return x.key === armSubpage; })[0] || ARM_CATS[0];
    var head = document.createElement('div'); head.className = 'section-head';
    head.innerHTML = '<h3>' + cfg.ico + ' ' + esc(cfg.label) + '</h3>';
    head.appendChild(btn('‹ Armamenti', '', function () { armSubpage = null; renderSection(); }));
    frag.appendChild(head);

    var cap = document.createElement('div'); cap.className = 'equip-cap'; cap.innerHTML = capacityText(c, cfg.key);
    frag.appendChild(cap);

    // slot di equipaggiamento (quadrati): tocca per equipaggiare / togliere
    frag.appendChild(buildEquipSlots(c, cfg.key));

    var ownLbl = document.createElement('div'); ownLbl.className = 'eq-own-lbl'; ownLbl.textContent = 'I tuoi oggetti';
    frag.appendChild(ownLbl);

    var create = btn('＋ Crea', 'primary', function () { createItemFlow(c, cfg.key); });
    create.classList.add('equip-create');
    frag.appendChild(create);

    var list = itemsByCat(c, cfg.cats);
    if (list.length === 0) frag.appendChild(emptyHint('Niente qui. Crea il tuo primo oggetto con "Crea".'));
    list.forEach(function (it) { frag.appendChild(itemCard(c, it)); });
    return frag;
  }

  function capacityText(c, key) {
    if (key === 'weapons') return '<span class="cap-chip">✋ Mani ' + handsUsed(c) + '/2</span>';
    if (key === 'armor') return '<span class="cap-chip">Equipaggiata ' + equippedCount(c, 'armor') + '/1</span>';
    if (key === 'elmo') return '<span class="cap-chip">Equipaggiato ' + equippedCount(c, 'elmo') + '/1</span>';
    if (key === 'accessory') return '<span class="cap-chip">Anelli ' + equippedAcc(c, 'ring') + '/2</span><span class="cap-chip">Collana ' + equippedAcc(c, 'collana') + '/1</span><span class="cap-chip">Extra ' + equippedAcc(c, 'extra') + '/1</span>';
    return '';
  }

  function itemMeta(it) {
    var bits = [];
    if (it.cat === 'weapon' || it.cat === 'shield') {
      if (it.tipo) bits.push('<span class="eq-tag">' + esc(it.tipo) + '</span>');
      else if (it.cat === 'shield') bits.push('<span class="eq-tag">Scudo</span>');
      bits.push((it.hands === 2 ? '2 mani' : '1 mano'));
      if (it.dmgBase || it.scaleStat) bits.push('💥 ' + (it.dmgBase || 0) + (it.scaleStat ? ' + ' + esc(it.scaleStat) + '/2' : ''));
    } else if (it.cat === 'armor') { if (it.classe) bits.push('<span class="eq-tag">' + esc(it.classe) + '</span>'); }
    else if (it.cat === 'elmo') { if (it.hp) bits.push('❤️ +' + it.hp + ' HP'); }
    else if (it.cat === 'accessory') { bits.push('<span class="eq-tag">' + accDisplay(it.accType) + '</span>'); }
    if (it.boosts && it.boosts.length) bits.push(it.boosts.map(function (b) { return (b.amount >= 0 ? '+' : '') + b.amount + ' ' + esc(b.stat); }).join(', '));
    if (it.abilities && it.abilities.length) bits.push('🎯 ' + it.abilities.length + ' abilità');
    return bits.join(' · ');
  }

  // ctx: { rerender, mode:'equip'|'arsenal' } — di default scheda giocatore
  function defaultRerender() { renderSection(); refreshAbilitaIfOpen(); }
  function itemCard(c, it, ctx) {
    ctx = ctx || {};
    var rerender = ctx.rerender || defaultRerender;
    var mode = ctx.mode || 'equip';
    var wrap = document.createElement('div'); wrap.className = 'item-card-wrap';
    var e = document.createElement('div'); e.className = 'entry item-card' + (mode === 'equip' && it.equipped ? ' equipped' : '');
    var lead = (mode === 'equip')
      ? '<button class="eq-star" title="Equipaggia" aria-label="Equipaggia">' + (it.equipped ? '★' : '☆') + '</button>'
      : '<span class="ic-lead" aria-hidden="true">' + ({ weapon: '⚔️', shield: '🛡️', armor: '🛡️', elmo: '⛑️', accessory: '💍' }[it.cat] || '❖') + '</span>';
    e.innerHTML = lead +
      '<div class="e-main"><div class="e-name">' + esc(it.name || itemDefaultName(it)) + '</div>' +
      '<div class="e-sub">' + itemMeta(it) + '</div></div>' +
      '<span class="ic-chev" aria-hidden="true">▾</span>' +
      (mode === 'arsenal' ? '<button class="ic-send" title="Invia a un giocatore" aria-label="Invia">📤</button>' : '') +
      '<button class="ic-edit" title="Modifica" aria-label="Modifica">✎</button>' +
      '<button class="e-del" title="Rimuovi" aria-label="Rimuovi">×</button>';
    var det = document.createElement('div'); det.className = 'item-det'; det.hidden = true; det.innerHTML = itemDetailHtml(it);
    if (mode === 'equip') e.querySelector('.eq-star').addEventListener('click', function (ev) { ev.stopPropagation(); toggleEquip(c, it); });
    if (mode === 'arsenal') e.querySelector('.ic-send').addEventListener('click', function (ev) { ev.stopPropagation(); sendArsenalItem(it); });
    e.querySelector('.ic-edit').addEventListener('click', function (ev) { ev.stopPropagation(); itemDialog(c, it, { cat: it.cat, magic: it.magic, rerender: rerender }); });
    e.querySelector('.e-del').addEventListener('click', function (ev) {
      ev.stopPropagation();
      c.sheet.armamenti.items = eqItems(c).filter(function (x) { return x.id !== it.id; });
      persist(); rerender();
    });
    // tocco sulla card = apri/chiudi l'anteprima dei dettagli (abilità + bonus)
    e.addEventListener('click', function () { det.hidden = !det.hidden; wrap.classList.toggle('open', !det.hidden); });
    wrap.appendChild(e); wrap.appendChild(det);
    return wrap;
  }

  // scelta iniziale per "Armi e scudi", poi apre il form
  function createItemFlow(c, key, ctx) {
    var rr = (ctx && ctx.rerender) || defaultRerender;
    function open(opts) { opts.rerender = rr; itemDialog(c, null, opts); }
    if (key === 'weapons') {
      var wrap = document.createElement('div'); wrap.className = 'choice-cards';
      function choiceBtn(label, ico, onPick) {
        var b = document.createElement('button'); b.className = 'choice-mini';
        b.innerHTML = '<span class="cm-ico">' + ico + '</span>' + label;
        b.addEventListener('click', function () { closeModal(); onPick(); });
        return b;
      }
      wrap.appendChild(choiceBtn('Arma Fisica', '🗡️', function () { open({ cat: 'weapon', magic: false }); }));
      wrap.appendChild(choiceBtn('Arma Magica', '🔮', function () { open({ cat: 'weapon', magic: true }); }));
      wrap.appendChild(choiceBtn('Scudo', '🛡️', function () { open({ cat: 'shield', magic: false }); }));
      openModal({ title: 'Cosa vuoi creare?', bodyNode: wrap, actions: [{ label: 'Annulla', onClick: closeModal }] });
    } else if (key === 'armor') {
      var wa = document.createElement('div'); wa.className = 'choice-cards';
      function armBtn(classe, ico) {
        var b = document.createElement('button'); b.className = 'choice-mini';
        b.innerHTML = '<span class="cm-ico">' + ico + '</span>' + classe;
        b.addEventListener('click', function () { closeModal(); open({ cat: 'armor', classe: classe }); });
        return b;
      }
      wa.appendChild(armBtn('Leggera', '🥋'));
      wa.appendChild(armBtn('Media', '🦺'));
      wa.appendChild(armBtn('Pesante', '🛡️'));
      openModal({ title: 'Che tipo di armatura?', bodyNode: wa, actions: [{ label: 'Annulla', onClick: closeModal }] });
    }
    else if (key === 'elmo') open({ cat: 'elmo' });
    else if (key === 'accessory') open({ cat: 'accessory' });
  }

  // editor riusabile dei boost (max 6) — opera su un array locale
  function buildBoostEditor(boosts) {
    var box = document.createElement('div');
    var list = document.createElement('div'); list.className = 'boost-list';
    var addBtn = btn('＋ Boost', '', function () { if (boosts.length >= 6) { toast('Massimo 6 boost', 'err'); return; } boosts.push({ stat: '', amount: 1 }); render(); });
    addBtn.classList.add('mini-add');
    function render() {
      list.innerHTML = '';
      boosts.forEach(function (b, i) {
        var row = document.createElement('div'); row.className = 'boost-row';
        row.innerHTML = '<select class="eq-select b-stat">' + statOptions(b.stat, false) + '</select>' +
          '<input class="b-amt" type="number" inputmode="numeric" value="' + (b.amount || 0) + '" />' +
          '<button class="b-del" aria-label="Rimuovi">×</button>';
        row.querySelector('.b-stat').addEventListener('change', function () { b.stat = this.value; });
        row.querySelector('.b-amt').addEventListener('input', function () { b.amount = parseInt(this.value, 10) || 0; });
        row.querySelector('.b-del').addEventListener('click', function () { boosts.splice(i, 1); render(); });
        list.appendChild(row);
      });
      addBtn.style.display = boosts.length >= 6 ? 'none' : '';
    }
    render();
    box.appendChild(list); box.appendChild(addBtn);
    return box;
  }
  // etichette dei tipi di effetto
  var EFF_LABELS = { '': 'Nessuno (descrittiva)', danno: '⚔️ Danno', cura: '✚ Cura', hp: '❤️ HP max', armatura: '🛡️ Armatura', status: '✦ Status', altro: '● Altro' };
  var EFF_NUM = ['danno', 'cura', 'hp', 'armatura']; // effetti con valore numerico
  function effOptions(sel) {
    return ['', 'danno', 'cura', 'hp', 'armatura', 'status', 'altro'].map(function (k) {
      return '<option value="' + k + '"' + (k === sel ? ' selected' : '') + '>' + EFF_LABELS[k] + '</option>';
    }).join('');
  }
  // descrizione sintetica di un effetto (usata nelle card)
  function effLabel(a) {
    if (!a.effKind) return '';
    if (EFF_NUM.indexOf(a.effKind) >= 0) {
      var base = { danno: '⚔️', cura: '✚', hp: '❤️', armatura: '🛡️' }[a.effKind];
      return base + ' ' + (a.effValue || 0) + (a.effKind === 'danno' && a.effScale ? ' + ' + a.effScale + '/2' : '');
    }
    return (a.effKind === 'status' ? '✦ ' : '● ') + (a.effText || EFF_LABELS[a.effKind]);
  }
  // editor riusabile delle abilità dell'oggetto — opera su un array locale
  function buildAbilityEditor(abilities) {
    var box = document.createElement('div');
    var list = document.createElement('div'); list.className = 'iab-list';
    var addBtn = btn('＋ Crea abilità', '', function () { abilities.push({ id: Store.genId(), name: '', note: '', countdown: 0, effKind: '', effValue: 0, effScale: '', effText: '' }); render(); });
    addBtn.classList.add('mini-add');
    function render() {
      list.innerHTML = '';
      abilities.forEach(function (a, i) {
        var blk = document.createElement('div'); blk.className = 'iab-block';
        blk.innerHTML =
          '<div class="iab-row"><input class="iab-name" maxlength="40" placeholder="Nome abilità" />' +
          '<button class="iab-del" aria-label="Rimuovi">×</button></div>' +
          '<textarea class="iab-note" rows="2" maxlength="400" placeholder="Cosa fa..."></textarea>' +
          '<div class="iab-eff"><label>Effetto (per i calcoli nei Fight)</label>' +
          '<select class="iab-kind eq-select">' + effOptions(a.effKind || '') + '</select>' +
          '<div class="iab-eff-fields"></div></div>' +
          '<div class="iab-cd"><label>Countdown turni (vuoto = ripetibile)</label><input class="iab-cdv" type="number" inputmode="numeric" min="0" /></div>';
        blk.querySelector('.iab-name').value = a.name || '';
        blk.querySelector('.iab-note').value = a.note || '';
        blk.querySelector('.iab-cdv').value = a.countdown ? a.countdown : '';
        blk.querySelector('.iab-name').addEventListener('input', function () { a.name = this.value; });
        blk.querySelector('.iab-note').addEventListener('input', function () { a.note = this.value; });
        blk.querySelector('.iab-cdv').addEventListener('input', function () { a.countdown = Math.max(0, parseInt(this.value, 10) || 0); });
        blk.querySelector('.iab-del').addEventListener('click', function () { abilities.splice(i, 1); render(); });
        var effFields = blk.querySelector('.iab-eff-fields');
        function renderEff() {
          effFields.innerHTML = '';
          if (EFF_NUM.indexOf(a.effKind) >= 0) {
            var unit = { danno: 'danno base', cura: 'PF curati', hp: 'HP max', armatura: 'armatura' }[a.effKind];
            var h = '<div class="iab-eff-row"><input class="iab-val" type="number" inputmode="numeric" placeholder="' + unit + '" />';
            if (a.effKind === 'danno') h += '<select class="iab-scale eq-select">' + statOptions(a.effScale || '', true) + '</select>';
            h += '</div>';
            effFields.innerHTML = h;
            effFields.querySelector('.iab-val').value = a.effValue ? a.effValue : '';
            effFields.querySelector('.iab-val').addEventListener('input', function () { a.effValue = parseInt(this.value, 10) || 0; });
            var sc = effFields.querySelector('.iab-scale');
            if (sc) sc.addEventListener('change', function () { a.effScale = this.value; });
          } else if (a.effKind === 'status' || a.effKind === 'altro') {
            effFields.innerHTML = '<input class="iab-etext" maxlength="60" placeholder="' + (a.effKind === 'status' ? 'Es. Avvelenato 2 turni' : 'Descrivi l\'effetto') + '" />';
            effFields.querySelector('.iab-etext').value = a.effText || '';
            effFields.querySelector('.iab-etext').addEventListener('input', function () { a.effText = this.value; });
          }
        }
        blk.querySelector('.iab-kind').addEventListener('change', function () { a.effKind = this.value; renderEff(); });
        renderEff();
        list.appendChild(blk);
      });
    }
    render();
    box.appendChild(list); box.appendChild(addBtn);
    return box;
  }

  // dialog unico di creazione/modifica oggetto
  function itemDialog(c, item, opts) {
    opts = opts || {};
    var cat = item ? item.cat : opts.cat;
    var magic = item ? !!item.magic : !!opts.magic;
    var editing = !!item;
    var boosts = (item ? item.boosts : []).map(function (b) { return { stat: b.stat, amount: b.amount }; });
    var abilities = (item ? item.abilities : []).map(function (a) { return { id: a.id, name: a.name, note: a.note, countdown: a.countdown, effKind: a.effKind || '', effValue: a.effValue || 0, effScale: a.effScale || '', effText: a.effText || '' }; });

    var wrap = document.createElement('div'); wrap.style.cssText = 'display:flex;flex-direction:column;gap:12px;';
    var html = '<div class="field"><label>Nome</label><input id="it-name" maxlength="40" /></div>';
    if (cat === 'weapon') {
      html += '<div class="field"><label>Tipo (' + (magic ? 'magiche' : 'fisiche') + ')</label><select id="it-tipo" class="eq-select">' + weaponTypeOptions(magic, item ? item.tipo : '') + '</select></div>';
    }
    if (cat === 'weapon' || cat === 'shield') {
      html += '<div class="field-row">' +
        '<div class="field"><label>Danni base</label><input id="it-dmg" type="number" inputmode="numeric" min="0" placeholder="0" /></div>' +
        '<div class="field"><label>Scala su</label><select id="it-scale" class="eq-select">' + statOptions(item ? item.scaleStat : '', true) + '</select></div>' +
        '</div>';
    }
    if (cat === 'armor') {
      var preClasse = item ? item.classe : (opts.classe || '');
      html += '<div class="field"><label>Classe</label><select id="it-classe" class="eq-select"><option value="">— classe —</option>' +
        Store.ARMOR_CLASSES.map(function (k) { return '<option' + (preClasse === k ? ' selected' : '') + '>' + esc(k) + '</option>'; }).join('') + '</select></div>';
    }
    if (cat === 'elmo') {
      html += '<div class="field"><label>HP aggiunti</label><input id="it-hp" type="number" inputmode="numeric" min="0" placeholder="0" /></div>';
    }
    if (cat === 'accessory') {
      html += '<div class="field"><label>Tipo accessorio</label><select id="it-acc" class="eq-select">' +
        ['ring', 'collana', 'extra'].map(function (t) { return '<option value="' + t + '"' + (item && item.accType === t ? ' selected' : '') + '>' + accDisplay(t) + '</option>'; }).join('') + '</select></div>';
    }
    html += '<div class="field"><label>Note</label><textarea id="it-note" rows="2" maxlength="500" placeholder="Dettagli..."></textarea></div>' +
      '<div class="field"><label>Boost statistiche (max 6)</label><div id="it-boosts"></div></div>' +
      '<div class="field"><label>Abilità (pulsanti nella sezione Fight)</label><div id="it-abil"></div></div>';
    wrap.innerHTML = html;
    wrap.querySelector('#it-name').value = item ? item.name : '';
    wrap.querySelector('#it-note').value = item ? item.note : '';
    if (cat === 'weapon' || cat === 'shield') wrap.querySelector('#it-dmg').value = item && item.dmgBase ? item.dmgBase : '';
    if (cat === 'elmo') wrap.querySelector('#it-hp').value = item && item.hp ? item.hp : '';
    wrap.querySelector('#it-boosts').appendChild(buildBoostEditor(boosts));
    wrap.querySelector('#it-abil').appendChild(buildAbilityEditor(abilities));

    function save() {
      var data = {
        id: item ? item.id : undefined, cat: cat, magic: magic,
        name: wrap.querySelector('#it-name').value.trim(),
        note: wrap.querySelector('#it-note').value.trim(),
        boosts: boosts, abilities: abilities,
        equipped: item ? item.equipped : false
      };
      if (cat === 'weapon') { data.tipo = wrap.querySelector('#it-tipo').value; data.hands = Store.weaponHands(data.tipo); }
      if (cat === 'weapon' || cat === 'shield') { data.dmgBase = parseInt(wrap.querySelector('#it-dmg').value, 10) || 0; data.scaleStat = wrap.querySelector('#it-scale').value; }
      if (cat === 'armor') data.classe = wrap.querySelector('#it-classe').value;
      if (cat === 'elmo') data.hp = parseInt(wrap.querySelector('#it-hp').value, 10) || 0;
      if (cat === 'accessory') data.accType = wrap.querySelector('#it-acc').value;
      if (!data.name && !data.tipo && cat !== 'armor' && cat !== 'elmo' && cat !== 'accessory') { toast('Dai un nome o un tipo', 'err'); return; }
      if (!data.name && (cat === 'armor' || cat === 'elmo' || cat === 'accessory' || cat === 'shield')) { wrap.querySelector('#it-name').focus(); toast('Dai un nome', 'err'); return; }
      var nn = Store.normalizeItem(data);
      if (item) {
        var i = eqItems(c).map(function (x) { return x.id; }).indexOf(item.id);
        nn.equipped = item.equipped; eqItems(c)[i] = nn;
      } else { eqItems(c).push(nn); }
      persist(); closeModal(); (opts.rerender || defaultRerender)();
    }
    var titleMap = { weapon: magic ? 'Arma magica' : 'Arma fisica', shield: 'Scudo', armor: 'Armatura', elmo: 'Elmo', accessory: 'Accessorio' };
    openModal({ title: (editing ? 'Modifica ' : 'Nuovo: ') + (titleMap[cat] || 'Oggetto'), bodyNode: wrap, focus: '#it-name',
      actions: [{ label: 'Annulla', onClick: closeModal }, { label: 'Salva', cls: 'primary', onClick: save }] });
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

  // dialog a campo singolo
  function promptDialog(title, label, placeholder, value, onSave) {
    var wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;flex-direction:column;gap:12px;';
    wrap.innerHTML = '<div class="field"><label>' + esc(label) + '</label><input id="pp-1" maxlength="50" placeholder="' + esc(placeholder || '') + '" /></div>';
    wrap.querySelector('#pp-1').value = value || '';
    function save() { var v = wrap.querySelector('#pp-1').value.trim(); if (!v) { wrap.querySelector('#pp-1').focus(); return; } onSave(v); closeModal(); }
    wrap.querySelector('#pp-1').addEventListener('keydown', function (e) { if (e.key === 'Enter') save(); });
    openModal({ title: title, bodyNode: wrap, focus: '#pp-1', actions: [{ label: 'Annulla', onClick: closeModal }, { label: 'Salva', cls: 'primary', onClick: save }] });
  }

  // esporta scheda corrente
  $('#sheet-export-btn').addEventListener('click', function () {
    var c = getChar(currentCharId);
    if (c) { Store.exportCharacter(c); toast('Scheda esportata', 'ok'); }
  });

  /* ============================================================
     MENU dati (export/import) — nella sezione player
     ============================================================ */
  function openDataMenu() {
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
  }

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
              master: Store.ensureMaster(data.data.master || {})
            };
            persist(); currentFolderId = null; renderPlayer();
            toast('Backup importato', 'ok');
          });
      } else if (data && data.kind === 'tdd-campaign' && data.campaign) {
        var camp = Store.normalizeCampaign(data.campaign);
        camp.id = Store.genId();
        masterCampaign(); // assicura struttura
        state.master.campaigns.unshift(camp);
        state.master.currentCampaignId = camp.id;
        persist();
        if (appRole === 'master') { masterSection = null; if (currentView === 'master') renderMaster(); }
        toast('Campagna importata', 'ok');
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
  // "Torna al menu": dalle pagine principali (player/master) torna alla scelta ruolo
  $all('[data-tomenu]').forEach(function (b) {
    b.addEventListener('click', function () { playerMode = null; navStack = []; showView('choice'); });
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      if (!$('#spotlight').hidden) { closeSpotlightByUser(); return; }
      if (!$('#announce').hidden) { closeAnnounce(); return; }
      if (!$('#ability-overlay').hidden) { closeAbilityOverlay(); return; }
      if (!$('#modal-overlay').hidden) { closeModal(); return; }
      if (currentView && currentView !== 'home') back();
    }
  });

  /* ============================================================
     COLLEGAMENTO DI SESSIONE (rete) · MESSAGGI · SPOTLIGHT
     ============================================================ */
  var chatMessages = [];     // { id, from, name, text, image, ts, to, system }
  var unread = 0;
  var netMembers = [];
  var currentTo = 'all';
  var pendingAttach = null;  // dataURL immagine in attesa di invio
  var spotlightShared = false;

  /* ---- nome visualizzato per la sessione (ricordato in locale) ---- */
  function netName(def) {
    var n = '';
    try { n = localStorage.getItem('tdd-net-name') || ''; } catch (e) {}
    return n || def || '';
  }
  function saveNetName(n) { try { localStorage.setItem('tdd-net-name', n); } catch (e) {} }

  /* ---- piccoli helper UI ---- */
  function btn(label, cls, fn) {
    var b = document.createElement('button');
    b.className = 'tool-btn ' + (cls || '');
    b.innerHTML = label;
    b.addEventListener('click', fn);
    return b;
  }
  function panelCard(title, html) {
    var c = document.createElement('div'); c.className = 'panel-card';
    c.innerHTML = '<h3>' + esc(title) + '</h3>' + (html ? '<p class="muted">' + html + '</p>' : '');
    return c;
  }

  /* ---- Menu di navigazione UNICO e COMPLETO (uguale in tutte le sezioni) ---- */
  var SHEET_SECTIONS = [
    { sec: 'home', ico: '🏠', label: 'Panoramica' },
    { sec: 'statistiche', ico: '📊', label: 'Statistiche' },
    { sec: 'abilita', ico: '✨', label: 'Abilità' },
    { sec: 'armamenti', ico: '🗡️', label: 'Armamenti' },
    { sec: 'zaino', ico: '🎒', label: 'Zaino' },
    { sec: 'combattimento', ico: '🔥', label: 'Combattimento' }
  ];
  function goSheetSection(sec) {
    closeAppDrawer();
    if (!currentCharId) return;
    if (currentView !== 'sheet') go('sheet');
    setSheetSection(sec);
  }
  function buildAppDrawer() {
    var nav = $('#app-drawer-nav');
    nav.innerHTML = '';
    var items = [];
    if (appRole === 'master') {
      items.push({ ico: '🛠️', label: 'Plancia', go: function () { masterSection = null; navTo('master'); if (currentView === 'master') renderMaster(); } });
      items.push({ ico: '🌳', label: 'Classi e abilità', go: function () { navTo('ability-editor'); } });
      items.push({ ico: '🐉', label: 'Bestiario', go: function () { masterSection = 'bestiario'; if (currentView !== 'master') navTo('master'); else renderMaster(); closeAppDrawer(); } });
      items.push({ ico: '📝', label: 'Note', go: function () { masterSection = 'note'; if (currentView !== 'master') navTo('master'); else renderMaster(); closeAppDrawer(); } });
      items.push({ ico: '⚔️', label: 'Arsenale', go: function () { masterSection = 'arsenale'; arsenalSub = null; if (currentView !== 'master') navTo('master'); else renderMaster(); closeAppDrawer(); } });
      items.push({ sep: true });
      if (Net.status().connected) items.push({ ico: '⚔️', label: 'Combattimento', go: function () { closeAppDrawer(); if (!fight.ongoing) startFightFlow(); else navTo('fight'); } });
      items.push({ ico: '🔗', label: 'Sessione', go: function () { navTo('session'); } });
      items.push({ ico: '💬', label: 'Messaggi', badge: true, go: function () { navTo('messages'); } });
      items.push({ ico: '🖼️', label: 'Mostra immagine a tutti', go: function () { closeAppDrawer(); pickBroadcastImage(); } });
    } else {
      // se una scheda è aperta, le sue sezioni sono raggiungibili da ovunque
      if (getChar(currentCharId)) {
        SHEET_SECTIONS.forEach(function (s) {
          items.push({ ico: s.ico, label: s.label, section: s.sec, go: function () { goSheetSection(s.sec); } });
        });
        items.push({ sep: true });
      }
      items.push({ ico: '🗂️', label: 'Le tue schede', go: function () { navTo('player'); } });
      items.push({ ico: '🔗', label: 'Sessione', go: function () { navTo('session'); } });
      if (fight.ongoing) items.push({ ico: '⚔️', label: 'Combattimento', go: function () { navTo('fight'); } });
      items.push({ ico: '💬', label: 'Messaggi', badge: true, go: function () { navTo('messages'); } });
      items.push({ ico: '💾', label: 'Dati e backup', go: function () { closeAppDrawer(); openDataMenu(); } });
    }
    items.forEach(function (it) {
      if (it.sep) { var sp = document.createElement('div'); sp.className = 'drawer-sep'; nav.appendChild(sp); return; }
      var b = document.createElement('button');
      var isActive = it.section && currentView === 'sheet' && currentSection === it.section;
      b.className = 'drawer-item' + (isActive ? ' active' : '');
      b.innerHTML = '<span class="tab-ico">' + it.ico + '</span>' + esc(it.label);
      if (it.badge && unread > 0) {
        var d = document.createElement('span'); d.className = 'unread-dot';
        d.textContent = unread > 9 ? '9+' : unread; b.appendChild(d);
      }
      b.addEventListener('click', it.go);
      nav.appendChild(b);
    });
  }
  function openAppDrawer() {
    buildAppDrawer();
    $('#app-drawer').classList.add('open');
    $('#app-drawer-overlay').classList.add('open');
    $('#app-drawer').setAttribute('aria-hidden', 'false');
  }
  function closeAppDrawer() {
    $('#app-drawer').classList.remove('open');
    $('#app-drawer-overlay').classList.remove('open');
    $('#app-drawer').setAttribute('aria-hidden', 'true');
  }
  // naviga a una vista "principale" (evita di ri-aprire la stessa)
  function navTo(name) {
    closeAppDrawer();
    if (currentView === name) return;
    go(name);
  }

  /* ---- Notifiche non lette (pallino + breve evidenza) ---- */
  function setUnreadDot(el) {
    if (!el) return;
    var d = el.querySelector('.unread-dot');
    if (unread > 0) {
      if (!d) { d = document.createElement('span'); d.className = 'unread-dot'; el.appendChild(d); }
      d.textContent = unread > 9 ? '9+' : unread;
    } else if (d) { d.remove(); }
  }
  function refreshUnreadUI() {
    $all('.nav-burger').forEach(setUnreadDot);
    setUnreadDot($('#sheet-menu-btn'));               // hamburger della scheda
    setUnreadDot($('#drawer-nav [data-nav="messages"]')); // voce Messaggi nel menu scheda
  }
  function clearUnread() { unread = 0; refreshUnreadUI(); }
  function flashBurger() {
    var els = $all('.nav-burger');
    var sm = $('#sheet-menu-btn'); if (sm) els.push(sm);
    els.forEach(function (b) {
      b.classList.remove('glow'); void b.offsetWidth; b.classList.add('glow');
      setTimeout(function () { b.classList.remove('glow'); }, 2400);
    });
  }

  /* ---- Eventi dalla rete ---- */
  function setupNet() {
    if (typeof Net === 'undefined') return;
    Net.on('status', function (s) {
      if (s.state === 'error') toast(s.message || 'Errore di connessione', 'err');
      else if (s.state === 'closed') toast(s.message || 'Sessione chiusa', 'err');
      else if (s.state === 'hosting') toast('Sessione avviata', 'ok');
      else if (s.state === 'connected') {
        toast('Collegato alla sessione', 'ok');
        var ac = getChar(activeCharId);
        sendWhoami(ac);
      }
      if (currentView === 'session') renderSession();
      if (currentView === 'master') renderMaster();
      if (currentView === 'messages') updateComposerState();
    });
    Net.on('roster', function (members) {
      netMembers = members || [];
      if (currentView === 'session') renderSession();
      if (currentView === 'master') renderMaster();
      rebuildRecipients();
    });
    Net.on('chat', function (msg) { addChatMessage(msg); });
    Net.on('sys', function (d) { addChatMessage({ system: true, text: d.text, ts: Date.now(), id: 'sys-' + Math.random() }); });
    Net.on('image', function (d) { showSpotlight(d.image, d.caption, true); });
    Net.on('image-close', function () { hideSpotlight(); });
    Net.on('tree-push', function (d) { applyIncomingTree(d.tree); });
    Net.on('tree-unlock', function (d) { applyUnlock(d.treeId, d.nodeId, d.unlocked); });
    Net.on('points-grant', function (d) { applyPointsGrant(d.amount); });
    Net.on('equip-push', function (d) { applyIncomingEquip(d.item); });
    Net.on('fight-start', function () {
      if (appRole === 'player') { fight.ongoing = true; fight.myInit = null; showFightInvite(); }
    });
    Net.on('fight-init', function (d) {
      if (appRole !== 'master') return;
      fight.inits[d.from] = { name: d.charName || rosterNameFor(d.from), value: d.value };
      recomputeOrderAndBroadcast();
      if (currentView === 'fight') renderFight();
      toast((d.charName || 'Un giocatore') + ': iniziativa ' + d.value, 'ok');
    });
    Net.on('fight-order', function (d) { fight.order = d.order || []; if (currentView === 'fight') renderFight(); });
    Net.on('fight-end', function () {
      fight.ongoing = false; fight.myInit = null; fight.inits = {}; fight.order = [];
      var inv = $('#fight-invite'); if (inv) inv.hidden = true;
      if (currentView === 'fight') { toast('Combattimento terminato', 'ok'); navTo(appRole === 'master' ? 'master' : 'session'); }
    });
    Net.on('tree-progress', function (d) {
      masterProgress[d.from] = d;
      if (currentView === 'ability-editor') renderAbilityEditor();
    });
  }

  /* ---- Lato giocatore: ricezione abilità/punti dal Master ---- */
  function activeChar() { return getChar(activeCharId) || getChar(currentCharId); }
  function refreshAbilitaIfOpen() {
    if (typeof aoCtx !== 'undefined' && aoCtx) refreshAbilityOverlay();
    if (currentView === 'sheet' && currentSection === 'abilita') renderSection();
  }
  function applyIncomingTree(tree) {
    var c = activeChar();
    if (!c) { toast('Scegli una scheda in Sessione per ricevere le abilità', 'err'); return; }
    var nt = Store.normalizeTree(tree);
    var idx = (c.sheet.abilita || []).map(function (t) { return t.id; }).indexOf(nt.id);
    if (idx >= 0) c.sheet.abilita[idx] = nt; else c.sheet.abilita.push(nt);
    persist();
    toast('Abilità "' + (nt.name || '') + '" ricevuta dal Master', 'ok');
    refreshAbilitaIfOpen();
  }
  function applyUnlock(treeId, nodeId, unlocked) {
    var c = activeChar(); if (!c) return;
    var tree = (c.sheet.abilita || []).filter(function (t) { return t.id === treeId; })[0]; if (!tree) return;
    var node = (tree.nodes || []).filter(function (n) { return n.id === nodeId; })[0]; if (!node) return;
    node.unlocked = !!unlocked; persist();
    toast(unlocked ? '🔓 Un nodo abilità è stato sbloccato!' : 'Un nodo abilità è stato bloccato');
    refreshAbilitaIfOpen();
  }
  function applyIncomingEquip(item) {
    var c = activeChar();
    if (!c) { toast('Scegli una scheda in Sessione per ricevere equipaggiamento', 'err'); return; }
    if (!item || typeof item !== 'object') return;
    var nn;
    // item ricco dall'arsenale (ha già il modello completo) → normalizza direttamente
    var richCats = ['weapon', 'shield', 'armor', 'elmo', 'accessory'];
    if (item.cat && richCats.indexOf(item.cat) >= 0 && (item.boosts || item.abilities || item.dmgBase != null || item.hp != null || item.scaleStat != null)) {
      var clone = JSON.parse(JSON.stringify(item)); clone.id = undefined; clone.equipped = false;
      nn = Store.normalizeItem(clone);
    } else {
      // formato semplice {kind,name,desc,...}
      var kind = item.kind || item.cat || 'weapon';
      var data = { name: item.name || '', note: item.desc || item.note || '' };
      if (kind === 'weapon') { data.cat = 'weapon'; data.tipo = item.tipo || ''; data.magic = Store.WEAPON_CAT.magiche.indexOf(data.tipo) >= 0; }
      else if (kind === 'shield') { data.cat = 'shield'; }
      else if (kind === 'armor') { data.cat = 'armor'; data.classe = item.classe || ''; }
      else if (kind === 'elmo') { data.cat = 'elmo'; data.hp = item.hp || 0; }
      else if (kind === 'accessory') { data.cat = 'accessory'; var slot = item.slot || ''; data.accType = (slot === 'collana') ? 'collana' : (slot === 'extra' ? 'extra' : 'ring'); }
      else { data.cat = 'weapon'; }
      nn = Store.normalizeItem(data);
    }
    nn.equipped = false;
    eqItems(c).push(nn); // arriva NON equipaggiato
    persist();
    toast('🎒 Equipaggiamento ricevuto dal Master', 'ok');
    if (currentView === 'sheet' && currentSection === 'armamenti') renderSection();
  }
  function applyPointsGrant(amount) {
    var c = activeChar();
    if (!c) { toast('Scegli una scheda in Sessione per ricevere i punti', 'err'); return; }
    var n = parseInt(amount, 10) || 0;
    c.sheet.abilityPoints = Math.max(0, (c.sheet.abilityPoints || 0) + n);
    persist();
    toast((n >= 0 ? '+' : '') + n + ' punti abilità dal Master', 'ok');
    refreshAbilitaIfOpen();
  }

  function addChatMessage(msg) {
    chatMessages.push(msg);
    if (chatMessages.length > 300) chatMessages.shift();
    maybeAnnounce(msg); // i privati del Master appaiono in evidenza
    if (currentView === 'messages') {
      appendChatNode(msg);
      scrollChatBottom();
    } else if (!msg.system) {
      unread++; refreshUnreadUI(); flashBurger();
    }
  }

  function masterMember() { return (netMembers || []).filter(function (m) { return m.role === 'master'; })[0]; }
  function recipientNames(to) {
    var ids = Array.isArray(to) ? to : [to];
    return ids.map(function (id) {
      var m = (netMembers || []).filter(function (x) { return x.id === id; })[0];
      return m ? (m.charName || m.name) : '?';
    }).join(', ');
  }
  // Mostra l'annuncio in evidenza se è un messaggio privato ricevuto dal Master
  function maybeAnnounce(msg) {
    if (msg.system || !msg.to || msg.to === 'all') return;
    var myId = Net.status().myId;
    if (msg.from === myId) return;
    var gm = masterMember();
    if (gm && msg.from === gm.id) showAnnounce(msg);
  }
  function showAnnounce(msg) {
    var body = $('#announce-body'); if (!body) return;
    var html = '';
    if (msg.text) html += '<p class="ann-text">' + esc(msg.text) + '</p>';
    if (msg.image) html += '<img class="ann-img" src="' + msg.image + '" alt="immagine" />';
    body.innerHTML = html || '<p class="ann-text"><i>(messaggio vuoto)</i></p>';
    $('#announce').hidden = false;
  }
  function closeAnnounce() { var a = $('#announce'); if (a) a.hidden = true; }

  /* ---- Vista MASTER (plancia) ---- */
  function renderMaster() {
    var body = $('#master-body');
    if (!body) return;
    body.innerHTML = '';
    if (masterSection === 'arsenale') { renderArsenal(body); return; }
    if (masterSection === 'bestiario') { renderBestiary(body); return; }
    if (masterSection === 'note') { renderCampaignNotes(body); return; }

    var st = Net.status();
    var on = st.connected;

    body.appendChild(campaignCard());

    var card = document.createElement('div'); card.className = 'panel-card';
    var acts = document.createElement('div');
    acts.style.cssText = 'display:flex;gap:10px;flex-wrap:wrap;margin-top:14px;';
    if (on) {
      card.innerHTML = '<h3>Partita in corso · ' + esc(masterCampaign().name) + '</h3>' +
        '<div class="code-display"><div class="code">' + esc(st.code || '') + '</div>' +
        '<div class="code-hint">I giocatori entrano con questo codice (stessa rete o hotspot)</div></div>';
      acts.appendChild(btn('⚔️ Combattimento', 'primary', startFightFlow));
      acts.appendChild(btn('🖼️ Mostra immagine', '', pickBroadcastImage));
      acts.appendChild(btn('💬 Messaggi', '', function () { navTo('messages'); }));
      acts.appendChild(btn('🔗 Gestisci', '', function () { navTo('session'); }));
      acts.appendChild(btn('Termina', 'danger', function () { Net.leave(); }));
    } else if (st.state === 'connecting') {
      card.innerHTML = '<h3>Avvio della partita…</h3><p class="muted">Creazione della sessione in corso…</p>';
    } else {
      card.innerHTML = '<h3>Avvia la partita</h3><p class="muted">Crea la sessione: otterrai un <b>codice</b> da dare ai giocatori. Sceglierai con quale campagna giocare.</p>';
      var startBtn = btn('⚔️ Avvia partita', 'primary big', startSessionFlow);
      startBtn.style.marginTop = '12px';
      acts.appendChild(startBtn);
    }
    card.appendChild(acts);
    body.appendChild(card);

    if (on) body.appendChild(membersCard(st));

    // navigazione alle sezioni della campagna
    var camp = masterCampaign();
    var grid = document.createElement('div'); grid.className = 'home-nav';
    function navBtn(ico, label, sub, fn) {
      var b = document.createElement('button'); b.className = 'home-btn';
      b.innerHTML = '<span class="hb-ico">' + ico + '</span><span class="hb-lbl">' + label + '</span><span class="hb-sub">' + sub + '</span>';
      b.addEventListener('click', fn); return b;
    }
    grid.appendChild(navBtn('🌳', 'Classi e abilità', (camp.classes.length) + ' classi', function () { navTo('ability-editor'); }));
    grid.appendChild(navBtn('🐉', 'Bestiario', (camp.bestiary.length) + ' creature', function () { masterSection = 'bestiario'; renderMaster(); }));
    grid.appendChild(navBtn('📝', 'Note', camp.sessions.length + ' sessioni', function () { masterSection = 'note'; renderMaster(); }));
    grid.appendChild(navBtn('⚔️', 'Arsenale', (camp.arsenal.items.length) + ' oggetti', function () { masterSection = 'arsenale'; arsenalSub = null; renderMaster(); }));
    body.appendChild(grid);
  }

  // intestazione di una sotto-sezione della Plancia con ritorno
  function masterSubHead(title, ico, backFn) {
    var head = document.createElement('div'); head.className = 'section-head';
    head.innerHTML = '<h3>' + ico + ' ' + esc(title) + '</h3>';
    head.appendChild(btn('‹ Plancia', '', backFn || function () { masterSection = null; renderMaster(); }));
    return head;
  }

  /* ---- Selettore + gestione campagne ---- */
  function campaignCard() {
    var camp = masterCampaign();
    var card = document.createElement('div'); card.className = 'panel-card campaign-card';
    card.innerHTML = '<h3>📖 Campagna</h3>';
    var sel = document.createElement('select'); sel.className = 'eq-select camp-select';
    state.master.campaigns.forEach(function (cp) {
      var o = document.createElement('option'); o.value = cp.id; o.textContent = cp.name; if (cp.id === camp.id) o.selected = true; sel.appendChild(o);
    });
    sel.addEventListener('change', function () {
      state.master.currentCampaignId = this.value; persist();
      editingClassId = null; editingAbilityId = null; masterSection = null;
      toast('Campagna: ' + masterCampaign().name, 'ok'); renderMaster();
    });
    card.appendChild(sel);
    if (camp.desc) { var d = document.createElement('p'); d.className = 'muted'; d.style.margin = '8px 0 0'; d.textContent = camp.desc; card.appendChild(d); }
    var row = document.createElement('div'); row.className = 'camp-actions';
    row.appendChild(btn('＋ Nuova', '', newCampaignDialog));
    row.appendChild(btn('✎ Rinomina', '', function () { renameCampaignDialog(camp); }));
    row.appendChild(btn('⭳ Esporta', '', function () { Store.exportCampaign(camp); toast('Campagna esportata', 'ok'); }));
    row.appendChild(btn('⭱ Importa', '', function () { $('#import-file').click(); }));
    row.appendChild(btn('🗑 Elimina', 'danger', function () { deleteCampaign(camp); }));
    card.appendChild(row);
    return card;
  }
  function newCampaignDialog() {
    twoFieldDialog('Nuova campagna', 'Nome', 'Es. Le Terre Spezzate', 'Descrizione', 'Ambientazione, tono, note...', function (name, desc) {
      var cp = Store.normalizeCampaign({ name: name, desc: desc });
      state.master.campaigns.unshift(cp); state.master.currentCampaignId = cp.id;
      editingClassId = null; editingAbilityId = null; masterSection = null;
      persist(); renderMaster();
    }, '', '', true);
  }
  function renameCampaignDialog(cp) {
    twoFieldDialog('Modifica campagna', 'Nome', '', 'Descrizione', '', function (name, desc) {
      cp.name = name; cp.desc = desc; persist(); renderMaster();
    }, cp.name, cp.desc, true);
  }
  function deleteCampaign(cp) {
    if (state.master.campaigns.length <= 1) { toast('Deve restare almeno una campagna', 'err'); return; }
    confirmDialog('Elimina campagna', 'Eliminare "' + cp.name + '" con le sue classi, bestiario, note e arsenale?', 'Elimina', true).then(function (ok) {
      if (!ok) return;
      state.master.campaigns = state.master.campaigns.filter(function (x) { return x.id !== cp.id; });
      state.master.currentCampaignId = state.master.campaigns[0].id;
      editingClassId = null; editingAbilityId = null; masterSection = null;
      persist(); renderMaster();
    });
  }
  // Scelta della campagna all'avvio della sessione
  function startSessionFlow() {
    if (typeof Net === 'undefined' || !Net.available()) { toast('Serve la connessione a internet', 'err'); return; }
    var camps = state.master.campaigns;
    function host() { var n = netName('Master'); saveNetName(n); Net.host(n); }
    if (camps.length <= 1) { masterCampaign(); host(); return; }
    var wrap = document.createElement('div'); wrap.className = 'modal-list';
    camps.forEach(function (cp) {
      var b = document.createElement('button'); b.className = 'modal-opt';
      b.innerHTML = '<span>' + esc(cp.name) + '</span>' + (cp.desc ? '<span class="mo-meta">' + esc(cp.desc) + '</span>' : '');
      b.addEventListener('click', function () {
        state.master.currentCampaignId = cp.id; persist();
        editingClassId = null; editingAbilityId = null; masterSection = null;
        closeModal(); host(); renderMaster();
      });
      wrap.appendChild(b);
    });
    openModal({ title: 'Con quale campagna giochi?', bodyNode: wrap, actions: [{ label: 'Annulla', onClick: closeModal }] });
  }

  /* ---- Arsenale del Master (stessa creazione dei giocatori, niente equip) ---- */
  function arsenalHost() {
    var camp = masterCampaign();
    camp.arsenal = Store.normalizeEquip(camp.arsenal || {});
    return { sheet: { armamenti: camp.arsenal } };
  }
  function renderArsenal(body) {
    var host = arsenalHost();
    var ctx = { mode: 'arsenal', rerender: renderMaster };
    if (!arsenalSub) {
      body.appendChild(masterSubHead('Arsenale', '⚔️', function () { masterSection = null; renderMaster(); }));
      var hint = document.createElement('p'); hint.className = 'muted'; hint.style.cssText = 'margin:0 2px 8px;font-size:.86rem;';
      hint.textContent = 'Organizza gli oggetti e inviali ai giocatori durante la sessione.';
      body.appendChild(hint);
      var grid = document.createElement('div'); grid.className = 'home-nav';
      ARM_CATS.forEach(function (cfg) {
        var all = itemsByCat(host, cfg.cats);
        var b = document.createElement('button'); b.className = 'home-btn';
        b.innerHTML = '<span class="hb-ico">' + cfg.ico + '</span><span class="hb-lbl">' + cfg.label + '</span><span class="hb-sub">' + all.length + ' oggetti</span>';
        b.addEventListener('click', function () { arsenalSub = cfg.key; renderMaster(); });
        grid.appendChild(b);
      });
      body.appendChild(grid);
      return;
    }
    var cfg = ARM_CATS.filter(function (x) { return x.key === arsenalSub; })[0] || ARM_CATS[0];
    var head = document.createElement('div'); head.className = 'section-head';
    head.innerHTML = '<h3>' + cfg.ico + ' ' + esc(cfg.label) + '</h3>';
    head.appendChild(btn('‹ Arsenale', '', function () { arsenalSub = null; renderMaster(); }));
    body.appendChild(head);
    var create = btn('＋ Crea', 'primary', function () { createItemFlow(host, cfg.key, ctx); });
    create.classList.add('equip-create');
    body.appendChild(create);
    var list = itemsByCat(host, cfg.cats);
    if (list.length === 0) body.appendChild(emptyHint('Niente qui. Crea un oggetto con "Crea".'));
    list.forEach(function (it) { body.appendChild(itemCard(host, it, ctx)); });
  }
  // Invia un oggetto dell'arsenale a uno o più giocatori collegati
  function sendArsenalItem(it) {
    if (typeof Net === 'undefined' || !Net.status().connected) { toast('Avvia prima la sessione', 'err'); return; }
    var players = connectedPlayers();
    if (!players.length) { toast('Nessun giocatore collegato', 'err'); return; }
    var payload = Store.normalizeItem(it); payload.equipped = false; payload.id = undefined;
    var wrap = document.createElement('div'); wrap.className = 'modal-list';
    if (players.length > 1) {
      var ball = document.createElement('button'); ball.className = 'modal-opt';
      ball.innerHTML = '<span>📢 Tutti i giocatori</span>';
      ball.addEventListener('click', function () {
        players.forEach(function (p) { Net.pushEquip(p.id, payload); });
        closeModal(); toast('Inviato a tutti', 'ok');
      });
      wrap.appendChild(ball);
    }
    players.forEach(function (p) {
      var b = document.createElement('button'); b.className = 'modal-opt';
      b.innerHTML = '<span>' + esc(p.charName || p.name) + '</span>' + (p.charName ? '<span class="mo-meta">' + esc(p.name) + '</span>' : '');
      b.addEventListener('click', function () {
        var ok = Net.pushEquip(p.id, payload);
        closeModal(); toast(ok ? 'Inviato a ' + (p.charName || p.name) : 'Giocatore non collegato', ok ? 'ok' : 'err');
      });
      wrap.appendChild(b);
    });
    openModal({ title: 'Invia "' + esc(it.name || itemDefaultName(it)) + '" a…', bodyNode: wrap, actions: [{ label: 'Annulla', onClick: closeModal }] });
  }

  /* ---- Bestiario della campagna ---- */
  function renderBestiary(body) {
    var camp = masterCampaign();
    body.appendChild(masterSubHead('Bestiario · ' + camp.name, '🐉'));
    body.appendChild(btn('＋ Nuova creatura', 'primary', function () { creatureDialog(null); })).classList.add('equip-create');
    if (camp.bestiary.length === 0) { body.appendChild(emptyHint('Nessuna creatura. Aggiungine una.')); return; }
    camp.bestiary.forEach(function (m) {
      var card = document.createElement('div'); card.className = 'panel-card creature-card';
      var statsLine = Store.STAT_DEFS.filter(function (d) { return m.stats[d.abbr]; }).map(function (d) { return d.abbr + ' ' + m.stats[d.abbr]; }).join(' · ');
      var abN = (m.abilities || []).length;
      card.innerHTML =
        (m.image ? '<img class="cr-img" src="' + m.image + '" alt="" />' : '') +
        '<h4 class="tree-li-name">' + esc(m.name || 'Creatura') + '</h4>' +
        '<p class="muted">❤️ ' + (m.hp || 0) + ' PF' + (statsLine ? ' · ' + statsLine : '') + (abN ? ' · 🎯 ' + abN + ' abilità' : '') + '</p>' +
        (m.note ? '<p class="cr-note">' + esc(m.note) + '</p>' : '') +
        ((m.abilities || []).length ? '<div class="cr-abils">' + m.abilities.map(function (a) { var el = effLabel(a); return '<span class="cr-ab"><b>' + esc(a.name || 'Abilità') + '</b>' + (el ? ' · ' + esc(el) : '') + (a.countdown ? ' · ⏳' + a.countdown : '') + '</span>'; }).join('') + '</div>' : '');
      var row = document.createElement('div'); row.style.cssText = 'display:flex;gap:10px;flex-wrap:wrap;margin-top:8px;';
      row.appendChild(btn('Modifica', '', function () { creatureDialog(m); }));
      row.appendChild(btn('Elimina', 'danger', function () {
        confirmDialog('Elimina creatura', 'Eliminare "' + (m.name || 'creatura') + '"?', 'Elimina', true).then(function (ok) {
          if (!ok) return; camp.bestiary = camp.bestiary.filter(function (x) { return x.id !== m.id; }); persist(); renderMaster();
        });
      }));
      card.appendChild(row);
      body.appendChild(card);
    });
  }
  function creatureDialog(m) {
    var camp = masterCampaign();
    var editing = !!m;
    var imgData = m ? (m.image || null) : null;
    var stats = {}; Store.STAT_DEFS.forEach(function (d) { stats[d.abbr] = m ? (m.stats[d.abbr] || 0) : 0; });
    var abilities = (m && m.abilities ? m.abilities : []).map(function (a) { return { id: a.id, name: a.name, note: a.note, countdown: a.countdown, effKind: a.effKind || '', effValue: a.effValue || 0, effScale: a.effScale || '', effText: a.effText || '' }; });
    var wrap = document.createElement('div'); wrap.style.cssText = 'display:flex;flex-direction:column;gap:12px;';
    var statsGrid = Store.STAT_DEFS.map(function (d) {
      return '<div class="cr-stat"><label>' + d.abbr + '</label><input data-stat="' + d.abbr + '" type="number" inputmode="numeric" value="' + stats[d.abbr] + '" /></div>';
    }).join('');
    wrap.innerHTML =
      '<div class="field"><label>Nome</label><input id="cr-name" maxlength="50" /></div>' +
      '<div class="field"><label>Punti Ferita (PF)</label><input id="cr-hp" type="number" inputmode="numeric" min="0" placeholder="0" /></div>' +
      '<div class="field"><label>Statistiche</label><div class="cr-stats-grid">' + statsGrid + '</div></div>' +
      '<div class="field"><label>Note</label><textarea id="cr-note" rows="3" maxlength="800" placeholder="Comportamento, attacchi, resistenze..."></textarea></div>' +
      '<div class="field"><label>Immagine (opzionale)</label><div class="cr-img-row"><div class="cr-img-prev" id="cr-prev"></div>' +
      '<button type="button" class="tool-btn" id="cr-img-btn">Scegli immagine</button>' +
      '<button type="button" class="tool-btn" id="cr-img-clear" style="display:none">Rimuovi</button></div>' +
      '<input type="file" id="cr-img-file" accept="image/*" hidden /></div>' +
      '<div class="field"><label>Abilità (pulsanti nella sezione Fight)</label><div id="cr-abil"></div></div>';
    wrap.querySelector('#cr-abil').appendChild(buildAbilityEditor(abilities));
    wrap.querySelector('#cr-name').value = m ? m.name : '';
    wrap.querySelector('#cr-hp').value = m && m.hp ? m.hp : '';
    wrap.querySelector('#cr-note').value = m ? m.note : '';
    var prev = wrap.querySelector('#cr-prev'), clearBtn = wrap.querySelector('#cr-img-clear');
    function refreshPrev() {
      if (imgData) { prev.style.backgroundImage = 'url(' + imgData + ')'; prev.classList.add('has'); clearBtn.style.display = ''; }
      else { prev.style.backgroundImage = ''; prev.classList.remove('has'); clearBtn.style.display = 'none'; }
    }
    refreshPrev();
    wrap.querySelector('#cr-img-btn').addEventListener('click', function () { wrap.querySelector('#cr-img-file').click(); });
    wrap.querySelector('#cr-img-file').addEventListener('change', function (e) {
      var f = e.target.files[0]; e.target.value = ''; if (!f) return;
      processImage(f, 512, 0.82).then(function (url) { imgData = url; refreshPrev(); }).catch(function () { toast('Immagine non valida', 'err'); });
    });
    clearBtn.addEventListener('click', function () { imgData = null; refreshPrev(); });
    function save() {
      var name = wrap.querySelector('#cr-name').value.trim();
      if (!name) { wrap.querySelector('#cr-name').focus(); toast('Dai un nome', 'err'); return; }
      var st = {}; wrap.querySelectorAll('[data-stat]').forEach(function (i) { st[i.getAttribute('data-stat')] = parseInt(i.value, 10) || 0; });
      var data = { id: m ? m.id : undefined, name: name, hp: parseInt(wrap.querySelector('#cr-hp').value, 10) || 0, stats: st, note: wrap.querySelector('#cr-note').value.trim(), image: imgData, abilities: abilities };
      var nn = Store.normalizeCreature(data);
      if (m) { var i = camp.bestiary.map(function (x) { return x.id; }).indexOf(m.id); camp.bestiary[i] = nn; }
      else camp.bestiary.unshift(nn);
      persist(); closeModal(); renderMaster();
    }
    openModal({ title: (editing ? 'Modifica creatura' : 'Nuova creatura'), bodyNode: wrap, focus: '#cr-name',
      actions: [{ label: 'Annulla', onClick: closeModal }, { label: 'Salva', cls: 'primary', onClick: save }] });
  }

  /* ---- Note per sessione di gioco (ogni sessione ha le sue note) ---- */
  function currentSession(camp) {
    var s = camp.sessions.filter(function (x) { return x.id === camp.currentSessionId; })[0];
    if (!s) { s = camp.sessions[0]; camp.currentSessionId = s.id; }
    return s;
  }
  function renderCampaignNotes(body) {
    var camp = masterCampaign();
    body.appendChild(masterSubHead('Note · ' + camp.name, '📝'));

    var sess = currentSession(camp);
    var card = document.createElement('div'); card.className = 'panel-card campaign-card';
    card.innerHTML = '<h3>🗓️ Sessione di gioco</h3>';
    var sel = document.createElement('select'); sel.className = 'eq-select camp-select';
    camp.sessions.forEach(function (s) {
      var o = document.createElement('option'); o.value = s.id; o.textContent = s.name; if (s.id === sess.id) o.selected = true; sel.appendChild(o);
    });
    sel.addEventListener('change', function () { camp.currentSessionId = this.value; persist(); renderMaster(); });
    card.appendChild(sel);
    var row = document.createElement('div'); row.className = 'camp-actions';
    row.appendChild(btn('＋ Nuova', '', function () {
      promptDialog('Nuova sessione', 'Nome', 'Es. Sessione ' + (camp.sessions.length + 1), '', function (name) {
        var s = Store.normalizeSession({ name: name });
        camp.sessions.push(s); camp.currentSessionId = s.id; persist(); renderMaster();
      });
    }));
    row.appendChild(btn('✎ Rinomina', '', function () {
      promptDialog('Rinomina sessione', 'Nome', '', sess.name, function (name) { sess.name = name; persist(); renderMaster(); });
    }));
    row.appendChild(btn('🗑 Elimina', 'danger', function () {
      if (camp.sessions.length <= 1) { toast('Deve restare almeno una sessione', 'err'); return; }
      confirmDialog('Elimina sessione', 'Eliminare "' + sess.name + '" e le sue note?', 'Elimina', true).then(function (ok) {
        if (!ok) return;
        camp.sessions = camp.sessions.filter(function (x) { return x.id !== sess.id; });
        camp.currentSessionId = camp.sessions[0].id; persist(); renderMaster();
      });
    }));
    card.appendChild(row);
    body.appendChild(card);

    var ta = document.createElement('textarea'); ta.className = 'field note-area';
    ta.placeholder = 'Cosa è successo in questa sessione: trama, PNG incontrati, scelte, ricompense, agganci per la prossima...';
    ta.value = sess.notes || '';
    var t;
    ta.addEventListener('input', function () { clearTimeout(t); t = setTimeout(function () { sess.notes = ta.value; persist(); }, 350); });
    var wrap = document.createElement('div'); wrap.className = 'field'; wrap.appendChild(ta);
    body.appendChild(wrap);
  }

  /* ============================================================
     COMBATTIMENTO (Fight) — invito, iniziativa, ordine condiviso
     ============================================================ */
  function rollD100() { return Math.floor(Math.random() * 100) + 1; }
  function rosterNameFor(id) {
    var m = (netMembers || []).filter(function (x) { return x.id === id; })[0];
    return m ? (m.charName || m.name) : 'Giocatore';
  }
  function computeFightOrder() {
    var arr = [];
    Object.keys(fight.inits).forEach(function (id) { var e = fight.inits[id]; arr.push({ name: e.name || rosterNameFor(id), value: e.value, kind: 'player' }); });
    fight.enemies.forEach(function (en) { arr.push({ name: en.name, value: en.init, kind: 'enemy' }); });
    arr.sort(function (a, b) { return (b.value || 0) - (a.value || 0); });
    return arr;
  }
  function recomputeOrderAndBroadcast() {
    fight.order = computeFightOrder();
    if (appRole === 'master' && Net.status().connected) Net.broadcastFightOrder(fight.order);
  }

  // MASTER: avvia il combattimento
  function startFightFlow() {
    if (typeof Net === 'undefined' || !Net.status().connected) { toast('Avvia prima la sessione', 'err'); return; }
    fight.ongoing = true; fight.inits = {}; fight.order = [];
    Net.startFight();
    recomputeOrderAndBroadcast();
    navTo('fight');
    toast('Invito al combattimento inviato', 'ok');
  }
  function endFightFlow() {
    confirmDialog('Termina combattimento', 'Vuoi terminare il combattimento per tutti?', 'Termina', true).then(function (ok) {
      if (!ok) return;
      Net.endFight();
      fight.ongoing = false; fight.myInit = null; fight.inits = {}; fight.enemies = []; fight.order = [];
      navTo('master');
    });
  }

  function showFightInvite() {
    var inv = $('#fight-invite'); if (!inv) return;
    inv.hidden = false;
  }

  function renderFight() {
    var body = $('#fight-body'); if (!body) return;
    body.innerHTML = '';
    if (appRole === 'master') renderFightMaster(body);
    else renderFightPlayer(body);
  }

  function orderList(order) {
    var box = document.createElement('div'); box.className = 'init-order';
    if (!order || !order.length) { box.appendChild(emptyHint('Ancora nessuna iniziativa.')); return box; }
    order.forEach(function (o, i) {
      var row = document.createElement('div'); row.className = 'init-row ' + (o.kind === 'enemy' ? 'is-enemy' : 'is-player');
      row.innerHTML = '<span class="init-pos">' + (i + 1) + '</span>' +
        '<span class="init-ico">' + (o.kind === 'enemy' ? '👹' : '⚔️') + '</span>' +
        '<span class="init-name">' + esc(o.name) + '</span>' +
        '<span class="init-val">' + (o.value != null ? o.value : '—') + '</span>';
      box.appendChild(row);
    });
    return box;
  }

  function renderFightMaster(body) {
    var st = Net.status();
    var top = document.createElement('div'); top.className = 'panel-card';
    top.innerHTML = '<h3>⚔️ Combattimento</h3><p class="muted">I giocatori tirano (o inseriscono) l\'iniziativa. Aggiungi i nemici e tira per loro col d100.</p>';
    var acts = document.createElement('div'); acts.style.cssText = 'display:flex;gap:10px;flex-wrap:wrap;margin-top:10px;';
    acts.appendChild(btn('📣 Re-invita', '', function () { if (Net.startFight()) toast('Invito rinviato', 'ok'); }));
    acts.appendChild(btn('🖼️ Immagine', '', pickBroadcastImage));
    acts.appendChild(btn('Termina', 'danger', endFightFlow));
    top.appendChild(acts);
    body.appendChild(top);

    // Nemici del master
    var enemCard = document.createElement('div'); enemCard.className = 'panel-card';
    enemCard.innerHTML = '<h3>👹 Nemici</h3>';
    enemCard.appendChild(btn('＋ Nemico', 'primary', addEnemyDialog)).classList.add('equip-create');
    if (!fight.enemies.length) { var ph = document.createElement('p'); ph.className = 'muted'; ph.style.margin = '4px 2px 0'; ph.textContent = 'Nessun nemico in campo.'; enemCard.appendChild(ph); }
    fight.enemies.forEach(function (en) {
      var r = document.createElement('div'); r.className = 'entry';
      r.innerHTML = '<span class="e-val">' + en.init + '</span><div class="e-main"><div class="e-name">' + esc(en.name) + '</div></div>' +
        '<button class="b-del" aria-label="Rimuovi">×</button>';
      r.querySelector('.b-del').addEventListener('click', function () {
        fight.enemies = fight.enemies.filter(function (x) { return x.id !== en.id; });
        recomputeOrderAndBroadcast(); renderFight();
      });
      enemCard.appendChild(r);
    });
    body.appendChild(enemCard);

    // Ordine + attesa
    var ord = document.createElement('div'); ord.className = 'panel-card';
    ord.innerHTML = '<h3>🎯 Ordine di iniziativa</h3>';
    ord.appendChild(orderList(computeFightOrder()));
    var waiting = (st.members || []).filter(function (m) { return m.role === 'player' && !fight.inits[m.id]; });
    if (waiting.length) {
      var w = document.createElement('p'); w.className = 'muted'; w.style.marginTop = '8px';
      w.textContent = 'In attesa: ' + waiting.map(function (m) { return m.charName || m.name; }).join(', ');
      ord.appendChild(w);
    }
    body.appendChild(ord);
  }

  function addEnemyDialog() {
    var camp = masterCampaign();
    var wrap = document.createElement('div'); wrap.style.cssText = 'display:flex;flex-direction:column;gap:12px;';
    var bestOpts = '<option value="">— dal bestiario —</option>' + camp.bestiary.map(function (m) { return '<option value="' + esc(m.id) + '">' + esc(m.name || 'Creatura') + '</option>'; }).join('');
    wrap.innerHTML =
      (camp.bestiary.length ? '<div class="field"><label>Dal bestiario</label><select id="en-best" class="eq-select">' + bestOpts + '</select></div>' : '') +
      '<div class="field"><label>Nome</label><input id="en-name" maxlength="40" placeholder="Es. Goblin" /></div>' +
      '<div class="field"><label>Iniziativa</label><div class="init-input"><input id="en-init" type="number" inputmode="numeric" min="0" placeholder="0" /><button type="button" class="tool-btn" id="en-d100">🎲 d100</button></div></div>';
    var bsel = wrap.querySelector('#en-best');
    if (bsel) bsel.addEventListener('change', function () {
      var id = this.value;
      var m = camp.bestiary.filter(function (x) { return x.id === id; })[0];
      if (m) wrap.querySelector('#en-name').value = m.name || '';
    });
    wrap.querySelector('#en-d100').addEventListener('click', function () { wrap.querySelector('#en-init').value = rollD100(); });
    function save() {
      var name = wrap.querySelector('#en-name').value.trim();
      if (!name) { wrap.querySelector('#en-name').focus(); toast('Dai un nome', 'err'); return; }
      var init = parseInt(wrap.querySelector('#en-init').value, 10); if (isNaN(init)) init = 0;
      fight.enemies.push({ id: Store.genId(), name: name, init: init });
      recomputeOrderAndBroadcast(); closeModal(); renderFight();
    }
    openModal({ title: 'Aggiungi nemico', bodyNode: wrap, focus: '#en-name',
      actions: [{ label: 'Annulla', onClick: closeModal }, { label: 'Aggiungi', cls: 'primary', onClick: save }] });
  }

  function renderFightPlayer(body) {
    if (!Net.status().connected) { body.appendChild(panelCard('Non sei in sessione', 'Entra in una sessione per combattere.')); return; }
    if (fight.myInit == null) {
      var card = document.createElement('div'); card.className = 'panel-card';
      card.innerHTML = '<h3>🎲 Tira per iniziativa o inserisci</h3><p class="muted">Puoi lasciare che l\'app tiri un d100, oppure inserire il numero che hai tirato dal vivo con i dadi fisici.</p>';
      var acts = document.createElement('div'); acts.style.cssText = 'display:flex;gap:10px;flex-wrap:wrap;margin-top:12px;';
      acts.appendChild(btn('🎲 Tira d100', 'primary big', function () { setMyInit(rollD100()); }));
      acts.appendChild(btn('✍️ Inserisci il tiro', '', function () {
        promptDialog('Inserisci iniziativa', 'Numero tirato', 'Es. 73', '', function (v) { var n = parseInt(v, 10); if (isNaN(n)) { toast('Numero non valido', 'err'); return; } setMyInit(n); });
      }));
      card.appendChild(acts);
      body.appendChild(card);
      return;
    }
    var mine = document.createElement('div'); mine.className = 'panel-card';
    mine.innerHTML = '<h3>La tua iniziativa</h3><div class="my-init">' + fight.myInit + '</div>';
    mine.appendChild(btn('↻ Ritira', '', function () { fight.myInit = null; renderFight(); }));
    body.appendChild(mine);
    var ord = document.createElement('div'); ord.className = 'panel-card';
    ord.innerHTML = '<h3>🎯 Ordine di iniziativa</h3>';
    ord.appendChild(orderList(fight.order));
    body.appendChild(ord);
  }
  function setMyInit(v) {
    fight.myInit = v;
    var ch = activeChar();
    Net.sendInitiative(v, ch ? charLabel(ch) : '');
    toast('Iniziativa: ' + v, 'ok');
    renderFight();
  }

  /* ---- Vista SESSIONE ---- */
  function renderSession() {
    var body = $('#session-body');
    if (!body) return;
    body.innerHTML = '';
    if (!Net.available()) {
      body.appendChild(panelCard('Collegamento non disponibile',
        'Per collegare i dispositivi serve la connessione a internet. Riprova quando sei online.'));
      return;
    }
    var st = Net.status();
    if (appRole === 'master') renderSessionMaster(body, st);
    else renderSessionPlayer(body, st);
  }

  function membersCard(st) {
    var c = document.createElement('div'); c.className = 'panel-card';
    var members = st.members || [];
    var players = members.filter(function (m) { return m.role === 'player'; });
    c.innerHTML = '<h3>Giocatori collegati (' + players.length + ')</h3>';
    var list = document.createElement('div'); list.className = 'member-list';
    members.forEach(function (m) {
      var row = document.createElement('div'); row.className = 'member' + (m.role === 'master' ? ' is-master' : '');
      var mine = (m.id === st.myId) ? ' (tu)' : '';
      var mainName, sub;
      if (m.role === 'master') {
        mainName = esc(m.name) + mine; sub = '';
      } else {
        mainName = m.charName ? (esc(m.charName) + mine) : ('<span class="m-nochar">personaggio non scelto' + mine + '</span>');
        sub = m.charName ? esc(m.name) : '';
      }
      var lvlChip = (m.role === 'player' && m.level != null) ? '<span class="m-lvl">Liv. ' + esc(String(m.level)) + '</span>' : '';
      row.innerHTML =
        '<span class="m-ico">' + (m.role === 'master' ? '📜' : '⚔️') + '</span>' +
        '<span class="m-name">' + mainName + (sub ? ('<span class="m-sub"> · ' + sub + '</span>') : '') + '</span>' +
        lvlChip +
        '<span class="m-role">' + (m.role === 'master' ? 'Master' : 'Player') + '</span>';
      if (st.role === 'master' && m.role === 'player') {
        var gb = document.createElement('button'); gb.className = 'tool-btn member-pts'; gb.textContent = '＋ punti';
        gb.addEventListener('click', function () { grantPointsDialog(m.id); });
        row.appendChild(gb);
        var eb = document.createElement('button'); eb.className = 'tool-btn member-pts'; eb.textContent = '🎒'; eb.title = 'Invia equipaggiamento';
        eb.addEventListener('click', function () { sendEquipDialog(m.id); });
        row.appendChild(eb);
      }
      list.appendChild(row);
    });
    c.appendChild(list);
    if (players.length === 0 && st.role === 'master') {
      var p = document.createElement('p'); p.className = 'muted'; p.style.marginTop = '8px';
      p.textContent = 'In attesa che i giocatori inseriscano il codice…';
      c.appendChild(p);
    }
    return c;
  }

  function renderSessionMaster(body, st) {
    var card = document.createElement('div'); card.className = 'panel-card';
    if (st.connected) {
      card.innerHTML =
        '<h3>Sessione attiva</h3>' +
        '<div class="code-display"><div class="code">' + esc(st.code || '') + '</div>' +
        '<div class="code-hint">Condividi questo codice con i giocatori sulla stessa rete/hotspot</div></div>';
      var actions = document.createElement('div');
      actions.style.cssText = 'display:flex;gap:10px;flex-wrap:wrap;margin-top:6px;';
      actions.appendChild(btn('🖼️ Mostra immagine a tutti', 'primary', pickBroadcastImage));
      actions.appendChild(btn('💬 Messaggi', '', function () { navTo('messages'); }));
      actions.appendChild(btn('Termina sessione', 'danger', function () { Net.leave(); }));
      card.appendChild(actions);
      body.appendChild(card);
      body.appendChild(membersCard(st));
    } else {
      card.innerHTML = '<h3>Avvia una sessione</h3><p class="muted">Crea una stanza e ottieni un codice da condividere. I giocatori potranno collegarsi, scriverti e vedere le immagini che proietti.</p>';
      var field = document.createElement('div'); field.className = 'field'; field.style.marginTop = '12px';
      field.innerHTML = '<label>Il tuo nome</label><input id="host-name" maxlength="24" placeholder="Master" />';
      field.querySelector('input').value = netName('Master');
      card.appendChild(field);
      var connecting = (st.state === 'connecting');
      var start = btn(connecting ? 'Avvio in corso…' : '⚔️ Avvia sessione', 'primary big', function () {
        var n = (field.querySelector('input').value || '').trim() || 'Master';
        saveNetName(n); Net.host(n);
      });
      start.style.marginTop = '12px';
      if (connecting) start.disabled = true;
      card.appendChild(start);
      body.appendChild(card);
    }
  }

  function renderSessionPlayer(body, st) {
    if (st.connected) {
      var card = document.createElement('div'); card.className = 'panel-card';
      card.innerHTML = '<h3>Sei in sessione</h3><p class="muted">Codice stanza: <b>' + esc(st.code || '') + '</b></p>';
      // scelta del personaggio attivo (riceve abilità e punti dal Master)
      var cf = document.createElement('div'); cf.className = 'field'; cf.style.marginTop = '10px';
      cf.innerHTML = '<label>Gioco con</label>';
      var csel = document.createElement('select'); csel.className = 'chat-to'; csel.style.maxWidth = '100%';
      var o0 = document.createElement('option'); o0.value = ''; o0.textContent = '— scegli una scheda —'; csel.appendChild(o0);
      state.characters.forEach(function (ch) {
        var o = document.createElement('option'); o.value = ch.id; o.textContent = charLabel(ch); csel.appendChild(o);
      });
      csel.value = activeCharId || '';
      csel.addEventListener('change', function () {
        activeCharId = this.value || null;
        var ch = getChar(activeCharId);
        sendWhoami(ch);
        if (ch) toast('Giochi con ' + charLabel(ch), 'ok');
      });
      cf.appendChild(csel);
      if (state.characters.length === 0) {
        var hint = document.createElement('p'); hint.className = 'muted'; hint.style.marginTop = '6px';
        hint.textContent = 'Non hai schede: creane una nella sezione Player per ricevere abilità.';
        cf.appendChild(hint);
      }
      card.appendChild(cf);
      var actions = document.createElement('div');
      actions.style.cssText = 'display:flex;gap:10px;flex-wrap:wrap;margin-top:10px;';
      actions.appendChild(btn('💬 Vai ai messaggi', 'primary', function () { navTo('messages'); }));
      actions.appendChild(btn('Esci dalla sessione', 'danger', function () { Net.leave(); }));
      card.appendChild(actions);
      body.appendChild(card);
      body.appendChild(membersCard(st));
    } else {
      var card2 = document.createElement('div'); card2.className = 'panel-card';
      card2.innerHTML = '<h3>Entra in una sessione</h3><p class="muted">Inserisci il codice che ti ha dato il Master. Dovete essere sulla stessa rete o hotspot.</p>';
      var form = document.createElement('div'); form.className = 'join-form'; form.style.marginTop = '12px';
      form.innerHTML =
        '<div class="field"><label>Il tuo nome</label><input id="join-name" maxlength="24" placeholder="Es. Arannis" /></div>' +
        '<div class="field"><label>Codice sessione</label><input id="join-code" class="code-input" maxlength="6" placeholder="ABC123" /></div>';
      form.querySelector('#join-name').value = netName('');
      var ci = form.querySelector('#join-code');
      ci.addEventListener('input', function () { this.value = this.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });
      var connecting = (st.state === 'connecting');
      var jb = btn(connecting ? 'Collegamento…' : '🔗 Entra', 'primary big', function () {
        var n = (form.querySelector('#join-name').value || '').trim();
        var code = (ci.value || '').trim();
        if (!n) { toast('Inserisci il tuo nome', 'err'); return; }
        if (!code) { toast('Inserisci il codice', 'err'); return; }
        saveNetName(n); Net.join(code, n);
      });
      jb.style.marginTop = '4px';
      if (connecting) jb.disabled = true;
      form.appendChild(jb);
      card2.appendChild(form);
      body.appendChild(card2);
    }
  }

  /* ---- Campagne del Master (contenitore di classi, bestiario, note, arsenale) ---- */
  function masterCampaign() {
    if (!state.master || !Array.isArray(state.master.campaigns) || !state.master.campaigns.length) {
      state.master = Store.ensureMaster(state.master || {});
    }
    var id = state.master.currentCampaignId;
    var camp = state.master.campaigns.filter(function (x) { return x.id === id; })[0];
    if (!camp) { camp = state.master.campaigns[0]; state.master.currentCampaignId = camp.id; }
    return camp;
  }
  function masterClasses() { return masterCampaign().classes; }

  /* ---- Editor abilità (Master): Classi → Abilità → Albero di nodi ---- */
  function connectedPlayers() { return (netMembers || []).filter(function (m) { return m.role === 'player'; }); }
  function getClass(id) { return masterClasses().filter(function (x) { return x.id === id; })[0]; }
  function getAbilityIn(cls, id) { return (cls.abilities || []).filter(function (a) { return a.id === id; })[0]; }

  function renderAbilityEditor() {
    var body = $('#ability-editor-body'); if (!body) return;
    body.innerHTML = '';
    masterCampaign(); // assicura la struttura a campagne
    if (editingClassId) {
      var cls = getClass(editingClassId);
      if (!cls) { editingClassId = null; editingAbilityId = null; return renderAbilityEditor(); }
      if (editingAbilityId) {
        var ability = getAbilityIn(cls, editingAbilityId);
        if (!ability) { editingAbilityId = null; return renderAbilityEditor(); }
        renderNodeEditor(body, cls, ability);
      } else {
        renderClassView(body, cls);
      }
    } else {
      renderClassList(body);
    }
  }

  // Livello 1 — elenco classi (cartelle)
  function renderClassList(body) {
    var head = document.createElement('div'); head.className = 'panel-card';
    head.innerHTML = '<h3>Classi · ' + esc(masterCampaign().name) + '</h3><p class="muted">Le classi sono cartelle per organizzare le abilità. Crea una classe, poi al suo interno le abilità (ognuna con il proprio albero).</p>';
    head.appendChild(btn('＋ Nuova classe', 'primary', newClassDialog));
    body.appendChild(head);
    var classes = masterClasses();
    if (classes.length === 0) { body.appendChild(emptyHint('Nessuna classe. Creane una con “Nuova classe”.')); return; }
    classes.forEach(function (cls) {
      var card = document.createElement('div'); card.className = 'panel-card';
      card.innerHTML = '<h4 class="tree-li-name">📚 ' + esc(cls.name) + '</h4>' +
        '<p class="muted">' + (cls.abilities ? cls.abilities.length : 0) + ' abilità' + (cls.desc ? ' · ' + esc(cls.desc) : '') + '</p>';
      var row = document.createElement('div'); row.style.cssText = 'display:flex;gap:10px;flex-wrap:wrap;margin-top:8px;';
      row.appendChild(btn('Apri', 'primary', function () { editingClassId = cls.id; editingAbilityId = null; renderAbilityEditor(); }));
      row.appendChild(btn('Rinomina', '', function () { renameClassDialog(cls); }));
      row.appendChild(btn('Elimina', 'danger', function () {
        confirmDialog('Elimina classe', 'Eliminare la classe "' + cls.name + '" e tutte le sue abilità?', 'Elimina', true).then(function (ok) {
          if (!ok) return; masterCampaign().classes = classes.filter(function (x) { return x.id !== cls.id; }); persist(); renderAbilityEditor();
        });
      }));
      card.appendChild(row);
      body.appendChild(card);
    });
  }

  function newClassDialog() {
    twoFieldDialog('Nuova classe', 'Nome', 'Es. Guerriero', 'Descrizione', 'Note sulla classe...', function (name, desc) {
      var cls = Store.normalizeClass({ name: name, desc: desc, abilities: [] });
      masterClasses().unshift(cls); persist(); editingClassId = cls.id; editingAbilityId = null; renderAbilityEditor();
    }, '', '', true);
  }
  function renameClassDialog(cls) {
    twoFieldDialog('Modifica classe', 'Nome', '', 'Descrizione', '', function (name, desc) {
      cls.name = name; cls.desc = desc; persist(); renderAbilityEditor();
    }, cls.name, cls.desc, true);
  }

  // Livello 2 — abilità dentro una classe
  function renderClassView(body, cls) {
    var top = document.createElement('div'); top.className = 'panel-card';
    var titleRow = document.createElement('div'); titleRow.style.cssText = 'display:flex;align-items:center;gap:10px;';
    titleRow.innerHTML = '<h3 style="flex:1;margin:0">📚 ' + esc(cls.name) + '</h3>';
    titleRow.appendChild(btn('‹ Classi', '', function () { editingClassId = null; renderAbilityEditor(); }));
    top.appendChild(titleRow);
    if (cls.desc) { var d = document.createElement('p'); d.className = 'muted'; d.textContent = cls.desc; top.appendChild(d); }
    top.appendChild(btn('＋ Nuova abilità', 'primary', function () { newAbilityDialog(cls); }));
    body.appendChild(top);

    if ((cls.abilities || []).length === 0) { body.appendChild(emptyHint('Nessuna abilità in questa classe. Aggiungine una.')); return; }
    cls.abilities.forEach(function (ab) {
      var card = document.createElement('div'); card.className = 'panel-card';
      var tgt = ab.targetName ? esc(ab.targetName) : 'non inviata';
      card.innerHTML = '<h4 class="tree-li-name">🌿 ' + esc(ab.name) + '</h4>' +
        '<p class="muted">' + (ab.nodes ? ab.nodes.length : 0) + ' nodi · ' + tgt + '</p>';
      var row = document.createElement('div'); row.style.cssText = 'display:flex;gap:10px;flex-wrap:wrap;margin-top:8px;';
      row.appendChild(btn('Apri albero', 'primary', function () { editingAbilityId = ab.id; linkMode = false; linkFrom = null; renderAbilityEditor(); }));
      row.appendChild(btn('Elimina', 'danger', function () {
        confirmDialog('Elimina abilità', 'Eliminare "' + ab.name + '"?', 'Elimina', true).then(function (ok) {
          if (!ok) return; cls.abilities = cls.abilities.filter(function (x) { return x.id !== ab.id; }); persist(); renderAbilityEditor();
        });
      }));
      card.appendChild(row);
      body.appendChild(card);
    });
  }

  function newAbilityDialog(cls) {
    twoFieldDialog('Nuova abilità', 'Nome', 'Es. Via della Lama', 'Descrizione', 'A cosa serve...', function (name, desc) {
      // parte sempre col primo cerchio (radice) = l'abilità stessa, già sbloccato
      var root = Store.normalizeNode({ name: name || 'Inizio', tier: 0, cost: 0, unlocked: true });
      var ab = Store.normalizeAbility({ name: name, desc: desc, nodes: [root], links: [] });
      cls.abilities.unshift(ab); persist();
      editingAbilityId = ab.id; linkMode = false; linkFrom = null; renderAbilityEditor();
    }, '', '', true);
  }

  // Livello 3 — editor "a disegno" dell'albero di un'abilità
  function renderNodeEditor(body, cls, ability) {
    if (!ability.links) ability.links = [];
    var top = document.createElement('div'); top.className = 'panel-card';
    var titleRow = document.createElement('div'); titleRow.style.cssText = 'display:flex;align-items:center;gap:10px;';
    titleRow.innerHTML = '<h3 style="flex:1;margin:0">🌿 ' + esc(ability.name) + '</h3>';
    titleRow.appendChild(btn('‹ ' + esc(cls.name), '', function () { editingAbilityId = null; linkMode = false; linkFrom = null; renderAbilityEditor(); }));
    top.appendChild(titleRow);

    var tf = document.createElement('div'); tf.className = 'field'; tf.style.marginTop = '10px';
    tf.innerHTML = '<label>Destinatario (giocatore connesso)</label>';
    var sel = document.createElement('select'); sel.className = 'chat-to';
    var o0 = document.createElement('option'); o0.value = ''; o0.textContent = '— non assegnato —'; sel.appendChild(o0);
    connectedPlayers().forEach(function (m) {
      var o = document.createElement('option'); o.value = m.id; o.textContent = m.name + (m.charName ? (' — ' + m.charName) : ''); sel.appendChild(o);
    });
    sel.value = ability.targetMemberId || '';
    sel.addEventListener('change', function () {
      ability.targetMemberId = this.value || null;
      var m = netMembers.filter(function (x) { return x.id === ability.targetMemberId; })[0];
      ability.targetName = m ? (m.charName || m.name) : ''; persist();
      syncAbility(ability); // invia subito l'abilità corrente al nuovo destinatario
    });
    tf.appendChild(sel);
    top.appendChild(tf);

    var acts = document.createElement('div'); acts.style.cssText = 'display:flex;gap:10px;flex-wrap:wrap;margin-top:12px;';
    acts.appendChild(btn('📤 Invia al giocatore', 'primary', function () { sendTreeToTarget(ability); }));
    acts.appendChild(btn('🎖 Concedi punti', '', function () { grantPointsDialog(ability.targetMemberId); }));
    top.appendChild(acts);
    body.appendChild(top);

    var pr = ability.targetMemberId && masterProgress[ability.targetMemberId];
    if (pr && pr.treeId === ability.id) {
      var prc = document.createElement('div'); prc.className = 'panel-card';
      var taken = Object.keys(pr.ranks || {}).filter(function (k) { return pr.ranks[k] >= 1; }).length;
      prc.innerHTML = '<h4>Progressi di ' + esc(pr.charName || ability.targetName || 'giocatore') + '</h4>' +
        '<p class="muted">Punti rimasti: ' + (pr.points != null ? pr.points : '?') + ' · nodi presi: ' + taken + '</p>';
      body.appendChild(prc);
    }

    // barra strumenti di disegno
    var toolCard = document.createElement('div'); toolCard.className = 'panel-card';
    var tools = document.createElement('div'); tools.style.cssText = 'display:flex;gap:10px;flex-wrap:wrap;align-items:center;';
    var linkBtn = btn(linkMode ? '🔗 Collega: ON' : '🔗 Collega', linkMode ? 'active' : '', function () {
      linkMode = !linkMode; linkFrom = null; renderAbilityEditor();
    });
    tools.appendChild(linkBtn);
    var hint = document.createElement('span'); hint.className = 'muted'; hint.style.fontSize = '.82rem';
    hint.textContent = linkMode ? 'Tocca due bolle per collegarle (tocca una linea per cambiarne il significato).' : 'Tocca una bolla per modificarla. Usa ＋ per aggiungere bolle.';
    tools.appendChild(hint);
    toolCard.appendChild(tools);
    body.appendChild(toolCard);

    // la tela dell'albero (editabile)
    var treeCard = document.createElement('div'); treeCard.className = 'panel-card editor-tree-card';
    treeCard.appendChild(buildEditorCanvas(ability));
    body.appendChild(treeCard);
    scheduleEditorDraw();
  }

  function buildEditorCanvas(ability) {
    var canvas = document.createElement('div'); canvas.className = 'tree-canvas';
    canvas.setAttribute('data-tree', ability.id);
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'tree-links'); canvas.appendChild(svg);
    var tiersWrap = document.createElement('div'); tiersWrap.className = 'tree-tiers'; canvas.appendChild(tiersWrap);

    var byTier = {};
    (ability.nodes || []).forEach(function (n) { (byTier[n.tier] = byTier[n.tier] || []).push(n); });
    var maxTier = 0;
    Object.keys(byTier).forEach(function (t) { maxTier = Math.max(maxTier, Number(t)); });

    for (var t = 0; t <= maxTier; t++) {
      (function (tier) {
        var row = document.createElement('div'); row.className = 'tree-tier';
        (byTier[tier] || []).forEach(function (node) { row.appendChild(editorOrb(ability, node)); });
        if (tier >= 1) row.appendChild(addChip(function () { addNodeToTier(ability, tier); }, '＋'));
        tiersWrap.appendChild(row);
      })(t);
    }
    // riga "nuovo livello" sotto: creare qui sblocca la profondità successiva
    var nextRow = document.createElement('div'); nextRow.className = 'tree-tier next-level';
    nextRow.appendChild(addChip(function () { addNodeToTier(ability, maxTier + 1); }, '＋ livello ' + (maxTier + 1)));
    tiersWrap.appendChild(nextRow);

    return canvas;
  }

  // disegna i collegamenti dell'editor quando la tela è misurabile (riprova su rAF)
  function scheduleEditorDraw() {
    var tries = 0;
    (function attempt() {
      var cv = $('#ability-editor-body .tree-canvas');
      if (cv && cv.getBoundingClientRect().width > 0) { redrawEditorLinks(); return; }
      if (tries++ < 40) requestAnimationFrame(attempt);
    })();
  }

  function addChip(onClick, label) {
    var b = document.createElement('button'); b.className = 'add-chip'; b.textContent = label || '＋';
    b.addEventListener('click', function (e) { e.stopPropagation(); onClick(); });
    return b;
  }

  function editorOrb(ability, node) {
    var el = document.createElement('button');
    el.className = 'ability-node editor-node' + (linkFrom === node.id ? ' linking' : '');
    el.setAttribute('data-node', node.id);
    var rankInfo = node.repeatable ? ('×' + (node.maxRank == null ? '∞' : node.maxRank)) : '';
    el.innerHTML =
      '<span class="nd-orb"><span class="nd-ico">✦</span></span>' +
      '<span class="nd-name">' + esc(node.name || 'Nodo') + '</span>' +
      '<span class="nd-cost">' + node.cost + ' pt' + (rankInfo ? (' · ' + rankInfo) : '') + '</span>';
    el.addEventListener('click', function () { onEditorNodeClick(ability, node); });
    return el;
  }

  function onEditorNodeClick(ability, node) {
    if (linkMode) {
      if (!linkFrom) { linkFrom = node.id; renderAbilityEditor(); toast('Ora tocca la bolla da collegare'); return; }
      if (linkFrom === node.id) { linkFrom = null; renderAbilityEditor(); return; }
      createLink(ability, linkFrom, node.id); linkFrom = null; renderAbilityEditor();
    } else {
      editNodeDialog(ability, node);
    }
  }

  function createLink(ability, aId, bId) {
    var na = ability.nodes.filter(function (x) { return x.id === aId; })[0];
    var nb = ability.nodes.filter(function (x) { return x.id === bId; })[0];
    if (!na || !nb) return;
    var from = aId, to = bId;
    if (na.tier > nb.tier) { from = bId; to = aId; } // la radice/sopra è il prerequisito
    if (from === to) return;
    if ((ability.links || []).some(function (l) { return l.from === from && l.to === to; })) { toast('Collegamento già presente'); return; }
    ability.links.push(Store.normalizeLink({ from: from, to: to, type: 'prereq' }));
    persist(); syncAbility(ability);
    toast('Collegamento creato');
  }

  // costruisce la copia da inviare (con i collegamenti) e la sincronizza live al giocatore
  function abilityForSend(ability) {
    return Store.normalizeAbility({ id: ability.id, name: ability.name, desc: ability.desc, nodes: ability.nodes, links: ability.links });
  }
  function syncAbility(ability) {
    if (ability && ability.targetMemberId && typeof Net !== 'undefined' && Net.status().connected) {
      Net.pushTree(ability.targetMemberId, abilityForSend(ability));
    }
  }

  function linkDialog(ability, link) {
    var fromN = ability.nodes.filter(function (x) { return x.id === link.from; })[0] || {};
    var toN = ability.nodes.filter(function (x) { return x.id === link.to; })[0] || {};
    var wrap = document.createElement('div'); wrap.style.cssText = 'display:flex;flex-direction:column;gap:12px;';
    wrap.innerHTML =
      '<p class="muted">Da <b>' + esc(fromN.name || '?') + '</b> a <b>' + esc(toN.name || '?') + '</b></p>' +
      '<label class="chk"><input type="radio" name="lt" value="prereq" /> Prerequisito: serve aver preso la bolla precedente</label>' +
      '<label class="chk"><input type="radio" name="lt" value="points" /> Soglia: servono <b>punti spesi</b> nell’albero</label>' +
      '<div class="field" id="lt-valwrap"><label>Punti spesi richiesti</label><input id="lt-val" type="number" inputmode="numeric" min="1" /></div>';
    wrap.querySelector('input[value="' + (link.type === 'points' ? 'points' : 'prereq') + '"]').checked = true;
    var valWrap = wrap.querySelector('#lt-valwrap'); var valInput = wrap.querySelector('#lt-val');
    valInput.value = link.value || 1;
    function syncVal() { valWrap.style.display = (wrap.querySelector('input[name="lt"]:checked').value === 'points') ? '' : 'none'; }
    Array.prototype.forEach.call(wrap.querySelectorAll('input[name="lt"]'), function (r) { r.addEventListener('change', syncVal); });
    syncVal();
    function save() {
      var type = wrap.querySelector('input[name="lt"]:checked').value;
      link.type = type;
      link.value = (type === 'points') ? Math.max(1, parseInt(valInput.value, 10) || 1) : 0;
      persist(); syncAbility(ability); closeModal(); renderAbilityEditor();
    }
    openModal({
      title: 'Significato del collegamento', bodyNode: wrap,
      actions: [
        { label: 'Elimina', cls: 'danger', onClick: function () {
            ability.links = ability.links.filter(function (l) { return l.id !== link.id; }); persist(); syncAbility(ability); closeModal(); renderAbilityEditor();
          } },
        { label: 'Annulla', onClick: closeModal },
        { label: 'Salva', cls: 'primary', onClick: save }
      ]
    });
  }

  function addNodeToTier(ability, tier) {
    var node = Store.normalizeNode({ name: 'Nuova passiva', tier: tier, cost: 1, unlocked: true });
    ability.nodes.push(node);
    // auto-collegamento "logico" al piano superiore più vicino che ha nodi
    if (tier >= 1) {
      var upper = null;
      for (var t = tier - 1; t >= 0 && !upper; t--) {
        var inT = ability.nodes.filter(function (n) { return n.tier === t; });
        if (inT.length) upper = inT[inT.length - 1];
      }
      if (upper) ability.links.push(Store.normalizeLink({ from: upper.id, to: node.id, type: 'prereq' }));
    }
    persist(); renderAbilityEditor(); syncAbility(ability);
    editNodeDialog(ability, node); // apri subito per configurarla
  }

  function sendTreeToTarget(ability) {
    if (!ability.targetMemberId) { toast('Scegli un destinatario', 'err'); return; }
    if (typeof Net === 'undefined' || !Net.status().connected) { toast('Avvia prima la sessione', 'err'); return; }
    var ok = Net.pushTree(ability.targetMemberId, abilityForSend(ability));
    toast(ok ? ('Abilità inviata a ' + (ability.targetName || 'giocatore')) : 'Giocatore non collegato', ok ? 'ok' : 'err');
  }
  function grantPointsDialog(memberId) {
    if (!memberId) { toast('Scegli prima un destinatario', 'err'); return; }
    if (typeof Net === 'undefined' || !Net.status().connected) { toast('Avvia prima la sessione', 'err'); return; }
    singleFieldDialog('Concedi punti abilità', 'Quanti punti', '', 'Es. 3', function (v) {
      var n = parseInt(v, 10); if (isNaN(n) || n === 0) return;
      var ok = Net.grantPoints(memberId, n);
      toast(ok ? ('Concessi ' + n + ' punti') : 'Giocatore non collegato', ok ? 'ok' : 'err');
    });
  }

  // Master → giocatore: comporre e inviare un pezzo di equipaggiamento
  function sendEquipDialog(memberId) {
    if (!memberId) { toast('Giocatore non valido', 'err'); return; }
    if (typeof Net === 'undefined' || !Net.status().connected) { toast('Avvia prima la sessione', 'err'); return; }
    var wrap = document.createElement('div'); wrap.style.cssText = 'display:flex;flex-direction:column;gap:12px;';
    wrap.innerHTML =
      '<div class="field"><label>Tipo di oggetto</label><select id="se-kind" class="eq-select">' +
        '<option value="weapon">Arma</option><option value="armor">Armatura</option><option value="elmo">Elmo</option><option value="accessory">Accessorio</option></select></div>' +
      '<div class="field" id="se-tipo-wrap"><label>Tipo arma</label><select id="se-tipo" class="eq-select">' + weaponOptions('') + '</select></div>' +
      '<div class="field" id="se-classe-wrap" style="display:none"><label>Classe armatura</label><select id="se-classe" class="eq-select"><option value="">— classe —</option>' + Store.ARMOR_CLASSES.map(function (k) { return '<option>' + esc(k) + '</option>'; }).join('') + '</select></div>' +
      '<div class="field" id="se-slot-wrap" style="display:none"><label>Slot accessorio</label><select id="se-slot" class="eq-select"><option value="">primo libero</option><option value="ring1">Anello 1</option><option value="ring2">Anello 2</option><option value="collana">Collana</option><option value="extra">Extra</option></select></div>' +
      '<div class="field"><label>Nome</label><input id="se-name" maxlength="40" /></div>' +
      '<div class="field"><label>Note</label><textarea id="se-desc" rows="3" maxlength="500"></textarea></div>';
    var kind = wrap.querySelector('#se-kind');
    function sync() {
      wrap.querySelector('#se-tipo-wrap').style.display = kind.value === 'weapon' ? '' : 'none';
      wrap.querySelector('#se-classe-wrap').style.display = kind.value === 'armor' ? '' : 'none';
      wrap.querySelector('#se-slot-wrap').style.display = kind.value === 'accessory' ? '' : 'none';
    }
    kind.addEventListener('change', sync); sync();
    function send() {
      var k = kind.value;
      var item = { kind: k, name: wrap.querySelector('#se-name').value.trim(), desc: wrap.querySelector('#se-desc').value.trim() };
      if (k === 'weapon') item.tipo = wrap.querySelector('#se-tipo').value;
      if (k === 'armor') item.classe = wrap.querySelector('#se-classe').value;
      if (k === 'accessory') item.slot = wrap.querySelector('#se-slot').value;
      if (!item.name && !item.tipo && !item.classe) { toast('Indica almeno un nome o un tipo', 'err'); return; }
      var ok = Net.pushEquip(memberId, item);
      toast(ok ? 'Equipaggiamento inviato' : 'Giocatore non collegato', ok ? 'ok' : 'err');
      closeModal();
    }
    openModal({ title: 'Invia equipaggiamento', bodyNode: wrap, focus: '#se-name',
      actions: [{ label: 'Annulla', onClick: closeModal }, { label: 'Invia', cls: 'primary', onClick: send }] });
  }

  function editNodeDialog(ability, node) {
    var wrap = document.createElement('div'); wrap.style.cssText = 'display:flex;flex-direction:column;gap:12px;';
    wrap.innerHTML =
      '<div class="field"><label>Nome</label><input id="nd-name" maxlength="40" /></div>' +
      '<div class="field"><label>Descrizione</label><textarea id="nd-desc" rows="3" maxlength="500"></textarea></div>' +
      '<div class="field"><label>Costo punti</label><input id="nd-cost" type="number" inputmode="numeric" min="0" /></div>' +
      '<label class="chk"><input type="checkbox" id="nd-rep" /> Ripetibile (più ranghi)</label>' +
      '<div class="field" id="nd-maxwrap"><label>Rango massimo (vuoto = infinito)</label><input id="nd-max" type="number" inputmode="numeric" min="1" /></div>';
    var nm = wrap.querySelector('#nd-name'), ds = wrap.querySelector('#nd-desc'),
        co = wrap.querySelector('#nd-cost'), rp = wrap.querySelector('#nd-rep'),
        mx = wrap.querySelector('#nd-max'), mw = wrap.querySelector('#nd-maxwrap');
    nm.value = node.name || '';
    ds.value = node.desc || '';
    co.value = node.cost;
    rp.checked = node.repeatable;
    mx.value = (node.maxRank != null) ? node.maxRank : '';
    function syncMax() { mw.style.display = rp.checked ? '' : 'none'; }
    rp.addEventListener('change', syncMax); syncMax();
    function save() {
      var name = nm.value.trim(); if (!name) { nm.focus(); return; }
      node.name = name;
      node.desc = ds.value.trim();
      node.cost = Math.max(0, parseInt(co.value, 10) || 0);
      node.repeatable = rp.checked;
      node.maxRank = rp.checked ? (mx.value === '' ? null : Math.max(1, parseInt(mx.value, 10) || 1)) : 1;
      node.unlocked = true;
      persist(); syncAbility(ability); closeModal(); renderAbilityEditor();
    }
    function del() {
      ability.nodes = ability.nodes.filter(function (x) { return x.id !== node.id; });
      ability.links = (ability.links || []).filter(function (l) { return l.from !== node.id && l.to !== node.id; });
      persist(); syncAbility(ability); closeModal(); renderAbilityEditor();
    }
    openModal({
      title: 'Modifica bolla', bodyNode: wrap, focus: '#nd-name',
      actions: [
        { label: 'Elimina', cls: 'danger', onClick: del },
        { label: 'Annulla', onClick: closeModal },
        { label: 'Salva', cls: 'primary', onClick: save }
      ]
    });
  }

  /* ---- Vista MESSAGGI (chat) ---- */
  function renderMessages() {
    var log = $('#chat-log');
    if (!log) return;
    log.innerHTML = '';
    if (chatMessages.length === 0) {
      var e = document.createElement('div'); e.className = 'chat-empty';
      e.innerHTML = Net.status().connected
        ? 'Nessun messaggio. Scrivi qualcosa per iniziare.'
        : 'Non sei collegato a una sessione.<br>Apri <b>Sessione</b> dal menu ☰ per ' + (appRole === 'master' ? 'avviarne una.' : 'entrare con un codice.');
      log.appendChild(e);
    } else {
      chatMessages.forEach(appendChatNode);
    }
    rebuildRecipients();
    updateComposerState();
    scrollChatBottom();
  }

  function appendChatNode(msg) {
    var log = $('#chat-log');
    var empty = log.querySelector('.chat-empty'); if (empty) empty.remove();
    if (msg.system) {
      var sn = document.createElement('div'); sn.className = 'msg system';
      sn.innerHTML = '<div class="bubble">' + esc(msg.text) + '</div>';
      log.appendChild(sn); return;
    }
    var myId = Net.status().myId;
    var mine = msg.from === myId;
    var node = document.createElement('div');
    node.className = 'msg ' + (mine ? 'mine' : 'theirs');
    var priv = msg.to && msg.to !== 'all';
    var who = (mine ? 'Tu' : esc(msg.name || 'Anonimo'));
    if (priv) who += mine ? (' <span class="priv">→ ' + esc(recipientNames(msg.to)) + '</span>') : ' <span class="priv">· privato</span>';
    var html = '<div class="who">' + who + '</div><div class="bubble">';
    if (msg.text) html += esc(msg.text);
    if (msg.image) html += '<img src="' + msg.image + '" alt="immagine" />';
    html += '</div>';
    node.innerHTML = html;
    var img = node.querySelector('img');
    if (img) img.addEventListener('click', function () { showSpotlight(msg.image, '', false); });
    log.appendChild(node);
  }

  function scrollChatBottom() { var log = $('#chat-log'); if (log) log.scrollTop = log.scrollHeight; }

  function rebuildRecipients() {
    var btn = $('#chat-to'); if (!btn) return;
    var myId = Net.status().myId;
    // tieni solo i destinatari ancora presenti
    if (Array.isArray(currentTo)) {
      currentTo = currentTo.filter(function (id) {
        return (netMembers || []).some(function (m) { return m.id === id && m.id !== myId; });
      });
      if (currentTo.length === 0) currentTo = 'all';
    }
    btn.textContent = (currentTo === 'all') ? 'Tutti' : recipientNames(currentTo);
  }

  function openRecipientsDialog() {
    if (!Net.status().connected) { toast('Non sei collegato a una sessione', 'err'); return; }
    var myId = Net.status().myId;
    var others = (netMembers || []).filter(function (m) { return m.id !== myId; });
    var wrap = document.createElement('div'); wrap.style.cssText = 'display:flex;flex-direction:column;gap:8px;';
    var allLab = document.createElement('label'); allLab.className = 'chk';
    allLab.innerHTML = '<input type="checkbox" id="rc-all" /> <b>Tutti</b>';
    wrap.appendChild(allLab);
    if (others.length) { var sep = document.createElement('div'); sep.className = 'drawer-sep'; wrap.appendChild(sep); }
    others.forEach(function (m) {
      var lab = document.createElement('label'); lab.className = 'chk';
      var ck = document.createElement('input'); ck.type = 'checkbox'; ck.value = m.id; ck.className = 'rc-m';
      if (Array.isArray(currentTo) && currentTo.indexOf(m.id) >= 0) ck.checked = true;
      lab.appendChild(ck);
      lab.appendChild(document.createTextNode(' ' + (m.charName ? (m.charName + ' (' + m.name + ')') : m.name) + (m.role === 'master' ? ' — Master' : '')));
      wrap.appendChild(lab);
    });
    var allCk = wrap.querySelector('#rc-all');
    if (currentTo === 'all') allCk.checked = true;
    allCk.addEventListener('change', function () { if (this.checked) wrap.querySelectorAll('.rc-m').forEach(function (c) { c.checked = false; }); });
    wrap.querySelectorAll('.rc-m').forEach(function (c) { c.addEventListener('change', function () { if (this.checked) allCk.checked = false; }); });
    function save() {
      if (allCk.checked) { currentTo = 'all'; }
      else {
        var ids = Array.prototype.slice.call(wrap.querySelectorAll('.rc-m:checked')).map(function (c) { return c.value; });
        currentTo = ids.length ? ids : 'all';
      }
      rebuildRecipients(); closeModal();
    }
    openModal({ title: 'Invia a…', bodyNode: wrap, actions: [{ label: 'Annulla', onClick: closeModal }, { label: 'Conferma', cls: 'primary', onClick: save }] });
  }

  function updateComposerState() {
    var on = Net.status().connected;
    ['#chat-text', '#chat-send-btn', '#chat-attach-btn', '#chat-to'].forEach(function (s) {
      var el = $(s); if (el) el.disabled = !on;
    });
    var ta = $('#chat-text');
    if (ta) ta.placeholder = on ? 'Scrivi un messaggio...' : 'Collegati a una sessione per scrivere';
  }

  function sendCurrentMessage() {
    var ta = $('#chat-text');
    var text = (ta.value || '').trim();
    if (!text && !pendingAttach) return;
    if (!Net.status().connected) { toast('Non sei collegato a una sessione', 'err'); return; }
    if (Net.sendChat(text, pendingAttach, currentTo)) {
      ta.value = ''; clearAttach(); autoGrow(ta);
    }
  }
  function clearAttach() { pendingAttach = null; var p = $('#chat-attach-preview'); if (p) p.hidden = true; var i = $('#chat-attach-img'); if (i) i.src = ''; }
  function autoGrow(ta) { ta.style.height = 'auto'; ta.style.height = Math.min(120, ta.scrollHeight) + 'px'; }

  /* ---- Spotlight (immagine a schermo intero) ---- */
  function showSpotlight(image, caption, shared) {
    if (!image) return;
    spotlightShared = !!shared;
    $('#spotlight-img').src = image;
    var cap = $('#spotlight-cap');
    cap.textContent = caption || '';
    cap.style.display = caption ? '' : 'none';
    $('#spotlight').hidden = false;
  }
  function hideSpotlight() {
    $('#spotlight').hidden = true;
    $('#spotlight-img').src = '';
    spotlightShared = false;
  }

  /* ---- Master: scegli e proietta un'immagine a tutti ---- */
  var broadcastInput = document.createElement('input');
  broadcastInput.type = 'file'; broadcastInput.accept = 'image/*'; broadcastInput.hidden = true;
  document.body.appendChild(broadcastInput);
  broadcastInput.addEventListener('change', function (e) {
    var file = e.target.files[0]; e.target.value = '';
    if (!file) return;
    toast('Invio immagine in corso…');
    processImage(file, 1280, 0.8).then(function (dataUrl) { Net.broadcastImage(dataUrl, ''); })
      .catch(function () { toast('Immagine non valida', 'err'); });
  });
  function pickBroadcastImage() {
    if (appRole !== 'master') return;
    if (!Net.status().connected) { toast('Avvia prima la sessione', 'err'); navTo('session'); return; }
    broadcastInput.click();
  }

  /* ---- wiring eventi DOM (sessione/messaggi/spotlight/drawer) ---- */
  ['#player-menu-btn', '#master-menu-btn', '#session-menu-btn', '#messages-menu-btn', '#abilities-menu-btn', '#fight-menu-btn'].forEach(function (s) {
    var el = $(s); if (el) el.addEventListener('click', openAppDrawer);
  });
  // invito al combattimento
  (function () {
    var go = $('#fi-go'), no = $('#fi-no');
    if (go) go.addEventListener('click', function () { $('#fight-invite').hidden = true; fight.ongoing = true; navTo('fight'); });
    if (no) no.addEventListener('click', function () { $('#fight-invite').hidden = true; });
  })();
  $('#app-drawer-overlay').addEventListener('click', closeAppDrawer);
  $('#app-drawer-close').addEventListener('click', closeAppDrawer);

  $('#chat-send-btn').addEventListener('click', sendCurrentMessage);
  $('#chat-text').addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendCurrentMessage(); }
  });
  $('#chat-text').addEventListener('input', function () { autoGrow(this); });
  $('#chat-to').addEventListener('click', openRecipientsDialog);
  $('#announce-close').addEventListener('click', closeAnnounce);
  $('#announce').addEventListener('click', function (e) { if (e.target === this) closeAnnounce(); });
  $('#chat-attach-btn').addEventListener('click', function () { $('#chat-file').click(); });
  $('#chat-file').addEventListener('change', function (e) {
    var file = e.target.files[0]; e.target.value = '';
    if (!file) return;
    processImage(file, 1280, 0.8).then(function (dataUrl) {
      pendingAttach = dataUrl;
      $('#chat-attach-img').src = dataUrl;
      $('#chat-attach-preview').hidden = false;
    }).catch(function () { toast('Immagine non valida', 'err'); });
  });
  $('#chat-attach-remove').addEventListener('click', clearAttach);

  // Chiusura spotlight richiesta dall'utente: chiude SEMPRE in locale,
  // e se è il master a chiudere un'immagine condivisa la fa sparire a tutti.
  function closeSpotlightByUser() {
    if (spotlightShared && appRole === 'master' && typeof Net !== 'undefined') {
      try { Net.closeImage(); } catch (e) {}
    }
    hideSpotlight();
  }
  $('#spotlight-close').addEventListener('click', function (e) { e.stopPropagation(); closeSpotlightByUser(); });
  // tocca lo sfondo scuro (fuori dall'immagine) per chiudere
  $('#spotlight').addEventListener('click', function (e) {
    if (e.target === this) closeSpotlightByUser();
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
  setupNet();
  hideSpotlight();           // mai mostrare lo spotlight all'avvio
  showView('home');
  currentView = 'home';
})();
