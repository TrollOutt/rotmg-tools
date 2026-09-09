'use strict';
// Extraction moved from generate-fame.js; source text is supplied by build-index.
module.exports = function(documents) {
const APOSTROPHE = String.fromCharCode(38, 97, 112, 111, 115, 59);
const unescapeXml = text => String(text)
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .split(APOSTROPHE).join(String.fromCharCode(39))
  .replace(/&amp;/g, '&');
const attr = (text, name) => {
  const match = new RegExp(name + '="([^"]*)"').exec(text);
  return match ? match[1] : null;
};
const tag = (text, name) => {
  const match = new RegExp('<' + name + '(?:[^>]*)>([\\s\\S]*?)</' + name + '>').exec(text);
  return match ? unescapeXml(match[1].trim()) : null;
};

// The document holding them; found rather than assumed, so a reshuffle of the
// client's own file numbering does not break this.
let xml = null;
for (const file of [...documents.keys()].filter(f => /^Objects\./.test(f))) {
  const text = documents.get(file);
  if (text.includes('<FameBonus')) { xml = text; break; }
}
if (!xml) {
  throw new Error('No FameBonus in source documents');
}

/* ---------------------------------------------------------------- *
 * 1. Which dungeon a completion stat counts                         *
 * ---------------------------------------------------------------- */
const dungeonOf = new Map();
for (const m of xml.matchAll(/<PlayerStat\b([^>]*)\/>/g)) {
  const id = attr(m[1], 'id');
  const dungeon = attr(m[1], 'dungeonId');
  if (id && dungeon) dungeonOf.set(id, unescapeXml(dungeon));
}

/* ---------------------------------------------------------------- *
 * 2. The bonuses                                                    *
 * ---------------------------------------------------------------- */
const bonuses = [];
for (const m of xml.matchAll(/<FameBonus[^>]*\bid="([^"]*)"[^>]*\bcode="([^"]*)"[^>]*>([\s\S]*?)<\/FameBonus>/g)) {
  const body = m[3];
  const conditions = [...body.matchAll(/<Condition([^>]*)>([^<]*)<\/Condition>/g)].map(c => ({
    kind: c[2].trim(),
    stat: attr(c[1], 'stat'),
    threshold: Number(attr(c[1], 'threshold')) || 0
  }));
  bonuses.push({
    id: m[1],
    code: Number(m[2]),
    group: tag(body, 'DisplayGroup') || '',
    category: tag(body, 'DisplayCategory') || '',
    name: (tag(body, 'DisplayName') || m[1]).replace(/\s*\{0\}\s*$/, ''),
    absolute: Number(tag(body, 'AbsoluteBonus')) || 0,
    relative: Number(tag(body, 'RelativeBonus')) || 0,
    repeatable: /<Repeatable\b/.test(body),
    description: (tag(body, 'Description') || '').replace(/\s+/g, ' '),
    conditions
  });
}

/* ---------------------------------------------------------------- *
 * 3. Write it                                                       *
 * ---------------------------------------------------------------- */

return { bonuses, dungeons: Object.fromEntries(dungeonOf) };
};
