/**
 * CPU 対戦相手。
 *
 * 大事にしていること
 * ------------------
 * **人間とまったく同じ入力しか行いません。** 体力を直接いじったり、
 * コマンドを飛ばして技を出したりはしません。必殺技を出したいときは、
 * 236 を 1 フレームずつ、本当に入力します。
 * そのため、こちらが見ている画面と CPU がやっていることが必ず一致します。
 *
 * 強さは「反応の速さ」「読みの精度」「手を出す頻度」で変えています。
 * 反応の速さは、数フレーム前の状況を見て判断させることで表現しています
 * （＝人間と同じように、見てから動くには時間がかかる）。
 */

import { toPx } from '../engine/constants';
import { currentMove, isActionable, moveTotal, type Fighter } from '../engine/fighter';
import {
  IN_DOWN,
  IN_LEFT,
  IN_LP,
  IN_MP,
  IN_RIGHT,
  IN_UP,
  BUTTON_BITS,
} from '../engine/input';
import type { MatchState } from '../engine/match';
import type { AiTag, Button, CharacterDef, Motion, MoveDef } from '../engine/types';

export type Difficulty = 'easy' | 'normal' | 'hard' | 'expert';

interface DifficultyParams {
  /** 見てから動くまでのフレーム数。 */
  reaction: number;
  /** 手を出す頻度（0-100）。 */
  aggression: number;
  /** ガードの精度（0-100）。 */
  block: number;
  /** 対空の精度。 */
  antiAir: number;
  /** コンボを完走できる確率。 */
  execution: number;
  /** 起き上がりに無敵技を撃つ確率。 */
  reversal: number;
  /** 投げ抜けの精度。 */
  techThrow: number;
  /** 何もしない「間」の入りやすさ。強いほど無駄がない。 */
  idleBias: number;
}

const PARAMS: Record<Difficulty, DifficultyParams> = {
  easy:   { reaction: 26, aggression: 28, block: 30, antiAir: 12, execution: 20, reversal: 4,  techThrow: 5,  idleBias: 62 },
  normal: { reaction: 15, aggression: 54, block: 68, antiAir: 52, execution: 68, reversal: 16, techThrow: 28, idleBias: 32 },
  hard:   { reaction: 10, aggression: 70, block: 84, antiAir: 75, execution: 85, reversal: 30, techThrow: 55, idleBias: 18 },
  expert: { reaction: 5,  aggression: 84, block: 96, antiAir: 94, execution: 97, reversal: 45, techThrow: 80, idleBias: 8 },
};

interface Snapshot {
  oppState: string;
  oppMoveIndex: number;
  oppMoveFrame: number;
  oppY: number;
  oppVy: number;
  dist: number;
  oppHealth: number;
}

/** 決定論的な乱数（同じ試合をやり直しても同じ動きになるように）。 */
function nextRandom(seed: number): number {
  let x = seed | 0;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  return x | 0;
}

export class CpuBrain {
  private queue: number[] = [];
  private history: Snapshot[] = [];
  private seed: number;
  private plan: 'neutral' | 'approach' | 'retreat' | 'pressure' | 'zone' = 'neutral';
  private planTimer = 0;
  private lastAttackFrame = -999;

  constructor(
    public side: number,
    public difficulty: Difficulty = 'normal',
    seed = 12345,
  ) {
    this.seed = seed + side * 7919;
  }

  private rand(): number {
    this.seed = nextRandom(this.seed);
    return ((this.seed >>> 0) % 10000) / 10000;
  }

  private chance(percent: number): boolean {
    return this.rand() * 100 < percent;
  }

  reset(): void {
    this.queue.length = 0;
    this.history.length = 0;
    this.plan = 'neutral';
    this.planTimer = 0;
  }

