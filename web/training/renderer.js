'use strict';
const {Game: HistoricalGame, TENDRILS, FOG_HB, hitRect} = PatienceEngine.createEngine(ROOM);
const Game = TrainingCombat.createGame(HistoricalGame, TRAINING_CATALOG);
// ------------------------------------------------------------------ loading
const IMG={};
const cv=document.getElementById('c'),cx=cv.getContext('2d');
const GW=1288,GH=1008;
function loadAll(){return Promise.all(Object.entries(ASSETS).map(([k,src])=>new Promise((res,reject)=>{const i=new Image();i.onerror=()=>reject(new Error('Unable to load '+src));i.onload=()=>{IMG[k]=i;res()};i.src=src})))}
const FSTACK='Inter,"Segoe UI",system-ui,sans-serif';
let TK=null,TW=null;
function fnt(sc){return '700 '+Math.max(6,56*sc)+'px '+FSTACK}
function textW(s,sc){TW=TW||document.createElement('canvas').getContext('2d');TW.font=fnt(sc||1);return TW.measureText(String(s)).width}
// same call as the old bitmap font: (x, y of the top of a 69*sc line), {sc, h:'c'|'r', v:'m', color, ctx}
function drawText(x,y,s,o={}){const sc=o.sc||1,col=o.color||'#fff';s=String(s);TK=o.ctx||cx;
  TK.font=fnt(sc);TK.textBaseline='alphabetic';TK.textAlign='left';
  const w=TK.measureText(s).width,lh=69*sc;
  if(o.h==='c')x-=w/2;else if(o.h==='r')x-=w;
  if(o.v==='m')y-=lh/2;
  const sh=Math.max(1,sc*3.2);TK.fillStyle='rgba(0,0,0,.8)';TK.fillText(s,x+sh,y+45*sc+sh);
  TK.fillStyle=col;TK.fillText(s,x,y+45*sc)}
// ------------------------------------------------------------------ sprites
const silCache={};
function silhouette(name,frame,color){const key=name+'|'+frame+'|'+color;if(silCache[key])return silCache[key];
  const m=SPRITES[name],c=document.createElement('canvas');c.width=m.w;c.height=m.h;const k=c.getContext('2d');
  k.drawImage(IMG[name],frame*m.w,0,m.w,m.h,0,0,m.w,m.h);k.globalCompositeOperation='source-in';k.fillStyle=color;k.fillRect(0,0,m.w,m.h);
  return silCache[key]=c}
// draws a sprite frame like draw_sprite_ext; angle in radians applied around the instance position (canvas convention)
function spr(name,frame,x,y,sx,sy,ang,alpha,opt={}){
  const m=SPRITES[name];frame=Math.floor(frame)%m.frames;
  cx.save();cx.translate(x,y);cx.rotate(ang);cx.scale(sx,sy);cx.globalAlpha=alpha;
  if(opt.outline){const r=.333,sil=silhouette(name,frame,'#000');
    for(const [dx,dy] of [[-1,-1],[0,-1],[1,-1],[-1,0],[1,0],[-1,1],[0,1],[1,1]])cx.drawImage(sil,-m.xo+dx*r,-m.yo+dy*r)}
  cx.drawImage(IMG[name],frame*m.w,0,m.w,m.h,-m.xo,-m.yo,m.w,m.h);
  if(opt.flash){cx.globalCompositeOperation='lighter';cx.drawImage(silhouette(name,frame,'#999'),-m.xo,-m.yo)}
  cx.restore()}
