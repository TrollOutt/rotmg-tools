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
function frames(stream) {
  const found = [];
  let at = 0;
  let broke = null;
  while (at + 5 <= stream.length) {
    const length = stream.readUInt32BE(at);
    // A message is at least its own header and no bigger than the game has
    // any reason to send.
    if (length < 5 || length > 262144 || at + length > stream.length) { broke = at; break; }
    found.push({ at, length, id: stream[at + 4] });
    at += length;
  }
  return { found, broke, consumed: at };
}

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

// One stream per direction, ordered by sequence number so retransmissions and
// reordering do not corrupt the framing.
const streams = new Map();
let onPort = 0;
for (const packet of packets) {
  const tcp = tcpOf(packet);
  if (!tcp) continue;
  if (tcp.sourcePort !== PORT && tcp.destinationPort !== PORT) continue;
  onPort++;
  const key = tcp.sourcePort === PORT ? 'server -> client' : 'client -> server';
  if (!streams.has(key)) streams.set(key, []);
  streams.get(key).push(tcp);
}
console.log('  ' + onPort.toLocaleString('en-US') + ' of them on TCP ' + PORT + '\n');

if (!onPort) {
  console.log('  Nothing on the game port. Was the client connected while it ran?\n');
  process.exit(0);
}

for (const [name, list] of streams) {
  list.sort((a, b) => a.sequence - b.sequence);
  const seen = new Set();
  const parts = [];
  for (const tcp of list) {
    if (seen.has(tcp.sequence)) continue;          // a retransmission
    seen.add(tcp.sequence);
    parts.push(tcp.payload);
  }
  const stream = Buffer.concat(parts);
  const { found, broke, consumed } = frames(stream);
  const share = stream.length ? (100 * consumed / stream.length) : 0;

  console.log('  ' + name);
  console.log('    ' + (stream.length / 1024).toFixed(0) + ' KB reassembled from '
    + parts.length.toLocaleString('en-US') + ' segments');
  console.log('    ' + found.length.toLocaleString('en-US') + ' messages framed, '
    + share.toFixed(1) + '% of the stream'
    + (broke === null ? '' : ' (framing broke at byte ' + broke + ')'));
  if (found.length > 2) {
    const ids = new Map();
    for (const frame of found) ids.set(frame.id, (ids.get(frame.id) || 0) + 1);
    const top = [...ids].sort((a, b) => b[1] - a[1]).slice(0, 10);
    console.log('    ids: ' + top.map(([id, n]) => id + ' x' + n).join(', '));
    const sizes = found.map(f => f.length).sort((a, b) => a - b);
    console.log('    message sizes: smallest ' + sizes[0]
      + ', median ' + sizes[Math.floor(sizes.length / 2)]
      + ', largest ' + sizes[sizes.length - 1]);
  }
  console.log('');
}

console.log('  A stream that frames cleanly for most of its length is plaintext,');
console.log('  and the map can be read off it. One that breaks on the second');
console.log('  message is encrypted, and this road is closed.\n');
