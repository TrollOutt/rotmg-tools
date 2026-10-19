// ------------------------------------------------------------------ menu background: the arena seen from above, drawn live
// (game sprites only: shades, spikes, arrows, tendrils and the floor tiles; nothing from the old menu picture)
const bgc=document.getElementById('bgart'),bx=bgc.getContext('2d');
let bgFloor=null,bgT0=performance.now(),bgArrows=[];
function bgResize(){bgc.width=Math.max(320,innerWidth);bgc.height=Math.max(240,innerHeight);bgFloor=null}
addEventListener('resize',bgResize);
function bgSpr(name,frame,x,y,sx,sy,ang,alpha){
 const m=SPRITES[name];frame=Math.floor(frame)%m.frames;
 bx.save();bx.translate(x,y);bx.rotate(ang);bx.scale(sx,sy);bx.globalAlpha=alpha;
 bx.drawImage(IMG[name],frame*m.w,0,m.w,m.h,-m.xo,-m.yo,m.w,m.h);bx.restore()}
function bgMakeFloor(){ // the arena floor, enlarged, darkened and blurred once
 const w=bgc.width,h=bgc.height,c=document.createElement('canvas');c.width=w;c.height=h;const k=c.getContext('2d');
 const s=Math.max(w,h)/280*1.15;k.imageSmoothingEnabled=false;
 k.fillStyle='#07070d';k.fillRect(0,0,w,h);
 k.filter='blur(2px) brightness(.95) saturate(1.2)';k.drawImage(IMG.floor,w/2-140*s,h/2-140*s,280*s,280*s);k.filter='none';
 const g=k.createRadialGradient(w/2,h*.45,Math.min(w,h)*.15,w/2,h/2,Math.max(w,h)*.75);g.addColorStop(0,'rgba(0,0,0,0)');g.addColorStop(1,'rgba(0,0,0,.6)');k.fillStyle=g;k.fillRect(0,0,w,h);
 return c}
function drawBg(now){
 if(!bgFloor)bgFloor=bgMakeFloor();
 const w=bgc.width,h=bgc.height,t=(now-bgT0)/1000,u=Math.max(1.6,Math.min(w,h)/230);   // u: pixel scale of the scene
 bx.setTransform(1,0,0,1,0,0);bx.imageSmoothingEnabled=false;bx.globalAlpha=1;bx.drawImage(bgFloor,0,0);
 // tendrils along the bottom edge
 for(let i=0;i*7*u<w+40;i++)bgSpr('s_tendril',(t*6+i*1.7)%7,i*7*u+10,h+4*u,u,u,0,.55);
 // lanes of arrows drifting down (the tendril salvos)
 if(bgArrows.length<26&&Math.random()<.2)bgArrows.push({x:Math.round(Math.random()*(w/(8*u)))*8*u,y:-20,v:(.3+Math.random()*.3)*60*u*.5,blue:Math.random()<.5});
 for(const a of bgArrows){a.y+=a.v/60;bgSpr(a.blue?'s_arrow_blue':'s_arrow_red',0,a.x,a.y,.9*u,.9*u,Math.PI/2,.5)}
 bgArrows=bgArrows.filter(a=>a.y<h+30);
 // four shades, their rings of spikes leave every 3 s, blue then red
 const sp=[[.09,.3],[.91,.3],[.09,.8],[.91,.8]];
 sp.forEach(([fx,fy],si)=>{const sx=w*fx,sy=h*fy;
  const per=3,phase=t%per,idx=Math.floor(t/per),blue=idx%2===0,rad=phase*24*u,fade=Math.max(0,1-phase/per);
  for(let i=0;i<16;i++){const d=i*Math.PI/8;bgSpr(blue?'s_spike_blue':'s_spike_red',0,sx+Math.cos(d)*rad,sy-Math.sin(d)*rad,.9*u,.9*u,-(d*180/Math.PI-45)*Math.PI/180,.8*fade)}
  // previous ring, still travelling outward
  const pr=rad+per*24*u,pf=Math.max(0,(1-(phase+per)/(per*2)))*.8;
  for(let i=0;i<16;i++){const d=i*Math.PI/8;bgSpr(!blue?'s_spike_blue':'s_spike_red',0,sx+Math.cos(d)*pr,sy-Math.sin(d)*pr,.9*u,.9*u,-(d*180/Math.PI-45)*Math.PI/180,pf)}
  bx.save();bx.shadowColor='rgba(180,60,255,.55)';bx.shadowBlur=18*u/2;bgSpr('s_shade',(t*6+si)%4,sx,sy+Math.sin(t*1.4+si)*3*u,1.3*u,1.3*u,0,1);bx.restore();
 });
 bx.globalAlpha=1}
// Behind the arena while playing: the menu's own blurred floor, a shade darker, so the frame
// around the game belongs to the same scene instead of a flat colour.
const gbc=document.getElementById('gameBack'),gbx=gbc&&gbc.getContext('2d');
function drawGameBack(){if(!gbx)return;gbc.width=Math.max(320,innerWidth);gbc.height=Math.max(240,innerHeight);
 if(!bgFloor)bgFloor=bgMakeFloor();gbx.drawImage(bgFloor,0,0,gbc.width,gbc.height);gbx.fillStyle='rgba(4,3,10,.45)';gbx.fillRect(0,0,gbc.width,gbc.height)}
addEventListener('resize',()=>{if(scene==='arena')drawGameBack()});
bgResize();
