/* Generador de archivos ZIP sin dependencias (método "store", sin compresión).
   Uso: const z = new MiniZip(); z.add("carpeta/archivo.txt", Uint8Array); const blob = z.blob(); */
(function(){
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = b => { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  function dosTime(d){ return { time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate() }; }
  class MiniZip {
    constructor(){ this.files = []; }
    add(name, data){ this.files.push({ name: new TextEncoder().encode(name), data: data instanceof Uint8Array ? data : new TextEncoder().encode(String(data)) }); }
    blob(){
      const parts = [], central = []; let offset = 0; const { time, date } = dosTime(new Date());
      for (const f of this.files) {
        const crc = crc32(f.data), size = f.data.length;
        const h = new DataView(new ArrayBuffer(30));
        h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true);
        h.setUint16(10, time, true); h.setUint16(12, date, true); h.setUint32(14, crc, true); h.setUint32(18, size, true); h.setUint32(22, size, true);
        h.setUint16(26, f.name.length, true); h.setUint16(28, 0, true);
        parts.push(h.buffer, f.name, f.data);
        const c = new DataView(new ArrayBuffer(46));
        c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, 0, true);
        c.setUint16(12, time, true); c.setUint16(14, date, true); c.setUint32(16, crc, true); c.setUint32(20, size, true); c.setUint32(24, size, true);
        c.setUint16(28, f.name.length, true); c.setUint16(30, 0, true); c.setUint16(32, 0, true); c.setUint16(34, 0, true); c.setUint16(36, 0, true);
        c.setUint32(38, 0, true); c.setUint32(42, offset, true);
        central.push(c.buffer, f.name);
        offset += 30 + f.name.length + size;
      }
      const cdSize = central.reduce((a, p) => a + (p.byteLength ?? p.length), 0);
      const e = new DataView(new ArrayBuffer(22));
      e.setUint32(0, 0x06054b50, true); e.setUint16(8, this.files.length, true); e.setUint16(10, this.files.length, true);
      e.setUint32(12, cdSize, true); e.setUint32(16, offset, true);
      return new Blob([...parts, ...central, e.buffer], { type: "application/zip" });
    }
  }
  window.MiniZip = MiniZip;
})();
