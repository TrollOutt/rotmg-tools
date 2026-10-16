'use strict';
const vm = require('vm'), assert = require('assert/strict');

// Ordered object graph, including undefined/non-finite values and source aliases.
// The fixture contains values recorded before extraction, not legacy algorithms.
function graph(value) {
  const seen = new Map(), nodes = [];
  function visit(v) {
    if (v === undefined) return ['undefined'];
    if (typeof v === 'number' && !Number.isFinite(v)) return ['number', String(v)];
    if (Object.is(v, -0)) return ['number', '-0'];
    if (v === null || typeof v !== 'object') return v;
    if (seen.has(v)) return ['ref', seen.get(v)];
    const id = nodes.length;
    seen.set(v, id); nodes.push(null);
    nodes[id] = Array.isArray(v) ? ['array', Array.from(v, visit)]
      : ['object', Object.keys(v).map(k => [k, visit(v[k])])];
    return ['ref', id];
  }
  return { root: visit(value), nodes };
}
function decode(g) {
  const nodes = g.nodes.map(n => n[0] === 'array' ? [] : {});
  function read(v) {
    if (!Array.isArray(v)) return v;
    if (v[0] === 'ref') return nodes[v[1]];
    if (v[0] === 'undefined') return undefined;
    if (v[0] === 'number') return v[1] === '-0' ? -0 : Number(v[1]);
    throw Error('Unknown fixture tag');
  }
  g.nodes.forEach((n, i) => {
    if (n[0] === 'array') nodes[i].push(...n[1].map(read));
    else for (const [k, v] of n[1]) nodes[i][k] = read(v);
  });
  return read(g.root);
}

// Execute the real mount adapter up to its first canvas access. No data logic
// is copied here: imports and the graphics continuation alone are left out.
function run({ source, dataModule, input, answer }) {
  const calls = [], pending = []; let creations = 0;
  const root = { innerHTML: '' }, host = { dataset: {}, shadowRoot: root };
  const page = { console, URL, Map, Set, Promise, Uint16Array, Error, Number, Object, Array, String, Boolean, Math,
    window: {}, fetch(url) { const key = String(url); calls.push(key); return answer(key, pending, input); } };
  vm.runInNewContext(dataModule, page);
  const create = page.SkinViewerData.createCatalogueData;
  page.SkinViewerData.createCatalogueData = deps => { creations++; return create(deps); };
  source = source.replace(/\r\n/g, '\n');
  const end = source.indexOf('\nconst canvas=');
  assert(end > 0 && source.slice(0, end).includes('async function createViewer('), 'Viewer data boundary moved');
  const prefix = source.slice(0, end).replace(/^import .*;\n/gm, '').replace(/\bexport /g, '')
    .replaceAll('import.meta.url', JSON.stringify('http://127.0.0.1/skins/app.js'));
  vm.runInNewContext(prefix + '\nreturn{skins,undrawn,dyes,classes,indexBridge,setActive(){}};}\nglobalThis.adapter={mount,unmount};', page);
  return { api: page.adapter, host, calls, pending, creations: () => creations };
}
const response = (key, input) => ({ ok: true, status: 200, text: () => Promise.resolve('<main></main>'),
  json: () => Promise.resolve(key.endsWith('/skins.json') ? input.skinCatalogue : key.endsWith('/dyes.json')
    ? input.dyeCatalogue : key.endsWith('/classes.json') ? input.classCatalogue : key.endsWith('/looks.json') ? input.looks : {}),
  arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)) });
const flush = async () => { for (let i = 0; i < 20; i++) await new Promise(r => setImmediate(r)); };
module.exports = { graph, decode, run, response, flush };
