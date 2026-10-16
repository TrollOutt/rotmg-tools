'use strict';
const assert=require('assert/strict'), fs=require('fs'),path=require('path'),vm=require('vm'),zlib=require('zlib'),crypto=require('crypto');
const IndexSearch=require('../web/index-search');
const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');
const corpus=JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(__dirname,'index-families-corpus.json.gz'))));
const digest=v=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
const plain=x=>JSON.parse(JSON.stringify(x,(_,v)=>typeof v==='number'&&!Number.isFinite(v)?String(v):v));
function collect(api) {
  const { IX } = api, cases = [];
  const save = (name, fn) => {
    try { cases.push([name, plain(fn())]); }
    catch (error) { cases.push([name, { error: error.name }]); }
  };
  save('domains', () => IX.domains.map(d => [d.id, d.title, d.blurb, d.pic, d.ids,
    d.groups.map(g => [g.id, g.title, g.pic, g.ids]),
    d.abilities && [d.abilities.id, d.abilities.title, d.abilities.pic, d.abilities.ids,
      d.abilities.kinds.map(g => d.groups.indexOf(g))],
    d.kindOf && [...d.kindOf].map(([id, g]) => [id, d.groups.indexOf(g)]),
    d.sortBy && d.ids.map(id => d.sortBy(IX.records.get(id)))]));
  save('side', () => IX.sidePortals);
  save('holders', () => [...IX.holderOf].map(([slot, r]) => {
    assert.strictEqual(r, IX.records.get(r.id));
    return [slot, r.id];
  }));
  for (const d of IX.domains) {
    assert.strictEqual(IX.domain(d.id), d);
    for (const key of ['', undefined, 'unknown', 'abilities', ...d.groups.map(g => g.id)]) {
      save('section/' + d.id + '/' + key, () => {
        const g = IX.groupOf(d, key);
        if (g) assert(g === d.abilities || d.groups.includes(g));
        return g && [g.id, api.isKind(d, g)];
      });
    }
    for (const n of [0, 1, 5, 90, -1, Infinity, NaN]) {
      save('sample/' + d.id + '/' + n, () => api.sampleOf(d, n));
    }
  }
  const membership = api.familyMembership();
  assert.strictEqual(api.familyMembership(), membership);
  save('membership', () => [...membership]);
  save('relations', () => IX.list.map(r => {
    const p = IX.portalHome(r);
    if (p) assert.strictEqual(p, IX.records.get(p.id));
    return [r.id, p && p.id, IX.isEventDungeon(r), IX.isSidePortal(r),
      membership.get(r.id) || (IX.isTechnical(r) ? 'tech' : 'other')];
  }));
  save('events', () => IX.list.filter(r => r.kind === 'event')
    .map(r => [r.id, r.artOf, r.event, api.eventFaces(r)]));
  const gives = api.dungeonGives();
  assert.strictEqual(api.dungeonGives(), gives);
  save('gives', () => [...gives].map(([id, rs]) => [id, rs.map(r => {
    assert.strictEqual(r, IX.records.get(r.id));
    return r.id;
  })]));
  for (const p of IX.list.filter(r => r.kind === 'portal')) {
    for (const cls of ['', ...IX.domains.find(d => d.id === 'classes').ids]) {
      for (const hand of ['', 'weapon', 'ability', 'armor', 'ring', 'unknown']) {
        save('gave/' + p.id + '/' + cls + '/' + hand, () => api.gaveTo(p, cls, hand).map(r => {
          assert.strictEqual(r, IX.records.get(r.id));
          return r.id;
        }));
      }
    }
  }
  return cases;
}

