/**
 * ファイター（対戦する 1 人ぶん）の状態。
 *
 * ここに入っているのは「試合の進行に必要な数値」だけです。
 * 見た目のためのものは一切入れていません。
 * そうしておくと、この構造体をまるごと保存して巻き戻すだけで
 * ロールバック（オンライン対戦の遅延ごまかし）が成立します。
 */

import { FP, GRAVITY, METER_MAX, px, toPx } from './constants';
import { cloneHistory, createHistory, type InputHistory } from './input';
import type { Box, CharacterDef, MoveDef, Stance } from './types';

export type FighterState =
  | 'idle'
  | 'walkF'
  | 'walkB'
  | 'crouch'
  | 'jumpStart'
  | 'air'
  | 'landing'
  | 'attack'
  | 'hitstun'
  | 'blockstun'
  | 'knockdown'
  | 'wakeup'
  | 'dash'
  | 'backdash'
  | 'grabbing'
  | 'grabbed'
  | 'dizzy'
  | 'ko'
  | 'intro'
  | 'win'
  | 'lose';

export interface Fighter {
  /** キャラクター定義の添字。 */
  charIndex: number;
  /** プレイヤー番号（0 or 1）。 */
  side: number;

  x: number; // 内部単位
  y: number; // 内部単位。地面が 0、上が正
  vx: number;
  vy: number;
  facingRight: boolean;

  state: FighterState;
  /** 今の状態が始まってから何フレーム経ったか（0 始まり）。 */
  stateFrame: number;
  /** 状態の長さ（-1 は無期限）。 */
  stateDuration: number;

  /** 出している技の添字（-1 は技を出していない）。 */
  moveIndex: number;
  /** 技の何フレーム目か（1 始まり）。 */
  moveFrame: number;
  /** この技がすでに相手に当たった／ガードされたか。 */
  moveHit: boolean;
  moveBlocked: boolean;
  /** この技で何回当てたか（多段技用）。 */
  moveHitCount: number;
  /** 最後に当てたときの技フレーム。 */
  lastHitFrame: number;
  /** キャンセルで出した技か（コンボ補正の判定に使う）。 */
  moveCancelled: boolean;
  /** 着地してから消化する硬直。 */
  pendingLanding: number;
  /** この技のアーマーの残り回数。 */
  armorLeft: number;

  stance: Stance;
  /** 技が終わったあとに戻る姿勢。 */
  returnStance: Stance;

  health: number;
  maxHealth: number;
  meter: number;
  stunValue: number;
  maxStun: number;
  /** スタン値が自然回復するまでの待ち時間。 */
  stunDecayDelay: number;

  hitstop: number;
  /** 超必殺技の暗転（自分は動ける／相手は止まる）。 */
  freeze: number;

  /** ガードを入力していたか（描画とデバッグ用）。 */
  guarding: boolean;
  /** 直前のフレームで下段ガード（しゃがみガード）だったか。 */
  guardLow: boolean;

  /** コンボ関係。攻撃側が持つ。 */
  comboHits: number;
  comboDamage: number;
  /** 空中の相手を何回打ち上げたか。 */
  juggle: number;

  /** 空中でまだ必殺技を使えるか。 */
  airMoveUsed: boolean;
  /** 空中ジャンプの残り回数。 */
  airJumps: number;

  /** 投げ関係。 */
  grabTarget: number; // 掴んでいる相手の side（-1 で掴んでいない）
  grabbedBy: number;
  /** 投げ抜けを受け付ける残りフレーム。 */
  throwTechWindow: number;

  /** 無敵の残りフレーム（バックダッシュなど、技によらないもの）。 */
  invulnFrames: number;

  /** ラウンド開始からの被弾数（統計用）。 */
  hitsTaken: number;

  input: InputHistory;
  /** 直前のフレームの生入力（描画やAI用）。 */
  lastInput: number;

  /** 相手に「詰められている」量。押し合いの解決に使う。 */
  pushX: number;
}

