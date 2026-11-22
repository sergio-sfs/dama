(function (root) {
  'use strict';
  const te = new TextEncoder(), td = new TextDecoder();
  const BROKERS = root.DAMA_BROKERS || ['wss://broker.hivemq.com:8884/mqtt', 'wss://broker.emqx.io:8084/mqtt'];
  const str = s => { const b = te.encode(s); return [b.length >> 8, b.length & 255, ...b]; };
  const rl = n => { const o = []; do { let d = n % 128; n = (n / 128) | 0; if (n > 0) d |= 128; o.push(d); } while (n > 0); return o; };
  const pkt = (t, body) => new Uint8Array([t, ...rl(body.length), ...body]);

  function openMqtt(url, room, cid, cb) {
    const base = 'damasg/' + room;
    let ws, ping, ready = false, closed = false, buf = new Uint8Array(0);
    const fin = () => { if (closed) return; closed = true; clearInterval(ping); cb.close(); };
    try { ws = new WebSocket(url, 'mqtt'); } catch (e) { setTimeout(fin, 0); return { name: 'MQTT', send() { return false; }, close() { closed = true; } }; }
    ws.binaryType = 'arraybuffer';
    ws.onopen = () => ws.send(pkt(0x10, [...str('MQTT'), 4, 2, 0, 60, ...str(cid)]));
    ws.onclose = ws.onerror = fin;
    ws.onmessage = e => {
      const d = new Uint8Array(e.data), n = new Uint8Array(buf.length + d.length);
      n.set(buf); n.set(d, buf.length); buf = n;
      while (buf.length >= 2) {
        let i = 1, len = 0, mul = 1, b;
        do { if (i >= buf.length) return; b = buf[i++]; len += (b & 127) * mul; mul *= 128; } while (b & 128);
        if (buf.length < i + len) return;
        const type = buf[0] >> 4, fl = buf[0] & 15, body = buf.slice(i, i + len);
        buf = buf.slice(i + len);
        if (type === 2) {
          if (body[1] !== 0) { fin(); return; }
          ws.send(pkt(0x82, [0, 1, ...str(base + '/#'), 0]));
        } else if (type === 9) {
          ready = true; ping = setInterval(() => { try { ws.send(new Uint8Array([0xC0, 0])); } catch (e) { } }, 30000);
          cb.open();
        } else if (type === 3) {
          const tl = (body[0] << 8) | body[1]; let off = 2 + tl;
          if ((fl >> 1) & 3) off += 2;
          if (body.length > off) { try { cb.msg(JSON.parse(td.decode(body.slice(off)))); } catch (e) { } }
        }
      }
    };
    return {
      name: 'MQTT',
      send(o, retain) {
        if (!ready || closed) return false;
        try { ws.send(pkt(0x30 | (retain ? 1 : 0), [...str(base + (retain ? '/s' : '/m')), ...te.encode(JSON.stringify(o))])); return true; } catch (e) { return false; }
      },
      close() { closed = true; clearInterval(ping); try { ws.close(); } catch (e) { } }
    };
  }

  function openNtfy(room, cid, cb) {
    const url = 'https://ntfy.sh/damasg-' + room;
    let closed = false, es;
    try { es = new EventSource(url + '/sse?since=12h'); } catch (e) { setTimeout(() => cb.close(), 0); return { name: 'ntfy', send() { return false; }, close() { } }; }
    es.onopen = () => cb.open();
    es.onmessage = e => { try { const ev = JSON.parse(e.data); if (ev.event === 'message') cb.msg(JSON.parse(ev.message)); } catch (x) { } };
    es.onerror = () => { if (closed) return; closed = true; es.close(); cb.close(); };
    return {
      name: 'ntfy',
      send(o) { fetch(url, { method: 'POST', body: JSON.stringify(o) }).catch(() => { }); return true; },
      close() { closed = true; es.close(); }
    };
  }

  const ICE_SERVERS = root.DAMA_ICE || [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:global.stun.twilio.com:3478' },
    { urls: ['turn:openrelay.metered.ca:80', 'turn:openrelay.metered.ca:443', 'turn:openrelay.metered.ca:443?transport=tcp'], username: 'openrelayproject', credential: 'openrelayproject' }
  ];

  function openPeer(room, cid, role, cb) {
    const hostId = 'damasg' + room.toLowerCase();
    let peer, conn = null, closed = false;
    const fin = () => { if (closed) return; closed = true; try { peer && peer.destroy(); } catch (e) { } cb.close(); };
    if (!root.Peer) { setTimeout(fin, 0); return { name: 'P2P', send() { return false; }, close() { closed = true; } }; }
    const opt = { config: { iceServers: ICE_SERVERS } };
    try { peer = role === 'host' ? new root.Peer(hostId, opt) : new root.Peer(opt); } catch (e) { setTimeout(fin, 0); return { name: 'P2P', send() { return false; }, close() { closed = true; } }; }
    function setup(c) {
      conn = c;
      c.on('open', () => cb.open());
      c.on('data', d => { try { cb.msg(typeof d === 'string' ? JSON.parse(d) : d); } catch (e) { } });
      c.on('close', () => { if (conn === c) conn = null; if (role === 'guest') fin(); });
      c.on('error', () => { });
    }
    peer.on('open', () => { if (role === 'guest') setup(peer.connect(hostId, { reliable: true })); else cb.open(); });
    peer.on('connection', c => { if (role === 'host') setup(c); });
    peer.on('error', fin);
    peer.on('disconnected', fin);
    return {
      name: 'P2P',
      send(o) { if (conn && conn.open) { try { conn.send(JSON.stringify(o)); return true; } catch (e) { } } return false; },
      close() { closed = true; try { peer.destroy(); } catch (e) { } }
    };
  }

  // mode: 'auto' (tutti) | 'p2p' | 'mqtt' | 'ntfy'. h: {msg(o), open(), status(s,names)}
  function open(room, mode, h, role) {
    const cid = 'd' + Math.random().toString(36).slice(2, 10);
    const kinds = mode === 'mqtt' ? ['m'] : mode === 'ntfy' ? ['n'] : mode === 'p2p' ? ['p'] : ['p', 'm', 'n'];
    const LAB = { m: 'MQTT', n: 'ntfy', p: 'P2P' };
    const ch = {};
    let stopped = false;
    const status = () => {
      const on = kinds.filter(k => ch[k].c && ch[k].open).map(k => LAB[k]);
      h.status(on.length ? 'open' : 'closed', on.join('+'));
    };
    function start(k) {
      const st = ch[k] = { c: null, open: false, idx: 0, retry: 0, connect: null };
      st.connect = function connect() {
        if (stopped || st.c) return;
        let opened = false, to, c;
        const cb = {
          msg: o => { if (o && o.from !== cid) h.msg(o); },
          open: () => { opened = true; clearTimeout(to); st.open = true; st.retry = 0; status(); h.open(k); },
          close: () => {
            clearTimeout(to); st.open = false;
            if (stopped || st.c !== c) return;
            st.c = null; status();
            if (!opened) st.idx++;
            setTimeout(connect, Math.min(800 * (1 + st.retry++), 8000));
          }
        };
        c = k === 'n' ? openNtfy(room, cid, cb) : k === 'p' ? openPeer(room, cid, role, cb) : openMqtt(BROKERS[st.idx % BROKERS.length], room, cid, cb);
        st.c = c;
        to = setTimeout(() => { if (!opened && st.c === c) { c.close(); cb.close(); } }, k === 'p' ? 12000 : 7000);
      };
      st.connect();
    }
    kinds.forEach(start);
    return {
      send(o, retain) { o.from = cid; let ok = false; kinds.forEach(k => { if (ch[k].c && ch[k].open && ch[k].c.send(o, retain)) ok = true; }); return ok; },
      reconnect() { kinds.forEach(k => { if (!ch[k].c) { ch[k].retry = 0; ch[k].connect(); } }); },
      alive() { return kinds.some(k => ch[k].c && ch[k].open); },
      close() { stopped = true; kinds.forEach(k => { if (ch[k].c) ch[k].c.close(); ch[k].c = null; }); }
    };
  }
  root.DamaNet = { open };
})(window);