function edgeData(mode) {
 const records=[{id:'class:a',kind:'class',name:'A',slots:[1,11]},{id:'class:b',kind:'class',name:'B',slots:[1,9]},
 {id:'main',kind:'portal',name:'Lost Halls',difficulty:7},{id:'side',kind:'portal',name:'LH Boss Room'},
 {id:'event',kind:'portal',name:'Seasonal',realmeyeArchive:{relations:[{type:'dungeon_roster',to:'foe'},{type:'dungeon_drop_interest',to:'gear'}]}},
 {id:'foe',kind:'enemy',name:'Boss',hp:100,labels:['BOSS','HERO'],spawns:true},
 {id:'gear',kind:'item',name:'Gear',slot:1,hand:'weapon',tier:14,realmeyeArchive:{relations:[{type:'dropped_by',to:'foe'},{type:'dropped_by',to:'side'},{type:'dropped_by',to:'event'}]}},
 {id:'ability',kind:'item',name:'Spell',slot:11,hand:'ability',labels:['UT']},{id:'ability2',kind:'item',name:'Seal',slot:12,hand:'ability',labels:['ST']},
 {id:'skin',kind:'skin',name:'A Skin',out:[['worn by','class:a']]},{id:'bag',kind:'item',name:'Potion',use:true},
 {id:'place',kind:'place',name:'Low Forest',communityOnly:true},{id:'status',kind:'status',name:'Buff',tone:'good'},
 {id:'set',kind:'set',name:'Set'},{id:'enchant',kind:'enchant',name:'Power',labels:['AWAKENED','UNIQUE']},{id:'pool',kind:'pool',name:'Pool',dev:true},
 {id:'ev',kind:'event',name:'Event',artOf:'foe',event:{spawns:[{id:'foe'},{id:'foe'},{name:'missing'}],waves:[{enemies:[{id:'foe'},{id:'absent'},{id:''}]}]}},
 ...['AI Untaris Teleport','HUDL Boss','LOD Portal','Draconis','Ivory Wyvern','3D Portal','Shaitan','Remnant of the Void','Wine Cellar Locked','Tomb of the Ancients (Old)','Legacy Lost Halls Portal','Unknown'].map((name,i)=>({id:'p'+i,kind:'portal',name}))];
 const slots={1:['Sword','weapon'],11:['Spell','ability'],12:['Seal','ability'],9:['Ring','ring']};
 let archive={livesIn:new Map([['foe',new Set(['side','event','place','unknown'])]]),roles:new Map([['foe',new Set(['encounter'])]])};
 const find=id=>records.find(r=>r.id===id);
 if(mode==='empty')records.length=0;
 if(mode==='no-slots')for(const r of records)delete r.slots;
 if(mode==='no-labels')for(const r of records)delete r.labels;
 if(mode==='no-names')for(const r of records)delete r.name;
 if(mode==='empty-names')for(const r of records)r.name='';
 if(mode==='no-archive'){archive=null;for(const r of records)delete r.realmeyeArchive;}
 if(mode==='partial-archive')archive={};
 if(mode==='empty-relations')for(const r of records)r.realmeyeArchive={relations:[]};
 if(mode==='missing-relations')for(const r of records)r.realmeyeArchive={};
 if(mode==='unknown-relation')find('gear').realmeyeArchive.relations.push({type:'dropped_by',to:'unknown'},{type:'dropped_by',to:''},{type:'dropped_by'});
 if(mode==='hidden')for(const r of records)r.hidden=true;
 if(mode==='dev')for(const r of records)r.dev=true;
 if(mode==='community')for(const r of records)r.communityOnly=true;
 if(mode==='folded')for(const r of records)r.folded=true;
 if(mode==='bad-event')delete find('ev').event.spawns;
 if(mode==='empty-event')find('ev').event={spawns:[],waves:[]};
 if(mode==='no-event')delete find('ev').event;
 if(mode==='bad-slot')slots[1]=[];
 if(mode==='null-slot')slots[1]=null;
 if(mode==='bad-kind')delete find('foe').kind;
 for(const key of ['NaN','Infinity','-Infinity','zero'])if(mode===key){const n=key==='zero'?0:Number(key);find('main').difficulty=n;find('gear').tier=n;find('foe').hp=n;}
 for(let i=0;i<records.length;i++)records[i].art=[i%3,0,8,8];
 const all=new Map(records.map(r=>[r.id,r]));return {all,slots:mode==='absent-slots'?undefined:slots,archive:()=>archive,difficulty:r=>r.difficulty||null};
}
function prepareEdge(api,mode){
 api.IX.hasPicture=r=>Boolean(r&&r.art);api.IX.picKey=r=>r&&r.art?r.art.join(','):'';
 api.IX.isTechnical=r=>(r.kind==='enemy'||r.kind==='portal')&&!api.IX.hasPicture(r);
 if(mode==='no-pictures')api.IX.hasPicture=()=>false;
 if(mode==='technical')api.IX.isTechnical=()=>true;
 if(mode==='same-picture')api.IX.picKey=()=>'';
 api.configure(edgeData(mode));
 if(mode==='duplicates'){api.IX.list.push(...api.IX.list);api.buildDomains();}
}


