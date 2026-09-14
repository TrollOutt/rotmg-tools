export function resolveExactTarget(target, skins, dyes) {
  if (!target || typeof target !== 'object') return null;
  const kind = String(target.kind || '');
  if (kind === 'skin' || kind === 'set-skin') {
    const matches = skins.filter(skin => skin.id === target.id
      && (target.type == null || skin.type === target.type));
    return matches.length === 1 ? { kind: 'skin', item: matches[0] } : null;
  }
  if (kind === 'dye' && (target.target === 'clothing' || target.target === 'accessory')) {
    const matches = dyes.filter(dye => dye.id === target.id && dye.target === target.target
      && (target.type == null || dye.type === target.type));
    return matches.length === 1
      ? { kind: 'dye', target: target.target, item: matches[0] }
      : null;
  }
  return null;
}
