// ------------------------------------------------------------------ run flow: pause, end screens, best-run ghost
let paused=false,runShown=false,rec=[],recIdx=0,bestRun=null,newRecord=false;
const ovEl=document.getElementById('overlay');
function recKey(o){return 'rotmg:training:patience:best:v1:'+(o.hard?'hard':'normal')+':'+o.mode+':'+(o.chases||(o.hard?4:3))+':'+JSON.stringify([o.hp,o.def,o.spd,o.lvl,o.rspeed,o.loseAt||0,o.dmgMult||1,o.maxHits||0,o.gear||{},o.cur||{}])}
function loadBest(o){try{return JSON.parse(localStorage.getItem(recKey(o))||'null')}catch(e){return null}}
// a win beats any defeat; between wins the least damage taken wins; between defeats the longest survival
function better(a,b){if(!b)return true;if(a.win!==b.win)return a.win;return a.win?a.lost<b.lost:a.frames>b.frames}
function beginRun(){gearReset();paused=false;runShown=false;rec=[];recIdx=0;newRecord=false;bestRun=SETTINGS.ghost?loadBest(g.o):null;ovEl.hidden=true}
function recordStep(){if(g.ended)return;rec.push(Math.round(g.px*10)/10,Math.round(g.py*10)/10,g.facing,g.vel>0?1:0);recIdx++}
function drawGhost(rot){
 if(!bestRun||!bestRun.path)return;const p=bestRun.path,n=p.length/4;let i=countdown>0?0:recIdx;if(i>=n)return;
 const x=p[i*4],y=p[i*4+1],f=p[i*4+2],mv=p[i*4+3];
 const a=mv?(i*8*(g.o.spd/60)/60)%3:0;
 spr(NAMES[f],a,x,y,.85,.85,rot,.42,{outline:true})}
function fmtS(fr){return (fr/60).toFixed(1)+' s'}
function dmgRows(){const d=g.dmg;const im=n=>'<img src="'+ASSETS[n]+'" alt="">';
 const rows=[['s_arrow_blue','Blue arrows',d.blueArrow],['s_arrow_red','Red arrows',d.redArrow],['s_spike_blue','Blue spikes',d.blueSpike],['s_spike_red','Red spikes',d.redSpike]];
 return rows.map(([n,l,v])=>'<div class="dr">'+im(n)+'<span>'+l+'</span><b>'+Math.round(v)+'</b></div>').join('')+
  '<div class="dr"><i class="dot bleed"></i><span>Bleeding</span><b>'+Math.round(d.bleed)+'</b></div>'+
  '<div class="dr"><i class="dot curse"></i><span>Curse bonus</span><b>'+Math.round(d.curse)+'</b></div>'}
function bestLine(b){if(!b)return 'No best run for this setup yet';
 return b.win?'Best: won with '+b.hp+' / '+b.max+' HP ('+b.lost+' lost)':'Best: '+fmtS(b.frames)+' survived out of '+fmtS(b.goal)}
function evHtml(){if(!g.events.length&&!g.blocked&&!(g.clipped>.5))return '';
 return '<div class="evs"><div class="evt">Equipment</div>'+g.events.map(e=>'<div class="ev"><b>'+fmtS(e.f)+'</b><span>'+e.text+'</span></div>').join('')+(g.blocked?'<div class="ev"><b>·</b><span>'+g.blocked+' hit'+(g.blocked>1?'s':'')+' blocked'+(g.blocked>1?'s':'')+' by invulnerability</span></div>':'')+(g.healed?'<div class="ev"><b>·</b><span>'+Math.round(g.healed)+' HP healed</span></div>':'')+(g.clipped>.5?'<div class="ev"><b>·</b><span>'+Math.round(g.clipped)+' HP lost to the max HP cap</span></div>':'')+'</div>'}
