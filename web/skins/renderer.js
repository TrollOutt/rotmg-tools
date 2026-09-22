/*
 * One sheet.
 *
 * This used to load the client's three packed sheets whole - thirty-seven
 * megabytes of every creature in the game - to draw characters out of them.
 * tools/build-skin-looks.js now cuts only what is drawn and lays it down
 * again on a single sheet, masks and bolts of cloth included, so there is one
 * picture to fetch and one texture on the card.
 */
const URLS={looks:'assets/skins/textures/looks.png'};
export const MODE={NONE:-1,COLOR:0,TEXTILE:1,HORIZONTAL:2,VERTICAL:3,SPINNING:4};
export function dyeMode(d){return !d?MODE.NONE:d.kind==='color'?MODE.COLOR:d.animation?.type==='horizontal'?MODE.HORIZONTAL:d.animation?.type==='vertical'?MODE.VERTICAL:d.animation?.type==='spinning'?MODE.SPINNING:MODE.TEXTILE}
export function phase(d,time){return(d?.animation?.speed||0)*time/1000}
export function composition(sprite,mask,dye,mode){if(mode===MODE.NONE||mask<=0)return sprite;return dye*mask}
export const OUTLINE_PIXELS=1;
/* The Atlas outline is a clear pixel touching the silhouette by a side only. */
export function isOutlinePixel(centre,left,right,above,below){return !centre&&Boolean(left||right||above||below)}
/* Grow the drawn quad, but keep the original sprite's feet and centre anchored. */
export function quadAt(rect,width,height,x=width/2,y=height*.72,pixelScale=6,padding=0){const w=(rect.w+padding*2)*pixelScale,h=(rect.h+padding*2)*pixelScale,l=(x-w/2)/width*2-1,r=(x+w/2)/width*2-1,top=1-(y-rect.h*pixelScale-padding*pixelScale)/height*2,bottom=1-(y+padding*pixelScale)/height*2;return[l,bottom,r,bottom,l,top,r,top]}
const V=`attribute vec2 p;attribute vec2 t;varying vec2 uv;void main(){uv=t;gl_Position=vec4(p,0,1);}`;
const F=`precision mediump float;varying vec2 uv;uniform sampler2D base,mask,mainTex,accTex;uniform vec4 baseRect,maskRect,mainRect,accRect;uniform vec2 baseSize,maskSize,mainSize,accSize,mainPivot,accPivot;uniform vec4 mainColor,accColor;uniform float mainMode,accMode,mainPhase,accPhase;
vec2 textile(vec2 local,vec4 r,vec2 size,float mode,float ph,vec2 pivot){vec2 q=local*baseRect.zw/max(r.zw,vec2(1.));if(mode==2.)q+=vec2(ph,0.);else if(mode==3.)q+=vec2(0.,ph);else if(mode==4.){q-=pivot;q=mat2(cos(ph),-sin(ph),sin(ph),cos(ph))*q+pivot;}return(r.xy+fract(q)*r.zw)/size;}
vec3 dye(sampler2D t,vec2 local,vec4 r,vec2 z,vec4 color,float mode,float ph,vec2 pivot){return mode==0.?color.rgb:texture2D(t,textile(local,r,z,mode,ph,pivot)).rgb;}
/* Sampling outside this frame is transparent, never the next packed frame. */
vec4 frameSample(sampler2D t,vec2 local,vec4 r,vec2 size){if(any(lessThan(local,vec2(0.)))||any(greaterThanEqual(local,r.zw)))return vec4(0.);return texture2D(t,(r.xy+local)/size);}
void main(){vec2 local=uv*(baseRect.zw+vec2(2.))-vec2(1.);vec4 s=frameSample(base,local,baseRect,baseSize);float neighbour=max(max(frameSample(base,local+vec2(-1.,0.),baseRect,baseSize).a,frameSample(base,local+vec2(1.,0.),baseRect,baseSize).a),max(frameSample(base,local+vec2(0.,-1.),baseRect,baseSize).a,frameSample(base,local+vec2(0.,1.),baseRect,baseSize).a));if(s.a<=0.&&neighbour>0.){gl_FragColor=vec4(0.,0.,0.,1.);return;}if(maskRect.z<=0.){gl_FragColor=s;return;}vec4 m=frameSample(mask,local,maskRect,maskSize);vec3 c=s.rgb;if(mainMode>=0.&&m.r>0.)c=dye(mainTex,local/baseRect.zw,mainRect,mainSize,mainColor,mainMode,mainPhase,mainPivot)*m.r;if(accMode>=0.&&m.g>0.)c=dye(accTex,local/baseRect.zw,accRect,accSize,accColor,accMode,accPhase,accPivot)*m.g;gl_FragColor=vec4(c,s.a);}`;
function sh(g,t,s){const x=g.createShader(t);g.shaderSource(x,s);g.compileShader(x);if(!g.getShaderParameter(x,g.COMPILE_STATUS))throw Error(g.getShaderInfoLog(x));return x}
function texture(g,i){const t=g.createTexture();g.bindTexture(g.TEXTURE_2D,t);for(const p of[g.TEXTURE_MIN_FILTER,g.TEXTURE_MAG_FILTER])g.texParameteri(g.TEXTURE_2D,p,g.NEAREST);for(const p of[g.TEXTURE_WRAP_S,g.TEXTURE_WRAP_T])g.texParameteri(g.TEXTURE_2D,p,g.CLAMP_TO_EDGE);g.pixelStorei(g.UNPACK_PREMULTIPLY_ALPHA_WEBGL,false);g.texImage2D(g.TEXTURE_2D,0,g.RGBA,g.RGBA,g.UNSIGNED_BYTE,i);return t}
export class Renderer{
  constructor(canvas){
    const g=this.g=canvas.getContext('webgl',{alpha:true,premultipliedAlpha:false});if(!g)throw Error('WebGL unavailable');
    const p=g.createProgram();g.attachShader(p,sh(g,g.VERTEX_SHADER,V));g.attachShader(p,sh(g,g.FRAGMENT_SHADER,F));g.linkProgram(p);if(!g.getProgramParameter(p,g.LINK_STATUS))throw Error(g.getProgramInfoLog(p));this.p=p;this.u={};
    for(const n of['base','mask','mainTex','accTex','baseRect','maskRect','mainRect','accRect','baseSize','maskSize','mainSize','accSize','mainPivot','accPivot','mainColor','accColor','mainMode','accMode','mainPhase','accPhase'])this.u[n]=g.getUniformLocation(p,n);
    this.b=g.createBuffer();g.useProgram(p);g.bindBuffer(g.ARRAY_BUFFER,this.b);g.bufferData(g.ARRAY_BUFFER,new Float32Array(16),g.DYNAMIC_DRAW);
    const a=g.getAttribLocation(p,'p'),t=g.getAttribLocation(p,'t');g.enableVertexAttribArray(a);g.vertexAttribPointer(a,2,g.FLOAT,false,16,0);g.enableVertexAttribArray(t);g.vertexAttribPointer(t,2,g.FLOAT,false,16,8);
    this.images={};this.textures={};for(const[n,url]of Object.entries(URLS)){const i=new Image();i.src=url;this.images[n]=i}
  }
  upload(){for(const[n,i]of Object.entries(this.images))if(!this.textures[n]&&i.complete&&i.naturalWidth)this.textures[n]=texture(this.g,i)}
  bind(name,unit,uniform){const g=this.g;g.activeTexture(g.TEXTURE0+unit);g.bindTexture(g.TEXTURE_2D,this.textures[name]);g.uniform1i(this.u[uniform],unit)}
  draw(frame,dyes,time,left=false,world=null){
    const g=this.g,U=this.u;g.viewport(0,0,g.canvas.width,g.canvas.height);g.clearColor(0,0,0,0);g.clear(g.COLOR_BUFFER_BIT);this.upload();
    if(!frame?.spriteAvailable||!this.textures[frame.atlas])return false;
    const base=this.images[frame.atlas],main=dyes.clothing,acc=dyes.accessory,r=x=>[x?.x||0,x?.y||0,x?.w||0,x?.h||0],dim=x=>[x.naturalWidth,x.naturalHeight],color=d=>d?.color?[parseInt(d.color.slice(1,3),16)/255,parseInt(d.color.slice(3,5),16)/255,parseInt(d.color.slice(5),16)/255,1]:[0,0,0,1];
    const usable=d=>d?.textile?.sheet&&this.textures[d.textile.sheet]?d:null,mainUse=main?.kind==='color'?main:usable(main),accUse=acc?.kind==='color'?acc:usable(acc),src=d=>d?.textile?.sheet||frame.atlas;
    const maskReady=Boolean(this.textures[frame.atlas]);  // the mask shares the sheet
    const w=world||{x:g.canvas.width/2,y:g.canvas.height*.72,scale:Math.max(1,Math.floor(Math.min(g.canvas.width/frame.rect.w,g.canvas.height/frame.rect.h)*.25))};
    const q=quadAt(frame.rect,g.canvas.width,g.canvas.height,w.x,w.y,w.scale,OUTLINE_PIXELS),uv=left?[1,1,0,1,1,0,0,0]:[0,1,1,1,0,0,1,0],vertices=[];for(let i=0;i<4;i++)vertices.push(q[i*2],q[i*2+1],uv[i*2],uv[i*2+1]);
    g.bindBuffer(g.ARRAY_BUFFER,this.b);g.bufferData(g.ARRAY_BUFFER,new Float32Array(vertices),g.DYNAMIC_DRAW);
    this.bind(frame.atlas,0,'base');this.bind(frame.atlas,1,'mask');this.bind(src(mainUse),2,'mainTex');this.bind(src(accUse),3,'accTex');
    g.uniform4fv(U.baseRect,r(frame.rect));g.uniform4fv(U.maskRect,frame.maskAvailable&&maskReady?r(frame.maskRect):[0,0,0,0]);g.uniform4fv(U.mainRect,r(mainUse?.textile?.rect));g.uniform4fv(U.accRect,r(accUse?.textile?.rect));
    g.uniform2fv(U.baseSize,dim(base));g.uniform2fv(U.maskSize,dim(base));g.uniform2fv(U.mainSize,dim(this.images[src(mainUse)]||base));g.uniform2fv(U.accSize,dim(this.images[src(accUse)]||base));
    g.uniform2fv(U.mainPivot,[(mainUse?.animation?.pivotX??.5),(mainUse?.animation?.pivotY??.5)]);g.uniform2fv(U.accPivot,[(accUse?.animation?.pivotX??.5),(accUse?.animation?.pivotY??.5)]);g.uniform4fv(U.mainColor,color(mainUse));g.uniform4fv(U.accColor,color(accUse));g.uniform1f(U.mainMode,dyeMode(mainUse));g.uniform1f(U.accMode,dyeMode(accUse));g.uniform1f(U.mainPhase,phase(mainUse,time));g.uniform1f(U.accPhase,phase(accUse,time));
    g.drawArrays(g.TRIANGLE_STRIP,0,4);return true;
  }
}