export function createFighter(charIndex: number, side: number, char: CharacterDef, x: number): Fighter {
  return {
    charIndex,
    side,
    x,
    y: 0,
    vx: 0,
    vy: 0,
    facingRight: side === 0,
    state: 'idle',
    stateFrame: 0,
    stateDuration: -1,
    moveIndex: -1,
    moveFrame: 0,
    moveHit: false,
    moveBlocked: false,
    moveHitCount: 0,
    lastHitFrame: 0,
    moveCancelled: false,
    pendingLanding: 0,
    armorLeft: 0,
    stance: 'stand',
    returnStance: 'stand',
    health: char.health,
    maxHealth: char.health,
    meter: 0,
    stunValue: 0,
    maxStun: char.stun,
    stunDecayDelay: 0,
    hitstop: 0,
    freeze: 0,
    guarding: false,
    guardLow: false,
    comboHits: 0,
    comboDamage: 0,
    juggle: 0,
    airMoveUsed: false,
    airJumps: 0,
    grabTarget: -1,
    grabbedBy: -1,
    throwTechWindow: 0,
    invulnFrames: 0,
    hitsTaken: 0,
    input: createHistory(),
    lastInput: 0,
    pushX: 0,
  };
}

export function cloneFighter(f: Fighter): Fighter {
  return { ...f, input: cloneHistory(f.input) };
}

/** 今出している技（出していなければ null）。 */
export function currentMove(f: Fighter, char: CharacterDef): MoveDef | null {
  return f.moveIndex >= 0 ? char.moves[f.moveIndex] : null;
}

/** 技の全体フレーム。 */
export function moveTotal(m: MoveDef): number {
  return m.startup - 1 + m.active + m.recovery;
}

/**
 * その技の、当てたときの「のけぞり時間」。硬直差から逆算する。
 *
 *   攻撃側が動けるようになるのは  ヒットしたフレーム + (全体 - 発生 + 1)
 *   守備側が動けるようになるのは  ヒットしたフレーム + のけぞり
 *   硬直差 = 守備側 - 攻撃側
 *
 * なので のけぞり = 硬直差 + (全体 - 発生) + 1 になります。
 * この式が正しいことは tests/frames.test.ts で実際に試合を回して確かめています。
 */
export function hitstunOf(m: MoveDef): number {
  return m.hit.hitAdvantage + (moveTotal(m) - m.startup) + 1;
}

/** ガードさせたときのガード硬直。考え方はのけぞりと同じ。 */
export function blockstunOf(m: MoveDef): number {
  return m.hit.blockAdvantage + (moveTotal(m) - m.startup) + 1;
}

/** 技の何フレーム目が攻撃判定の出ている時間か。 */
export function isActiveFrame(m: MoveDef, frame: number): boolean {
  return frame >= m.startup && frame < m.startup + m.active;
}

/** 空中にいるか（見た目の Y ではなく、判定としての空中）。 */
export function isAirborne(f: Fighter, char: CharacterDef): boolean {
  if (f.y > 0) return true;
  if (f.state === 'air') return true;
  const m = currentMove(f, char);
  if (m?.airborne) {
    const to = m.airborne.to === 'landing' ? Infinity : m.airborne.to;
    if (f.moveFrame >= m.airborne.from && f.moveFrame <= to) return true;
  }
  return false;
}

/**
 * 走り込みながら技を出せる状態か。
 *
 * ダッシュ中いっさい何もできないと、前進が「ただの移動」で終わってしまい、
 * 攻めが単調になります。踏み込んでから技、ができると一気に選択肢が増えます。
 */
export function canActFromDash(f: Fighter): boolean {
  return f.state === 'dash' && f.stateFrame >= 3;
}

/** 行動できる状態か。 */
export function isActionable(f: Fighter): boolean {
  switch (f.state) {
    case 'idle':
    case 'walkF':
    case 'walkB':
    case 'crouch':
      return true;
    default:
      return false;
  }
}

