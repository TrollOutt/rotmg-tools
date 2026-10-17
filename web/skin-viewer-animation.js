/* Sequence playback decisions. The viewer owns clocks, state changes and drawing. */
/** @typedef {import('./skin-viewer-data').SkinViewerSequence} SkinPlaybackSequence */
/**
 * @typedef {Object} SkinPlaybackDependencies
 * @property {() => number} getAttackPeriod Read the adapter's current period only for a playable attack.
 */
var SkinViewerAnimation = (() => {
  'use strict';
  /** @param {SkinPlaybackDependencies} deps */
  function createSequencePlayback(deps) {
    /**
     * @param {SkinPlaybackSequence[]} pool
     * @param {number} actionRaw
     * @param {number} directionRaw
     * @param {number} set
     * @returns {SkinPlaybackSequence | undefined} The original sequence, including the unplayable final fallback.
     */
    function sequence(pool,actionRaw,directionRaw,set) {
      return pool.find(q=>q.set===set&&q.actionRaw===actionRaw&&q.directionRaw===directionRaw&&q.frames.some(f=>f.spriteAvailable))
        ||pool.find(q=>q.set===set&&q.actionRaw===actionRaw&&q.frames.some(f=>f.spriteAvailable))
        ||pool.find(q=>q.set===set&&q.actionRaw===0&&q.directionRaw===directionRaw&&q.frames.some(f=>f.spriteAvailable))
        ||pool.find(q=>q.set===set&&q.frames.some(f=>f.spriteAvailable))||pool[0];
    }
    /** @param {SkinPlaybackSequence | null | undefined} seq @param {number} index */
    function current(seq,index) {
      return seq?.frames[index%Math.max(1,seq.frames.length)];
    }
    /** @param {SkinPlaybackSequence | null | undefined} seq @param {number} index */
    function nextIndex(seq,index) {
      if(!seq?.frames.length)return index;
      let n=(index+1)%seq.frames.length;
      if(seq.frames.some(x=>x.spriteAvailable)){
        let guard=0;
        while(!seq.frames[n].spriteAvailable&&guard++<seq.frames.length)n=(n+1)%seq.frames.length;
      }
      return n;
    }
    /**
     * @param {SkinPlaybackSequence | null | undefined} seq
     * @param {number} index
     * @param {number} now
     * @param {number} attackStart
     * @returns {number | undefined} Preserve the historical undefined index for non-finite phases.
     */
    function attackFrameIndex(seq,index,now,attackStart) {
      if(seq?.actionRaw!==2)return index;
      const playable=[];
      for(let i=0;i<seq.frames.length;i++)if(seq.frames[i].spriteAvailable)playable.push(i);
      if(!playable.length)return index;
      const period=deps.getAttackPeriod(),elapsed=Math.max(0,now-attackStart),phase=(elapsed%period)/period;
      return playable[Math.min(playable.length-1,Math.floor(phase*playable.length))];
    }
    return { sequence, current, nextIndex, attackFrameIndex };
  }
  return { createSequencePlayback };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = SkinViewerAnimation;
