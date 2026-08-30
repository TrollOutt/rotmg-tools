'use strict';
/*
 * Look at what the capture caught.
 *
 *   node tools/read-capture.js [file.pcapng]
 *
 * Before anything can be made of the realm stream, one question has to be
 * answered: is it readable at all. The game's protocol frames every message as
 * a four-byte length, big-endian and counting itself, then a one-byte id, then
 * the body. If the capture is plaintext those lengths line up end to end for
 * thousands of packets in a row; if it is encrypted they are noise, and the
 * chain of frames falls apart on the second one.
 *
 * So this reassembles the two directions of the connection and walks the
 * framing as far as it goes. It reports how far that is, and what ids came
 * past — which is the whole basis for deciding whether the map can be read off
 * the wire or whether that road is closed.
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const CAPTURES = path.join(root, 'client-data', 'capture');
const PORT = 2050;

/* ---------------- pcapng, only the blocks that carry packets ---------------- */
function readPcapng(buffer) {
  const packets = [];
  let at = 0;
  let little = true;
  let linkType = 1;
  while (at + 12 <= buffer.length) {
    const type = little ? buffer.readUInt32LE(at) : buffer.readUInt32BE(at);
    if (type === 0x0a0d0d0a) {                    // Section Header
      const magic = buffer.readUInt32LE(at + 8);
      little = magic === 0x1a2b3c4d;
    }
    const length = little ? buffer.readUInt32LE(at + 4) : buffer.readUInt32BE(at + 4);
    if (length < 12 || at + length > buffer.length) break;
    if (type === 0x00000001) {                    // Interface Description
      linkType = little ? buffer.readUInt16LE(at + 8) : buffer.readUInt16BE(at + 8);
    } else if (type === 0x00000006) {             // Enhanced Packet
      const captured = little ? buffer.readUInt32LE(at + 20) : buffer.readUInt32BE(at + 20);
      packets.push({ data: buffer.subarray(at + 28, at + 28 + captured), linkType });
    }
    at += length;
  }
  return packets;
}

/*
 * Ethernet or raw IP in, TCP payload out. Loopback on Windows comes through
 * as a null/loopback link type, so the offset to the IP header is not fixed.
 */
function tcpOf(packet) {
  const b = packet.data;
  let at = 0;
  if (packet.linkType === 1) {
    if (b.length < 14) return null;
    const ethertype = b.readUInt16BE(12);
    if (ethertype === 0x0800) at = 14;
    else if (ethertype === 0x86dd) at = 14;
    else return null;
  } else if (packet.linkType === 0 || packet.linkType === 228 || packet.linkType === 101) {
    at = packet.linkType === 0 ? 4 : 0;
  } else {
    at = 0;
  }
  if (at + 20 > b.length) return null;
  const version = b[at] >> 4;
  let protocol, ipHeader, source, destination;
  if (version === 4) {
    ipHeader = (b[at] & 0x0f) * 4;
    protocol = b[at + 9];
    source = b.subarray(at + 12, at + 16).join('.');
    destination = b.subarray(at + 16, at + 20).join('.');
  } else if (version === 6) {
    ipHeader = 40;
    protocol = b[at + 6];
    source = 'v6';
    destination = 'v6';
  } else return null;
  if (protocol !== 6) return null;
  const tcp = at + ipHeader;
  if (tcp + 20 > b.length) return null;
  const sourcePort = b.readUInt16BE(tcp);
  const destinationPort = b.readUInt16BE(tcp + 2);
  const sequence = b.readUInt32BE(tcp + 4);
  const dataOffset = (b[tcp + 12] >> 4) * 4;
  const payload = b.subarray(tcp + dataOffset);
  if (!payload.length) return null;
  return { source, destination, sourcePort, destinationPort, sequence, payload };
}

/* ---------------- walk the framing ---------------- */
const plausible = (stream, at) => {
  if (at + 5 > stream.length) return 0;
  const length = stream.readUInt32BE(at);
  return (length >= 5 && length <= 262144 && at + length <= stream.length) ? length : 0;
};

/*
 * Walk the framing, and pick it up again after a hole.
 *
 * A capture drops packets — a few per cent of a busy stream — and one missing
 * segment breaks the chain for everything after it. Rather than stopping
 * there, this scans forward for a byte that starts a length which chains
 * three more times: one plausible length is a coincidence, four in a row is
 * the frame boundary. What is skipped is counted and reported, because a
 * reader that silently invents its own alignment is worse than one that stops.
 */
