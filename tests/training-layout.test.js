'use strict';
// Training Ground menu: no Level setting, a fixed internal level, and panels that never scroll on their own.
const assert = require('assert/strict');
const fs = require('fs'), path = require('path');
const read = file => fs.readFileSync(path.join(__dirname, '..', 'web/training', file), 'utf8').replace(/\r\n/g, '\n');

const html = read('ui.html'), code = read('ui_code.js'), game = read('ui_game.js');
const engine = read('engine.js'), shell = read('shell.css');

// Level is gone from the interface: the three editable totals are SPD, Max HP and DEF.
assert(!/Level/i.test(html), 'no Level label in the menu');
assert.deepEqual([...html.matchAll(/class="stat" data-key="(\w+)"/g)].map(m => m[1]), ['spd', 'hp', 'def']);
assert(!/Lv\b|Level/.test(code.match(/const rc=\[[^\n]*\n/)[0]), 'the run summary does not mention a level');

// The engine still needs one: it is pinned to the historical default, whatever an old save says,
// so scenarios, fixtures and record keys keep their meaning.
const engineLevel = engine.match(/hard: false, mode: 'solo', rspeed: 0[^}]*/)[0] && engine.match(/lvl: (\d+)/)[1];
assert.equal(engineLevel, '5');
assert.match(code, new RegExp('const FIXED_LEVEL=' + engineLevel + ';'));
assert(/function clampSettings\(\)\{SETTINGS\.lvl=FIXED_LEVEL;/.test(code), 'saved levels are overridden');
assert(!/lvl:\[/.test(code.match(/const LIM=\{[^}]*\}/)[0]), 'no editable range for the level');
assert(/lvl:SETTINGS\.lvl/.test(code), 'the engine still receives the pinned level');
assert(/o\.lvl/.test(game), 'record keys keep their level slot, so saved records stay readable');

// The settings steps fit the window: no panel owns a scrollbar, cards sit in two columns,
// and phones lose only text, never a choice.
assert(/no inner scrolling: every step fits the window/.test(shell));
const desktop = shell.slice(shell.indexOf('@media(min-width:761px){'));
assert(/\.pane\{overflow:hidden;padding:0\}/.test(desktop));
assert(/\.pane \.card,\.pane \.one\{overflow:visible;height:auto;max-height:100%\}/.test(desktop));
assert(/\.cols\{display:grid;grid-template-columns:/.test(desktop));
assert(/@media\(max-width:760px\)\{[^@]*\.cols,\.cols\.eq\{display:block\}/.test(shell));
assert((html.match(/class="cols/g) || []).length === 2, 'Character and Equipment use two columns');
for (const id of ['trainingClass', 'gearGrid', 'trainingConsumable', 'start']) assert(html.includes('id="' + id + '"'), id + ' stays reachable');
console.log('training layout ok');