  /** 1 フレームぶんの入力を返す。 */
  think(s: MatchState, chars: [CharacterDef, CharacterDef]): number {
    const me = s.fighters[this.side];
    const opp = s.fighters[1 - this.side];
    const myChar = chars[this.side];
    const p = PARAMS[this.difficulty];

    // 見た情報を記録する（あとで「数フレーム前の状況」として読む）。
    this.history.push({
      oppState: opp.state,
      oppMoveIndex: opp.moveIndex,
      oppMoveFrame: opp.moveFrame,
      oppY: toPx(opp.y),
      oppVy: opp.vy,
      dist: Math.abs(toPx(opp.x) - toPx(me.x)),
      oppHealth: opp.health,
    });
    if (this.history.length > 60) this.history.shift();

    if (s.phase !== 'fight') {
      this.queue.length = 0;
      return 0;
    }

    // 入力の予約があれば、それを 1 フレームずつ出す。
    if (this.queue.length > 0) return this.queue.shift()!;

    if (me.hitstop > 0 || me.freeze > 0) return 0;

    const seen = this.observed(p.reaction);
    const dist = Math.abs(toPx(opp.x) - toPx(me.x));
    const forward = me.facingRight ? IN_RIGHT : IN_LEFT;
    const back = me.facingRight ? IN_LEFT : IN_RIGHT;

    // --- 攻撃を受けている最中 ---
    if (me.state === 'hitstun') {
      // のけぞり中は何もできない。ガードを入れ続けて、明けた瞬間に備える。
      const low = this.opponentAttackIsLow(opp, chars[1 - this.side]);
      return back | (low ? IN_DOWN : 0);
    }

    if (me.state === 'blockstun') {
      const low = this.opponentAttackIsLow(opp, chars[1 - this.side]);
      const guard = back | (low ? IN_DOWN : 0);
      // ガード硬直が明ける直前。ここで手を出すかどうかを決める。
      //
      // ガードしているだけでは、こちらの番はいつまでも来ません。
      // 実際の対戦でも「ガードして、相手の硬直が終わる前に自分の速い技を置く」
      // のが基本で、これができないと押しっぱなしの相手に何もできなくなります。
      if (me.stateDuration - me.stateFrame > 1) return guard;

      const window = this.punishWindow(opp, chars[1 - this.side]);
      if (window > 0 && this.chance(p.execution)) {
        // 相手の硬直に確実に間に合う技があるなら、それを差し込む。
        const best = this.bestPunish(myChar, me, window + 1, dist);
        if (best && this.queueMove(myChar, best, me)) return this.queue.shift() ?? 0;
      }
      // 確定はしなくても、いちばん速い技で「押し返す」。
      // 相手が次に振ってくる技より速ければ、こちらが先に当たる。
      if (this.chance((p.aggression + p.execution) / 2)) {
        const quick = this.fastestReaching(myChar, me, dist);
        if (quick && this.queueMove(myChar, quick, me)) return this.queue.shift() ?? 0;
      }
      return guard;
    }

    // --- 起き上がり ---
    if (me.state === 'knockdown' || me.state === 'wakeup') {
      if (me.state === 'wakeup' && me.stateFrame >= me.stateDuration - 3) {
        const rev = this.findMove(myChar, (m) => m.aiTags?.includes('reversal') ?? false);
        if (rev && this.chance(p.reversal) && me.meter >= (rev.meterCost ?? 0)) {
          if (this.queueMove(myChar, rev, me)) return this.queue.shift() ?? 0;
        }
      }
      return back;
    }

    // --- コンボ（当たった／ガードされた技を必殺技でキャンセル）---
    // ここは「技を出している最中」なので、行動可能かどうかより先に見る必要がある。
    if (me.state === 'attack') {
      const cur = currentMove(me, myChar);
      if (cur && (me.moveHit || me.moveBlocked) && this.chance(p.execution)) {
        const target = this.pickCancelTarget(myChar, cur, me);
        if (target && this.queueMove(myChar, target, me)) return this.queue.shift() ?? 0;
      }
      return 0;
    }

    if (!isActionable(me) && me.state !== 'air') return 0;

    // --- 対空 ---
    if (seen && seen.oppY > 26 && seen.oppVy < 0 && dist < 92 && me.y === 0) {
      if (this.chance(p.antiAir)) {
        const aa = this.findMove(myChar, (m) => (m.aiTags?.includes('antiAir') ?? false) && (m.meterCost ?? 0) <= me.meter);
        if (aa && this.queueMove(myChar, aa, me)) return this.queue.shift() ?? 0;
      }
    }

    // --- ガード ---
    if (seen && this.shouldBlock(opp, chars[1 - this.side], dist) && this.chance(p.block)) {
      const low = this.opponentAttackIsLow(opp, chars[1 - this.side]);
      return back | (low ? IN_DOWN : 0);
    }

    // --- 確定反撃（相手が空振って硬直している） ---
    const punish = this.punishWindow(opp, chars[1 - this.side]);
    if (punish > 0 && dist < 80) {
      const best = this.bestPunish(myChar, me, punish, dist);
      if (best && this.queueMove(myChar, best, me)) return this.queue.shift() ?? 0;
    }

    // --- 作戦を決めなおす ---
    if (this.planTimer <= 0) {
      this.planTimer = 24 + Math.floor(this.rand() * 40);
      this.plan = this.choosePlan(myChar, me, opp, dist, p);
    }
    this.planTimer--;

    switch (this.plan) {
      case 'zone': {
        const proj = this.findMove(
          myChar,
          (m) => (m.aiTags?.includes('zoning') ?? false) && (m.meterCost ?? 0) <= me.meter,
        );
        const ready = proj && s.frame - this.lastAttackFrame > 34;
        // 相手が空中にいるときに飛び道具を撃つと、そのまま跳び込まれる。
        const safe = opp.y === 0;
        if (ready && safe && this.queueMove(myChar, proj!, me)) {
          this.lastAttackFrame = s.frame;
          this.planTimer = 0; // 撃ったら作戦を組み直す
          return this.queue.shift() ?? 0;
        }
        // 撃てないあいだ下がりっぱなしだと、ただ画面端に追い込まれる。
        // 間合いを保つだけにして、近すぎるときだけ下がる。
        if (dist < 90) return back;
        if (this.hasChargeMoves(myChar) && me.input.chargeBack < 45) return back;
        this.planTimer = Math.min(this.planTimer, 8);
        return 0;
      }
      case 'retreat':
        return back;
      case 'approach': {
        if (dist > 150 && this.chance(30)) {
          // 前ダッシュ。前を 2 回入れる。
          this.queue.push(forward, forward, 0, forward, forward, forward);
          return this.queue.shift()!;
        }
        if (dist > 110 && this.chance(p.aggression / 6)) {
          // 跳び込み。
          this.queue.push(forward | IN_UP, forward | IN_UP);
          const jump = this.findMove(myChar, (m) => m.input.stances.includes('air') && m.id === 'jmk');
          if (jump) {
            for (let i = 0; i < 16; i++) this.queue.push(forward);
            this.queue.push(forward | BUTTON_BITS[jump.input.button ?? 'MK']);
          }
          return this.queue.shift()!;
        }
        return forward;
      }
      case 'pressure': {
        if (s.frame - this.lastAttackFrame < 10) return 0;
        const atk = this.pickPressureMove(myChar, me, dist, p);
        if (atk && this.queueMove(myChar, atk, me)) {
          this.lastAttackFrame = s.frame;
          return this.queue.shift() ?? 0;
        }
        // 届く技が無いなら、まず間合いを詰める。空振りは反撃のもと。
        return forward;
      }
      default: {
        // ため技を持つキャラは、待っているあいだに後ろを入れてためておく。
        // 人間のため技キャラも、ずっとそうしています。
        if (this.hasChargeMoves(myChar) && me.input.chargeBack < 45 && dist > 70) return back;
        // 立ちっぱなしにせず、細かく前後に動いて間合いを測る。
        if (this.chance(p.idleBias)) return 0;
        return dist > 120 ? forward : this.chance(50) ? back : forward;
      }
    }
  }

