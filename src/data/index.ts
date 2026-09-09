import type { CharacterDef } from '../engine/types';
import { GOUZAN } from './gouzan';
import { KUROHA } from './kuroha';
import { RYUGA } from './ryuga';
import { SAYA } from './saya';

export const ROSTER: CharacterDef[] = [RYUGA, SAYA, KUROHA, GOUZAN];

export function characterById(id: string): CharacterDef {
  const c = ROSTER.find((x) => x.id === id);
  if (!c) throw new Error(`unknown character: ${id}`);
  return c;
}

export { RYUGA, SAYA, KUROHA, GOUZAN };
