// Gabarit du script lancé dans le panneau navigateur : télécharge les clips puis propose UN SEUL zip.
// __LIST__ est remplacé par {"vo": "url", ...}.
window.__zipDone = false; window.__zipInfo = null;
(async () => {
  const L = __LIST__;
  const T = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; T[n] = c >>> 0; }
  const crc = (b) => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = T[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const enc = new TextEncoder(); const parts = []; const central = []; let off = 0; const bad = [];
  for (const [k, u] of Object.entries(L)) {
    try {
      const r = await fetch(u); if (!r.ok) { bad.push([k, r.status]); continue; }
      const d = new Uint8Array(await r.arrayBuffer()); const n = enc.encode(k + '.mp3'); const c = crc(d); const s = d.length;
      const h = new DataView(new ArrayBuffer(30)); h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(12, 0x21, true); h.setUint32(14, c, true); h.setUint32(18, s, true); h.setUint32(22, s, true); h.setUint16(26, n.length, true);
      parts.push(new Uint8Array(h.buffer), n, d);
      const cd = new DataView(new ArrayBuffer(46)); cd.setUint32(0, 0x02014b50, true); cd.setUint16(4, 20, true); cd.setUint16(6, 20, true); cd.setUint16(14, 0x21, true); cd.setUint32(16, c, true); cd.setUint32(20, s, true); cd.setUint32(24, s, true); cd.setUint16(28, n.length, true); cd.setUint32(42, off, true);
      central.push(new Uint8Array(cd.buffer), n); off += 30 + n.length + s;
    } catch (e) { bad.push([k, String(e)]); }
  }
  const cdSize = central.reduce((a, b) => a + b.length, 0);
  const e = new DataView(new ArrayBuffer(22)); e.setUint32(0, 0x06054b50, true); e.setUint16(8, central.length / 2, true); e.setUint16(10, central.length / 2, true); e.setUint32(12, cdSize, true); e.setUint32(16, off, true);
  const blob = new Blob([...parts, ...central, new Uint8Array(e.buffer)], { type: 'application/zip' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'voix-mille-li.zip'; document.body.appendChild(a); a.click();
  window.__zipInfo = { files: central.length / 2, bytes: blob.size, bad }; window.__zipDone = true;
})();
'lancé'
