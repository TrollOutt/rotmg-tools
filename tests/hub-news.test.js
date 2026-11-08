'use strict';

/*
 * tools/hub-news.js on copies of the RotMG Hub's sitemap and post pages: which
 * URLs are posts, what a post reads as, and that the log keeps each post once.
 */
const assert = require('assert/strict');
const { postPaths, plainText, parsePost, merge, pending, digest } = require('../tools/hub-news');

const loc = path => `<url><loc>https://hub.realmofthemadgod.com${path}</loc><priority>0.8</priority></url>`;
const sitemap = '<?xml version="1.0"?><urlset>' + [
  '', '/news0', '/updates', '/fan-content/mspaint', '/lore/characters/oryx',
  '/news0/updates0/s312pn', '/news/updates/discord-1568312851032965384',
  '/news0/news1/let’s-talk-about-stability-in-the-realm', '/news0/updates0/s312pn'
].map(loc).join('') + '</urlset>';
assert.deepEqual(postPaths(sitemap), [
  '/news0/updates0/s312pn', '/news/updates/discord-1568312851032965384',
  '/news0/news1/let’s-talk-about-stability-in-the-realm'
], 'HUB-001 posts only, once each, slugs with typographic quotes included');

// The page's serialised data, as the Hub writes it: the site's own dates first, then the article.
const page = article => '<html><script>$R[9]={created_at:1771190642,published_at:1779967563,title:"Realm of the Mad God Hub"};'
  + `$R[1347]={article:$R[1348]={date:null,image_url:"",tags:"",category:"${article.category}",published_at:${article.published},`
  + `datetime:1793836800,render_options:null,custom_html:"no",id:"nws_x",slug:"s",title:"${article.title}",description:"",text:"",`
  + `html:"${article.html}"},more:$R[1349]={title:"Another post"}}</script></html>`;

const notes = parsePost(page({
  category: 'company_news', published: 1793717334, title: 'Season 31, Part 2: White Snake Invasion! Patch Notes',
  html: '\\x3Cp>Realmers,\\x3C/p>\\x3Cp>Face the \\"returning\\" White Snake &amp; Thessal.&nbsp;\\x3C/p>'
    + '\\x3Cul>\\x3Cli>Claim All button\\x3C/li>\\x3Cli>Friends List notes\\x3C/li>\\x3C/ul>\\x3Ch2>Ocean Trench\\x3C/h2>'
}), '/news0/updates0/s312pn');
assert.deepEqual(notes, {
  path: '/news0/updates0/s312pn', category: 'company_news',
  title: 'Season 31, Part 2: White Snake Invasion! Patch Notes', published: '2026-11-03T14:48:54.000Z',
  text: 'Realmers,\nFace the "returning" White Snake & Thessal.\n\n- Claim All button\n- Friends List notes\nOcean Trench'
}, 'HUB-002 a post: its own time and title, not the site\'s, and its HTML as lines of text');

const discord = parsePost(page({
  category: 'update', published: 1793604025, title: '',
  html: 'Pet Rework Q&amp;A\\x3Cbr>\\x3Cbr>Realmers, we&#x27;re working on a pet rework!'
}), '/news/updates/discord-1567588109624021053');
assert.equal(discord.title, 'Pet Rework Q&A', 'HUB-003 a Discord copy has no title: its first line is one');
assert.equal(discord.text, "Pet Rework Q&A\n\nRealmers, we're working on a pet rework!", 'HUB-004 breaks are lines');

assert.equal(parsePost('<html>Just a moment...</html>', '/news0/updates0/x'), null, 'HUB-005 a page with no article does not read');
assert.equal(plainText('a\\nb'), 'a\\nb', 'HUB-006 text is not unescaped twice');

const log = { integratedThrough: null, entries: [] };
assert.equal(merge(log, [notes, discord]).length, 2);
assert.deepEqual(merge(log, [notes]), [], 'HUB-007 a post already kept is not kept twice');
assert.deepEqual(log.entries.map(e => e.published), ['2026-11-02T07:20:25.000Z', '2026-11-03T14:48:54.000Z'],
  'HUB-008 the log is in time order');
log.integratedThrough = '2026-11-03T00:00:00Z';
assert.deepEqual(pending(log).map(e => e.path), ['/news0/updates0/s312pn'], 'HUB-009 only what came after the last integration');
assert.match(digest(pending(log)), /^## Season 31, Part 2.*\n\n2026-11-03 14:48 UTC · company_news · https:\/\/hub\.realmofthemadgod\.com\/news0\/updates0\/s312pn\n\nRealmers,/,
  'HUB-010 the digest names each post, its time and its address');

console.log('hub-news: ok');
