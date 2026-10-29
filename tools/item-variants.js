'use strict';
/*
 * One name on screen, several items.
 *
 * The client declares the Beehemoth Armor four times under one display name,
 * and the four are not copies: the yellow one gives Dexterity, the red one
 * Vitality, the blue one Wisdom, the green one Life. Folding them into one
 * row kept whichever came out best and lost the other three.
 *
 * Copies of a name whose worn bonuses differ are told apart by what their
 * client ids do not share - "EH Red Bee Armor" against "EH Blue Bee Armor"
 * says Red and Blue. Only when every copy has such a word, and the words
 * differ, is the name split; anything else (a shiny, a Retro beside the
 * plain one, a working name with nothing in common) stays one row as before.
 */

/** @param {string} body @returns {string} */
function wornOf(body) {
  return [...body.matchAll(/<ActivateOnEquip\b([^>]*)>IncrementStat<\/ActivateOnEquip>/g)]
    .map(m => {
      const stat = (/\bstat="([^"]+)"/.exec(m[1]) || [])[1];
      const amount = (/\bamount="([^"]+)"/.exec(m[1]) || [])[1];
      return stat + amount;
    }).sort().join(',');
}

/**
 * @param {{id: string, name: string, body: string, shiny?: boolean}[]} list
 * @returns {Map<string, string>} client id -> the word that tells it apart
 */
function variantsOf(list) {
  const groups = new Map();
  for (const one of list) {
    if (one.shiny) continue;
    (groups.get(one.name) || groups.set(one.name, []).get(one.name)).push(one);
  }
  const out = new Map();
  for (const copies of groups.values()) {
    if (copies.length < 2) continue;
    if (new Set(copies.map(one => wornOf(one.body))).size < 2) continue;
    const words = copies.map(one => one.id.split(/\s+/));
    const shared = words[0].filter(word => words.every(list => list.includes(word)));
    if (!shared.length) continue;
    const said = words.map(list => list.filter(word => !shared.includes(word)).join(' '));
    if (said.some(word => !/^[A-Za-z][A-Za-z ]*$/.test(word))) continue;
    if (new Set(said).size !== said.length) continue;
    copies.forEach((one, i) => out.set(one.id, said[i]));
  }
  return out;
}

/** @param {string} name @param {string | undefined} variant */
const variantName = (name, variant) => (variant ? name + ' (' + variant + ')' : name);

module.exports = { variantsOf, variantName, wornOf };