  /** reaction フレーム前の観測。 */
  private observed(reaction: number): Snapshot | null {
    const i = this.history.length - 1 - reaction;
    return i >= 0 ? this.history[i] : null;
  }

  private opponentAttackIsLow(opp: Fighter, oppChar: CharacterDef): boolean {
    const m = currentMove(opp, oppChar);
    return m?.hit.guard === 'low';
  }

  /** 相手の攻撃が届きそうか。 */
  private shouldBlock(opp: Fighter, oppChar: CharacterDef, dist: number): boolean {
    if (opp.state !== 'attack') return false;
    const m = currentMove(opp, oppChar);
    if (!m) return false;
    if (opp.moveFrame > m.startup + m.active) return false;
    const reach = m.hitboxes.reduce((r, b) => Math.max(r, b.x + b.w), 0) + 24;
    return dist <= reach + 20;
  }

  /** 相手が硬直していて、あと何フレーム動けないか。 */
  private punishWindow(opp: Fighter, oppChar: CharacterDef): number {
    if (opp.state !== 'attack') return 0;
    const m = currentMove(opp, oppChar);
    if (!m) return 0;
    if (opp.moveFrame < m.startup + m.active) return 0;
    return moveTotal(m) - opp.moveFrame;
  }

  /** その硬直に間に合ういちばん強い技を選ぶ。 */
  private bestPunish(char: CharacterDef, me: Fighter, window: number, dist: number): MoveDef | null {
    let best: MoveDef | null = null;
    let bestDamage = 0;
    for (const m of char.moves) {
      if (m.input.stances.includes('air')) continue;
      if ((m.meterCost ?? 0) > me.meter) continue;
      if (m.startup > window) continue;
      const reach = m.throwSpec
        ? m.throwSpec.range
        : m.hitboxes.reduce((r, b) => Math.max(r, b.x + b.w), 0) + 20;
      if (reach < dist) continue;
      const dmg = m.throwSpec ? m.throwSpec.damage : m.hit.damage;
      if (dmg > bestDamage) {
        bestDamage = dmg;
        best = m;
      }
    }
    return best;
  }

