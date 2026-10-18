'use strict';
addEventListener('keydown',e=>{const k=e.key.toLowerCase();
 if(k==='f11'){e.preventDefault();if(document.fullscreenElement)document.exitFullscreen();else document.documentElement.requestFullscreen();return}
 if(scene==='menu'){if(k==='enter'&&!(e.target&&e.target.tagName==='INPUT')){e.preventDefault();startGame()}return}
 if(['arrowup','arrowdown','arrowleft','arrowright',' '].includes(k))e.preventDefault();
 const dg={Digit1:'armor',Digit2:'ring',Digit3:'nild',Numpad1:'armor',Numpad2:'ring',Numpad3:'nild'}[e.code];
 if(dg&&!e.repeat&&!paused&&!g.ended){if(g.useSlot(dg))gearPump();return}
 if(e.repeat)return;
 if(g.ended){if(runShown&&(k==='r'||k==='enter'))startGame();else if(k==='escape')overlayAction('menu');return}
 if(paused){if(k==='escape'||k==='enter')setPause(false);else if(k==='r')startGame();else if(k==='m')overlayAction('menu');return}
 if(k==='escape'){setPause(true);return}
 keys[k]=true;pressed[k]=true;
 if([KM.up,KM.left,KM.down,KM.right,'arrowup','arrowdown','arrowleft','arrowright'].includes(k)){pAnim+=1;ghostAnim=ghostAnim.map(a=>a+1)}
 if(k==='r')startGame();
});
addEventListener('keyup',e=>{keys[e.key.toLowerCase()]=false});
addEventListener('blur',()=>{for(const k in keys)keys[k]=false});
function down(...ks){return ks.some(k=>keys[k])}
// ------------------------------------------------------------------ simulation loop (60 steps / s)
let acc=0,last=performance.now(),fpsCount=0,fpsT=0,fps=60;
function stepGame(pre){
 const hd=(down(KM.right,'arrowright')?1:0)-(down(KM.left,'arrowleft')?1:0),vd=(down(KM.down,'arrowdown')?1:0)-(down(KM.up,'arrowup')?1:0);
 const rot=(down(KM.rotR)?1:0)-(down(KM.rotL)?1:0);
 const ctl={resetRot:pressed[KM.resetRot],resetAll:pressed[KM.resetAll],offset:pressed[KM.offset],pre:!!pre};
 if(pressed[KM.zoomIn])zoom=Math.max(0,Math.min(2,zoom-1));if(pressed[KM.zoomOut])zoom=Math.max(0,Math.min(2,zoom+1));
 for(const k in pressed)pressed[k]=false;
 g.tick(hd,vd,rot,ctl);
 if(g.vel===0)pAnim=0;else pAnim+=8*(g.o.spd/60)/60;
 g.ghosts.forEach((gh,i)=>{if(gh.vel===0)ghostAnim[i]=0;else ghostAnim[i]+=8*(g.o.spd/60)/60});
}
// ------------------------------------------------------------------ drawing
const NAMES=['s_player_right','s_player_up','s_player_left','s_player_down'];
function inFog(x,y,m,fx,fy){return hitRect(x,y,m,[fx+FOG_HB[0],fy+FOG_HB[1],fx+FOG_HB[2],fy+FOG_HB[3]])}
function drawArena(){
 const rot=g.rotation*Math.PI/180;
 const L=32*(g.offset?1:0),ang=(-g.rotation+90)*Math.PI/180;
 const offx=L*Math.cos(ang),offy=-L*Math.sin(ang);
 const camx=g.px+offx,camy=g.py+offy;
 cx.setTransform(1,0,0,1,0,0);cx.fillStyle='#000';cx.fillRect(0,0,GW,GH);
 const sx=GW/VW[zoom],sy=GH/VH[zoom];
 cx.setTransform(sx,0,0,sy,GW/2,GH/2);cx.rotate(-rot);cx.translate(-camx,-camy);cx.imageSmoothingEnabled=false;
 // fog centre (o_fog Step)
 let fx=g.px+offx,fy=g.py+offy;fx-=((fx%8)+8)%8;fy-=((fy%8)+8)%8;
 cx.drawImage(IMG.floor,0,0);
 for(const t of TENDRILS)spr('s_tendril',t.anim,t.x,t.y,1,1,0,1);
 for(const s of g.shades){if(!inFog(s.x,s.y,[-5,-8,6,5],fx,fy))continue;spr('s_shade',s.anim,s.x,s.y,1.3,1.3,rot,1,{outline:true})}
 for(const p of g.projs){if(!inFog(p.x,p.y,p.m,fx,fy))continue;
  const a=p.kind==='ab'?'s_arrow_blue':p.kind==='ar'?'s_arrow_red':p.kind==='sb'?'s_spike_blue':'s_spike_red';
  if(p.kind[0]==='a')spr(a,0,p.x,p.y,.9,.9,-p.dir*Math.PI/180,1);else spr(a,0,p.x,p.y,.72,.72,-(p.dir-45)*Math.PI/180,1)}
 g.ghosts.forEach((gh,i)=>spr(NAMES[gh.facing],ghostAnim[i]%3,gh.x,gh.y,1,1,rot,.14));
 drawGhost(rot);
 spr(NAMES[g.facing],pAnim%3,g.px,g.py,.85,.85,rot,1,{outline:true,flash:g.flash>0});
 drawInvulnHalo(rot);
 cx.drawImage(IMG.s_fog,0,0,80,40,fx-320,fy-160,640,320);
 // ---------------- GUI layer
 cx.setTransform(1,0,0,1,0,0);
 const lime=g.frames>g.goal;
 drawText(10,10,'score: '+Math.min(g.frames,g.goal)+' / '+g.goal,{sc:.5,color:lime?'#00ff00':'#fff'});
 drawText(10,40,'fps: '+fps,{sc:.5});
 let hy=70;const ho=g.o;
 if(ho.loseAt>0){drawText(10,hy,'defeat below '+Math.round(ho.loseAt*100)+'% HP ('+Math.round(g.maxHp*ho.loseAt)+')',{sc:.4,color:'#ffcc66'});hy+=34}
 if(ho.maxHits>0){drawText(10,hy,'hits : '+g.hits+' / '+ho.maxHits,{sc:.4,color:'#ffcc66'});hy+=34}
 if(ho.dmgMult!==1){drawText(10,hy,'damage x'+ho.dmgMult,{sc:.4,color:'#ffcc66'});hy+=34}
 const bo=225*(g.offset?1:0);
 const x2=Math.max(0,g.hp/g.maxHp)*66;
 cx.fillStyle='#010101';cx.fillRect(GW/2-30,GH/2+33+bo,66,8);
 cx.fillStyle='#62e448';cx.fillRect(GW/2-29,GH/2+34+bo,Math.max(0,x2-1),6);
 gearPump();drawGearHud();
 if(ho.loseAt>0){cx.fillStyle='#fff';cx.fillRect(GW/2-29+66*ho.loseAt-1,GH/2+31+bo,2,12)}
 if(countdown>0)drawText(GW/2,GH/2-120,Math.ceil(countdown/60),{sc:3,h:'c',v:'m'});

}
function n2(v){return String(Math.round(v*100)/100)}
function drawEnd(){
 cx.globalAlpha=.8;cx.fillStyle='#000';cx.fillRect(GW/2-300,GH/2-400,600,800);cx.globalAlpha=1;
 if(g.victory)drawText(GW/2-250,GH/2-380,g.o.hard?'HARD MODE CLEARED':'NORMAL MODE CLEARED',{sc:.7,color:'#00ff00'});
 else drawText(GW/2-250,GH/2-380,g.lost?'DEFEAT':'YOU DIED',{sc:.7,color:'#ff0000'});
 if(g.lost==='hp')drawText(GW/2-250,GH/2-340,'defeat : sous '+Math.round(g.o.loseAt*100)+'% des HP ('+Math.max(0,Math.round(g.hp))+' / '+g.maxHp+')',{sc:.38,color:'#ffcc66'});
 else if(g.lost==='hits')drawText(GW/2-250,GH/2-340,'defeat : '+g.o.maxHits+'e hit',{sc:.38,color:'#ffcc66'});
 else if(g.victory)drawText(GW/2-250,GH/2-340,'HP remaining : '+Math.max(0,Math.round(g.hp))+' / '+g.maxHp+'   hits : '+g.hits,{sc:.38});
 const d=g.dmg;
 const row=(name,dy,val)=>{const m=SPRITES[name];cx.save();cx.imageSmoothingEnabled=false;cx.drawImage(IMG[name],0,0,m.w,m.h,GW/2-250-m.xo*3,GH/2+dy-m.yo*3,m.w*3,m.h*3);cx.restore();drawText(GW/2-200,GH/2+dy-10,n2(val),{sc:.5})};
 row('s_arrow_red',-300,d.redArrow);row('s_arrow_blue',-200,d.blueArrow);row('s_spike_red',-100,d.redSpike);row('s_spike_blue',0,d.blueSpike);
 drawText(GW/2-250,GH/2+100,'bleed: '+n2(d.bleed),{sc:.5});
 drawText(GW/2-250,GH/2+200,'curse (amplified): '+n2(d.curse),{sc:.5});
 drawText(GW/2-200,GH/2+300,'Click: menu   R: retry',{sc:.5});
}
let fpsFrames=0,fpsTime=performance.now();
function loop(t){
 acc+=Math.min(.1,(t-last)/1000)*60;last=t;
 if(scene==='arena'&&!paused){while(acc>=1){acc-=1;if(countdown>0){countdown--;stepGame(true)}else{stepGame();recordStep()}}if(g.ended)onRunEnd()}else acc=0;
 fpsFrames++;if(t-fpsTime>=1000){fps=Math.min(60,Math.round(fpsFrames*1000/(t-fpsTime)));fpsFrames=0;fpsTime=t}
 if(scene==='arena')drawArena();else if(scene==='menu')drawBg(t);
 requestAnimationFrame(loop)}
Promise.all([loadAll(),document.fonts.load('700 20px Inter'),document.fonts.load('28px "Press Start 2P"')]).then(()=>{clampSettings();bindMenu();document.getElementById('loadStatus').hidden=true;requestAnimationFrame(loop)}).catch(error=>{document.getElementById('loadStatus').textContent=error.message;console.error(error)});
