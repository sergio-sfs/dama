(function (root) {
  'use strict';
  const E = {};
  // board: array(64), idx=r*8+c, r=0 in alto (nero). 1 pedina bianca, 2 dama bianca, -1/-2 nere
  E.defaultRules = { mandatory: true, majority: true, pawnTakesKing: false, drawPlies: 80 };
  E.initial = function () {
    const b = new Array(64).fill(0);
    for (let r = 0; r < 3; r++) for (let c = 0; c < 8; c++) if ((r + c) % 2 === 1) b[r * 8 + c] = -1;
    for (let r = 5; r < 8; r++) for (let c = 0; c < 8; c++) if ((r + c) % 2 === 1) b[r * 8 + c] = 1;
    return b;
  };
  const DIRS = [[-1, -1], [-1, 1], [1, -1], [1, 1]];

  function captures(b, from, side, rules) {
    const p = b[from], isK = Math.abs(p) === 2, res = [];
    const captured = [], path = [from];
    b[from] = 0;
    function rec(r, c) {
      let found = false;
      for (const [dr, dc] of DIRS) {
        if (!isK && dr !== -side) continue;
        const r2 = r + 2 * dr, c2 = c + 2 * dc;
        if (r2 < 0 || r2 > 7 || c2 < 0 || c2 > 7) continue;
        const i1 = (r + dr) * 8 + c + dc, i2 = r2 * 8 + c2, t = b[i1];
        if (t === 0 || t * side > 0 || b[i2] !== 0 || captured.indexOf(i1) >= 0) continue;
        if (!isK && Math.abs(t) === 2 && !rules.pawnTakesKing) continue;
        found = true;
        captured.push(i1); path.push(i2);
        if (!isK && ((side === 1 && r2 === 0) || (side === -1 && r2 === 7)))
          res.push({ path: path.slice(), cap: captured.map(i => ({ i, k: Math.abs(b[i]) === 2 })), byK: false });
        else rec(r2, c2);
        captured.pop(); path.pop();
      }
      if (!found && path.length > 1)
        res.push({ path: path.slice(), cap: captured.map(i => ({ i, k: Math.abs(b[i]) === 2 })), byK: isK });
    }
    rec((from / 8) | 0, from % 8);
    b[from] = p;
    return res;
  }

  E.moves = function (b, side, rules) {
    rules = rules || E.defaultRules;
    let caps = [];
    for (let i = 0; i < 64; i++) if (b[i] * side > 0) caps.push(...captures(b, i, side, rules));
    if (caps.length && rules.mandatory) {
      if (rules.majority) {
        const key = m => [m.cap.length, m.byK ? 1 : 0, m.cap.filter(x => x.k).length];
        const cmp = (a, c) => { for (let j = 0; j < 3; j++) if (a[j] !== c[j]) return a[j] - c[j]; return 0; };
        let best = null;
        for (const m of caps) { const k = key(m); if (!best || cmp(k, best) > 0) best = k; }
        caps = caps.filter(m => cmp(key(m), best) === 0);
      }
      return caps;
    }
    const out = caps.slice();
    for (let i = 0; i < 64; i++) {
      if (b[i] * side <= 0) continue;
      const isK = Math.abs(b[i]) === 2, r = (i / 8) | 0, c = i % 8;
      for (const [dr, dc] of DIRS) {
        if (!isK && dr !== -side) continue;
        const r2 = r + dr, c2 = c + dc;
        if (r2 < 0 || r2 > 7 || c2 < 0 || c2 > 7) continue;
        if (b[r2 * 8 + c2] === 0) out.push({ path: [i, r2 * 8 + c2], cap: [], byK: isK });
      }
    }
    return out;
  };

  E.apply = function (b, m) {
    const n = b.slice(), from = m.path[0], to = m.path[m.path.length - 1];
    let p = n[from];
    n[from] = 0;
    for (const x of m.cap) n[x.i] = 0;
    const r = (to / 8) | 0;
    if (Math.abs(p) === 1 && ((p === 1 && r === 0) || (p === -1 && r === 7))) p *= 2;
    n[to] = p;
    return n;
  };

  const sq = i => 'abcdefgh'[i % 8] + (8 - ((i / 8) | 0));
  E.notation = m => m.path.map(sq).join(m.cap.length ? 'x' : '-');
  E.sq = sq;

  function evaluate(b, side) {
    let s = 0;
    for (let i = 0; i < 64; i++) {
      const v = b[i];
      if (!v) continue;
      const r = (i / 8) | 0, c = i % 8, a = Math.abs(v), sg = v > 0 ? 1 : -1;
      const cen = 3 - Math.abs(3.5 - c) - Math.abs(3.5 - r) * 0.5;
      let x;
      if (a === 2) x = 320 + cen * 3;
      else {
        const adv = sg === 1 ? 7 - r : r;
        x = 100 + adv * 4 + cen * 2 + (adv === 0 ? 6 : 0);
      }
      s += sg * x;
    }
    return s * side;
  }
  E.evaluate = evaluate;

  E.bestMove = function (b, side, rules, opt) {
    opt = opt || {};
    const maxD = opt.depth || 4, tlim = opt.time || 1500, noise = opt.noise || 0;
    const root = E.moves(b, side, rules);
    if (!root.length) return null;
    if (root.length === 1) return { move: root[0], score: 0 };
    const t0 = Date.now();
    let nodes = 0;
    function nm(bd, sd, d, al, be, ply) {
      if (++nodes % 512 === 0 && Date.now() - t0 > tlim) throw 'T';
      const ms = E.moves(bd, sd, rules);
      if (!ms.length) return -10000 + ply;
      if (d <= 0 && (!ms[0].cap.length || d < -6)) return evaluate(bd, sd);
      ms.sort((x, y) => y.cap.length - x.cap.length);
      let best = -Infinity;
      for (const m of ms) {
        const v = -nm(E.apply(bd, m), -sd, d - 1, -be, -al, ply + 1);
        if (v > best) best = v;
        if (best > al) al = best;
        if (al >= be) break;
      }
      return best;
    }
    let result = { move: root[Math.floor(Math.random() * root.length)], score: 0 };
    for (let d = 1; d <= maxD; d++) {
      try {
        let bestV = -Infinity, bestM = null, al = -Infinity;
        const scored = [];
        for (const m of root) {
          const v = -nm(E.apply(b, m), -side, d - 1, -Infinity, -al, 1) + (noise ? (Math.random() - 0.5) * noise : 0);
          scored.push([v, m]);
          if (v > bestV) { bestV = v; bestM = m; }
          if (!noise && v > al) al = v;
        }
        result = { move: bestM, score: bestV };
      } catch (e) { if (e !== 'T') throw e; break; }
    }
    return result;
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = E; else root.DamaEngine = E;
})(typeof window !== 'undefined' ? window : globalThis);
