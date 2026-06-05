/* ============================================================
   Net — collegamento di sessione tra dispositivi (PeerJS / WebRTC)
   Topologia a stella: il MASTER è l'hub, i PLAYER si collegano a lui.
   Il master smista i messaggi (chat e immagini) ai destinatari giusti.
   I messaggi vivono solo durante la sessione (non salvati).
   ============================================================ */
(function (global) {
  'use strict';

  var PEER_PREFIX = 'tdd-';                       // prefisso per ridurre le collisioni sul broker pubblico
  var ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // niente caratteri ambigui (0/O, 1/I, ecc.)

  var peer = null;
  var role = null;          // 'master' | 'player'
  var myName = '';
  var myCode = null;        // codice stanza (solo master)
  var masterPeerId = null;  // id peer del master (lato player)
  var connected = false;
  var conns = {};           // id -> DataConnection (master: tutti i player; player: { master: conn })
  var roster = [];          // [{ id, name, role }]
  var handlers = {};

  function on(ev, fn) { (handlers[ev] = handlers[ev] || []).push(fn); return Net; }
  function emit(ev, data) {
    (handlers[ev] || []).forEach(function (f) { try { f(data); } catch (e) { console.error(e); } });
  }

  function genCode(n) {
    var s = ''; n = n || 6;
    for (var i = 0; i < n; i++) s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
    return s;
  }
  function uid() { return 'm-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7); }
  function available() { return typeof global.Peer === 'function'; }
  function myId() { return peer ? peer.id : 'me'; }

  function safeSend(conn, obj) { try { if (conn && conn.open) conn.send(obj); } catch (e) {} }

  function netErrMsg(err) {
    var t = err && err.type;
    if (t === 'peer-unavailable') return 'Codice non valido o Master non in linea.';
    if (t === 'network' || t === 'server-error' || t === 'socket-error') return 'Problema di rete: controlla la connessione internet.';
    if (t === 'browser-incompatible') return 'Questo browser non supporta il collegamento.';
    if (t === 'ssl-unavailable') return 'Connessione non sicura non disponibile.';
    return 'Errore di connessione' + (t ? ' (' + t + ')' : '') + '.';
  }

  /* ===================== MASTER ===================== */
  function host(name) {
    if (!available()) { emit('status', { state: 'error', message: 'Manca la connessione a internet (motore di rete non caricato).' }); return; }
    cleanup();
    role = 'master';
    myName = (name || 'Master').trim() || 'Master';
    attempt(0);

    function attempt(tries) {
      if (tries > 6) { emit('status', { state: 'error', message: 'Impossibile creare la sessione, riprova.' }); return; }
      myCode = genCode(6);
      emit('status', { state: 'connecting', role: 'master' });
      peer = new global.Peer(PEER_PREFIX + myCode, { debug: 1 });

      peer.on('open', function () {
        connected = true;
        roster = [{ id: peer.id, name: myName, role: 'master' }];
        emit('status', { state: 'hosting', code: myCode, role: 'master' });
        emit('roster', roster.slice());
      });
      peer.on('connection', function (conn) { setupMasterConn(conn); });
      peer.on('error', function (err) {
        if (err && err.type === 'unavailable-id') {
          try { peer.destroy(); } catch (e) {}
          attempt(tries + 1); // codice già in uso: riprovo con un altro
        } else {
          emit('status', { state: 'error', message: netErrMsg(err) });
        }
      });
      peer.on('disconnected', function () { try { peer.reconnect(); } catch (e) {} });
    }
  }

  function setupMasterConn(conn) {
    conn.on('open', function () { conns[conn.peer] = conn; });
    conn.on('data', function (d) { onMasterData(conn, d); });
    conn.on('close', function () { removeMember(conn.peer); });
    conn.on('error', function () {});
  }

  function onMasterData(conn, d) {
    if (!d || !d.t) return;
    if (d.t === 'hello') {
      conns[conn.peer] = conn;
      upsertMember({ id: conn.peer, name: (d.name || 'Giocatore'), role: 'player', charName: d.charName || '' });
      broadcastRoster();
      emit('sys', { text: (d.name || 'Un giocatore') + ' si è unito alla sessione.' });
    } else if (d.t === 'whoami') {
      var m = roster.filter(function (x) { return x.id === conn.peer; })[0];
      if (m) { m.charName = d.charName || ''; if (d.level != null) m.level = d.level; broadcastRoster(); }
    } else if (d.t === 'chat') {
      routeChat(conn.peer, d);
    } else if (d.t === 'tree-progress') {
      emit('tree-progress', { from: conn.peer, treeId: d.treeId, ranks: d.ranks || {}, points: d.points, charName: d.charName || '' });
    }
  }

  // Smistamento chat dal punto di vista del master (hub). "to" può essere 'all' o un array di id.
  function routeChat(originId, d) {
    var msg = {
      t: 'chat', id: d.id || uid(), from: originId, name: d.name,
      text: d.text, image: d.image, ts: d.ts || Date.now(), to: d.to || 'all'
    };
    if (msg.to === 'all') {
      emit('chat', msg); // il master lo vede
      Object.keys(conns).forEach(function (id) { if (id !== originId) safeSend(conns[id], msg); });
    } else {
      var targets = Array.isArray(msg.to) ? msg.to : [msg.to];
      if (targets.indexOf(peer.id) >= 0) emit('chat', msg); // il master è tra i destinatari
      targets.forEach(function (id) {
        if (id !== peer.id && id !== originId && conns[id]) safeSend(conns[id], msg);
      });
    }
  }

  /* ===================== PLAYER ===================== */
  function join(code, name) {
    if (!available()) { emit('status', { state: 'error', message: 'Manca la connessione a internet (motore di rete non caricato).' }); return; }
    cleanup();
    role = 'player';
    myName = (name || 'Giocatore').trim() || 'Giocatore';
    code = (code || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (code.length < 4) { emit('status', { state: 'error', message: 'Codice non valido.' }); return; }
    masterPeerId = PEER_PREFIX + code;
    emit('status', { state: 'connecting', role: 'player' });

    peer = new global.Peer({ debug: 1 });
    peer.on('open', function () {
      var conn = peer.connect(masterPeerId, { reliable: true });
      conns.master = conn;
      conn.on('open', function () {
        connected = true;
        emit('status', { state: 'connected', code: code, role: 'player' });
        safeSend(conn, { t: 'hello', name: myName, role: 'player' });
      });
      conn.on('data', function (d) { onPlayerData(d); });
      conn.on('close', function () {
        connected = false;
        emit('status', { state: 'closed', message: 'Sessione chiusa dal Master.' });
        emit('roster', []);
      });
      conn.on('error', function () {});
    });
    peer.on('error', function (err) { emit('status', { state: 'error', message: netErrMsg(err) }); });
    peer.on('disconnected', function () { try { peer.reconnect(); } catch (e) {} });
  }

  function onPlayerData(d) {
    if (!d || !d.t) return;
    if (d.t === 'roster') {
      roster = d.members || [];
      var m = roster.filter(function (x) { return x.role === 'master'; })[0];
      if (m) masterPeerId = m.id;
      emit('roster', roster.slice());
    } else if (d.t === 'chat') { emit('chat', d); }
    else if (d.t === 'image') { emit('image', d); }
    else if (d.t === 'image-close') { emit('image-close', {}); }
    else if (d.t === 'sys') { emit('sys', d); }
    else if (d.t === 'tree-push') { emit('tree-push', { tree: d.tree }); }
    else if (d.t === 'tree-unlock') { emit('tree-unlock', { treeId: d.treeId, nodeId: d.nodeId, unlocked: !!d.unlocked }); }
    else if (d.t === 'points-grant') { emit('points-grant', { amount: d.amount }); }
    else if (d.t === 'equip-push') { emit('equip-push', { item: d.item }); }
  }

  /* ===================== INVIO (condiviso) ===================== */
  // to: 'all' oppure l'id di un membro
  function sendChat(text, image, to) {
    if (!connected) return false;
    to = to || 'all';
    var msg = { t: 'chat', id: uid(), from: myId(), name: myName, text: text || '', image: image || null, ts: Date.now(), to: to };
    emit('chat', msg); // mostra subito a chi scrive
    if (role === 'master') {
      if (to === 'all') { Object.keys(conns).forEach(function (id) { safeSend(conns[id], msg); }); }
      else {
        var targets = Array.isArray(to) ? to : [to];
        targets.forEach(function (id) { if (conns[id]) safeSend(conns[id], msg); });
      }
    } else {
      safeSend(conns.master, msg); // il master fa da hub e instrada
    }
    return true;
  }

  /* ---- Abilità ad albero ---- */
  // Master → un giocatore: invia/aggiorna un albero abilità.
  function pushTree(memberId, tree) {
    if (role !== 'master') return false;
    if (conns[memberId]) { safeSend(conns[memberId], { t: 'tree-push', tree: tree }); return true; }
    return false;
  }
  // Master → un giocatore: sblocca/blocca un nodo.
  function unlockNode(memberId, treeId, nodeId, unlocked) {
    if (role !== 'master') return false;
    if (conns[memberId]) { safeSend(conns[memberId], { t: 'tree-unlock', treeId: treeId, nodeId: nodeId, unlocked: !!unlocked }); return true; }
    return false;
  }
  // Master → un giocatore: concede punti abilità.
  function grantPoints(memberId, amount) {
    if (role !== 'master') return false;
    if (conns[memberId]) { safeSend(conns[memberId], { t: 'points-grant', amount: amount }); return true; }
    return false;
  }
  // Master → un giocatore: invia un pezzo di equipaggiamento.
  function pushEquip(memberId, item) {
    if (role !== 'master') return false;
    if (conns[memberId]) { safeSend(conns[memberId], { t: 'equip-push', item: item }); return true; }
    return false;
  }
  // Player → master: comunica il personaggio attivo + livello (mostrati nella lista membri).
  function whoami(charName, level) {
    if (role !== 'player' || !connected) return;
    safeSend(conns.master, { t: 'whoami', charName: charName || '', level: (level == null ? null : level) });
  }
  // Player → master: invia i progressi su un albero.
  function sendProgress(treeId, ranks, points, charName) {
    if (role !== 'player' || !connected) return;
    safeSend(conns.master, { t: 'tree-progress', treeId: treeId, ranks: ranks || {}, points: points, charName: charName || '' });
  }

  // Solo master: proietta un'immagine sullo schermo di tutti.
  function broadcastImage(image, caption) {
    if (role !== 'master' || !connected) return;
    var msg = { t: 'image', id: uid(), image: image, caption: caption || '' };
    Object.keys(conns).forEach(function (id) { safeSend(conns[id], msg); });
    emit('image', msg); // anche il master la vede
  }
  function closeImage() {
    if (role !== 'master') return;
    Object.keys(conns).forEach(function (id) { safeSend(conns[id], { t: 'image-close' }); });
    emit('image-close', {});
  }

  /* ===================== roster / membri ===================== */
  function broadcastRoster() {
    var members = roster.slice();
    Object.keys(conns).forEach(function (id) { safeSend(conns[id], { t: 'roster', members: members }); });
    emit('roster', members);
  }
  function upsertMember(m) {
    var i = roster.map(function (x) { return x.id; }).indexOf(m.id);
    if (i >= 0) roster[i] = m; else roster.push(m);
  }
  function removeMember(id) {
    var gone = roster.filter(function (x) { return x.id === id; })[0];
    var before = roster.length;
    roster = roster.filter(function (x) { return x.id !== id; });
    delete conns[id];
    if (roster.length !== before) {
      broadcastRoster();
      if (gone) emit('sys', { text: (gone.name || 'Un giocatore') + ' ha lasciato la sessione.' });
    }
  }

  /* ===================== chiusura ===================== */
  function leave() { cleanup(); emit('status', { state: 'idle' }); emit('roster', []); }
  function cleanup() {
    try { Object.keys(conns).forEach(function (id) { try { conns[id].close(); } catch (e) {} }); } catch (e) {}
    conns = {}; roster = []; connected = false; masterPeerId = null; myCode = null; role = null;
    if (peer) { try { peer.destroy(); } catch (e) {} peer = null; }
  }

  function status() {
    var st = 'idle';
    if (connected && role === 'master') st = 'hosting';
    else if (connected && role === 'player') st = 'connected';
    return { state: st, role: role, code: myCode, connected: connected, members: roster.slice(), myId: myId() };
  }

  var Net = {
    on: on, host: host, join: join, sendChat: sendChat,
    broadcastImage: broadcastImage, closeImage: closeImage,
    pushTree: pushTree, unlockNode: unlockNode, grantPoints: grantPoints, pushEquip: pushEquip,
    whoami: whoami, sendProgress: sendProgress,
    leave: leave, status: status, available: available, myId: myId
  };
  global.Net = Net;
})(window);
