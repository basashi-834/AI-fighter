/**
 * テスト用の道具。実際に試合を回して、1 フレーム単位で結果を確かめる。
 *
 * 「表に書いた硬直差」と「本当の挙動」が合っているかは、
 * 式を見比べるだけでは分かりません。動かして数えるのがいちばん確実です。
 */

import { px } from '../src/engine/constants';
import { isActionable, type Fighter } from '../src/engine/fighter';
import { BUTTON_BITS, IN_DOWN, IN_LEFT, IN_RIGHT, IN_UP } from '../src/engine/input';

import { createMatch, stepMatch, type MatchState, type SimEvent } from '../src/engine/match';
import type { Button, CharacterDef, MoveDef } from '../src/engine/types';

export const NEUTRAL = 0;

export function press(...buttons: Button[]): number {
  return buttons.reduce((acc, b) => acc | BUTTON_BITS[b], 0);
}

export const DIR = { up: IN_UP, down: IN_DOWN, left: IN_LEFT, right: IN_RIGHT };

export interface Rig {
  state: MatchState;
  chars: [CharacterDef, CharacterDef];
  /** そのフレームに起きたイベント。 */
  events: SimEvent[];
  step(a?: number, b?: number): SimEvent[];
}

/** 試合を「開始直後・指定の距離」で用意する。 */
export function makeRig(
  charA: CharacterDef,
  charB: CharacterDef,
  distance = 60,
): Rig {
  const state = createMatch([charA, charB], {
    roundsToWin: 2,
    timeLimit: 0,
    training: false,
    autoRecover: false,
    dummyAction: 'stand',
    infiniteMeter: true,
  });
  state.phase = 'fight';
  state.phaseFrame = 0;
  state.fighters[0].x = px(-distance / 2);
  state.fighters[1].x = px(distance / 2);
  const rig: Rig = {
    state,
    chars: [charA, charB],
    events: [],
    step(a = 0, b = 0) {
      stepMatch(state, [charA, charB], [a, b]);
      rig.events = state.events;
      return state.events;
    },
  };
  return rig;
}

export function findMove(char: CharacterDef, id: string): MoveDef {
  const m = char.moves.find((x) => x.id === id);
  if (!m) throw new Error(`move not found: ${id}`);
  return m;
}

export function moveIndex(char: CharacterDef, id: string): number {
  const i = char.moves.findIndex((x) => x.id === id);
  if (i < 0) throw new Error(`move not found: ${id}`);
  return i;
}

/** ある技を出して当て、「攻撃側／守備側が動けるようになったフレーム」を測る。 */
export interface AdvantageResult {
  /** ヒットしたフレーム（試合開始からの通し番号）。 */
  hitFrame: number;
  attackerFree: number;
  defenderFree: number;
  advantage: number;
  blocked: boolean;
  damage: number;
}

export function measureAdvantage(
  charA: CharacterDef,
  charB: CharacterDef,
  moveId: string,
  opts: { distance?: number; block?: boolean; crouchDefender?: boolean } = {},
): AdvantageResult {
  const move = findMove(charA, moveId);
  const distance = opts.distance ?? 46;
  const rig = makeRig(charA, charB, distance);
  const [a, b] = rig.state.fighters;

  // 守備側は右側に立って左を向いているので、「後ろ」は右方向。
  const guardBits = (opts.block ? IN_RIGHT : 0) | (opts.crouchDefender ? IN_DOWN : 0);

  // しゃがみ技を出すには、攻撃側も下を入れておく必要がある。
  const crouchAttacker = move.input.stances.includes('crouch') && !move.input.stances.includes('stand');
  const button = move.input.button!;
  const attackBits = press(button) | (crouchAttacker ? IN_DOWN : 0);
  const holdBits = crouchAttacker ? IN_DOWN : 0;

  // しゃがみ技のときは、先に 2 フレームしゃがんでから技を出す。
  if (crouchAttacker) {
    rig.step(IN_DOWN, guardBits);
    rig.step(IN_DOWN, guardBits);
  }
  rig.step(attackBits, guardBits);

  let hitFrame = -1;
  let attackerFree = -1;
  let defenderFree = -1;
  let blocked = false;
  let damage = 0;
  const startHealth = b.health;

  for (let i = 0; i < 400; i++) {
    const evs = rig.step(holdBits, guardBits);
    for (const e of evs) {
      if (e.type === 'hit' && e.side === 1) {
        hitFrame = rig.state.frame;
        damage = startHealth - b.health;
      }
      if (e.type === 'block' && e.side === 1) {
        hitFrame = rig.state.frame;
        blocked = true;
      }
    }
    if (hitFrame >= 0) {
      if (attackerFree < 0 && isActionable(a)) attackerFree = rig.state.frame;
      if (defenderFree < 0 && isActionable(b)) defenderFree = rig.state.frame;
      if (attackerFree >= 0 && defenderFree >= 0) break;
    }
  }

  return {
    hitFrame,
    attackerFree,
    defenderFree,
    advantage: defenderFree - attackerFree,
    blocked,
    damage,
  };
}

/** 状態のハッシュ。決定性の確認に使う。 */
export function hashState(s: MatchState): string {
  const parts: (string | number)[] = [s.frame, s.timer, s.cameraX, s.phase, s.phaseFrame];
  for (const f of s.fighters) {
    parts.push(
      f.x, f.y, f.vx, f.vy, f.facingRight ? 1 : 0, f.state, f.stateFrame, f.stateDuration,
      f.moveIndex, f.moveFrame, f.health, f.meter, f.hitstop, f.stunValue, f.comboHits,
    );
  }
  for (const p of s.projectiles) parts.push(p.x, p.y, p.vx, p.life, p.dead ? 1 : 0);
  return parts.join('|');
}

export function fighterOf(rig: Rig, side: number): Fighter {
  return rig.state.fighters[side];
}