  /** 今の技からキャンセルで出せる、いちばん強い技。 */
  private pickCancelTarget(char: CharacterDef, cur: MoveDef, me: Fighter): MoveDef | null {
    const kinds = new Set(
      cur.cancels
        .filter((r) => me.moveFrame >= r.from && me.moveFrame <= r.to)
        .filter((r) => (me.moveHit && r.onHit) || (me.moveBlocked && r.onBlock))
        .map((r) => r.kind),
    );
    if (kinds.size === 0) return null;
    let best: MoveDef | null = null;
    let bestDmg = 0;
    for (const m of char.moves) {
      const cost = m.meterCost ?? 0;
      if (cost > me.meter) continue;
      const isSuper = cost >= 1000;
      const isSpecial = m.input.motion !== 'none' && !isSuper;
      if (isSuper && !kinds.has('super')) continue;
      if (isSpecial && !kinds.has('special')) continue;
      if (!isSuper && !isSpecial) continue;
      if (m.throwSpec) continue; // コマンド投げはキャンセルで出しても掴めない
      const dmg = m.hit.damage + (isSuper ? 200 : 0);
      if (dmg > bestDmg) {
        bestDmg = dmg;
        best = m;
      }
    }
    return best;
  }

  private choosePlan(
    char: CharacterDef,
    me: Fighter,
    opp: Fighter,
    dist: number,
    p: DifficultyParams,
  ): 'neutral' | 'approach' | 'retreat' | 'pressure' | 'zone' {
    const zoning = char.ai.zoning;
    const lowHealth = me.health < me.maxHealth * 0.3;
    const winning = me.health > opp.health;

    // 自分のいちばん長い通常技が届く距離を基準にする。
    const maxReach = char.moves.reduce(
      (r, m) => (m.input.motion === 'none' && m.input.button ? Math.max(r, reachOf(m)) : r),
      0,
    );

    if (dist > maxReach + 60) {
      if (zoning > 40 && this.chance(zoning)) return 'zone';
      void 0;
      return this.chance(p.aggression + 20) ? 'approach' : 'neutral';
    }
    if (dist > maxReach) {
      if (zoning > 40 && this.chance(zoning / 3)) return 'zone';
      if (winning && lowHealth && this.chance(40)) return 'retreat';
      return this.chance(p.aggression + 10) ? 'approach' : 'neutral';
    }
    // 技が届く間合い。
    if (this.chance(p.aggression)) return 'pressure';
    return this.chance(20) ? 'retreat' : 'neutral';
  }

