'use strict';

// Normalize only source text used by test instrumentation, never fixture data.
const normalizeSource = text => text.replace(/\r\n/g, '\n');
function sourceSlice(text, file) {
  const source = normalizeSource(text);
  function position(marker) {
    const at = source.indexOf(marker);
    if (at < 0) throw Error(`${file}: missing source marker ${JSON.stringify(marker)}`);
    if (source.indexOf(marker, at + 1) >= 0)
      throw Error(`${file}: ambiguous source marker ${JSON.stringify(marker)}`);
    return at;
  }
  return (from, to) => {
    const start = position(from), end = position(to);
    if (end <= start) throw Error(`${file}: reversed source markers ${JSON.stringify(from)} -> ${JSON.stringify(to)}`);
    return source.slice(start, end);
  };
}
module.exports = { normalizeSource, sourceSlice };
