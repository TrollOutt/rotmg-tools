'use strict';
/*
 * The client's objects, read straight from its XML.
 *
 * client-data/Objects.NNN.xml holds every object the game declares. Three
 * things about those files cost real time to find out and are written down
 * here so they are not found out again:
 *
 *   - the attributes of <Object> come in any order: id= may precede type=, and
 *     there may be others (collectionIcon=, setType=...);
 *   - some files hold several XML documents one after the other (an empty
 *     <Objects /> and then a second root), so a reader that stops at the first
 *     root loses hundreds of objects;
 *   - an object is found by its id or by the hexadecimal type other objects use
 *     to point at it (a BulletCreate's type="0xbbcb").
 *
 * It needs client-data/, the extraction of an installed client, which a
 * checkout of the repository does not have: `available()` says whether it is
 * there.
 */
const fs = require('fs');
const path = require('path');

const CLIENT = process.env.ROTMG_CLIENT_DATA || path.join(__dirname, '..', 'client-data');
const available = () => fs.existsSync(CLIENT) && fs.readdirSync(CLIENT).some(f => /^Objects\.\d+\.xml$/.test(f));

let cache = null;
function load() {
  if (cache) return cache;
  const byId = new Map(), byType = new Map();
  for (const file of fs.readdirSync(CLIENT).filter(f => /^Objects\.\d+\.xml$/.test(f))) {
    const text = fs.readFileSync(path.join(CLIENT, file), 'utf8');
    for (const m of text.matchAll(/<Object\s+([^>]*)>([\s\S]*?)<\/Object>/g)) {
      const id = (/\bid="([^"]*)"/.exec(m[1]) || [])[1], type = (/\btype="([^"]*)"/.exec(m[1]) || [])[1];
      if (id === undefined) continue;
      byId.set(id, m[2]);
      if (type) byType.set(Number(type), { id, body: m[2] });
    }
  }
  cache = { byId, byType };
  return cache;
}

const tag = (body, name) => { const m = new RegExp('<' + name + '(?: [^>]*)?>([^<]*)</' + name + '>').exec(body); return m ? m[1] : undefined; };
const attributes = text => Object.fromEntries([...String(text).matchAll(/([A-Za-z]+)="([^"]*)"/g)].map(m => [m[1], m[2]]));

module.exports = { CLIENT, available, load, tag, attributes };