  /**
   * 近距離での攻め手を選ぶ。
   *
   * 大事なのは「届く技しか振らない」ことです。
   * 届かない技を振ると、そのまま硬直を晒して反撃をもらいます。
   * 人間の上級者がやっていることも、結局これに尽きます。
   */
  private pickPressureMove(char: CharacterDef, me: Fighter, dist: number, p: DifficultyParams): MoveDef | null {
    const roll = this.rand() * 100;
    const reaches = (m: MoveDef): boolean => reachOf(m) >= dist;
    const usable = (m: MoveDef): boolean =>
      (m.meterCost ?? 0) <= me.meter && !m.input.stances.includes('air');
    const pick = (tag: AiTag): MoveDef | undefined =>
      char.moves.find((m) => m.aiTags?.includes(tag) && usable(m) && reaches(m));

    // 超必殺技。ゲージがあって、相手をあと少しで倒せるなら思い切る。
    if (me.meter >= 1000 && roll < 14 && this.chance(p.execution)) {
      const sup = char.moves.find((m) => (m.meterCost ?? 0) >= 1000 && reaches(m) && !m.throwSpec);
      if (sup) return sup;
    }
    // 投げ。近いときだけ。
    if (roll < 22) {
      const g = pick('grab');
      if (g) return g;
    }
    // 下段始動。
    if (roll < 58) {
      const low = pick('lowStarter');
      if (low) return low;
    }
    // 牽制。
    if (roll < 82) {
      const poke = pick('poke');
      if (poke) return poke;
    }
    // それ以外は、届く通常技の中からいちばん強いものを振る。
    const all = char.moves.filter(
      (m) => m.input.motion === 'none' && m.input.button && usable(m) && !m.throwSpec && reaches(m),
    );
    if (all.length === 0) return null;
    all.sort((a, b) => b.hit.damage - a.hit.damage);
    return all[Math.floor(this.rand() * Math.min(3, all.length))];
  }

  /** 今の距離に届く技の中で、いちばん発生が速いもの。 */
  private fastestReaching(char: CharacterDef, me: Fighter, dist: number): MoveDef | null {
    let best: MoveDef | null = null;
    for (const m of char.moves) {
      if (m.input.motion !== 'none' || !m.input.button) continue;
      if (m.input.stances.includes('air')) continue;
      if (m.throwSpec) continue;
      if ((m.meterCost ?? 0) > me.meter) continue;
      if (reachOf(m) < dist) continue;
      if (!best || m.startup < best.startup) best = m;
    }
    return best;
  }

  private findMove(char: CharacterDef, pred: (m: MoveDef) => boolean): MoveDef | null {
    return char.moves.find(pred) ?? null;
  }

