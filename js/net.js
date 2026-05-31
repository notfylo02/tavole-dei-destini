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
      upsertMember({ id: conn.peer, name: (d.name || 'Giocatore'), role: 'player' });
      broadcastRoster();
      emit('sys', { text: (d.name || 'Un giocatore') + ' si è unito alla sessione.' });
    } else if (d.t === 'chat') {
      routeChat(conn.peer, d);
    }
  }

  // Smistamento chat dal punto di vista del master (hub).
  function routeChat(originId, d) {
    var msg = {
      t: 'chat', id: d.id || uid(), from: originId, name: d.name,
      text: d.text, image: d.image, ts: d.ts || Date.now(), to: d.to || 'all'
    };
    if (msg.to === 'all') {
      emit('chat', msg); // il master lo vede
      Object.keys(conns).forEach(function (id) { if (id !== originId) safeSend(conns[id], msg); });
    } else if (msg.to === peer.id) {
      emit('chat', msg); // messaggio privato per il master
    } else if (conns[msg.to]) {
      safeSend(conns[msg.to], msg); // privato verso un altro player (instradato dal master)
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
      else if (conns[to]) { safeSend(conns[to], msg); }
    } else {
      safeSend(conns.master, msg); // il master fa da hub e instrada
    }
    return true;
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
    leave: leave, status: status, available: available, myId: myId
  };
  global.Net = Net;
})(window);