function exerciseCaches(api) {
 const {IX}=api;
 prepareEdge(api,'normal');
 const initial=api.familyMembership(),gives=api.dungeonGives(),home=IX.portalHome(IX.records.get('side'));
 const domains=IX.domains,side=IX.sidePortals,holders=IX.holderOf;
 const replacement=edgeData('normal');
 IX.records=replacement.all;IX.list=[...replacement.all.values()];
 assert.notStrictEqual(IX.records.get('main'),home);
 assert.strictEqual(IX.portalHome(IX.records.get('side')),home,'portal name index deliberately stays memoized until build');
 assert.strictEqual(api.familyMembership(),initial);assert.strictEqual(api.dungeonGives(),gives);
 assert.notStrictEqual(gives.get('main')[0],IX.records.get('gear'),'drop references intentionally stay cached until build');
 IX.domains=[];assert.strictEqual(IX.domain('classes'),undefined);
 assert.strictEqual(api.familyMembership(),initial,'domain replacement alone does not invalidate search membership');IX.domains=domains;
 // A failed build publishes side portals at the same early phase, but leaves
 // the existing domains, holders, membership and drop cache in place.
 const isGear=IX.isGear;IX.isGear=()=>{throw new Error('classification failed');};
 assert.throws(()=>api.buildDomains(),/classification failed/);
 assert.notStrictEqual(IX.sidePortals,side);assert.strictEqual(IX.holderOf,holders);assert.strictEqual(IX.domains,domains);
 assert.strictEqual(api.familyMembership(),initial);assert.strictEqual(api.dungeonGives(),gives);
 IX.isGear=isGear;api.buildDomains();
 assert.notStrictEqual(api.familyMembership(),initial);assert.notStrictEqual(api.dungeonGives(),gives);
 assert.strictEqual(IX.portalHome(IX.records.get('side')),IX.records.get('main'));
 assert.strictEqual(api.dungeonGives().get('main')[0],IX.records.get('gear'));
 // The archive accessor is reread by the adapter's existing refresh sequence.
 api.configure(edgeData('no-archive'));assert.equal(api.dungeonGives().size,0);
 api.configure(edgeData('normal'));assert(api.dungeonGives().size>0);
 // A failed lazy drop construction is retried; no partial map is memoized.
 api.buildDomains();const difficulty=IX.difficultyOf;
 IX.difficultyOf=()=>{throw new Error('archive failed');};
 assert.throws(()=>api.dungeonGives(),/archive failed/);
 IX.difficultyOf=difficulty;assert(api.dungeonGives().size>0);
 assert.strictEqual(api.dungeonGives(),api.dungeonGives());
 assert.strictEqual(IX.portalHome(null),null);assert.strictEqual(IX.portalHome(undefined),null);
 assert.strictEqual(IX.groupOf(undefined,''),null);
 assert.throws(()=>IX.groupOf(undefined,'unknown'),{name:'TypeError'});
 assert.equal(api.isKind(null,null),false);
 api.buildDomains();
 IX.domains=[{id:'first',ids:['gear','gear']},{id:'second',ids:['gear']}];
 assert.deepEqual(Array.from(api.familyMembership(),entry=>Array.from(entry)),[['gear','first']],'first family wins overlapping membership');
}
function exerciseLive(api) {
 prepareEdge(api,'normal');
 const deps=api.familyDependencies(),calls=new Map();
 // Replace every injected function after creation. Traversal must invoke the
 // replacements rather than a destructured snapshot of the original callbacks.
 for(const [key,fn] of Object.entries(deps))deps[key]=(...args)=>{calls.set(key,(calls.get(key)||0)+1);return fn(...args);};
 api.buildDomains();api.familyMembership();api.dungeonGives();
 api.sampleOf(api.IX.domain('gear'),5);api.classHolds('class:a',api.IX.records.get('gear'));
 api.IX.technical(()=>true);api.IX.isEventDungeon(api.IX.records.get('event'));
 for(const key of Object.keys(deps))assert(calls.get(key)>0,'live callback '+key);
 const enemies=api.IX.domain('enemies'),foe=api.IX.records.get('foe');
 const score=enemies.sortBy(foe);api.IX.foundIn=new Map();
 assert.equal(enemies.sortBy(foe),score+1e9,'existing sort function rereads archive');
 deps.getFoundIn=()=>new Map([[foe.id,new Set(['main'])]]);
 assert.equal(enemies.sortBy(foe),score,'replaced archive getter is live');
 deps.difficultyOf=()=>2;
 assert.equal(api.IX.domain('dungeons').sortBy(api.IX.records.get('main')),2);
 deps.getRecord=id=>id==='class:a'?{slots:[]}:api.IX.records.get(id);
 assert.equal(api.classHolds('class:a',api.IX.records.get('gear')),false);
 const gear=api.IX.records.get('gear');
 deps.getRecord=id=>id===gear.id?{...gear,name:'Replacement'}:api.IX.records.get(id);
 deps.getList=()=>[];api.buildDomains();
 assert.equal(api.IX.domains.every(d=>d.ids.length===0),true,'new catalogue read by same factory');
 assert.equal(api.IX.sidePortals.length,0);assert.equal(api.IX.holderOf.size,0);
 assert.equal(api.familyCreations(),1);
}