function frames(stream) {
  const found = [];
  let at = 0;
  let skipped = 0;
  let resyncs = 0;
  while (at + 5 <= stream.length) {
    const length = plausible(stream, at);
    if (length) { found.push({ at, length, id: stream[at + 4] }); at += length; continue; }
    let scan = at + 1;
    let regained = -1;
    while (scan + 5 <= stream.length) {
      let probe = scan, chain = 0;
      while (chain < 4) {
        const next = plausible(stream, probe);
        if (!next) break;
        probe += next; chain++;
      }
      if (chain >= 4) { regained = scan; break; }
      scan++;
    }
    if (regained < 0) { skipped += stream.length - at; break; }
    skipped += regained - at;
    resyncs++;
    at = regained;
  }
  return { found, skipped, resyncs, consumed: stream.length - skipped };
}

/* ---------------- shared with find-tile-packet.js ---------------- */
function newest(dir) {
  if (!fs.existsSync(dir)) return null;
  const pcaps = fs.readdirSync(dir).filter(name => name.endsWith('.pcapng')).sort();
  return pcaps.length ? path.join(dir, pcaps[pcaps.length - 1]) : null;
}

// Every connection direction in a capture, rebuilt and framed.
function streamsOf(file, port) {
  const packets = readPcapng(fs.readFileSync(file));
  const grouped = new Map();
  for (const packet of packets) {
    const tcp = tcpOf(packet);
    if (!tcp) continue;
    if (tcp.sourcePort !== port && tcp.destinationPort !== port) continue;
    const key = tcp.source + ':' + tcp.sourcePort + ' -> ' + tcp.destination + ':' + tcp.destinationPort;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(tcp);
  }
  const out = [];
  for (const [name, list] of grouped) {
    const base = list[0].sequence;
    const offsetOf = tcp => {
      let d = (tcp.sequence - base) >>> 0;
      if (d > 0x80000000) d -= 0x100000000;
      return d;
    };
    let low = 0, high = 0;
    for (const tcp of list) {
      const at = offsetOf(tcp);
      if (at < low) low = at;
      if (at + tcp.payload.length > high) high = at + tcp.payload.length;
    }
    const span = high - low;
    if (span <= 0 || span > 512 * 1024 * 1024) continue;
    const bytes = Buffer.alloc(span);
    for (const tcp of list) tcp.payload.copy(bytes, offsetOf(tcp) - low);
    out.push({
      name, bytes,
      fromPort: list[0].sourcePort,
      toPort: list[0].destinationPort,
      frames: frames(bytes).found
    });
  }
  return out;
}

module.exports = { newest, streamsOf, readPcapng, tcpOf, frames };

if (require.main !== module) return;

/* ---------------- do it ---------------- */
let file = process.argv[2];
if (!file) {
  if (!fs.existsSync(CAPTURES)) {
    console.error('\n  Nothing captured yet. From an administrator PowerShell:'
      + '\n    .\\tools\\capture-realm.ps1 -Seconds 120\n');
    process.exit(1);
  }
  const pcaps = fs.readdirSync(CAPTURES).filter(name => name.endsWith('.pcapng')).sort();
  if (!pcaps.length) {
    console.error('\n  No .pcapng in ' + path.relative(root, CAPTURES)
      + '. The .etl needs converting:\n    pktmon etl2pcap <file>.etl --out <file>.pcapng\n');
    process.exit(1);
  }
  file = path.join(CAPTURES, pcaps[pcaps.length - 1]);
}

console.log('\n  ' + path.relative(root, file) + '  ('
  + (fs.statSync(file).size / 1048576).toFixed(1) + ' MB)');
const packets = readPcapng(fs.readFileSync(file));
console.log('  ' + packets.length.toLocaleString('en-US') + ' packets');

/*
 * One stream per connection and direction — not per direction alone.
 *
 * There can be more than one connection on this port at once, and merging them
 * interleaves two unrelated byte streams, so the framing of the result is
 * meaningless. That was this tool's first mistake.
 *
 * And a segment is placed at its sequence offset rather than appended in
 * sorted order. TCP sequence numbers start at a random value and wrap at 2^32;
 * sorting them puts a wrapped stream back to front. Placing each segment where
 * it belongs relative to the lowest one seen is what actually rebuilds the
 * stream — and it shows a missed packet as a hole rather than hiding it by
 * closing the gap.
 */