function showOverlay(kind){
 const o=g.o,goal=g.goal,frames=Math.min(g.frames,goal),lost=Math.round(g.totalLost()),hpLeft=Math.max(0,Math.round(g.hp));
 ovEl.className='ov '+kind;ovEl.hidden=false;
 const mode=(o.hard?'hard':'normal')+' · '+o.mode;let kicker,title,sub,actions;
 if(kind==='pause'){
  const total=g.goal/600,chases=Math.min(Math.floor(g.frames/600)+(g.frames%600>=300?1:0),total);
  kicker='Run paused';title='Pause';sub=mode+' · '+fmtS(frames)+' / '+fmtS(goal)+' · chase '+chases+' / '+total+' · '+hpLeft+' / '+g.maxHp+' HP';
  actions='<button data-a="resume" class="pri">Resume <kbd>Esc</kbd></button><button data-a="retry">Restart <kbd>R</kbd></button><button data-a="menu">Menu <kbd>M</kbd></button>'}
 else if(kind==='win'){
  kicker='Patience completed';title='Victory';sub=mode+' · '+hpLeft+' / '+g.maxHp+' HP remaining · '+g.hits+' hit'+(g.hits>1?'s':'');
  actions='<button data-a="retry" class="pri">Retry <kbd>R</kbd></button><button data-a="menu">Menu <kbd>Esc</kbd></button>'}
 else{
  kicker=g.lost==='hp'?'Below the threshold of '+Math.round(o.loseAt*100)+' % HP':g.lost==='hits'?'Limit of '+o.maxHits+' hits reached':'You died';
  title='Defeat';sub=mode+' · survived '+fmtS(frames)+' out of '+fmtS(goal)+' · '+g.hits+' hit'+(g.hits>1?'s':'');
  actions='<button data-a="retry" class="pri">Retry <kbd>R</kbd></button><button data-a="menu">Menu <kbd>Esc</kbd></button>'}
 const pct=Math.round(frames/goal*100);
 document.getElementById('ovKicker').textContent=kicker;
 document.getElementById('ovTitle').textContent=title;
 document.getElementById('ovSub').textContent=sub;
 document.getElementById('ovBar').style.width=pct+'%';
 document.getElementById('ovPct').textContent=pct+' %';
 document.getElementById('ovBadge').hidden=!(kind!=='pause'&&newRecord);
 document.getElementById('ovStats').innerHTML=(kind==='pause'?'':'<div class="dr total"><span>HP lost</span><b>'+lost+'</b></div>'+dmgRows())+evHtml();
 document.getElementById('ovBest').textContent=bestLine(kind==='pause'?bestRun:loadBest(o));
 document.getElementById('ovActions').innerHTML=actions;
}
function onRunEnd(){
 if(runShown)return;runShown=true;
 const o=g.o,run={win:g.victory,lost:Math.round(g.totalLost()),hp:Math.max(0,Math.round(g.hp)),max:g.maxHp,frames:Math.min(g.frames,g.goal),goal:g.goal,hits:g.hits,path:rec};
 const old=loadBest(o);
 if(better(run,old)){newRecord=true;try{localStorage.setItem(recKey(o),JSON.stringify(run))}catch(e){}}
 lastResult={win:g.victory,lost:g.lost,hp:run.hp,max:g.maxHp,hits:g.hits,secs:fmtS(run.frames).replace(' s',''),hard:o.hard};
 setTimeout(()=>{if(scene==='arena'&&g.ended)showOverlay(g.victory?'win':'lose')},700);
}
function setPause(on){if(scene!=='arena'||!g||g.ended)return;paused=on;for(const k in keys)keys[k]=false;if(on)showOverlay('pause');else{ovEl.hidden=true;acc=0;cv.focus()}}
function overlayAction(a){if(a==='resume')setPause(false);else if(a==='retry')startGame();else if(a==='menu'){ovEl.hidden=true;paused=false;showMenu()}}
ovEl.addEventListener('click',e=>{const b=e.target.closest('button[data-a]');if(b)overlayAction(b.dataset.a)});
addEventListener('blur',()=>{if(scene==='arena'&&g&&!g.ended&&countdown<=0)setPause(true)});
