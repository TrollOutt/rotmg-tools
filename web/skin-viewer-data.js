/* Client catalogue projections for the Skin Viewer. Loading and drawing stay in its adapter. */
/** @typedef {{ x: number, y: number, w: number, h: number }} SkinViewerRect */
/** @typedef {{ frames: number[][] }} SkinViewerGeometry */
/** @typedef {{ type: string, id: string, name: string }} SkinViewerIdentity */
/**
 * @typedef {SkinViewerIdentity & {
 *   wears?: string, look?: string, tier?: number, level?: number, given?: string,
 *   pick?: number, hidden?: string, unlockers?: string[], sets?: string[]
 * }} SkinViewerSkinRecord
 */
/**
 * @typedef {Object} SkinViewerDyeGeometry
 * @property {string} on
 * @property {string} kind
 * @property {string | null} [color]
 * @property {{ atlas: string, index: number, rect: SkinViewerRect } | null} [cloth]
 * @property {{ how: string, speed: number, pivotX: number, pivotY: number } | null} [moves]
 * @property {{ rect: SkinViewerRect } | null} [icon]
 */
/**
 * @typedef {Object} SkinViewerLooks
 * @property {Record<string, SkinViewerGeometry | null | undefined>} skins
 * @property {Record<string, SkinViewerDyeGeometry | null | undefined>} dyes
 * @property {Record<string, { rect: SkinViewerRect } | null | undefined>} classes
 */
/**
 * @typedef {Object} SkinViewerFrame
 * @property {number} set
 * @property {number} actionRaw
 * @property {number} directionRaw
 * @property {string} action
 * @property {string} direction
 * @property {string} atlas
 * @property {SkinViewerRect} rect
 * @property {SkinViewerRect | null} maskRect
 * @property {boolean} spriteAvailable
 * @property {boolean} maskAvailable
 * @property {number} frame
 */
/**
 * @typedef {Object} SkinViewerSequence
 * @property {number} set
 * @property {number} actionRaw
 * @property {number} directionRaw
 * @property {string} action
 * @property {string} direction
 * @property {SkinViewerFrame[]} frames
 */
/**
 * @typedef {Object} SkinViewerDataDependencies
 * @property {() => SkinViewerLooks} getLooks Current geometry, read at each catalogue projection.
 * @property {() => (string | null | undefined)[]} getActions Adapter's action table, read for each frame projection.
 * @property {() => (string | null | undefined)[]} getDirections Adapter's direction table, read for each frame projection.
 */