const streams = new Map();
let onPort = 0;
for (const packet of packets) {
  const tcp = tcpOf(packet);
  if (!tcp) continue;
  if (tcp.sourcePort !== PORT && tcp.destinationPort !== PORT) continue;
  onPort++;
  const key = tcp.source + ':' + tcp.sourcePort + ' -> ' + tcp.destination + ':' + tcp.destinationPort;
  if (!streams.has(key)) streams.set(key, []);
  streams.get(key).push(tcp);
}
console.log('  ' + onPort.toLocaleString('en-US') + ' of them on TCP ' + PORT);
console.log('  ' + streams.size + ' connection direction' + (streams.size === 1 ? '' : 's') + '\n');

if (!onPort) {
  console.log('  Nothing on the game port. Was the client connected while it ran?\n');
  process.exit(0);
}

// Biggest first: the stream carrying the world is the one worth reading.
const ordered = [...streams].sort((a, b) =>
  b[1].reduce((n, t) => n + t.payload.length, 0) - a[1].reduce((n, t) => n + t.payload.length, 0));

let holes = 0;
for (const [name, list] of ordered) {
  // 32-bit sequence arithmetic, with a wrap treated as the short distance it
  // is rather than a leap of four gigabytes.
  const base = list[0].sequence;
  const offsetOf = tcp => {
    let d = (tcp.sequence - base) >>> 0;
    if (d > 0x80000000) d -= 0x100000000;
    return d;
  };
  let low = 0, high = 0;
  for (const tcp of list) {
    const at = offsetOf(tcp);
    if (at < low) low = at;
    if (at + tcp.payload.length > high) high = at + tcp.payload.length;
  }
  const span = high - low;
  if (span <= 0 || span > 512 * 1024 * 1024) continue;
  const stream = Buffer.alloc(span);
  const filled = new Uint8Array(span);
  for (const tcp of list) {
    const at = offsetOf(tcp) - low;
    tcp.payload.copy(stream, at);
    filled.fill(1, at, at + tcp.payload.length);
  }
  holes = 0;
  for (let i = 0; i < span; i++) if (!filled[i]) holes++;
  const parts = list;
  const { found, skipped, resyncs, consumed } = frames(stream);
  const share = stream.length ? (100 * consumed / stream.length) : 0;

  console.log('  ' + name);
  console.log('    ' + (stream.length / 1024).toFixed(0) + ' KB from '
    + parts.length.toLocaleString('en-US') + ' segments'
    + (holes ? ', ' + (100 * holes / stream.length).toFixed(1) + '% never captured' : ', no gaps'));
  console.log('    ' + found.length.toLocaleString('en-US') + ' messages framed, '
    + share.toFixed(1) + '% of the stream'
    + (resyncs ? ', picked up again ' + resyncs + ' time' + (resyncs === 1 ? '' : 's') : ''));
  if (found.length > 2) {
    const ids = new Map();
    for (const frame of found) ids.set(frame.id, (ids.get(frame.id) || 0) + 1);
    const top = [...ids].sort((a, b) => b[1] - a[1]).slice(0, 10);
    console.log('    ids: ' + top.map(([id, n]) => id + ' x' + n).join(', '));
    const sizes = found.map(f => f.length).sort((a, b) => a - b);
    console.log('    message sizes: smallest ' + sizes[0]
      + ', median ' + sizes[Math.floor(sizes.length / 2)]
      + ', largest ' + sizes[sizes.length - 1]);

    /*
     * Framing cleanly is not the same as being readable, and that is the thing
     * this tool learned the hard way: the length and the id travel in the
     * clear, the body does not. Entropy tells them apart. Structured data —
     * counts, coordinates, type numbers repeating — sits well under seven bits
     * a byte. A cipher's output sits at eight and stays there.
     */
    const bodies = found.map(f => stream.subarray(f.at + 5, f.at + f.length)).filter(b => b.length > 32);
    if (bodies.length) {
      const sample = Buffer.concat(bodies.slice(0, 400));
      const counts = new Array(256).fill(0);
      for (const byte of sample) counts[byte]++;
      let bits = 0;
      for (const n of counts) { if (!n) continue; const p = n / sample.length; bits -= p * Math.log2(p); }
      console.log('    body entropy: ' + bits.toFixed(2) + ' bits a byte — '
        + (bits > 7.5 ? 'encrypted' : bits > 6 ? 'compressed, or packed very tight' : 'plain structured data'));
    }
  }
  console.log('');
}

console.log('  The framing is in the clear: a stream that chains end to end is the');
console.log('  game\'s, and the ids above are real. Whether anything can be read out');
console.log('  of it is the entropy line — eight bits a byte is a cipher, and no');
console.log('  amount of capturing gets past that.\n');
