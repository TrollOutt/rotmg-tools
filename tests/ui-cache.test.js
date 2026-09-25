'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');

function fameUiHarness(nodes, computedStyle = () => ({ maxHeight: '0px' })) {
  const file = path.join(root, 'web/fame-page.js');
  const source = fs.readFileSync(file, 'utf8');
  const marker = 'return { init, render };';

  assert(
    source.includes(marker),
    'CACHE-000 FamePage test hook marker exists'
  );

  const script = source.replace(
    marker,
    `return {
      init, render,
      __uiTest: {
        paint,
        alreadyShowing,
        fitGrid
      }
    };`
  );

  const context = {
    module: { exports: {} },
    console,
    document: {
      getElementById(id) {
        return nodes[id] || null;
      }
    },
    getComputedStyle: computedStyle
  };

  vm.runInNewContext(script, context, {
    filename: file
  });

  return context.module.exports.__uiTest;
}

function panelNode() {
  let markup = '';
  let writes = 0;
  let layoutReads = 0;
  const classOps = [];

  const node = {
    classList: {
      remove(name) {
        classOps.push(['remove', name]);
      },
      add(name) {
        classOps.push(['add', name]);
      }
    }
  };

  Object.defineProperty(node, 'innerHTML', {
    get() {
      return markup;
    },
    set(value) {
      markup = String(value);
      writes++;
    }
  });

  Object.defineProperty(node, 'offsetWidth', {
    get() {
      layoutReads++;
      return 100;
    }
  });

  return {
    node,
    stats() {
      return {
        markup,
        writes,
        layoutReads,
        classOps: classOps.map(one => [...one])
      };
    }
  };
}

/* ------------------------------------------------------------------ *
 * Cached panel painting                                               *
 * ------------------------------------------------------------------ */

{
  const panel = panelNode();
  const ui = fameUiHarness({ panel: panel.node });

  ui.paint('panel', '<b>one</b>', 'same');

  let stats = panel.stats();

  assert.equal(
    stats.writes,
    1,
    'CACHE-001 first paint writes markup once'
  );

  assert.equal(
    stats.layoutReads,
    1,
    'UX-001 genuinely new content restarts its entrance animation'
  );

  assert.deepEqual(
    stats.classOps,
    [
      ['remove', 'is-fresh'],
      ['add', 'is-fresh']
    ],
    'UX-001 animation restart removes then reapplies the freshness class'
  );

  assert.equal(
    ui.alreadyShowing('panel', 'same'),
    true,
    'CACHE-002 the current panel signature is remembered'
  );

  ui.paint('panel', '<b>one</b>', 'same');

  stats = panel.stats();

  assert.equal(
    stats.writes,
    1,
    'CACHE-003 identical markup and signature cause no DOM rewrite'
  );

  assert.equal(
    stats.layoutReads,
    1,
    'CACHE-003 identical paint causes no forced layout'
  );

  assert.equal(
    stats.classOps.length,
    2,
    'CACHE-003 identical paint causes no animation churn'
  );

  ui.paint('panel', '<b>two</b>', 'same');

  stats = panel.stats();

  assert.equal(
    stats.writes,
    2,
    'CACHE-004 changed markup is still written'
  );

  assert.equal(
    stats.markup,
    '<b>two</b>',
    'CACHE-004 changed markup reaches the panel'
  );

  assert.equal(
    stats.layoutReads,
    1,
    'UX-002 same logical panel does not restart its animation'
  );

  assert.equal(
    stats.classOps.length,
    2,
    'UX-002 same signature avoids freshness-class churn'
  );

  ui.paint('panel', '<b>three</b>', 'different');

  stats = panel.stats();

  assert.equal(
    stats.writes,
    3,
    'CACHE-005 a changed logical panel is rendered'
  );

  assert.equal(
    stats.layoutReads,
    2,
    'UX-003 a changed signature restarts the entrance animation'
  );

  assert.deepEqual(
    stats.classOps.slice(-2),
    [
      ['remove', 'is-fresh'],
      ['add', 'is-fresh']
    ],
    'UX-003 changed logical content gets one fresh animation'
  );
}

