/* ============================================================
   Storage — salvataggio locale + export/import
   Modello dati generico: le REGOLE le definisce il Master,
   quindi le sezioni della scheda sono liste/coppie flessibili.
   ============================================================ */
(function (global) {
  'use strict';

  var KEY = 'tavole-dei-destini';
  var VERSION = 1;

  function emptyState() {
    return { version: VERSION, characters: [], folders: [], master: {} };
  }

  // Statistiche standard del gioco (definite dal Master)
  var STAT_DEFS = [
    { abbr: 'FOR', name: 'Forza' },
    { abbr: 'DES', name: 'Destrezza' },
    { abbr: 'COS', name: 'Costituzione' },
    { abbr: 'INT', name: 'Intelligenza' },
    { abbr: 'SAG', name: 'Saggezza' },
    { abbr: 'OCC', name: 'Occulto' },
    { abbr: 'TEC', name: 'Tecnica' },
    { abbr: 'CAR', name: 'Carisma' },
    { abbr: 'TAT', name: 'Tattica' }
  ];

  function makeCoreStats() {
    return STAT_DEFS.map(function (d) {
      return { id: 'core-' + d.abbr, abbr: d.abbr, name: d.name, value: '', core: true };
    });
  }

  // Garantisce la presenza e l'ordine delle 9 statistiche standard,
  // preservando i valori già inseriti e le statistiche personalizzate.
  function ensureCoreStats(sheet) {
    var stats = Array.isArray(sheet.statistiche) ? sheet.statistiche : [];
    var byAbbr = {};
    stats.forEach(function (s) { if (s && s.core && s.abbr) byAbbr[s.abbr] = s; });
    var ordered = STAT_DEFS.map(function (d) {
      var ex = byAbbr[d.abbr];
      if (ex) { ex.name = d.name; ex.abbr = d.abbr; return ex; }
      return { id: 'core-' + d.abbr, abbr: d.abbr, name: d.name, value: '', core: true };
    });
    var customs = stats.filter(function (s) { return s && !s.core; });
    sheet.statistiche = ordered.concat(customs);
    return sheet;
  }

  // Sistema punti statistiche
  var BASE_POINTS = 10;     // punti iniziali (livello 1)
  var POINTS_PER_LEVEL = 4; // punti guadagnati per ogni livello dopo il 1°
  var STAT_MIN = -5;        // valore minimo per statistica

  function pointsBudget(level) {
    var lv = Math.max(1, parseInt(level, 10) || 1);
    return BASE_POINTS + POINTS_PER_LEVEL * (lv - 1);
  }

  function emptySheet() {
    return {
      level: 1,                     // livello del personaggio
      statistiche: makeCoreStats(), // { id, abbr, name, value, core }
      abilita: [],                  // { id, name, desc }
      armamenti: [],                // { id, name, desc }
      zaino: [],                    // { id, name, qty, desc }
      combattimento: ''             // testo libero (note di combattimento)
    };
  }

  function genId() {
    return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  }

  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return emptyState();
      var data = JSON.parse(raw);
      if (!data || typeof data !== 'object') return emptyState();
      data.version = data.version || VERSION;
      data.characters = Array.isArray(data.characters) ? data.characters : [];
      data.folders = Array.isArray(data.folders) ? data.folders : [];
      data.master = data.master || {};
      // normalizza schede mancanti
      data.characters.forEach(function (c) {
        c.sheet = mergeSheet(c.sheet);
      });
      return data;
    } catch (e) {
      console.error('Errore lettura salvataggio:', e);
      return emptyState();
    }
  }

  function mergeSheet(sheet) {
    var base = emptySheet();
    if (!sheet || typeof sheet !== 'object') return base;
    base.level = Math.max(1, parseInt(sheet.level, 10) || 1);
    base.statistiche = Array.isArray(sheet.statistiche) ? sheet.statistiche : [];
    base.abilita = Array.isArray(sheet.abilita) ? sheet.abilita : [];
    base.armamenti = Array.isArray(sheet.armamenti) ? sheet.armamenti : [];
    base.zaino = Array.isArray(sheet.zaino) ? sheet.zaino : [];
    base.combattimento = typeof sheet.combattimento === 'string' ? sheet.combattimento : '';
    ensureCoreStats(base);
    return base;
  }

  function save(state) {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
      return true;
    } catch (e) {
      console.error('Errore salvataggio:', e);
      return false;
    }
  }

  /* ---------- Download helper ---------- */
  function download(filename, obj) {
    var blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
  }

  function slug(s) {
    return (s || 'export').toString().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'export';
  }

  function exportAll(state) {
    download('tavole-dei-destini-backup.json', { kind: 'tdd-full', version: VERSION, data: state });
  }

  function exportCharacter(char) {
    download('pg-' + slug(char.nome + '-' + (char.cognome || '')) + '.json',
      { kind: 'tdd-character', version: VERSION, character: stripChar(char) });
  }

  // copia pulita senza folderId/posizione, mantenendo i dati di gioco
  function stripChar(char) {
    return {
      nome: char.nome, cognome: char.cognome, razza: char.razza,
      classe: char.classe, descrizione: char.descrizione,
      image: char.image || null,
      sheet: mergeSheet(char.sheet)
    };
  }

  function parseFile(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        try { resolve(JSON.parse(reader.result)); }
        catch (e) { reject(new Error('File non valido')); }
      };
      reader.onerror = function () { reject(new Error('Impossibile leggere il file')); };
      reader.readAsText(file);
    });
  }

  global.Store = {
    KEY: KEY,
    VERSION: VERSION,
    emptyState: emptyState,
    emptySheet: emptySheet,
    mergeSheet: mergeSheet,
    STAT_DEFS: STAT_DEFS,
    BASE_POINTS: BASE_POINTS,
    POINTS_PER_LEVEL: POINTS_PER_LEVEL,
    STAT_MIN: STAT_MIN,
    pointsBudget: pointsBudget,
    genId: genId,
    load: load,
    save: save,
    exportAll: exportAll,
    exportCharacter: exportCharacter,
    stripChar: stripChar,
    parseFile: parseFile
  };
})(window);
