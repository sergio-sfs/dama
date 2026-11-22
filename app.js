(function () {
  'use strict';
  const VERSION = '1.0.0';
  const ACCESS_HASH = 'dfa83d369a43b3cdd08b4bd294500ab7e3a3d6487ea5d8d42ad67df54848b00a';
  const E = window.DamaEngine, NET = window.DamaNet;
  const $ = s => document.querySelector(s);
  const clone = o => JSON.parse(JSON.stringify(o));
  const LS = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { } }
  };
  const NAMES = ['Marco', 'Giulia', 'Enzo', 'Chiara', 'Luca', 'Sofia', 'Nino', 'Rita', 'Gigi', 'Anna', 'Piero', 'Marta', 'Aldo', 'Elena', 'Bruno', 'Laura', 'Carlo', 'Nora', 'Tino', 'Vera'];
  const THEMES = [['#f0d9b5', '#b58863', 'Legno'], ['#eeeed2', '#769656', 'Verde'], ['#dfe7ee', '#5b7fa6', 'Azzurro']];
  const LEVELS = [['Facile', { depth: 1, time: 200, noise: 260 }], ['Medio', { depth: 3, time: 600, noise: 40 }], ['Difficile', { depth: 6, time: 1200, noise: 0 }], ['Esperto', { depth: 10, time: 2500, noise: 0 }]];
  const SERIES = [['Partita secca', 1], ['Al meglio di 3', 2], ['Al meglio di 5', 3]];

  const cfg = Object.assign({ name: '', theme: 0, hl: true, net: 'auto', level: 1, color: 'w', series: 0 }, LS.get('dama_cfg', {}));
  cfg.rules = Object.assign({}, E.defaultRules, cfg.rules || {});
  const saveCfg = () => LS.set('dama_cfg', cfg);

  let G = null, tmr = null;
  const CH = { '0': '.', '1': 'w', '2': 'W', '-1': 'b', '-2': 'B' }, DC = { '.': 0, w: 1, W: 2, b: -1, B: -2 };
  const pack = st => Object.assign({}, st, { board: st.board.map(v => CH[v]).join('') });
  const unpack = s => Object.assign({}, s, { board: [...s.board].map(c => DC[c]) });
  const rid = () => Math.random().toString(36).slice(2, 8);
  const toast = (t, ms) => { const e = $('#toast'); e.textContent = t; e.classList.add('on'); clearTimeout(tmr); tmr = setTimeout(() => e.classList.remove('on'), ms || 2200); };
  const vib = () => { if (navigator.vibrate) navigator.vibrate(40); };
  const sha = async s => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map(b => b.toString(16).padStart(2, '0')).join('');
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

  // ---------- modal ----------
  function modal(title, html, btns, onOpen) {
    const m = $('#modal'), b = $('#mbox');
    b.innerHTML = (title ? '<h2>' + title + '</h2>' : '') + '<div class="mb">' + html + '</div><div class="mbtns"></div>';
    const bt = b.querySelector('.mbtns');
    (btns || []).forEach(x => {
      const e = document.createElement('button'); e.textContent = x.t; if (x.cls) e.className = x.cls;
      e.onclick = () => { if (!x.keep) closeModal(); if (x.cb) x.cb(); };
      bt.appendChild(e);
    });
    m.classList.remove('hid');
    if (onOpen) onOpen(b);
  }
  const closeModal = () => $('#modal').classList.add('hid');

  // ---------- state ----------
  function newState(rules, hostWhite, names, scores, need) {
    return { gid: rid(), seq: 0, board: E.initial(), turn: 1, last: [], noProg: 0, res: null, rules, hostWhite, names, scores, need, ply: 0 };
  }
  const colorFor = (role, st) => (role === 'host') === st.hostWhite ? 1 : -1;
  const oppName = () => G.mode === 'cpu' ? G.st.names[1] : (G.role === 'host' ? G.st.names[1] : G.st.names[0]) || 'Avversario';
  const myName = () => (G.role === 'host' ? G.st.names[0] : G.st.names[1]) || cfg.name || 'Tu';

  function save() {
    if (!G || !G.st) return;
    LS.set('dama_save', { mode: G.mode, role: G.role, room: G.room, lvl: G.lvl, st: pack(G.st) });
  }

  // ---------- screens ----------
  function show(id) { ['#home', '#game'].forEach(s => $(s).classList.toggle('hid', s !== id)); }
  function home() {
    if (G && G.net) { G.net.close(); }
    if (G && G.st && G.st.res && G.mode === 'cpu') LS.del('dama_save');
    G = null; closeModal(); show('#home');
    const sv = LS.get('dama_save', null);
    const hb = $('#homebtns'); hb.innerHTML = '';
    const add = (t, f, cls) => { const b = document.createElement('button'); b.textContent = t; if (cls) b.className = cls; b.onclick = f; hb.appendChild(b); };
    if (sv) add('▶ Riprendi partita' + (sv.mode === 'online' ? ' online' : ''), () => resume(sv), 'pri');
    add('🤖 Gioca contro il computer', cpuSetup);
    add('🌐 Gioca online con un amico', onlineMenu);
    add('⚙ Impostazioni', settings);
    add('📖 Guida e regole', guide);
    $('#ver').textContent = 'Dama v' + VERSION;
  }

  function cpuSetup() {
    const seg = (id, arr, cur) => '<div class="seg" id="' + id + '">' + arr.map((a, i) => '<button data-v="' + i + '" class="' + (i === cur ? 'on' : '') + '">' + a + '</button>').join('') + '</div>';
    const colors = ['w', 'b', 'r'];
    modal('Contro il computer',
      '<label>Livello</label>' + seg('s_lv', LEVELS.map(l => l[0]), cfg.level) +
      '<label>Il tuo colore</label>' + seg('s_co', ['Bianco', 'Nero', 'Casuale'], colors.indexOf(cfg.color)) +
      '<label>Formato</label>' + seg('s_se', SERIES.map(s => s[0]), cfg.series) +
      '<p class="sm">Regole: dalle Impostazioni › Varianti di regola.</p>',
      [{ t: 'Inizia', cls: 'pri', cb: () => startCpu() }, { t: 'Annulla' }],
      b => b.querySelectorAll('.seg').forEach(sg => sg.onclick = e => {
        const v = e.target.dataset.v; if (v === undefined) return;
        sg.querySelectorAll('button').forEach(x => x.classList.remove('on')); e.target.classList.add('on');
        if (sg.id === 's_lv') cfg.level = +v; else if (sg.id === 's_co') cfg.color = colors[+v]; else cfg.series = +v;
        saveCfg();
      }));
  }

  function startCpu(prev) {
    const w = prev ? !prev.st.hostWhite : (cfg.color === 'w' ? true : cfg.color === 'b' ? false : Math.random() < .5);
    let nm; do { nm = NAMES[Math.floor(Math.random() * NAMES.length)]; } while (prev && nm === prev.st.names[1]);
    const cont = prev && !prev.st.res.final;
    const need = cont ? prev.st.need : SERIES[cfg.series][1];
    const scores = cont ? prev.st.scores.slice() : [0, 0];
    G = { mode: 'cpu', role: 'host', lvl: cfg.level, hist: [], taps: [], cands: [], busy: false, hint: null, msg: '' };
    G.st = newState(clone(cfg.rules), w, [cfg.name || 'Tu', nm], scores, need);
    G.my = w ? 1 : -1;
    closeModal(); show('#game'); save(); render(); cpuTurn();
  }

  // ---------- rendering ----------
  function counts(b) { let w = 0, k = 0, bl = 0, bk = 0; b.forEach(v => { if (v > 0) { w++; } else if (v < 0) bl++; }); return [w, bl]; }
  function render() {
    if (!G || !G.st) return;
    const st = G.st, flip = G.my === -1;
    const th = THEMES[cfg.theme] || THEMES[0];
    const bd = $('#board'); bd.style.setProperty('--l', th[0]); bd.style.setProperty('--d', th[1]);
    G.moves = (st.turn === G.my && !st.res) ? E.moves(st.board, st.turn, st.rules) : [];
    const tgt = new Set(), selected = new Set(G.taps), must = new Set(), hintSq = new Set();
    G.cands.forEach(m => tgt.add(m.path[G.taps.length]));
    if (cfg.hl && !G.taps.length && G.moves.length && G.moves[0].cap.length) G.moves.forEach(m => must.add(m.path[0]));
    if (G.hint) G.hint.path.forEach(i => hintSq.add(i));
    const last = new Set(st.last || []);
    let h = '';
    for (let k = 0; k < 64; k++) {
      const i = flip ? 63 - k : k, r = (i / 8) | 0, c = i % 8, dark = (r + c) % 2 === 1, v = st.board[i];
      const cl = ['sq', dark ? 'd' : 'l'];
      if (last.has(i)) cl.push('last'); if (selected.has(i)) cl.push('sel'); if (tgt.has(i)) cl.push('tgt');
      if (must.has(i)) cl.push('must'); if (hintSq.has(i)) cl.push('hint');
      h += '<div class="' + cl.join(' ') + '" data-i="' + i + '">' + (v ? '<div class="pc ' + (v > 0 ? 'w' : 'b') + (Math.abs(v) === 2 ? ' k' : '') + '">' + (Math.abs(v) === 2 ? '♛' : '') + '</div>' : '') + '</div>';
    }
    bd.innerHTML = h;
    const [nw, nb] = counts(st.board), mine = G.my === 1 ? nw : nb, theirs = G.my === 1 ? nb : nw;
    $('#oppname').textContent = (G.my === 1 ? '⚫ ' : '⚪ ') + oppName();
    $('#oppinfo').textContent = 'Pezzi ' + theirs + ' · Prese ' + (12 - mine);
    $('#myname').textContent = (G.my === 1 ? '⚪ ' : '⚫ ') + myName();
    $('#myinfo').textContent = 'Pezzi ' + mine + ' · Prese ' + (12 - theirs);
    const sc = st.scores, myS = G.role === 'host' ? sc[0] : sc[1], opS = G.role === 'host' ? sc[1] : sc[0];
    let s;
    if (st.res) s = 'Partita finita';
    else if (G.mode === 'online' && !st.names[1]) s = 'In attesa dell\'avversario…';
    else if (G.busy) s = 'Sto pensando…';
    else if (st.turn === G.my) s = G.moves.length && G.moves[0].cap.length && st.rules.mandatory ? 'Tocca a te — presa obbligatoria' : 'Tocca a te';
    else s = 'Tocca a ' + oppName();
    const ser = st.need > 1 ? ' · Serie ' + myS + '–' + opS : '';
    const net = G.mode === 'online' ? ' · ' + (G.netOk ? '🟢 ' + G.netName : '🔴 offline') : '';
    $('#status').innerHTML = esc(s) + '<small>' + esc(ser + net) + '</small>' + (G.msg ? '<div class="hm">' + esc(G.msg) + '</div>' : '');
    $('#t_hint').classList.toggle('hid', G.mode !== 'cpu');
    $('#t_undo').classList.toggle('hid', G.mode !== 'cpu');
  }

  // ---------- gameplay ----------
  function onTap(e) {
    const el = e.target.closest('.sq'); if (!el || !G || !G.st) return;
    const i = +el.dataset.i, st = G.st;
    if (G.busy || st.res) return;
    if (st.turn !== G.my) return;
    if (G.mode === 'online' && !st.names[1]) { toast('Attendi l\'avversario'); return; }
    G.hint = null; G.msg = '';
    if (!G.taps.length) {
      const c = G.moves.filter(m => m.path[0] === i);
      if (!c.length) { if (st.board[i] * G.my > 0 && G.moves.length && G.moves[0].cap.length) toast('Presa obbligatoria'); return; }
      G.taps = [i]; G.cands = c;
    } else {
      const nx = G.cands.filter(m => m.path[G.taps.length] === i);
      if (nx.length) {
        G.taps.push(i); G.cands = nx;
        const done = nx.find(m => m.path.length === G.taps.length);
        if (done) { commit(done); return; }
      } else {
        const c = G.moves.filter(m => m.path[0] === i);
        if (c.length) { G.taps = [i]; G.cands = c; } else { G.taps = []; G.cands = []; }
      }
    }
    render();
  }

  function commit(m) {
    if (G.mode === 'cpu') G.hist.push(pack(G.st));
    applyMove(m);
  }

  function applyMove(m) {
    const st = G.st, mover = st.turn, p = st.board[m.path[0]];
    st.noProg = (m.cap.length || Math.abs(p) === 1) ? 0 : st.noProg + 1;
    st.board = E.apply(st.board, m); st.last = m.path; st.turn = -st.turn; st.seq++; st.ply++;
    G.taps = []; G.cands = []; G.hint = null; G.msg = '';
    const next = E.moves(st.board, st.turn, st.rules);
    if (!next.length) finish(mover, 'blocco');
    else if (st.rules.drawPlies && st.noProg >= st.rules.drawPlies) finish(0, 'patta');
    afterChange(true);
  }

  function finish(w, why) {
    const st = G.st; st.res = { w, why };
    if (w !== 0) { const hostWon = w === (st.hostWhite ? 1 : -1); st.scores[hostWon ? 0 : 1]++; }
    if (st.scores[0] >= st.need || st.scores[1] >= st.need) st.res.final = true;
  }

  function afterChange(local) {
    save(); render();
    if (G.mode === 'online' && local) sendState();
    if (G.st.res) showEnd();
    else if (G.mode === 'cpu' && G.st.turn !== G.my) cpuTurn();
  }

  function cpuTurn() {
    if (!G || G.mode !== 'cpu' || G.st.res || G.st.turn === G.my) return;
    G.busy = true; render();
    const g = G, gid = G.st.gid, seq = G.st.seq;
    setTimeout(() => {
      if (G !== g || g.st.gid !== gid || g.st.seq !== seq) { return; }
      const lv = LEVELS[g.lvl][1];
      const r = E.bestMove(g.st.board, g.st.turn, g.st.rules, lv);
      g.busy = false;
      if (r) applyMove(r.move);
    }, 350);
  }

  function showEnd() {
    const st = G.st, key = st.gid + ':' + st.seq;
    if (G.endShown === key) return; G.endShown = key;
    const me = G.my, w = st.res.w;
    let t = w === 0 ? 'Patta' : (w === me ? '🎉 Hai vinto!' : 'Ha vinto ' + esc(oppName()));
    const myS = G.role === 'host' ? st.scores[0] : st.scores[1], opS = G.role === 'host' ? st.scores[1] : st.scores[0];
    let body = st.need > 1 ? '<p>Serie: <b>' + myS + '–' + opS + '</b> (al meglio di ' + (st.need * 2 - 1) + ')</p>' : '';
    if (st.res.final) body += '<p>' + (myS > opS ? '🏆 Serie vinta da te!' : '🏆 Serie vinta da ' + esc(oppName())) + '</p>';
    const btns = [];
    const canNext = G.mode === 'cpu' || G.role === 'host';
    if (canNext) btns.push({ t: 'Nuova partita', cls: 'pri', cb: nextGame });
    else body += '<p class="sm">In attesa che l\'organizzatore avvii la nuova partita…</p>';
    btns.push({ t: 'Menu', cb: () => { if (G.mode === 'cpu') LS.del('dama_save'); home(); } });
    modal(t, body, btns);
  }

  function nextGame() {
    if (G.mode === 'cpu') { startCpu({ st: G.st }); return; }
    const old = G.st, fin = old.res.final;
    const ns = newState(old.rules, !old.hostWhite, old.names, fin ? [0, 0] : old.scores.slice(), old.need);
    ns.seq = old.seq + 1;
    G.st = ns; G.my = colorFor(G.role, ns); G.taps = []; G.cands = []; closeModal();
    afterChange(true);
  }

  function resign() {
    if (!G || !G.st || G.st.res) return;
    modal('Abbandonare la partita?', '', [{ t: 'Sì, abbandono', cls: 'pri', cb: () => { finish(-G.my, 'resa'); G.st.seq++; afterChange(true); } }, { t: 'No' }]);
  }

  function hint() {
    const st = G.st; if (G.mode !== 'cpu' || st.res || st.turn !== G.my || G.busy) return;
    const r = E.bestMove(st.board, G.my, st.rules, { depth: 8, time: 1500 });
    if (!r) return;
    G.hint = r.move; G.taps = []; G.cands = [];
    const m = r.move, sc = r.score;
    G.msg = '💡 ' + E.notation(m) + (m.cap.length ? ' — presa di ' + m.cap.length : '') + (sc > 150 ? ' · sei in vantaggio' : sc < -150 ? ' · posizione difficile' : ' · partita equilibrata');
    render();
  }

  function undo() {
    if (G.mode !== 'cpu' || G.busy || !G.hist.length || G.st.res) return;
    G.st = unpack(G.hist.pop()); G.taps = []; G.cands = []; G.hint = null; G.msg = '';
    save(); render();
  }

  // ---------- online ----------
  const genCode = () => { const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let s = ''; for (let i = 0; i < 5; i++) s += a[Math.floor(Math.random() * a.length)]; return s; };

  async function ensureAccess() {
    if (LS.get('dama_acc', '') === ACCESS_HASH) return true;
    return new Promise(res => modal('Parola d\'accesso', '<p class="sm">Per giocare online serve la parola d\'accesso (si chiede una sola volta su questo dispositivo).</p><input id="acc" type="password" autocapitalize="none" autocomplete="off">',
      [{ t: 'OK', cls: 'pri', keep: true, cb: async () => { const h = await sha(($('#acc').value || '').trim().toLowerCase()); if (h === ACCESS_HASH) { LS.set('dama_acc', h); closeModal(); res(true); } else toast('Parola errata'); } },
      { t: 'Annulla', cb: () => res(false) }]));
  }

  function onlineMenu() {
    const nm = () => { cfg.name = ($('#nm').value || '').trim(); saveCfg(); };
    modal('Online', '<label>Il tuo nome</label><input id="nm" value="' + esc(cfg.name) + '" maxlength="14"><p class="sm">Crea una stanza e invita un amico, oppure entra con il codice che ti ha dato.</p>',
      [{ t: 'Crea stanza', cls: 'pri', cb: () => { nm(); createRoom(); } },
       { t: 'Entra in una stanza', cb: () => { nm(); joinDialog(); } },
       { t: 'Annulla' }]);
  }

  async function createRoom() {
    if (!await ensureAccess()) return;
    const room = genCode(), w = cfg.color === 'w' ? true : cfg.color === 'b' ? false : Math.random() < .5;
    G = { mode: 'online', role: 'host', room, taps: [], cands: [], busy: false, hint: null, msg: '' };
    G.st = newState(clone(cfg.rules), w, [cfg.name || 'Organizzatore', ''], [0, 0], SERIES[cfg.series][1]);
    G.my = colorFor('host', G.st);
    show('#game'); save(); render(); startNet(true); waitModal();
  }

  function waitModal() {
    modal('Stanza ' + G.room, '<div class="code">' + G.room + '</div><p>Manda il link all\'amico e dagli questo codice: lo deve scrivere lui dopo aver scelto «Entra in una stanza».</p><p class="sm" id="nst"></p>',
      [{ t: '📤 Invia invito', cls: 'pri', keep: true, cb: shareInvite }, { t: 'Chiudi finestra' }, { t: 'Esci', cb: () => { LS.del('dama_save'); home(); } }]);
  }
  function shareInvite() {
    const url = location.origin + location.pathname + '?invito=1';
    const text = 'Giochiamo a Dama! Apri il link, scegli «Entra in una stanza» e scrivi il codice che ti dico io.';
    if (navigator.share) navigator.share({ title: 'Dama', text, url }).catch(() => { });
    else { navigator.clipboard && navigator.clipboard.writeText(text + ' ' + url); toast('Invito copiato'); }
  }

  function joinDialog() {
    modal('Entra in una stanza', '<label>Codice stanza</label><input id="rc" maxlength="5" autocapitalize="characters" autocomplete="off" style="text-transform:uppercase"><label>Il tuo nome</label><input id="nm" value="' + esc(cfg.name) + '" maxlength="14">',
      [{ t: 'Entra', cls: 'pri', keep: true, cb: async () => { const code = ($('#rc').value || '').trim().toUpperCase(), nm = ($('#nm').value || '').trim(); if (code.length !== 5) { toast('Codice di 5 caratteri'); return; } cfg.name = nm; saveCfg(); closeModal(); if (await ensureAccess()) joinRoom(code); } }, { t: 'Annulla' }]);
  }

  function joinRoom(code) {
    G = { mode: 'online', role: 'guest', room: code, st: null, taps: [], cands: [], busy: false, hint: null, msg: '' };
    show('#game'); startNet(false);
    modal('Connessione…', '<p>Cerco la stanza ' + code + '…</p>', [{ t: 'Annulla', cb: home }]);
    const g = G;
    setTimeout(() => { if (G === g && !g.st) { closeModal(); toast('Stanza non trovata: controlla il codice e che l\'organizzatore l\'abbia creata', 4000); home(); } }, 20000);
  }

  function startNet(fresh) {
    G.netOk = false;
    const g = G;
    g.net = NET.open(g.room, cfg.net, {
      msg: o => { if (G === g) netMsg(o); },
      open: () => { if (G !== g) return; g.net.send({ t: 'hello', role: g.role, name: cfg.name || (g.role === 'host' ? 'Organizzatore' : 'Ospite'), seq: g.st ? g.st.seq : -1, ts: Date.now() }); if (g.role === 'host' && g.st) { if (fresh && !g.cleared) { g.cleared = true; } sendState(); } },
      status: (s, n) => { if (G !== g) return; g.netOk = s === 'open'; if (n) g.netName = n; if (g.st) render(); }
    }, g.role);
  }
  function sendState() { if (G && G.net && G.st) G.net.send({ t: 'state', role: G.role, s: pack(G.st) }, true); }

  function netMsg(o) {
    if (o.t === 'hello') {
      if (o.role === G.role || Date.now() - o.ts > 120000) return;
      if (G.role === 'host' && G.st) {
        const first = !G.st.names[1];
        if (G.st.names[1] !== o.name) { G.st.names[1] = o.name; G.st.seq++; save(); }
        if (first || !G.guestSeen) { toast('✅ ' + o.name + ' è entrato nella stanza', 3500); vib(); }
        G.guestSeen = true; closeModal(); render();
      }
      sendState();
    } else if (o.t === 'state' && o.s) {
      if (o.role === G.role) return;
      const s = unpack(o.s), cur = G.st;
      if (!cur || s.seq > cur.seq || (s.gid !== cur.gid && o.role === 'host')) {
        const moved = cur && s.seq > cur.seq && s.turn === colorFor(G.role, s);
        const newGame = cur && s.gid !== cur.gid;
        G.st = s; G.my = colorFor(G.role, s); G.taps = []; G.cands = []; G.hint = null;
        if (!cur || newGame) closeModal();
        if (moved) vib();
        save(); render();
        if (s.res) showEnd();
      }
    }
  }

  function resume(sv) {
    closeModal();
    G = { mode: sv.mode, role: sv.role, room: sv.room, lvl: sv.lvl, hist: [], taps: [], cands: [], busy: false, hint: null, msg: '' };
    G.st = unpack(sv.st); G.my = colorFor(G.role, G.st); G.endShown = G.st.gid + ':' + G.st.seq;
    show('#game'); render();
    if (G.mode === 'online') { startNet(false); if (G.role === 'host' && !G.st.names[1]) waitModal(); }
    else cpuTurn();
  }

  // ---------- settings & guide ----------
  function settings() {
    const r = cfg.rules;
    const cb = (k, t) => '<label class="ck"><input type="checkbox" data-r="' + k + '"' + (r[k] ? ' checked' : '') + '> ' + t + '</label>';
    modal('Impostazioni',
      '<label>Il tuo nome</label><input id="s_nm" value="' + esc(cfg.name) + '" maxlength="14">' +
      '<label>Scacchiera</label><div class="seg" id="s_th">' + THEMES.map((t, i) => '<button data-v="' + i + '" class="' + (i === cfg.theme ? 'on' : '') + '">' + t[2] + '</button>').join('') + '</div>' +
      '<label class="ck"><input type="checkbox" id="s_hl"' + (cfg.hl ? ' checked' : '') + '> Evidenzia i pezzi che devono prendere</label>' +
      '<label>Connessione online (fuori dal Wi‑Fi)</label><div class="seg" id="s_net">' + [['auto', 'Auto'], ['p2p', 'Diretto'], ['mqtt', 'MQTT'], ['ntfy', 'ntfy']].map(x => '<button data-v="' + x[0] + '" class="' + (cfg.net === x[0] ? 'on' : '') + '">' + x[1] + '</button>').join('') + '</div>' +
      '<label>Varianti di regola</label>' + cb('mandatory', 'Presa obbligatoria') + cb('majority', 'Presa di maggioranza obbligatoria') + cb('pawnTakesKing', 'La pedina può mangiare la dama') +
      '<label>Patta per inattività</label><select id="s_dr">' + [[0, 'Mai'], [40, '20 mosse per lato'], [80, '40 mosse per lato'], [120, '60 mosse per lato']].map(x => '<option value="' + x[0] + '"' + (r.drawPlies === x[0] ? ' selected' : '') + '>' + x[1] + '</option>').join('') + '</select>' +
      '<p class="sm">Le varianti si applicano alle nuove partite. Online valgono quelle dell\'organizzatore. Versione ' + VERSION + '</p>',
      [{ t: 'Fatto', cls: 'pri', cb: () => { cfg.name = $('#s_nm').value.trim(); cfg.hl = $('#s_hl').checked; cfg.rules.drawPlies = +$('#s_dr').value; saveCfg(); if (G && G.st) render(); } }],
      b => {
        b.querySelectorAll('input[data-r]').forEach(i => i.onchange = () => { cfg.rules[i.dataset.r] = i.checked; saveCfg(); });
        b.querySelector('#s_th').onclick = e => { const v = e.target.dataset.v; if (v === undefined) return; cfg.theme = +v; saveCfg(); b.querySelectorAll('#s_th button').forEach(x => x.classList.toggle('on', x === e.target)); if (G && G.st) render(); };
        b.querySelector('#s_net').onclick = e => { const v = e.target.dataset.v; if (!v) return; cfg.net = v; saveCfg(); b.querySelectorAll('#s_net button').forEach(x => x.classList.toggle('on', x === e.target)); };
      });
  }

  function guide() {
    modal('Guida', '<div class="gd"><b>Regole (Dama italiana)</b><br>Scacchiera 8×8, 12 pedine a testa, si muove sulle caselle scure. Il Bianco inizia. Le pedine avanzano in diagonale di una casella; la dama muove di una casella in tutte le direzioni. La presa è obbligatoria e si salta il pezzo avversario adiacente. La pedina non può prendere la dama (opzione nelle varianti). Se ci sono più prese, si deve scegliere quella con più pezzi; a parità, quella fatta con la dama, poi quella con più dame. Una pedina che arriva all\'ultima fila diventa dama e la presa termina. Perde chi non ha più pezzi o mosse.<br><br>' +
      '<b>Come si gioca</b><br>Tocca il pezzo, poi la casella di arrivo (nelle prese multiple tocca ogni casella del percorso). 💡 suggerisce la mossa (solo contro il computer), ↩ annulla l\'ultima mossa.<br><br>' +
      '<b>Online</b><br>Uno crea la stanza e manda il link; l\'amico apre il link, sceglie «Entra in una stanza» e scrive il codice. La parola d\'accesso si chiede una volta per dispositivo. Se chiudi l\'app o passano giorni: dal menu scegli «Riprendi partita online» e la partita ricomincia da dove era. Se non va fuori dal Wi‑Fi, cambia connessione in Impostazioni (MQTT o ntfy).<br><br>' +
      '<b>Installare</b><br>Safari › Condividi › Aggiungi a Home.</div>', [{ t: 'Chiudi', cls: 'pri' }]);
  }

  // ---------- init ----------
  function init() {
    $('#board').addEventListener('click', onTap);
    $('#t_hint').onclick = hint; $('#t_undo').onclick = undo; $('#t_res').onclick = resign;
    $('#t_menu').onclick = () => modal('Menu', '', [{ t: '⚙ Impostazioni', cb: settings }, { t: '📖 Guida', cb: guide }, { t: '🏠 Esci al menu principale', cb: home }, { t: 'Chiudi' }]);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && G && G.net && !G.net.alive()) G.net.reconnect();
      if (document.visibilityState === 'visible' && G && G.net) { G.net.send({ t: 'hello', role: G.role, name: cfg.name || 'Giocatore', seq: G.st ? G.st.seq : -1, ts: Date.now() }); }
      if (window.__reg) window.__reg.update().catch(() => { });
    });
    home();
    if (/invito=1/.test(location.search)) { history.replaceState(null, '', location.pathname); joinDialog(); }
    if ('serviceWorker' in navigator) {
      let reloaded = false;
      const had = !!navigator.serviceWorker.controller;
      navigator.serviceWorker.register('sw.js').then(r => { window.__reg = r; r.update().catch(() => { }); }).catch(() => { });
      navigator.serviceWorker.addEventListener('controllerchange', () => { if (reloaded || !had) return; reloaded = true; if (!G) location.reload(); else toast('Aggiornamento pronto: riapri l\'app al termine della partita', 4000); });
    }
  }
  init();
})();
