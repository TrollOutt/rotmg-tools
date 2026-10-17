'use strict';
const vm = require('vm'), crypto = require('crypto');
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
    // Array.from creates host-realm arrays even when v came from a VM.
    const tag = Object.prototype.toString.call(v);
    nodes[id] = Array.isArray(v) ? ['array', Array.from(v, visit)]
      : tag === '[object Map]' ? ['map', Array.from(v, ([key, entry]) => [visit(key), visit(entry)])]
      : tag === '[object Set]' ? ['set', Array.from(v, visit)]
      : ['object', Object.keys(v).map(k => [k, visit(v[k])])];
    return ['ref', id];
  }
  return { root: visit(value), nodes };
}
function decode(g) {
  const nodes = g.nodes.map(n => n[0] === 'array' ? [] : n[0] === 'map' ? new Map() : n[0] === 'set' ? new Set() : {});
  function read(v) {
    if (!Array.isArray(v)) return v;
    if (v[0] === 'ref') return nodes[v[1]];
    if (v[0] === 'undefined') return undefined;
    if (v[0] === 'number') return v[1] === '-0' ? -0 : Number(v[1]);
    throw Error('Unknown fixture tag');
  }
  g.nodes.forEach((n, i) => {
    if (n[0] === 'array') nodes[i].push(...n[1].map(read));
    else if (n[0] === 'map') for (const [k, v] of n[1]) nodes[i].set(read(k), read(v));
    else if (n[0] === 'set') for (const v of n[1]) nodes[i].add(read(v));
    else for (const [k, v] of n[1]) nodes[i][k] = read(v);
  });
  return read(g.root);
}

function makeApi({ source, dataModule = '', input, fetcher, bundle }) {
  const asked = [];
  let callbacks = 0, creations = 0;
  const context = { A: input.atlas, __kin: input.kin, BASE: '/atlas/', window: {},
    fetch: url => { asked.push(url); return fetcher ? fetcher(url) : Promise.resolve({ ok: true, json: () => Promise.resolve(input.files[url]) }); } };
  context.window.parent = bundle ? { ROTMG_BUNDLE: bundle } : context.window;
  const start = source.indexOf('let known = null, knownAsked = false;');
  const end = source.indexOf('/* Whichever panel is open is drawn again once all of that arrives. */');
  if (start < 0 || end < start) throw Error('Atlas panel boundary missing');
  if (dataModule) {
    vm.runInNewContext(dataModule, context);
    const create = context.AtlasData.createPanelData;
    context.AtlasData.createPanelData = deps => { creations++; return create(deps); };
  }
  vm.runInNewContext(source.slice(start, end).replace('/*LOOTKIN*/null', '__kin')
    + ';this.api={knownName,kinOf,knownId,portalOf,blueprintFor,askKnown,readKnown,getKnown:()=>known};', context);
  return { ...context.api, asked, creations: () => creations,
    load: async () => { context.api.askKnown(() => callbacks++); context.api.askKnown(() => callbacks++); await flush(); return callbacks; } };
}
async function flush() { for (let i = 0; i < 30; i++) await Promise.resolve(); }
const digest = value => crypto.createHash('sha256').update(JSON.stringify(graph(value))).digest('hex');
async function project(input, options) {
  const a = makeApi({ ...options, input });
  const before = [a.knownId('a', ['item']), a.getKnown(), a.asked.slice()];
  const callbacks = await a.load(), known = a.getKnown();
  const names = [...new Set([
    ...((input.files['/atlas/../index/wiki.json'] || {}).ids || []).filter(x => typeof x === 'string').map(x => x.slice(x.indexOf(':') + 1)),
    ...Object.keys((input.files['/atlas/../index/item-art.json'] || {}).art || {}),
    ...Object.values((input.files['/atlas/../../realmeye-data.json'] || {}).creatures || {}).map(x => x.name),
    null, undefined, '', '  ÉTOILE  ', 'Davy Jones’ Locker', "Davy Jones' Locker", 'étoile', 'etoile', 'No such record'
  ])];
  const queries = names.map(name => [name, a.knownName(name), a.knownId(name, ['enemy', 'portal', 'item']),
    a.knownId(name, ['item', 'portal', 'enemy']), a.kinOf.group(name), a.kinOf.mundane(name), a.portalOf(name)]);
  const beside = ['Helm of the Juggernaut', 'Juggernaut Blueprint', 'Juggernaut Blueprint', 'Étoile', 'Étoile Blueprint',
    'Blueprint', ' Blueprint', 'A Blueprint', '  a  ', 'a blueprint'];
  const pairs = beside.map(n => [n, a.blueprintFor(n, beside)]);
  return { before, callbacks, asked: a.asked, known: { ...known, ids: [...known.ids], drops: [...known.drops], pics: [...known.pics], named: [...known.named] }, queries, pairs };
}
async function journal(options) {
  const rows = [];
  for (const mode of ['http', 'objects', 'text', 'bad-text', 'not-ok', 'rejected', 'bad-json']) {
    const input = { atlas: null, kin: null, files: {} };
    const payloads = [{ ids: ['enemy:Étoile'] }, { creatures: {} }, { art: { Étoile: [0, 0, 8, 8] } }];
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const replies = [], callbacks = [];
    let count = 0;
    const a = makeApi({ ...options, input,
      bundle: ['objects', 'text', 'bad-text'].includes(mode) ? { sources: {
        wikiText: mode === 'objects' ? payloads[0] : mode === 'text' ? JSON.stringify(payloads[0]) : '{',
        realmLootText: mode === 'objects' ? payloads[1] : JSON.stringify(payloads[1])
      }, itemArt: mode === 'objects' ? payloads[2] : JSON.stringify(payloads[2]), indexSheet: 'host-sheet' } : null,
      fetcher: url => { const index = count++; replies.push(['request', index]);
        return gate.then(() => { replies.push(['reply', index]); if (mode === 'rejected') throw Error('network');
          return { ok: mode !== 'not-ok', json() { replies.push(['json', index]); return mode === 'bad-json' ? Promise.reject(Error('json')) : Promise.resolve(payloads[index]); } }; }); }
    });
    const returned = a.askKnown(() => callbacks.push('first'));
    a.askKnown(() => callbacks.push('concurrent'));
    await flush();
    const pending = [a.asked.slice(), callbacks.slice(), a.getKnown() === null, returned];
    release(); await flush();
    const held = a.getKnown(); a.askKnown(() => callbacks.push('retry')); await flush();
    rows.push({ mode, pending, asked: a.asked, replies, callbacks, same: held === a.getKnown(), known: {
      ids: [...held.ids], drops: [...held.drops], pics: [...held.pics], named: [...held.named], sheet: held.sheet, wide: held.wide, tall: held.tall } });
  }
  return rows;
}
module.exports = { makeApi, flush, digest, project, journal, graph, decode };