// Frozen on 9b00919 outside the repository before changing the browse code.
// Hashes cover complete ordered values, labels, nonfinite scores, membership,
// event associations, drops and duplicates. Identity is checked separately.
async function run() {
 const source=read('web/index-families.js'),sandbox={};vm.runInNewContext(source,sandbox);
 assert.equal(typeof sandbox.IndexFamilies.createFamilies,'function');
 assert(!/\b(?:document|window|localStorage|RealmIndex)\b/.test(source));
 assert(!/\{[^}\n]*\bany\b|@ts-ignore|@ts-expect-error/.test(source));
 assert.equal((read('web/index-browse.js').match(/IndexFamilies\.createFamilies\(/g)||[]).length,1);
 let count=0;
 function compare(actual,expected,label) {
  if(!Array.isArray(expected)){assert.deepEqual(actual,expected,label);count++;return;}
  assert.equal(actual.length,expected.length,label);
  actual.forEach(([name,value],i)=>{assert.equal(name,expected[i][0]);assert.equal(digest(value),corpus.values[expected[i][1]],label+'/'+name);count++;});
 }
 let api;
 for(const real of corpus.real) {
  api=await require('./index-harness')(IndexSearch,undefined,{archive:real.archive,loadArchive:real.archive});
  compare(collect(api),real.cases,'archive='+real.archive);
  const membership=api.familyMembership(),gives=api.dungeonGives(),domain=api.IX.domains[0];
  assert.strictEqual(api.familyMembership(),membership);assert.strictEqual(api.dungeonGives(),gives);
  api.buildDomains();
  assert.notStrictEqual(api.familyMembership(),membership);assert.notStrictEqual(api.dungeonGives(),gives);
  assert.notStrictEqual(api.IX.domains[0],domain);
  assert.equal(api.familyCreations(),1);assert.equal(api.creations(),1);assert.equal(api.filterCreations(),1);assert.equal(api.groupingCreations(),1);
 }
 for(const [mode,expected] of corpus.edges) {
  // Each configuration resets the catalogue and classifiers on the same factory.
  let got;try{prepareEdge(api,mode);got=collect(api);}catch(e){got={error:e.name};}
  compare(got,expected,mode);assert.equal(api.familyCreations(),1);
 }
 exerciseCaches(await require('./index-harness')(IndexSearch));
 exerciseLive(await require('./index-harness')(IndexSearch));
 let domains, side, holders;
 const pure = sandbox.IndexFamilies.createFamilies({ ...api.familyDependencies(),
  getList: () => [], getSlots: () => ({}), getBiomeLevels: () => [],
  getDomains: () => domains, setDomains: value => { domains = value; },
  setSidePortals: value => { side = value; }, setHolderOf: value => { holders = value; }
 });
 pure.buildDomains();
 assert.equal(domains.length, 11); assert.equal(side.length, 0); assert.equal(holders.size, 0);
 assert.equal(pure.familyMembership().size, 0); assert.equal(pure.dungeonGives().size, 0);
 console.log('Index families parity: '+count+' frozen cases, archive loaded/absent and '+corpus.edges.length+' edge scenarios; identical order, labels, associations, references and duplicates.');
}
run().catch(error=>{console.error(error);process.exitCode=1;});