/* ------------------------------------------------------------------ *
 * Grid fitting: bounded layout work                                   *
 * ------------------------------------------------------------------ */

function gridNode({
  room,
  maxHeight = 0,
  multiplier = 5,
  hasChild = true
}) {
  let tile = 104;
  let setCalls = 0;
  let scrollReads = 0;

  const style = {
    overflowY: '',
    setProperty(name, value) {
      assert.equal(name, '--tile');
      tile = parseFloat(value);
      setCalls++;
    }
  };

  const node = {
    firstElementChild: hasChild ? {} : null,
    clientHeight: room,
    style
  };

  Object.defineProperty(node, 'scrollHeight', {
    get() {
      scrollReads++;
      return Math.ceil(tile * multiplier);
    }
  });

  return {
    node,
    computed: { maxHeight: maxHeight + 'px' },
    stats() {
      return {
        tile,
        setCalls,
        scrollReads,
        overflowY: style.overflowY
      };
    }
  };
}

{
  const grid = gridNode({
    room: 400,
    multiplier: 5
  });

  const ui = fameUiHarness(
    { fameGrid: grid.node },
    () => grid.computed
  );

  ui.fitGrid();

  const stats = grid.stats();

  assert(
    stats.tile > 79 && stats.tile <= 80.2,
    `PERF-UI-001 binary search finds the largest fitting tile (${stats.tile})`
  );

  assert.equal(
    stats.setCalls,
    10,
    'PERF-UI-001 fit uses one max probe, eight binary probes and one final write'
  );

  assert.equal(
    stats.scrollReads,
    9,
    'PERF-UI-001 only the nine probes trigger layout measurement'
  );

  assert.equal(
    stats.overflowY,
    '',
    'UX-010 scrollbar suppression is temporary'
  );
}

{
  const grid = gridNode({
    room: 100,
    multiplier: 5
  });

  const ui = fameUiHarness(
    { fameGrid: grid.node },
    () => grid.computed
  );

  ui.fitGrid();

  const stats = grid.stats();

  assert.equal(
    stats.tile,
    54,
    'UX-011 a window too short to fit the grid stops at the readable minimum'
  );

  assert.equal(
    stats.setCalls,
    10,
    'PERF-UI-002 even the no-fit case keeps the bounded search budget'
  );

  assert.equal(
    stats.overflowY,
    '',
    'UX-011 no-fit case restores scrolling instead of hiding overflow'
  );
}

{
  const grid = gridNode({
    room: 0,
    maxHeight: 360,
    multiplier: 4
  });

  const ui = fameUiHarness(
    { fameGrid: grid.node },
    () => grid.computed
  );

  ui.fitGrid();

  const stats = grid.stats();

  assert(
    stats.tile <= 90.25 && stats.tile > 89,
    `UX-012 CSS max-height supplies the fitting room when clientHeight is zero (${stats.tile})`
  );

  assert(
    stats.setCalls <= 10,
    'PERF-UI-003 max-height fitting keeps the same bounded layout budget'
  );
}

{
  const grid = gridNode({
    room: 400,
    hasChild: false
  });

  const ui = fameUiHarness(
    { fameGrid: grid.node },
    () => grid.computed
  );

  ui.fitGrid();

  const stats = grid.stats();

  assert.equal(
    stats.setCalls,
    0,
    'CACHE-010 an empty grid performs no sizing writes'
  );

  assert.equal(
    stats.scrollReads,
    0,
    'CACHE-010 an empty grid performs no layout measurements'
  );
}

{
  const grid = gridNode({
    room: 0,
    maxHeight: 0
  });

  const ui = fameUiHarness(
    { fameGrid: grid.node },
    () => grid.computed
  );

  ui.fitGrid();

  const stats = grid.stats();

  assert.equal(
    stats.setCalls,
    0,
    'CACHE-011 a grid with no measurable room performs no sizing work'
  );

  assert.equal(
    stats.scrollReads,
    0,
    'CACHE-011 a grid with no measurable room performs no layout reads'
  );
}

console.log('UI cache / layout budget contract: ok');
