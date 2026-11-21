#!/usr/bin/env node
'use strict';
/*
 * Posts the before/after pictures of a pull request on it, as one comment
 * that each new push updates.
 *
 *     node tools/pr-preview-comment.js <dir>     # dir: what pr-shots.js wrote
 *
 * Run by .github/workflows/pr-preview-comment.yml, from main, with a token
 * that can write: GITHUB_TOKEN, GITHUB_REPOSITORY and HEAD_SHA (the commit
 * the pictures were taken of) in the environment.
 *
 * Everything in <dir> was made by the pull request's own code, so none of it
 * is believed: the pull request number must name an open pull request whose
 * head is HEAD_SHA, only <page>-before.png / <page>-after.png files of known
 * pages that really are PNGs are used, and the comment's text comes from here
 * and from GitHub's API, never from the directory.
 *
 * The pictures are committed to the pr-previews branch (a branch of pictures
 * only, unrelated to main), so the comment can show them.
 */
const fs = require('fs');
const path = require('path');
const { PAGES } = require('./pr-shots.js');

const MARKER = '<!-- pr-preview -->';
const BRANCH = 'pr-previews';
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const MAX_BYTES = 8 << 20;

const { GITHUB_TOKEN: token, GITHUB_REPOSITORY: repo, HEAD_SHA: headSha } = process.env;

async function api(method, route, body) {
  const response = await fetch(`https://api.github.com/repos/${repo}${route}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'pr-preview' },
    body: body && JSON.stringify(body)
  });
  if (response.status === 404 && method === 'GET') return null;
  if (!response.ok) throw new Error(`${method} ${route}: ${response.status} ${await response.text()}`);
  return response.status === 204 ? null : response.json();
}

// The pictures that pass, as [{ page, before, after }] with file paths or null.
function trustedPictures(dir, manifest) {
  const entries = Array.isArray(manifest.pages) ? manifest.pages.slice(0, 4) : [];
  const pictures = [];
  for (const entry of entries) {
    const page = entry && entry.page;
    if (!Object.prototype.hasOwnProperty.call(PAGES, page) || pictures.some(seen => seen.page === page)) continue;
    const picture = { page };
    for (const side of ['before', 'after']) {
      const file = path.join(dir, `${page}-${side}.png`);
      let ok = entry[side] === `${page}-${side}.png` && fs.existsSync(file);
      if (ok) {
        const size = fs.statSync(file).size;
        const head = Buffer.alloc(8);
        const handle = fs.openSync(file, 'r');
        fs.readSync(handle, head, 0, 8, 0);
        fs.closeSync(handle);
        ok = size <= MAX_BYTES && head.equals(PNG);
      }
      picture[side] = ok ? file : null;
    }
    if (picture.before || picture.after) pictures.push(picture);
  }
  return pictures;
}

// One commit on the pictures branch; returns that commit's id.
async function commitPictures(number, pictures) {
  const files = pictures.flatMap(picture => ['before', 'after'].filter(side => picture[side])
    .map(side => ({ local: picture[side], remote: `pr-${number}/${headSha.slice(0, 7)}/${picture.page}-${side}.png` })));
  const ref = await api('GET', `/git/ref/heads/${BRANCH}`);
  const parent = ref && ref.object.sha;
  const baseTree = parent && (await api('GET', `/git/commits/${parent}`)).tree.sha;
  const tree = [];
  for (const file of files) {
    const blob = await api('POST', '/git/blobs', { content: fs.readFileSync(file.local).toString('base64'), encoding: 'base64' });
    tree.push({ path: file.remote, mode: '100644', type: 'blob', sha: blob.sha });
  }
  const newTree = await api('POST', '/git/trees', baseTree ? { base_tree: baseTree, tree } : { tree });
  const commit = await api('POST', '/git/commits', {
    message: `Preview of #${number} at ${headSha.slice(0, 7)}`, tree: newTree.sha, parents: parent ? [parent] : []
  });
  if (parent) await api('PATCH', `/git/refs/heads/${BRANCH}`, { sha: commit.sha });
  else await api('POST', '/git/refs', { ref: `refs/heads/${BRANCH}`, sha: commit.sha });
  return { commit: commit.sha, url: (page, side) => `https://raw.githubusercontent.com/${repo}/${commit.sha}/pr-${number}/${headSha.slice(0, 7)}/${page}-${side}.png` };
}

const code = text => '`' + String(text).replace(/[`\r\n]/g, '') + '`';

function commentBody(number, pictures, stored, changed) {
  const lines = [MARKER, '### Preview', ''];
  if (!pictures.length) {
    lines.push('No page of the site changes in this pull request, so there is nothing to picture.');
  } else {
    lines.push(`The site before and after this pull request (merged into main, commit ${code(headSha.slice(0, 7))}).`);
    for (const { page, before, after } of pictures) {
      const cell = (file, side) => file ? `<img src="${stored.url(page, side)}" alt="${side}">` : '*not shown*';
      lines.push('', `#### ${PAGES[page].label}`, '', '| Before | After |', '| --- | --- |',
        `| ${cell(before, 'before')} | ${cell(after, 'after')} |`);
    }
  }
  const shown = changed.slice(0, 50).map(file => `- ${code(file.filename)} (+${file.additions} −${file.deletions})`);
  if (changed.length > 50) shown.push(`- … and ${changed.length - 50} more`);
  lines.push('', `<details><summary>Files changed (${changed.length})</summary>`, '', ...shown, '', '</details>',
    '', `To try it locally: ${code(`npm run pr -- ${number}`)}`);
  return lines.join('\n');
}

async function main() {
  const dir = path.resolve(process.argv[2] || '');
  if (!process.argv[2] || !token || !repo || !/^[0-9a-f]{40}$/.test(headSha || '')) {
    throw new Error('Usage: GITHUB_TOKEN=... GITHUB_REPOSITORY=owner/name HEAD_SHA=<sha> node tools/pr-preview-comment.js <dir>');
  }
  let manifest = {};
  try { manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')); } catch (error) { /* checked below */ }
  const number = Number(manifest.pr);
  if (!Number.isInteger(number) || number <= 0) throw new Error('The pictures name no pull request.');

  const pull = await api('GET', `/pulls/${number}`);
  if (!pull || pull.state !== 'open' || pull.head.sha !== headSha) {
    console.log(`Pull request ${number} is not open at ${headSha.slice(0, 7)} any more; nothing posted.`);
    return;
  }
  const pictures = trustedPictures(dir, manifest);
  const stored = pictures.length ? await commitPictures(number, pictures) : null;
  const changed = [];
  for (let page = 1; page <= 30; page++) {
    const batch = await api('GET', `/pulls/${number}/files?per_page=100&page=${page}`);
    changed.push(...batch);
    if (batch.length < 100) break;
  }
  const body = commentBody(number, pictures, stored, changed);

  const comments = await api('GET', `/issues/${number}/comments?per_page=100`);
  const mine = comments.find(comment => comment.user && comment.user.type === 'Bot' && comment.body.startsWith(MARKER));
  if (mine) await api('PATCH', `/issues/comments/${mine.id}`, { body });
  else await api('POST', `/issues/${number}/comments`, { body });
  console.log(`Preview ${mine ? 'updated' : 'posted'} on #${number}: ${pictures.length} page(s).`);
}

module.exports = { trustedPictures, commentBody };
if (require.main === module) main().catch(error => { console.error(error.message); process.exit(1); });
