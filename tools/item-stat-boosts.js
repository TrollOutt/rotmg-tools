'use strict';

/*
 * Source declarations only: preserve every stat-boost activation, including
 * those after another Activate and those fired by a proc. Attribute values
 * remain XML strings; missing values stay missing. Consumers must separately
 * establish stat meaning, units, scaling, aura recipients and eligibility.
 * Keep attributes nested so future client attributes cannot overwrite the
 * activation verb or trigger. No item names or gameplay values belong here.
 */
module.exports = body => {
  const out = [];
  const xml = body.replace(/<!--[\s\S]*?-->/g, '');
  const otherActivations = [];
  for (const m of xml.matchAll(/<(\w*Activate\w*)\b([^>]*)>\s*(\w+)\s*<\/\1>/g)) {
    if (/^StatBoost(Self|Aura)$/.test(m[3])) continue;
    otherActivations.push({ on: m[3], trigger: m[1] });
  }
  for (const m of xml.matchAll(
    /<(\w*Activate\w*)\b([^>]*)>\s*(StatBoostSelf|StatBoostAura)\s*<\/\1>/g)) {
    const attributes = Object.fromEntries([...m[2].matchAll(
      /([\w:.-]+)\s*=\s*(["'])([\s\S]*?)\2/g)].map(a => [a[1], a[3]]));
    out.push({ on: m[3], trigger: m[1], attributes,
      ...(otherActivations.length ? { otherActivations } : {}) });
  }
  return out;
};