  /**
   * 技を出すための入力を予約する。出せないときは false を返す。
   *
   * 必殺技なら、コマンドを 1 フレームずつ本当に入力します。
   * ため技だけは例外で、その場でためはじめると 48 フレームも棒立ちになるため、
   * 「すでにたまっているときだけ出す」ようにしています。
   * ためは普段の後ろ歩き・ガードのあいだに勝手にできているので、
   * 人間のため技キャラの動きとほぼ同じになります。
   */
  private queueMove(char: CharacterDef, move: MoveDef, me: Fighter): boolean {
    void char;
    const facingRight = me.facingRight;
    const F = facingRight ? IN_RIGHT : IN_LEFT;
    const B = facingRight ? IN_LEFT : IN_RIGHT;
    const D = IN_DOWN;
    const U = IN_UP;
    const btn = move.input.buttons
      ? move.input.buttons.reduce((a, b) => a | BUTTON_BITS[b], 0)
      : move.input.button
        ? BUTTON_BITS[move.input.button as Button]
        : IN_LP | IN_MP;

    if (move.input.motion === 'charge_back') {
      if (me.input.chargeBack < 45 && me.input.chargeBackReady <= 0) return false;
      this.queue.push(F, F | btn, F | btn);
      return true;
    }
    if (move.input.motion === 'charge_down') {
      if (me.input.chargeDown < 45 && me.input.chargeDownReady <= 0) return false;
      this.queue.push(U, U | btn, U | btn);
      return true;
    }

    // しゃがみ技は下を入れたまま押す。
    if (move.input.stances.includes('crouch') && !move.input.stances.includes('stand')) {
      this.queue.push(D, D, D | btn, D | btn);
      return true;
    }

    const seq = motionSequence(move.input.motion, F, B, D, U);
    for (const dir of seq) this.queue.push(dir);
    // 最後にボタンを足す（方向はコマンドの終わりの向きを保つ）。
    const last = seq.length > 0 ? seq[seq.length - 1] : 0;
    this.queue.push(last | btn);
    this.queue.push(last | btn);
    return true;
  }

  /** このキャラがため技を持っているか。 */
  private hasChargeMoves(char: CharacterDef): boolean {
    return char.moves.some(
      (m) => m.input.motion === 'charge_back' || m.input.motion === 'charge_down',
    );
  }
}

/** その技が届く距離（相手の体の厚みぶんを足した目安）。 */
function reachOf(m: MoveDef): number {
  if (m.throwSpec) return m.throwSpec.range;
  const box = m.hitboxes.reduce((r, b) => Math.max(r, b.x + b.w), 0);
  // 前へ進みながら出す技は、その移動ぶんも届く。
  const dash = (m.velocity ?? []).reduce((r, v) => Math.max(r, v.vx > 0 ? (v.vx / 256) * m.active : 0), 0);
  if (box === 0 && m.projectile) return 999; // 飛び道具は画面端まで届く
  return box + dash + 16;
}

/** コマンドを「1 フレームずつの方向入力」に展開する。 */
function motionSequence(motion: Motion, F: number, B: number, D: number, U: number): number[] {
  switch (motion) {
    case 'none':
      return [];
    case '236':
      return [D, D, D | F, D | F, F];
    case '214':
      return [D, D, D | B, D | B, B];
    case '623':
      return [F, 0, D, D, D | F, D | F];
    case '421':
      return [B, 0, D, D, D | B, D | B];
    case '41236':
      return [B, D | B, D, D | F, F];
    case '63214':
      return [F, D | F, D, D | B, B];
    case '236236':
      return [D, D | F, F, 0, D, D | F, F];
    case '214214':
      return [D, D | B, B, 0, D, D | B, B];
    case '632146':
      return [F, D | F, D, D | B, B, D | B, D, D | F, F];
    case 'charge_back':
      return new Array(48).fill(B).concat([F]);
    case 'charge_down':
      return new Array(48).fill(D).concat([U]);
    default:
      return [];
  }
}
