export type Rect = number[];
export interface Room { walls: number[][]; water: number[][]; tendrils: number[][]; shades: number[][] }
export interface Gear { id: string; hp?: number; mode?: string; at: number; waitCur?: boolean }
export interface Options {
  hp: number; def: number; spd: number; lvl: number; hard: boolean; mode: string;
  rspeed: number; loseAt: number; dmgMult: number; maxHits: number; chases?: number;
  gear?: Record<string, Gear>; cur?: Record<string, Gear>;
}
export interface Item {
  id?: string; slot: string; name: string; tag: string; hp: number; def: number; spd: number;
  text: string; eff: null | { below: number; cd: number; invuln?: number; heal?: number };
}
export interface Ghost { x: number; y: number; angle: number; facing: number; vel: number; anim: number }
export interface Shade { x: number; y: number; ogx: number; ogy: number; tx: number; ty: number; state: string; id: number; resets: number; anim: number }
export interface Projectile { x: number; y: number; dir: number; vx: number; vy: number; life: number; kind: string; dmg: number; m: Rect; hit: boolean }
export interface Motion { x: number; y: number; hsp: number; vsp: number; vel: number }
export interface Control { resetRot?: boolean; resetAll?: boolean; offset?: boolean; pre?: boolean }
