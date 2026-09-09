'use strict';

// The index and bench use different names for a few fields. Keep those
// translations here so the index card can retain its existing public shape.
const fields = {
  items: 'name id hand slot sb tier bag mp rate many fan worn share rel burst shots does cast set cool labels art pic icon',
  classes: 'name about hp hpTop mp mpTop att attTop def defTop spd spdTop dex dexTop vit vitTop wis wisTop grow slots kit art pic',
  enchants: 'id name says labels fits notFits notWith notOn weight worn mul sub rel heal alters pic',
  sets: 'name pieces steps',
  bosses: 'name id hp def god hero quest art strip pic'
};
const kinds = { items: 'item', classes: 'class', enchants: 'enchant', sets: 'set', bosses: 'enemy' };
function key(group, field) {
  if (field === 'id') return 'clientId';
  /*
   * The picture of an item is the index's own picture: the rectangle it cut
   * out of the client, on the sheet every page of this site draws from. The
   * bench used to look items up in a folder of downloaded wiki renders and
   * fall back to a second sheet of its own, so the same item had two pictures
   * and sometimes none. It carries the index's rectangle now, like everything
   * else it knows.
   */
  if (field === 'icon') return 'art';
  if (['art', 'strip', 'pic'].includes(field)) return 'bench' + field[0].toUpperCase() + field.slice(1);
  if (group === 'items') return ({ shots: 'fires', does: 'activate' })[field] || field;
  if (group === 'enchants') return ({ says: 'about', notFits: 'refuses', notWith: 'beside' })[field] || field;
  return field;
}
function assign(record, group, value) {
  for (const field of fields[group].split(' ')) {
    // `icon` is read off the record on the way out; nothing puts it there.
    if (field === 'name' || field === 'icon') continue;
    let v = value[field];
    if (group === 'classes' && /^(hp|mp|att|def|spd|dex|vit|wis)(Top)?$/.test(field)) {
      (record.stats ||= {})[field] = v; continue;
    }
    if (field === 'labels') v = v ? v.split(',') : undefined;
    if (field === 'sb') v = v ? true : undefined;
    record[key(group, field)] = v;
  }
}
function attach(records, mechanics, objects) {
  const lookup = new Map();
  for (const record of records.values()) {
    lookup.set(record.kind + '|' + (record.alias || record.name), record);
    if (record.kind === 'item') delete record.bench;
  }
  // All item declarations carry mechanics, including items the bench excludes.
  for (const one of objects) {
    const r = lookup.get('item|' + one.id);
    if (!r) continue;
    assign(r, 'items', mechanics.itemOf(one, r.hand, r.slot, (r.labels || []).join(',')));
    const conditions = require('./item-conditions')(one.body);
    if (conditions.length) r.conditions = conditions;
  }
  const view = {};
  for (const group of Object.keys(fields)) {
    view[group] = mechanics[group].map(value => {
      const r = lookup.get(kinds[group] + '|' + (value.id || value.name));
      if (!r) throw new Error('No index record for ' + group + ': ' + (value.id || value.name));
      assign(r, group, value);
      if (group === 'items') r.bench = 1;
      return r.id;
    });
  }
  /*
   * Why the bench does not offer it, in words that are true of the thing.
   *
   * There was one fallback reason and it was a duplicate's reason, so once the
   * index started holding dyes, marks and pet skins, five thousand of them
   * were told they were another copy of a name the bench already had. They are
   * not copies of anything; they are not gear. The family the client gives
   * them says so, and saying so is cheaper than a reader working it out.
   */
  const article = say => (/^[aeiou]/.test(say) ? 'an ' : 'a ') + say;
  for (const r of records.values()) {
    if (r.kind === 'item' && !r.bench && !r.hidden?.length) {
      r.benchWhy = r.family && r.family !== 'other'
        ? article(r.family) + ', not gear anybody wears'
        : r.family === 'other' ? 'not gear anybody wears'
        : r.use ? 'consumable; not worn on the bench'
        : 'another copy of a name offered on the bench';
    }
  }
  return view;
}
function project(index, runtime = false) {
  const records = new Map(index.records.map(r => [r.id, r]));
  const out = {};
  if (!index.views?.theory) throw new Error('Index lacks mechanics; rebuild the index first.');
  for (const group of Object.keys(fields)) {
    out[group] = index.views.theory[group].map(id => {
      const r = records.get(id);
      if (!r || (group === 'items' && !r.bench)) throw new Error('Invalid theory projection member: ' + id);
      const value = {};
      for (const field of fields[group].split(' ')) {
        let v = group === 'classes' && /^(hp|mp|att|def|spd|dex|vit|wis)(Top)?$/.test(field)
          ? r.stats?.[field] : r[key(group, field)];
        if (field === 'labels') v = v?.join(',') || undefined;
        if (field === 'sb') v = v ? 1 : undefined;
        if (group === 'enchants' && ['fits', 'notFits', 'notWith', 'notOn'].includes(field)) v ||= undefined;
        if (v !== undefined) value[field] = v;
      }
      if (runtime && group === 'items') delete value.id;
      return value;
    });
  }
  return out;
}
function artwork(index, theory) {
  const records = new Map(index.records.map(r => [r.id, r]));
  for (const group of Object.keys(fields)) {
    theory[group].forEach((value, i) => {
      const record = records.get(index.views.theory[group][i]);
      for (const field of ['art', 'pic']) if (value[field] !== undefined) record[key(group, field)] = value[field];
    });
  }
  index.theorySheet = theory.sheet;
}
module.exports = { attach, project, artwork };
