/* Index effects around the historical engine; its collision/RNG rules stay untouched. */
var TrainingCombat = (function () {
  'use strict';
  const ticks = (/** @type {number} */ seconds) => Math.round(seconds * 60);
  /** @param {import('./catalog-types').Catalog} catalog @param {import('./catalog-types').Selection} o */
  function selection(catalog, o) {
    const character = catalog.classes.find(c => c.id === o.classId) || catalog.classes[0];
    const equipment = catalog.equipment.filter(it => character && character.slots.includes(it.slot)
      && o.equipment?.[it.hand] === it.id && (it.simulation !== 'manual' || Number.isFinite(character.stats.mpTop ?? character.stats.mp)));
    const consumable = catalog.consumables.find(it => it.id === o.consumableId && it.bonus > 0 && it.duration > 0
      && Number.isFinite(it.bonus) && Number.isFinite(it.duration)) || null;
    return { character, equipment, consumable };
  }
  /** @param {ReturnType<typeof import('./engine').createEngine>['Game']} Base @param {import('./catalog-types').Catalog} catalog */
  function createGame(Base, catalog) {
    return class IndexGame extends Base {
      /** @param {number} seed @param {import('./catalog-types').TrainingOptions} options */
      constructor(seed, options = {}) {
        const chosen = selection(catalog, options);
        const equipment = Object.fromEntries(chosen.equipment.map(it => [it.hand, it.id]));
        super(seed, { ...options, gear: {}, cur: {} });
        // Persist only validated identities; old archive swaps can never enter this path.
        this.o = Object.assign(this.o, { classId: chosen.character?.id || '', equipment,
          consumableId: chosen.consumable?.id || '', rules: 'index-v2-postHit', seed });
        this.selectedItems = chosen.equipment;
        this.selectedConsumable = chosen.consumable;
        this.indexTick = 0;
        this.activeUntil = 0;
        /** @type {Record<string, number>} */
        this.cooldownUntil = {};
        this.mana = chosen.character?.stats.mpTop ?? chosen.character?.stats.mp ?? 0;
        this.wisdom = chosen.character?.stats.wisTop ?? chosen.character?.stats.wis;
        this.healingUntil = 0;
        this.consumableUntil = chosen.consumable ? ticks(chosen.consumable.duration) : 0;
        this.consumableUsed = !!chosen.consumable;
        this.maxHp = this.o.hp;
        this.baseMaxHp = this.maxHp;
        if (chosen.consumable) {
          // One use at construction, before countdown/first combat tick. No mid-run API.
          this.maxHp += chosen.consumable.bonus;
          this.log(chosen.consumable.name + ': +' + chosen.consumable.bonus + ' max HP for ' + chosen.consumable.duration + ' s (current HP unchanged)');
        }
      }
      /** @param {import('./catalog-types').Equipment} item */
      cooldown(item) { return Math.max(0, (this.cooldownUntil[item.id] || 0) - this.indexTick); }
      /** @param {import('./catalog-types').Equipment} item @param {number} at */
      protect(item, at = this.indexTick) {
        this.activeUntil = Math.max(this.activeUntil, at + ticks(item.duration));
        this.cooldownUntil[item.id] = at + ticks(item.cooldown);
        this.log(item.name + ': Invulnerable ' + item.duration + ' s; cooldown ' + item.cooldown + ' s');
      }
      activateAbility() {
        if (this.ended || this.hp <= 0) return false;
        const item = this.selectedItems.find(it => it.simulation === 'manual');
        if (!item || this.cooldown(item) > 0) return false;
        if (this.mana < item.cost) { this.log('Not enough MP (' + item.cost + ' required)'); return false; }
        this.mana -= item.cost;
        this.protect(item);
        for (const c of item.conditions) {
          if (c.effect !== 'Healing' || c.trigger !== 'Activate' || !['self', 'allies'].includes(c.target) || !catalog.healingPerSecond) continue;
          let duration = Number(c.duration);
          if (c.statModDuration !== undefined) {
            if (c.scalingStat !== 'WIS' || this.wisdom === undefined) continue;
            duration += Math.max(0, this.wisdom - Number(c.statModScalingMin)) * Number(c.statModDuration);
          }
          if (duration > 0 && Number.isFinite(duration)) this.healingUntil = Math.max(this.healingUntil, this.indexTick + ticks(duration));
        }
        return true;
      }
      /** @param {import('./types').Projectile} p */
      onHit(p) {
        if (this.activeUntil > this.indexTick) { p.hit = true; this.blocked++; return; }
        const before = this.hp;
        this.invuln = 0;
        super.onHit(p);
        if (this.hp <= 0 || this.ended) return;
        const damage = before - this.hp;
        for (const item of this.selectedItems) {
          // Explicitly approved historical convention, not a claim about live ordering.
          if (item.simulation !== 'postHit' || this.cooldown(item) > 0
            || item.below === null || item.damageThreshold === null
            || damage < item.damageThreshold || this.hp / this.maxHp >= item.below) continue;
          // Base collisions run after frames increments. A hit proc therefore starts
          // at that collision boundary, not at the preceding ability-input boundary.
          this.protect(item, this.frames);
        }
      }
      /** @param {number} hd @param {number} vd @param {number} rot @param {import('./types').Control & {ability?: boolean}} ctl */
      tick(hd, vd, rot = 0, ctl = {}) {
        if (ctl.pre || this.ended) { super.tick(hd, vd, rot, ctl); return; }
        this.indexTick = this.frames;
        if (this.consumableUsed && this.consumableUntil > 0 && this.indexTick >= this.consumableUntil) {
          this.maxHp = this.baseMaxHp;
          this.clip();
          this.consumableUntil = 0;
          this.log('Temporary max HP expired');
        }
        if (ctl.ability) this.activateAbility();
        // The Index says Invulnerable blocks attacks, not Bleeding/status damage.
        // Let the unchanged engine process statuses; onHit handles attack protection.
        this.invuln = 0;
        super.tick(hd, vd, rot, ctl);
        if (!this.ended && this.hp > 0 && this.healingUntil > this.indexTick && catalog.healingPerSecond) {
          const amount = Math.min(catalog.healingPerSecond / 60, this.maxHp - this.hp);
          this.hp += amount; this.healed += amount;
        }
        this.indexTick = this.frames;
        if (this.consumableUntil > 0 && this.indexTick >= this.consumableUntil) {
          this.maxHp = this.baseMaxHp; this.clip(); this.consumableUntil = 0;
          this.log('Temporary max HP expired');
        }
        this.invuln = Math.max(0, this.activeUntil - this.indexTick);
      }
    };
  }
  return { selection, createGame };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = TrainingCombat;
