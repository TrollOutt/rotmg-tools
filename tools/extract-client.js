'use strict';
/*
 * Pull every XML document out of an installed RotMG client into client-data/.
 *
 *   node tools/extract-client.js [--client <dir>]
 *
 * No selection: whatever the client carries comes out, one file per document,
 * named by its root element. Earlier passes over this data went looking for
 * two files by name and therefore only ever found two — which is how
 * EnchanterSettings, and 158 of the 159 Objects documents, stayed unread.
 *
 * The client stores these as plain uncompressed UTF-8 text inside
 * resources.assets, so no Unity asset parser is involved: find the XML
 * declaration, read to the matching close tag, write it out.
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const OUT = path.join(root, 'client-data');

const DEFAULT_CLIENTS = [
  path.join(process.env.LOCALAPPDATA || '', 'RealmOfTheMadGod', 'Production'),
  'C:/Program Files (x86)/Steam/steamapps/common/Realm of the Mad God Exalt'
];

function findClient(given) {
  for (const base of given ? [given] : DEFAULT_CLIENTS) {
    // Steam's current launcher calls this folder "RotMG Exalt Launcher_Data";
    // older installations used the shorter Exalt name.  The resources file is
    // the same, so accept both rather than making the caller point at an
    // internal Unity folder.
    for (const folder of ['RotMG Exalt_Data', 'RotMG Exalt Launcher_Data', 'Realm of the Mad God Exalt_Data', '']) {
      const assets = path.join(base, folder, 'resources.assets');
      if (fs.existsSync(assets)) return { base, assets };
    }
  }
  return null;
}

const givenAt = process.argv.indexOf('--client');
const client = findClient(givenAt > 0 ? process.argv[givenAt + 1] : null);
if (!client) {
  console.error('\n  No installed client found. Looked in:');
  for (const base of DEFAULT_CLIENTS) console.error(`    ${base}`);
  console.error('  Pass one with --client <dir>.\n');
  process.exit(1);
}

const started = Date.now();
const size = fs.statSync(client.assets).size;

/*
 * Read in overlapping windows rather than all at once: the file is ~400 MB and
 * the documents live in a band near the end, but nothing guarantees that stays
 * true, so the whole file is swept. The overlap has to exceed the largest
 * document; 64 MB is comfortably more than the biggest one here (~2 MB).
 */
const WINDOW = 64 * 1024 * 1024;
const OVERLAP = 8 * 1024 * 1024;
const handle = fs.openSync(client.assets, 'r');
const buffer = Buffer.alloc(WINDOW);

const documents = new Map();   // root element -> array of texts
let position = 0;

while (position < size) {
  const read = fs.readSync(handle, buffer, 0, WINDOW, position);
  if (!read) break;
  const text = buffer.toString('utf8', 0, read);
  const opening = /<\?xml[^>]*\?>\s*<([A-Za-z_][\w.\-]*)[\s>]/g;
  let match;
  while ((match = opening.exec(text))) {
    const name = match[1];
    const close = `</${name}>`;
    const end = text.indexOf(close, match.index);
    if (end < 0) continue;                       // straddles the window; the overlap catches it
    const document = text.slice(match.index, end + close.length);
    if (!documents.has(name)) documents.set(name, []);
    const list = documents.get(name);
    if (!list.includes(document)) list.push(document);
  }
  if (read < WINDOW) break;
  position += WINDOW - OVERLAP;
}
fs.closeSync(handle);

fs.mkdirSync(OUT, { recursive: true });
for (const file of fs.readdirSync(OUT)) if (file.endsWith('.xml')) fs.unlinkSync(path.join(OUT, file));

console.log(`\n  ${path.basename(client.base)} — ${(size / 1048576).toFixed(0)} MB read in ${((Date.now() - started) / 1000).toFixed(1)} s\n`);

let total = 0;
let bytes = 0;
for (const [name, list] of [...documents].sort((a, b) => a[0].localeCompare(b[0]))) {
  // One document keeps its plain name; several are numbered, sorted so the
  // numbering is the same on every machine and every run.
  const sorted = [...list].sort();
  sorted.forEach((document, index) => {
    const file = sorted.length === 1 ? `${name}.xml` : `${name}.${String(index + 1).padStart(3, '0')}.xml`;
    fs.writeFileSync(path.join(OUT, file), document, 'utf8');
    bytes += document.length;
  });
  total += sorted.length;
  console.log(`    ${String(sorted.length).padStart(4)}  ${name}`);
}

console.log(`\n  ${total} documents, ${(bytes / 1048576).toFixed(1)} MB -> client-data/\n`);