/** 相手に殴られている最中か（コンボ継続中か）の判定に使う。 */
export function isStunned(f: Fighter): boolean {
  return (
    f.state === 'hitstun' ||
    f.state === 'blockstun' ||
    f.state === 'knockdown' ||
    f.state === 'wakeup' ||
    f.state === 'grabbed' ||
    f.state === 'dizzy'
  );
}

/** 姿勢ごとの標準の食らい判定・押し合い判定を返す。 */
export function stanceBoxes(f: Fighter, char: CharacterDef) {
  const s: Stance = f.y > 0 ? 'air' : f.stance;
  return char.boxes[s] ?? char.boxes.stand;
}

/** ローカル座標の矩形をワールド座標（px）に直す。 */
export function worldBox(f: Fighter, b: Box): { l: number; r: number; b: number; t: number } {
  const fx = toPx(f.x);
  const fy = toPx(f.y);
  if (f.facingRight) {
    return { l: fx + b.x, r: fx + b.x + b.w, b: fy + b.y, t: fy + b.y + b.h };
  }
  return { l: fx - b.x - b.w, r: fx - b.x, b: fy + b.y, t: fy + b.y + b.h };
}

/** 今フレームの食らい判定。技 → フレーム指定 → 姿勢の順で上書きされる。 */
export function hurtboxes(f: Fighter, char: CharacterDef): Box[] {
  const m = currentMove(f, char);
  if (m) {
    const fb = m.frameBoxes?.find((x) => x.frame === f.moveFrame && x.hurtboxes);
    if (fb?.hurtboxes) return fb.hurtboxes;
    if (m.hurtboxes) return m.hurtboxes;
  }
  return stanceBoxes(f, char).hurt;
}

/** 今フレームの攻撃判定。技を出していない、または持続外なら空。 */
export function hitboxes(f: Fighter, char: CharacterDef): Box[] {
  const m = currentMove(f, char);
  if (!m || f.state !== 'attack') return [];
  if (!isActiveFrame(m, f.moveFrame)) return [];
  if (f.moveHit || f.moveBlocked) return [];
  const fb = m.frameBoxes?.find((x) => x.frame === f.moveFrame && x.hitboxes);
  if (fb?.hitboxes) return fb.hitboxes;
  return m.hitboxes;
}

/** 押し合い判定。 */
export function pushbox(f: Fighter, char: CharacterDef): Box {
  return stanceBoxes(f, char).push;
}

/** 技の無敵が効いているか。 */
export function hasInvuln(f: Fighter, char: CharacterDef, kind: 'strike' | 'throw' | 'projectile'): boolean {
  if (f.invulnFrames > 0) return true;
  const m = currentMove(f, char);
  if (!m?.invuln) return false;
  for (const w of m.invuln) {
    if (f.moveFrame >= w.from && f.moveFrame <= w.to) {
      if (w.kind === 'full') return true;
      if (w.kind === kind) return true;
    }
  }
  return false;
}

/** 重力を 1 フレームぶん適用する。 */
export function applyGravity(f: Fighter, char: CharacterDef): void {
  // 体重が重いほど落ちるのが速い（＝浮かない）。
  f.vy -= Math.round((GRAVITY * char.weight) / 100);
}

/** ゲージを増やす（上限で止める）。 */
export function addMeter(f: Fighter, amount: number): void {
  f.meter = Math.max(0, Math.min(METER_MAX, f.meter + amount));
}

/** 画面上での距離（px）。 */
export function distanceX(a: Fighter, b: Fighter): number {
  return Math.abs(toPx(a.x) - toPx(b.x));
}

/** ステージ内へ押し戻す。 */
export function clampToStage(f: Fighter, half: number, char: CharacterDef): boolean {
  const pb = pushbox(f, char);
  const halfW = Math.round(pb.w / 2);
  const min = px(-half + halfW);
  const max = px(half - halfW);
  if (f.x < min) {
    f.x = min;
    return true;
  }
  if (f.x > max) {
    f.x = max;
    return true;
  }
  return false;
}

/** 内部単位のまま四捨五入しないで足す小ヘルパ。 */
export function moveBy(f: Fighter, dx: number): void {
  f.x += dx;
}

export const ONE_PX = FP;
