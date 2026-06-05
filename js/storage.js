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
  var POINTS_PER_LEVEL = 3; // punti guadagnati per ogni livello dopo il 1°
  var STAT_MIN = -5;        // valore minimo per statistica

  function pointsBudget(level) {
    var lv = Math.max(1, parseInt(level, 10) || 1);
    return BASE_POINTS + POINTS_PER_LEVEL * (lv - 1);
  }

  function emptySheet() {
    return {
      level: 1,                     // livello del personaggio
      statistiche: makeCoreStats(), // { id, abbr, name, value, core }
      abilita: [],                  // alberi abilità: [ tree ] (vedi normalizeTree)
      abilityPoints: 0,             // punti abilità non spesi (concessi dal Master)
      abilityRanks: {},             // progressi: { [treeId]: { [nodeId]: rank } }
      armamenti: normalizeEquip({}),// equipaggiamento: { weapons, armor, elmo, accessori }
      zaino: [],                    // { id, name, qty, desc }
      combattimento: ''             // testo libero (note di combattimento)
    };
  }

  /* ---------- Equipaggiamento (Armamenti) ---------- */
  // Cataloghi canonici (come le 9 stat: definiti dal gioco)
  var WEAPON_CAT = {
    fisiche: ['Tirapugni', 'Guanti corazzati', 'Pugnale', 'Falcetto', 'Spada', 'Balestrino', 'Balestra', 'Stocco', 'Frusta', 'Archibugio', 'Scimitarra', 'Arco lungo', 'Arco', 'Pistola', 'Chackram', 'Ascia', 'Ascia a due mani', 'Spadone', 'Mazza', 'Martello da guerra', 'Alabarda', 'Cannone'],
    magiche: ['Staffa', 'Bacchetta', 'Falce', 'Libro', 'Rituale', 'Sfera di cristallo', 'Teschio Arcano', 'Incensiere', 'Famigli', 'Bastone runico']
  };
  var ARMOR_CLASSES = ['Leggera', 'Media', 'Pesante'];

  function slotItem(o) {
    if (!o || typeof o !== 'object') return null;
    if (!o.name && !o.desc) return null;
    return { name: typeof o.name === 'string' ? o.name : '', desc: typeof o.desc === 'string' ? o.desc : '' };
  }
  function normalizeEquip(e) {
    // migrazione: vecchio armamenti era un array piatto [{name,desc}] -> diventano armi
    var weaponsFromArray = null;
    if (Array.isArray(e)) { weaponsFromArray = e; e = {}; }
    e = (e && typeof e === 'object') ? e : {};
    var weapons = Array.isArray(e.weapons) ? e.weapons : (weaponsFromArray || []);
    var acc = (e.accessori && typeof e.accessori === 'object') ? e.accessori : {};
    return {
      weapons: weapons.filter(function (w) { return w && (w.name || w.desc || w.tipo); }).map(function (w) {
        return { id: w.id || genId(), tipo: typeof w.tipo === 'string' ? w.tipo : '', name: typeof w.name === 'string' ? w.name : '', desc: typeof w.desc === 'string' ? w.desc : '' };
      }),
      armor: (e.armor && typeof e.armor === 'object' && (e.armor.name || e.armor.desc || e.armor.classe))
        ? { classe: typeof e.armor.classe === 'string' ? e.armor.classe : '', name: e.armor.name || '', desc: e.armor.desc || '' } : null,
      elmo: slotItem(e.elmo),
      accessori: { ring1: slotItem(acc.ring1), ring2: slotItem(acc.ring2), collana: slotItem(acc.collana), extra: slotItem(acc.extra) }
    };
  }

  /* ---------- Abilità ad albero ---------- */
  // Normalizza un nodo dell'albero abilità.
  function normalizeNode(n) {
    n = n || {};
    var maxRank;
    if (n.repeatable) {
      maxRank = (n.maxRank == null) ? null : Math.max(1, parseInt(n.maxRank, 10) || 1);
    } else {
      maxRank = 1;
    }
    return {
      id: n.id || genId(),
      name: typeof n.name === 'string' ? n.name : '',
      desc: typeof n.desc === 'string' ? n.desc : '',
      tier: Math.max(0, parseInt(n.tier, 10) || 0),
      cost: Math.max(0, parseInt(n.cost, 10) || 0),
      repeatable: !!n.repeatable,
      maxRank: maxRank,
      unlocked: n.unlocked !== false // le passive sono sempre disponibili di default
    };
  }
  // Normalizza un collegamento (linea) tra due nodi.
  // type: 'prereq' = serve aver preso il nodo "from"; 'points' = servono "value" punti spesi nell'albero.
  function normalizeLink(l) {
    l = l || {};
    return {
      id: l.id || genId(),
      from: l.from, to: l.to,
      type: (l.type === 'points') ? 'points' : 'prereq',
      value: Math.max(0, parseInt(l.value, 10) || 0)
    };
  }
  // Normalizza un albero abilità (+ migrazione vecchi node.parents -> links).
  function normalizeTree(t) {
    t = t || {};
    var rawNodes = Array.isArray(t.nodes) ? t.nodes : [];
    var nodes = rawNodes.map(normalizeNode);
    var ids = {}; nodes.forEach(function (n) { ids[n.id] = true; });
    var links;
    if (Array.isArray(t.links)) {
      links = t.links.map(normalizeLink);
    } else {
      // migrazione: ogni parent diventa un link 'prereq'
      links = [];
      rawNodes.forEach(function (rn) {
        if (rn && rn.id && Array.isArray(rn.parents)) {
          rn.parents.forEach(function (pid) { links.push(normalizeLink({ from: pid, to: rn.id, type: 'prereq' })); });
        }
      });
    }
    links = links.filter(function (l) { return ids[l.from] && ids[l.to] && l.from !== l.to; });
    return {
      id: t.id || genId(),
      name: typeof t.name === 'string' ? t.name : 'Abilità',
      desc: typeof t.desc === 'string' ? t.desc : '',
      nodes: nodes,
      links: links
    };
  }
  // Un'abilità = un albero {id,name,desc,nodes}. Alias semantico di normalizeTree.
  function normalizeAbility(a) {
    a = a || {};
    var na = normalizeTree(a);
    na.targetMemberId = a.targetMemberId || null; // ultimo destinatario (comodità Master)
    na.targetName = a.targetName || '';
    return na;
  }
  // Una classe = cartella organizzativa del Master con dentro più abilità.
  function normalizeClass(c) {
    c = c || {};
    return {
      id: c.id || genId(),
      name: typeof c.name === 'string' ? c.name : 'Classe',
      desc: typeof c.desc === 'string' ? c.desc : '',
      abilities: Array.isArray(c.abilities) ? c.abilities.map(normalizeAbility) : []
    };
  }

  // Converte eventuali vecchie voci piatte {id,name,desc} in un albero unico.
  function migrateAbilita(arr) {
    if (!Array.isArray(arr) || arr.length === 0) return [];
    // già nel nuovo formato? (un elemento con array nodes => è un albero)
    var looksLikeTrees = arr.every(function (x) { return x && Array.isArray(x.nodes); });
    if (looksLikeTrees) return arr.map(normalizeTree);
    // formato piatto legacy => albero unico, nodi tier 0, sbloccati, costo 0
    var nodes = arr.filter(function (x) { return x && (x.name || x.desc); }).map(function (x) {
      return normalizeNode({ id: x.id, name: x.name, desc: x.desc, tier: 0, cost: 0, unlocked: true });
    });
    if (nodes.length === 0) return [];
    return [normalizeTree({ name: 'Abilità', nodes: nodes })];
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
      // Gerarchia: master.classes = [{ id, name, desc, abilities:[ability] }]
      if (Array.isArray(data.master.classes)) {
        data.master.classes = data.master.classes.map(normalizeClass);
      } else if (Array.isArray(data.master.trees) && data.master.trees.length) {
        // migrazione: i vecchi alberi diventano abilità in una classe "Generale"
        data.master.classes = [normalizeClass({ name: 'Generale', abilities: data.master.trees })];
      } else {
        data.master.classes = [];
      }
      delete data.master.trees;
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
    base.abilita = migrateAbilita(sheet.abilita);
    base.abilityPoints = Math.max(0, parseInt(sheet.abilityPoints, 10) || 0);
    base.abilityRanks = (sheet.abilityRanks && typeof sheet.abilityRanks === 'object') ? sheet.abilityRanks : {};
    base.armamenti = normalizeEquip(sheet.armamenti);
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
    normalizeTree: normalizeTree,
    normalizeAbility: normalizeAbility,
    normalizeClass: normalizeClass,
    normalizeNode: normalizeNode,
    normalizeLink: normalizeLink,
    normalizeEquip: normalizeEquip,
    WEAPON_CAT: WEAPON_CAT,
    ARMOR_CLASSES: ARMOR_CLASSES,
    genId: genId,
    load: load,
    save: save,
    exportAll: exportAll,
    exportCharacter: exportCharacter,
    stripChar: stripChar,
    parseFile: parseFile
  };
})(window);
