export interface Condition {
  effect: string; target: string; trigger: string; duration?: string;
  scalingStat?: string; statModScalingMin?: string; statModDuration?: string;
}
export interface Equipment {
  id: string; name: string; clientId: string; clientType?: string; sourceFile?: string;
  icon: number[] | null; slot: number; hand: string; duration: number; cooldown: number;
  cost: number; below: number | null; damageThreshold: number | null;
  simulation: 'manual' | 'postHit'; conditions: Condition[];
}
export interface Consumable {
  id: string; name: string; bonus: number; duration: number;
  icon?: number[] | null; clientId?: string; clientType?: string; sourceFile?: string;
}
export interface Character {
  id: string; name: string; slots: number[]; stats: Record<string, number | undefined>;
}
export interface Catalog {
  classes: Character[]; equipment: Equipment[]; consumables: Consumable[];
  healingPerSecond: number | null;
}
export interface Selection { classId?: string; equipment?: Record<string, string>; consumableId?: string }
export type TrainingOptions = Partial<import('./types').Options> & Selection;