var SkinViewerData = (() => {
  'use strict';
  /** @param {SkinViewerDataDependencies} deps */
  function createCatalogueData(deps) {
    /** @param {SkinViewerGeometry | null | undefined} geometry */
    function framesOf(geometry) {
      if(!geometry)return{sequences:[],frames:[]};
      const SAY_ACTION=deps.getActions(),SAY_DIRECTION=deps.getDirections();
      /** @type {SkinViewerSequence[]} */
      const sequences=[];
      /** @type {Map<string, SkinViewerSequence>} */
      const byKey=new Map();
      /** @type {SkinViewerFrame[]} */
      const flat=[];
      for(const row of geometry.frames){
        const[set,action,direction,x,y,w,h,maskX,maskY]=row;
        const frame={
          set,actionRaw:action,directionRaw:direction,
          action:SAY_ACTION[action]||('action '+action),
          direction:SAY_DIRECTION[direction]||('direction '+direction),
          atlas:'looks',rect:{x,y,w,h},
          maskRect:maskX<0?null:{x:maskX,y:maskY,w,h},
          spriteAvailable:true,maskAvailable:maskX>=0,
          frame:0
        };
        flat.push(frame);
        /* One sequence per animation, in the order the client wrote them. */
        const key=set+'|'+action+'|'+direction;
        let sequence=byKey.get(key);
        if(!sequence){
          sequence={set,actionRaw:action,directionRaw:direction,
            action:frame.action,direction:frame.direction,frames:[]};
          byKey.set(key,sequence);sequences.push(sequence);
        }
        frame.frame=sequence.frames.length;
        sequence.frames.push(frame);
      }
      return{sequences,frames:flat};
    }

    /** @param {{ skins: SkinViewerSkinRecord[] }} skinCatalogue */
    function skinEntries(skinCatalogue) {
      const looks=deps.getLooks();
      // Keep declarations without geometry out of the viewer, but in the Index.
      const undrawn=skinCatalogue.skins.filter(one=>!looks.skins[one.type]);
      const skins=skinCatalogue.skins.filter(one=>looks.skins[one.type]).map(one=>{
        const drawn=framesOf(looks.skins[one.type]);
        return{
          id:one.name,indexId:one.id,type:Number.parseInt(one.type,16),
          className:one.wears||null,
          family:one.look||'Other',
          tier:one.tier,level:one.level,given:one.given,pick:one.pick,
          unlockers:one.unlockers||[],sets:one.sets||[],hidden:one.hidden,
          sequences:drawn.sequences,frames:drawn.frames
        };
      });
      return{undrawn,skins};
    }

    /** @param {{ dyes: SkinViewerIdentity[] }} dyeCatalogue */
    function dyeEntries(dyeCatalogue) {
      const looks=deps.getLooks();
      const dyes=[];
      for(const one of dyeCatalogue.dyes){
        const made=looks.dyes[one.type];
        if(!made)continue;
        dyes.push({
          id:one.name,indexId:one.id,type:Number.parseInt(one.type,16),
          target:made.on,
          kind:made.kind==='cloth'?'textile':made.kind,
          color:made.color||null,
          textile:made.cloth?{atlas:made.cloth.atlas,index:made.cloth.index,
            sheet:'looks',rect:made.cloth.rect}:null,
          animation:made.moves?{type:made.moves.how,speed:made.moves.speed,
            pivotX:made.moves.pivotX,pivotY:made.moves.pivotY}:null,
          icon:made.icon?{sheet:'looks',rect:made.icon.rect}:null
        });
      }
      return dyes;
    }

    /** @param {{ classes: SkinViewerIdentity[] }} classCatalogue */
    function classEntries(classCatalogue) {
      const looks=deps.getLooks();
      return classCatalogue.classes.map(one=>{
        const drawn=looks.classes[one.type];
        return{name:one.name,indexId:one.id,type:Number.parseInt(one.type,16),
          icon:drawn?{sheet:'looks',rect:drawn.rect}:null};
      });
    }

    /**
     * @param {ReturnType<typeof skinEntries>['skins']} skins
     * @param {ReturnType<typeof dyeEntries>} dyes
     */
    function indexBridge(skins,dyes) {
      /** @type {Record<string, { kind: string, id: string, type: number, reason: string }[]>} */
      const reverse={};
      const indexBridge={
        skins:Object.fromEntries(skins.map(one=>[one.id,{
          target:{kind:'index',id:one.indexId},
          match:{kind:'index',id:one.indexId},
          unlockers:one.unlockers,sets:one.sets,reason:'declared by the client'
        }])),
        dyes:Object.fromEntries(dyes.map(one=>[one.id,{
          target:{kind:'index',id:one.indexId},
          match:{kind:'index',id:one.indexId},reason:'declared by the client'
        }])),
        reverse
      };
      for(const one of skins){
        for(const to of [one.indexId,...one.unlockers,...one.sets].filter(Boolean)){
          (indexBridge.reverse[to]||(indexBridge.reverse[to]=[]))
            .push({kind:'skin',id:one.id,type:one.type,reason:'declared by the client'});
        }
      }
      return indexBridge;
    }
    return { framesOf, skinEntries, dyeEntries, classEntries, indexBridge };
  }
  return { createCatalogueData };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = SkinViewerData;
