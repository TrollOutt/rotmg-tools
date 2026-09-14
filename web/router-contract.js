(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.RealmRoutes = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  function parse(hash) {
    const value = String(hash || '').replace(/^#\/?/, '');
    const split = value.indexOf('?');
    const page = (split < 0 ? value : value.slice(0, split)) || 'home';
    let open = '';
    if (page === 'index' && split >= 0) {
      try { open = new URLSearchParams(value.slice(split + 1)).get('open') || ''; }
      catch (_) { open = ''; }
    }
    return { page, open };
  }

  function indexHash(id) {
    return typeof id === 'string' && id.trim() === id && id
      ? 'index?open=' + encodeURIComponent(id)
      : '';
  }

  return { parse, indexHash };
});
