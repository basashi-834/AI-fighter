/**
 * 試合の進行。ここが「1 フレームぶん世界を進める」中心です。
 *
 * この関数は次の 2 つを守るように書いてあります。
 *   1. 同じ状態 + 同じ入力からは、いつ・どの機械で動かしても同じ結果になる
 *      （小数を使わない／Math.random を使わない／Date を見ない）
 *   2. 状態はぜんぶ MatchState の中にある（外に隠れた変数を持たない）
 *
 * この 2 つがあるおかげで、状態を保存して巻き戻すだけでロールバック
 * （オンライン対戦の遅延ごまかし）がそのまま動きます。
 */

import {
  FP,
  HARD_KNOCKDOWN_FRAMES,
  MAX_SEPARATION,
  METER_PER_BAR,
  MIN_SCALING,
  ROUNDS_TO_WIN,
  ROUND_INTRO_FRAMES,
  ROUND_OUTRO_FRAMES,
  ROUND_TIME_FRAMES,
  SOFT_KNOCKDOWN_FRAMES,
  STAGE_HALF,
  VIEW_W,
  WAKEUP_FRAMES,
  px,
  toPx,
} from './constants';
import {
  addMeter,
  applyGravity,
  canActFromDash,
  clampToStage,
  cloneFighter,
  createFighter,
  currentMove,
  hasInvuln,
  hitboxes,
  hitstunOf,
  blockstunOf,
  hurtboxes,
  isActionable,
  isActiveFrame,
  isStunned,
  moveTotal,
  pushbox,
  worldBox,
  type Fighter,
} from './fighter';
import {
  ALL_BUTTONS,
  IN_DOWN,
  IN_LEFT,
  IN_RIGHT,
  IN_UP,
  cloneHistory,
  consumePress,
  hasBufferedPress,
  inputAt,
  isHeld,
  matchDoubleTap,
  matchMotion,
  pushInput,
  toNumpad,
} from './input';
import type { Box, CharacterDef, HitProps, MoveDef } from './types';

/* ------------------------------------------------------------------ */
/* 状態                                                                 */
/* ------------------------------------------------------------------ */

export interface Projectile {
  owner: number;
  charIndex: number;
  moveIndex: number;
  x: number;
  y: number;
  vx: number;
  facingRight: boolean;
  life: number;
  power: number;
  style: string;
  box: Box;
  hit: HitProps;
  dead: boolean;
  /** 出てからのフレーム数（描画のアニメーション用）。 */
  age: number;
}

export type SimEvent =
  | { type: 'hit'; side: number; x: number; y: number; props: HitProps; counter: boolean; combo: number; damage: number }
  | { type: 'block'; side: number; x: number; y: number; props: HitProps; low: boolean }
  | { type: 'armor'; side: number; x: number; y: number }
  | { type: 'whiff'; side: number; sfx: string }
  | { type: 'throw'; side: number; x: number; y: number }
  | { type: 'throwTech'; x: number; y: number }
  | { type: 'projectile'; side: number; x: number; y: number; style: string }
  | { type: 'clash'; x: number; y: number }
  | { type: 'jump'; side: number }
  | { type: 'land'; side: number; hard: boolean }
  | { type: 'dash'; side: number; back: boolean }
  | { type: 'superFlash'; side: number }
  | { type: 'ko'; side: number }
  | { type: 'dizzy'; side: number }
  | { type: 'roundStart'; round: number }
  | { type: 'roundEnd'; winner: number }
  | { type: 'matchEnd'; winner: number }
  | { type: 'wallBounce'; side: number; x: number };

export type TrainingDummyAction = 'stand' | 'crouch' | 'jump' | 'guard' | 'guardAll' | 'cpu';

export interface MatchConfig {
  /** ラウンド制（先取数）。 */
  roundsToWin: number;
  /** 制限時間（フレーム）。0 で無制限。 */
  timeLimit: number;
  training: boolean;
  /** トレーニング中の自動回復。 */
  autoRecover: boolean;
  dummyAction: TrainingDummyAction;
  /** ゲージ常時最大。 */
  infiniteMeter: boolean;
}

export const DEFAULT_CONFIG: MatchConfig = {
  roundsToWin: ROUNDS_TO_WIN,
  timeLimit: ROUND_TIME_FRAMES,
  training: false,
  autoRecover: false,
  dummyAction: 'stand',
  infiniteMeter: false,
};

export type MatchPhase = 'intro' | 'fight' | 'ko' | 'roundEnd' | 'matchEnd';

export interface MatchState {
  frame: number;
  fighters: [Fighter, Fighter];
  projectiles: Projectile[];
  timer: number;
  phase: MatchPhase;
  phaseFrame: number;
  round: number;
  wins: [number, number];
  cameraX: number;
  /** 決着したラウンドの勝者（-1 は引き分け）。 */
  roundWinner: number;
  matchWinner: number;
  events: SimEvent[];
  config: MatchConfig;
  /** 決着後の演出用スローモーション。 */
  slowmo: number;
}

export interface Sim {
  chars: [CharacterDef, CharacterDef];
  state: MatchState;
}

export function createMatch(
  chars: [CharacterDef, CharacterDef],
  config: MatchConfig = DEFAULT_CONFIG,
): MatchState {
  const a = createFighter(0, 0, chars[0], px(-70));
  const b = createFighter(1, 1, chars[1], px(70));
  b.facingRight = false;
  const state: MatchState = {
    frame: 0,
    fighters: [a, b],
    projectiles: [],
    timer: config.timeLimit,
    phase: 'intro',
    phaseFrame: 0,
    round: 1,
    wins: [0, 0],
    cameraX: 0,
    roundWinner: -1,
    matchWinner: -1,
    events: [],
    config,
    slowmo: 0,
  };
  if (config.infiniteMeter) {
    a.meter = METER_PER_BAR * 3;
    b.meter = METER_PER_BAR * 3;
  }
  return state;
}

export function cloneMatch(s: MatchState): MatchState {
  return {
    ...s,
    fighters: [cloneFighter(s.fighters[0]), cloneFighter(s.fighters[1])],
    projectiles: s.projectiles.map((p) => ({ ...p, box: { ...p.box } })),
    wins: [s.wins[0], s.wins[1]],
    events: [],
    config: { ...s.config },
  };
}

/* ------------------------------------------------------------------ */
/* 補助                                                                 */
/* ------------------------------------------------------------------ */

function emit(s: MatchState, e: SimEvent): void {
  s.events.push(e);
}

/** ダメージ補正。コンボの段数が進むほど減っていく。 */
export function comboScaling(hits: number): number {
  if (hits <= 1) return 100;
  const table = [100, 100, 80, 70, 60, 50, 45, 40, 35, 30, 25, 20, 15];
  return hits < table.length ? table[hits] : MIN_SCALING;
}

function moveKind(m: MoveDef): 'normal' | 'special' | 'super' {
  if ((m.meterCost ?? 0) >= METER_PER_BAR) return 'super';
  if (m.input.motion !== 'none') return 'special';
  return 'normal';
}

/** 矩形どうしが重なっているか。 */
function overlaps(a: { l: number; r: number; b: number; t: number }, b: { l: number; r: number; b: number; t: number }): boolean {
  return a.l < b.r && b.l < a.r && a.b < b.t && b.b < a.t;
}

function centerOf(a: { l: number; r: number; b: number; t: number }, b: { l: number; r: number; b: number; t: number }) {
  return {
    x: Math.round((Math.max(a.l, b.l) + Math.min(a.r, b.r)) / 2),
    y: Math.round((Math.max(a.b, b.b) + Math.min(a.t, b.t)) / 2),
  };
}

/** 今のフレームで「後ろ」を入れているか。 */
function holdingBack(f: Fighter): boolean {
  const bits = inputAt(f.input, 0);
  return (bits & (f.facingRight ? IN_LEFT : IN_RIGHT)) !== 0;
}

function holdingDown(f: Fighter): boolean {
  return (inputAt(f.input, 0) & IN_DOWN) !== 0;
}

/* ------------------------------------------------------------------ */
/* 技を出す                                                             */
/* ------------------------------------------------------------------ */

/** 今の状態から candidate をキャンセルで出せるか。 */
function canCancelInto(f: Fighter, char: CharacterDef, candidate: MoveDef): boolean {
  const cur = currentMove(f, char);
  if (!cur || f.state !== 'attack') return false;
  const kind = moveKind(candidate);
  for (const rule of cur.cancels) {
    if (f.moveFrame < rule.from || f.moveFrame > rule.to) continue;
    const okState =
      (f.moveHit && rule.onHit) ||
      (f.moveBlocked && rule.onBlock) ||
      (!f.moveHit && !f.moveBlocked && rule.onWhiff);
    if (!okState) continue;
    if (rule.kind === 'special' && kind === 'special') return true;
    if (rule.kind === 'super' && kind === 'super') return true;
    if (rule.kind === 'target' && rule.into?.includes(candidate.id)) return true;
  }
  return false;
}

/** 技を出せる状態か（行動可能 or キャンセル可能）。 */
function canStartMove(f: Fighter, char: CharacterDef, m: MoveDef): boolean {
  const airborne = f.y > 0;
  const stance = airborne ? 'air' : f.stance;
  if (!m.input.stances.includes(stance)) return false;
  if (airborne && m.onceInAir && f.airMoveUsed) return false;
  if ((m.meterCost ?? 0) > f.meter) return false;

  if (isActionable(f)) return true;
  if (canActFromDash(f)) return true;
  if (f.state === 'air' && m.input.stances.includes('air')) return true;
  if (f.state === 'attack') return canCancelInto(f, char, m);
  return false;
}

/** 入力からその技が成立しているか。 */
function inputMatches(f: Fighter, m: MoveDef): boolean {
  if (!matchMotion(f.input, m.input.motion, f.facingRight)) return false;
  if (m.input.buttons) {
    // 同時押し（投げなど）。どれかがバッファに入っていて、残りが押されていればよい。
    let anyBuffered = false;
    for (const b of m.input.buttons) {
      if (!isHeld(f.input, b) && !hasBufferedPress(f.input, b, 4)) return false;
      if (hasBufferedPress(f.input, b, 6)) anyBuffered = true;
    }
    return anyBuffered;
  }
  if (m.input.button) return hasBufferedPress(f.input, m.input.button);
  return false;
}

/** 技の優先順位。コマンドが長い／ゲージを使うものを先に見る。 */
function movePriority(m: MoveDef): number {
  let p = 0;
  p += (m.meterCost ?? 0) / 100;
  const motionLen: Record<string, number> = {
    none: 0,
    charge_back: 3,
    charge_down: 3,
    '236': 4,
    '214': 4,
    '623': 5,
    '421': 5,
    '41236': 6,
    '63214': 6,
    '236236': 8,
    '214214': 8,
    '632146': 9,
  };
  p += motionLen[m.input.motion] ?? 0;
  if (m.input.buttons) p += 7; // 同時押しは単押しより優先
  return p;
}

/** 技を開始する。 */
function startMove(f: Fighter, char: CharacterDef, index: number, s: MatchState): void {
  const m = char.moves[index];
  const cancelled = f.state === 'attack';
  // 走り込みから出した技は、そこで足を止める（勢いはそのままにしない）。
  if (f.state === 'dash') f.vx = Math.round(f.vx / 2);
  f.returnStance = f.y > 0 ? 'air' : f.stance;
  f.state = 'attack';
  f.stateFrame = 0;
  f.stateDuration = -1;
  f.moveIndex = index;
  f.moveFrame = 1;
  f.moveHit = false;
  f.moveBlocked = false;
  f.moveHitCount = 0;
  f.lastHitFrame = 0;
  f.moveCancelled = cancelled;
  f.armorLeft = m.armor?.hits ?? 0;
  f.guarding = false;
  if (m.input.button) consumePress(f.input, m.input.button);
  if (m.input.buttons) for (const b of m.input.buttons) consumePress(f.input, b);
  if (m.meterCost && !s.config.infiniteMeter) f.meter -= m.meterCost;
  if (f.y > 0 && m.onceInAir) f.airMoveUsed = true;
  if (m.superFreeze) {
    f.freeze = 0;
    const opp = s.fighters[1 - f.side];
    opp.freeze = m.superFreeze;
    f.hitstop = m.superFreeze;
    emit(s, { type: 'superFlash', side: f.side });
  }
  if (m.sfx) emit(s, { type: 'whiff', side: f.side, sfx: m.sfx });
  // 技の 1F 目の速度指定をここで適用する。
  applyMoveVelocity(f, m, 1);
}

function applyMoveVelocity(f: Fighter, m: MoveDef, frame: number): void {
  if (!m.velocity) return;
  for (const v of m.velocity) {
    if (v.frame !== frame) continue;
    const sign = f.facingRight ? 1 : -1;
    if (v.add) {
      f.vx += v.vx * sign;
      f.vy += v.vy;
    } else {
      f.vx = v.vx * sign;
      f.vy = v.vy;
    }
  }
}

/** バッファを見て出せる技を探し、あれば出す。 */
function tryMoves(s: MatchState, f: Fighter, char: CharacterDef): boolean {
  // 優先順位の高い順に調べる。
  const order = char.moves
    .map((m, i) => ({ m, i, p: movePriority(m) }))
    .sort((a, b) => b.p - a.p);
  for (const { m, i } of order) {
    if (!canStartMove(f, char, m)) continue;
    if (!inputMatches(f, m)) continue;
    startMove(f, char, i, s);
    return true;
  }
  return false;
}

/* ------------------------------------------------------------------ */
/* ファイター 1 人ぶんの更新                                             */
/* ------------------------------------------------------------------ */

function endMove(f: Fighter, char: CharacterDef): void {
  const m = currentMove(f, char);
  f.moveIndex = -1;
  f.moveFrame = 0;
  f.moveHit = false;
  f.moveBlocked = false;
  f.armorLeft = 0;
  const stance = m?.endStance ?? f.returnStance;
  if (f.y > 0) {
    f.state = 'air';
    f.stateFrame = 0;
  } else if (stance === 'crouch') {
    f.state = 'crouch';
    f.stance = 'crouch';
    f.stateFrame = 0;
  } else {
    f.state = 'idle';
    f.stance = 'stand';
    f.stateFrame = 0;
  }
}

function beginLanding(s: MatchState, f: Fighter, char: CharacterDef): void {
  const lag = f.pendingLanding > 0 ? f.pendingLanding : char.landingLag;
  f.pendingLanding = 0;
  f.y = 0;
  f.vy = 0;
  f.vx = 0;
  f.airMoveUsed = false;
  f.airJumps = 0;
  f.moveIndex = -1;
  f.moveFrame = 0;
  f.state = 'landing';
  f.stateFrame = 0;
  f.stateDuration = lag;
  f.stance = 'stand';
  emit(s, { type: 'land', side: f.side, hard: lag > 6 });
}

function toKnockdown(s: MatchState, f: Fighter, hard: boolean): void {
  f.y = 0;
  f.vy = 0;
  f.vx = 0;
  f.state = 'knockdown';
  f.stateFrame = 0;
  f.stateDuration = hard ? HARD_KNOCKDOWN_FRAMES : SOFT_KNOCKDOWN_FRAMES;
  f.moveIndex = -1;
  f.stance = 'stand';
  f.juggle = 0;
  emit(s, { type: 'land', side: f.side, hard: true });
}

function updateFighter(s: MatchState, side: number, chars: [CharacterDef, CharacterDef]): void {
  const f = s.fighters[side];
  const opp = s.fighters[1 - side];
  const char = chars[side];

  // 相手の超必殺技の暗転中は完全に止まる。
  if (f.freeze > 0) {
    f.freeze--;
    return;
  }
  // ヒットストップ中は座標もアニメも進まない。入力の記録だけは進んでいる。
  if (f.hitstop > 0) {
    f.hitstop--;
    return;
  }

  if (f.throwTechWindow > 0) f.throwTechWindow--;
  if (f.invulnFrames > 0) f.invulnFrames--;
  if (f.stunDecayDelay > 0) {
    f.stunDecayDelay--;
  } else if (f.stunValue > 0) {
    f.stunValue = Math.max(0, f.stunValue - 2);
  }

  // 向きの更新。地上で行動可能なときだけ振り向く。
  if (f.y === 0 && (isActionable(f) || f.state === 'landing' || f.state === 'wakeup')) {
    const dx = opp.x - f.x;
    if (dx !== 0) f.facingRight = dx > 0;
  }

  f.stateFrame++;

  switch (f.state) {
    case 'attack':
      updateAttackState(s, f, char);
      break;

    case 'hitstun':
    case 'blockstun':
      if (f.stateFrame >= f.stateDuration && f.y === 0) {
        if (f.stunValue >= f.maxStun && f.state === 'hitstun') {
          f.state = 'dizzy';
          f.stateFrame = 0;
          f.stateDuration = 180;
          f.stunValue = 0;
          emit(s, { type: 'dizzy', side: f.side });
        } else {
          f.state = 'idle';
          f.stateFrame = 0;
          f.stance = 'stand';
        }
      }
      break;

    case 'dizzy':
      // 連打で早く復帰できる。
      if (f.stateFrame >= f.stateDuration) {
        f.state = 'idle';
        f.stateFrame = 0;
      }
      break;

    case 'knockdown':
      // 受け身：ダウン中に下を入れておくと、少し早く起き上がれる。
      // ただし早く起きたぶん、無敵時間も短い。
      if (holdingDown(f) && f.stateDuration > 18) f.stateDuration -= 1;
      if (f.stateFrame >= f.stateDuration) {
        f.state = 'wakeup';
        f.stateFrame = 0;
        f.stateDuration = WAKEUP_FRAMES;
        f.invulnFrames = Math.max(f.invulnFrames, WAKEUP_FRAMES - 4);
      }
      break;

    case 'wakeup':
      if (f.stateFrame >= f.stateDuration) {
        f.state = 'idle';
        f.stateFrame = 0;
      }
      break;

    case 'landing':
      if (f.stateFrame >= f.stateDuration) {
        f.state = 'idle';
        f.stateFrame = 0;
      }
      break;

    case 'jumpStart':
      if (f.stateFrame >= f.stateDuration) {
        f.state = 'air';
        f.stateFrame = 0;
        f.vy = char.jumpVy;
        emit(s, { type: 'jump', side: f.side });
      }
      break;

    case 'dash':
      if (f.stateFrame >= f.stateDuration) {
        f.state = 'idle';
        f.stateFrame = 0;
        f.vx = 0;
      }
      break;

    case 'backdash':
      if (f.stateFrame >= f.stateDuration) {
        f.state = 'idle';
        f.stateFrame = 0;
        f.vx = 0;
      }
      break;

    case 'grabbed':
      if (f.stateFrame >= f.stateDuration) {
        f.state = 'idle';
        f.stateFrame = 0;
      }
      break;

    default:
      break;
  }

  // 行動できるなら入力を処理する。ダッシュ中も技だけは出せる。
  if (isActionable(f) || f.state === 'air' || f.state === 'attack' || canActFromDash(f)) {
    handleInput(s, f, char);
  }

  // 物理。
  const airborne = f.y > 0 || f.state === 'air';
  if (airborne) {
    applyGravity(f, char);
    f.y += f.vy;
    f.x += f.vx;
    if (f.y <= 0) {
      f.y = 0;
      if (f.state === 'hitstun') {
        toKnockdown(s, f, true);
      } else if (f.state === 'attack' && currentMove(f, char)?.landingRecovery) {
        f.pendingLanding = currentMove(f, char)!.landingRecovery!;
        beginLanding(s, f, char);
      } else if (f.state === 'attack') {
        f.pendingLanding = 0;
        beginLanding(s, f, char);
      } else {
        beginLanding(s, f, char);
      }
    }
  } else {
    f.x += f.vx;
    // 地上の速度は減衰させる（のけぞりの押し出しなど）。
    if (f.state === 'hitstun' || f.state === 'blockstun') {
      const decel = px(0.32);
      if (f.vx > 0) f.vx = Math.max(0, f.vx - decel);
      else if (f.vx < 0) f.vx = Math.min(0, f.vx + decel);
    } else if (f.state !== 'dash' && f.state !== 'backdash' && f.state !== 'attack') {
      f.vx = 0;
    }
  }
}

function updateAttackState(s: MatchState, f: Fighter, char: CharacterDef): void {
  const m = currentMove(f, char)!;
  f.moveFrame++;
  applyMoveVelocity(f, m, f.moveFrame);

  // 多段技。前の当たりから interval フレーム経ったら、もう一度当たれるようにする。
  if (m.multiHit && (f.moveHit || f.moveBlocked) && f.moveHitCount < m.multiHit.times) {
    if (f.moveFrame - f.lastHitFrame >= m.multiHit.interval) {
      f.moveHit = false;
      f.moveBlocked = false;
    }
  }

  // 飛び道具を出す。
  if (m.projectile && f.moveFrame === m.projectile.spawnFrame) {
    spawnProjectile(s, f, char, m);
  }

  // 投げの掴み判定・投げ切り。
  if (m.throwSpec) {
    updateThrow(s, f, char, m);
  }

  const total = moveTotal(m);
  if (f.moveFrame > total) {
    if (f.y > 0) {
      // 空中技の硬直は着地してから消化する。
      f.pendingLanding = m.landingRecovery ?? char.landingLag;
      f.state = 'air';
      f.stateFrame = 0;
      f.moveIndex = -1;
    } else {
      endMove(f, char);
    }
  }
}

function spawnProjectile(s: MatchState, f: Fighter, char: CharacterDef, m: MoveDef): void {
  const spec = m.projectile!;
  const mine = s.projectiles.filter((p) => p.owner === f.side && !p.dead).length;
  if (mine >= spec.maxActive) return;
  const sign = f.facingRight ? 1 : -1;
  s.projectiles.push({
    owner: f.side,
    charIndex: f.charIndex,
    moveIndex: f.moveIndex,
    x: f.x + px(spec.ox) * sign,
    y: f.y + px(spec.oy),
    vx: px(spec.vx) * sign,
    facingRight: f.facingRight,
    life: spec.life,
    power: spec.power,
    style: spec.style,
    box: { ...spec.box },
    hit: spec.hit,
    dead: false,
    age: 0,
  });
  void char;
  emit(s, { type: 'projectile', side: f.side, x: toPx(f.x) + spec.ox * sign, y: toPx(f.y) + spec.oy, style: spec.style });
}

/* ------------------------------------------------------------------ */
/* 入力処理                                                             */
/* ------------------------------------------------------------------ */

function handleInput(s: MatchState, f: Fighter, char: CharacterDef): void {
  // 技（キャンセルを含む）はいつでも先に見る。
  if (tryMoves(s, f, char)) return;
  if (f.state === 'attack') return;

  const bits = inputAt(f.input, 0);
  const dir = toNumpad(bits, f.facingRight);

  if (f.state === 'air') {
    // 空中では移動入力は効かない（慣性のみ）。
    return;
  }

  // ジャンプ。
  if ((bits & IN_UP) !== 0 && isActionable(f)) {
    f.state = 'jumpStart';
    f.stateFrame = 0;
    f.stateDuration = char.jumpStartup;
    f.stance = 'stand';
    if (dir === 9 || dir === 6) f.vx = char.jumpVx;
    else if (dir === 7 || dir === 4) f.vx = -char.backJumpVx;
    else f.vx = 0;
    if (!f.facingRight) f.vx = -f.vx;
    return;
  }

  // ダッシュ／バックダッシュ。
  if (isActionable(f) && f.y === 0) {
    if (matchDoubleTap(f.input, true, f.facingRight) && dir >= 3 && (dir === 6 || dir === 3 || dir === 9)) {
      startDash(s, f, char, false);
      return;
    }
    if (matchDoubleTap(f.input, false, f.facingRight) && (dir === 4 || dir === 1 || dir === 7)) {
      startDash(s, f, char, true);
      return;
    }
  }

  if (!isActionable(f)) return;

  // しゃがみ。
  if ((bits & IN_DOWN) !== 0) {
    f.stance = 'crouch';
    f.state = 'crouch';
    f.guarding = holdingBack(f);
    f.guardLow = true;
    f.vx = 0;
    return;
  }

  f.stance = 'stand';
  f.guardLow = false;

  // 歩き。
  const fwd = f.facingRight ? IN_RIGHT : IN_LEFT;
  const back = f.facingRight ? IN_LEFT : IN_RIGHT;
  if ((bits & fwd) !== 0) {
    f.state = 'walkF';
    f.vx = f.facingRight ? char.walkForward : -char.walkForward;
    f.guarding = false;
  } else if ((bits & back) !== 0) {
    f.state = 'walkB';
    f.vx = f.facingRight ? -char.walkBack : char.walkBack;
    f.guarding = true;
  } else {
    f.state = 'idle';
    f.vx = 0;
    f.guarding = false;
  }
}

function startDash(s: MatchState, f: Fighter, char: CharacterDef, back: boolean): void {
  if (back) {
    f.state = 'backdash';
    f.stateFrame = 0;
    f.stateDuration = char.backdash.frames + char.backdash.recovery;
    f.vx = f.facingRight ? -char.backdash.speed : char.backdash.speed;
    f.invulnFrames = char.backdash.invuln;
  } else {
    f.state = 'dash';
    f.stateFrame = 0;
    f.stateDuration = char.dash.frames + char.dash.recovery;
    f.vx = f.facingRight ? char.dash.speed : -char.dash.speed;
  }
  f.stance = 'stand';
  emit(s, { type: 'dash', side: f.side, back });
}

/* ------------------------------------------------------------------ */
/* 当たり判定                                                           */
/* ------------------------------------------------------------------ */

/** ガードできているかを判定する。 */
function isBlocking(defender: Fighter, props: HitProps): boolean {
  if (props.guard === 'unblockable') return false;
  if (defender.y > 0) return false; // 空中ガードなし
  if (defender.state === 'hitstun' || defender.state === 'knockdown' || defender.state === 'dizzy') return false;
  if (defender.state === 'attack' || defender.state === 'dash' || defender.state === 'jumpStart') return false;
  if (defender.state === 'grabbed' || defender.state === 'wakeup') return false;
  if (!holdingBack(defender)) return false;
  const crouching = holdingDown(defender);
  if (props.guard === 'high' && crouching) return false; // 中段はしゃがみでは防げない
  if (props.guard === 'low' && !crouching) return false; // 下段は立ちでは防げない
  return true;
}

function applyDamage(s: MatchState, f: Fighter, amount: number, allowKill: boolean): void {
  if (s.config.training && s.config.autoRecover) {
    // トレーニングでは体力を減らすが、あとで戻す。
    f.health = Math.max(1, f.health - amount);
    return;
  }
  const min = allowKill ? 0 : 1;
  f.health = Math.max(min, f.health - amount);
}

function applyHit(
  s: MatchState,
  attacker: Fighter,
  defender: Fighter,
  chars: [CharacterDef, CharacterDef],
  props: HitProps,
  point: { x: number; y: number },
  source: MoveDef | null,
): void {
  const defChar = chars[defender.side];
  const blocked = isBlocking(defender, props);

  // アーマー。のけぞらずに耐える。
  if (!blocked && defender.state === 'attack') {
    const dm = currentMove(defender, defChar);
    if (dm?.armor && defender.armorLeft > 0 && defender.moveFrame >= dm.armor.from && defender.moveFrame <= dm.armor.to) {
      defender.armorLeft--;
      applyDamage(s, defender, Math.max(1, Math.round((props.damage * dm.armor.damageScale) / 100)), true);
      attacker.hitstop = props.hitstop;
      defender.hitstop = props.hitstop;
      emit(s, { type: 'armor', side: defender.side, x: point.x, y: point.y });
      if (source) {
        attacker.moveHit = true;
        attacker.moveHitCount++;
        attacker.lastHitFrame = attacker.moveFrame;
      }
      return;
    }
  }

  const wasCombo = isStunned(defender) && defender.state !== 'blockstun';
  if (!wasCombo) attacker.comboHits = 0;

  attacker.hitstop = blocked ? props.guardstop : props.hitstop;
  defender.hitstop = blocked ? props.guardstop : props.hitstop;

  if (blocked) {
    attacker.moveBlocked = true;
    attacker.moveHitCount++;
    attacker.lastHitFrame = attacker.moveFrame;
    // 飛び道具（source === null）は硬直差ではなく、そのままの値をガード硬直として使う。
    const stun = source ? blockstunOf(source) : props.blockAdvantage;
    defender.state = 'blockstun';
    defender.stateFrame = 0;
    defender.stateDuration = Math.max(1, stun);
    defender.guarding = true;
    defender.guardLow = holdingDown(defender);
    defender.stance = defender.guardLow ? 'crouch' : 'stand';
    defender.vx = defender.facingRight ? -props.pushbackBlock : props.pushbackBlock;
    const chipKills = (source?.meterCost ?? 0) >= METER_PER_BAR;
    if (props.chip > 0) applyDamage(s, defender, props.chip, chipKills);
    if (defender.health <= 0) {
      // 削り殺しでもきちんと吹き飛ばす。
      defender.state = 'hitstun';
      defender.stateFrame = 0;
      defender.stateDuration = 999;
      defender.vx = defender.facingRight ? -px(3) : px(3);
      defender.vy = px(5.4);
      defender.y = 1;
    }
    addMeter(attacker, Math.round(props.meterGainAttacker / 2));
    addMeter(defender, Math.round(props.meterGainDefender / 2));
    emit(s, { type: 'block', side: defender.side, x: point.x, y: point.y, props, low: defender.guardLow });
    return;
  }

  // カウンターヒット（相手が技を出し始めている最中）。
  const dm = currentMove(defender, defChar);
  const counter =
    defender.state === 'attack' && dm != null && defender.moveFrame <= dm.startup + dm.active - 1;

  // 多段技の 2 発目以降はコンボ段数を進めない。
  // そうしないと 8 段の超必殺技が補正で最後はスカスカになってしまう。
  const repeatHit = source?.multiHit != null && attacker.moveHitCount > 0;
  attacker.moveHit = true;
  attacker.moveHitCount++;
  attacker.lastHitFrame = attacker.moveFrame;
  if (!repeatHit) attacker.comboHits++;
  const scale = comboScaling(attacker.comboHits);
  let dmg = Math.max(1, Math.round((props.damage * scale) / 100));
  if (counter) dmg = Math.round(dmg * 1.2);
  attacker.comboDamage += dmg;
  applyDamage(s, defender, dmg, true);
  defender.hitsTaken++;

  defender.stunValue += counter ? Math.round(props.damage * 1.5) : props.damage;
  defender.stunDecayDelay = 120;

  addMeter(attacker, props.meterGainAttacker);
  addMeter(defender, props.meterGainDefender);

  const airborne = defender.y > 0;
  // 倒しきった一撃は、技の性質にかかわらず必ず吹き飛ばす。
  // 立ったまま negative になって終わるのは、決着として気持ちよくない。
  const finisher = defender.health <= 0;
  const knock = finisher ? 'launch' : props.knockdown;
  const baseStun = source ? hitstunOf(source) : props.hitAdvantage;
  const stun = Math.max(1, baseStun + (counter ? props.counterBonus : 0));

  defender.state = 'hitstun';
  defender.stateFrame = 0;
  defender.moveIndex = -1;
  defender.moveFrame = 0;
  defender.guarding = false;

  if (finisher) {
    attacker.hitstop = Math.max(attacker.hitstop, 18);
    defender.hitstop = Math.max(defender.hitstop, 18);
  }

  if (airborne || knock === 'launch' || knock === 'hard' || knock === 'soft') {
    // 浮かせる。空中では体重ぶん飛びにくい。
    const w = chars[defender.side].weight;
    const boost = finisher ? 150 : 100;
    const lx = Math.round((Math.max(props.launchX, finisher ? px(3.2) : 0) * boost) / w);
    const ly = Math.round((Math.max(props.launchY, finisher ? px(5.6) : 0) * boost) / w);
    defender.vx = defender.facingRight ? -lx : lx;
    defender.vy = airborne ? Math.max(ly, px(3)) : ly;
    if (defender.vy <= 0) defender.vy = px(3);
    defender.stateDuration = 999;
    defender.juggle++;
    defender.y = Math.max(defender.y, 1);
  } else {
    defender.stateDuration = stun;
    defender.vx = defender.facingRight ? -props.pushbackHit : props.pushbackHit;
    defender.stance = holdingDown(defender) ? 'crouch' : 'stand';
  }

  emit(s, {
    type: 'hit',
    side: defender.side,
    x: point.x,
    y: point.y,
    props,
    counter,
    combo: attacker.comboHits,
    damage: dmg,
  });
}

function resolveStrikes(s: MatchState, chars: [CharacterDef, CharacterDef]): void {
  for (let i = 0; i < 2; i++) {
    const attacker = s.fighters[i];
    const defender = s.fighters[1 - i];
    if (attacker.hitstop > 0 || attacker.freeze > 0) continue;
    const hbs = hitboxes(attacker, chars[i]);
    if (hbs.length === 0) continue;
    const m = currentMove(attacker, chars[i]);
    if (m?.throwSpec) continue; // 投げは別処理
    if (hasInvuln(defender, chars[1 - i], 'strike')) continue;
    if (defender.state === 'grabbed') continue;

    const hurts = hurtboxes(defender, chars[1 - i]);
    let point: { x: number; y: number } | null = null;
    outer: for (const hb of hbs) {
      const a = worldBox(attacker, hb);
      for (const hu of hurts) {
        const d = worldBox(defender, hu);
        if (overlaps(a, d)) {
          point = centerOf(a, d);
          break outer;
        }
      }
    }
    if (!point) continue;
    applyHit(s, attacker, defender, chars, m!.hit, point, m!);
  }
}

function updateThrow(s: MatchState, f: Fighter, char: CharacterDef, m: MoveDef): void {
  const spec = m.throwSpec!;
  const opp = s.fighters[1 - f.side];
  const oppChar = s.fighters[1 - f.side].charIndex;
  void oppChar;

  // 掴み判定は持続フレームのあいだだけ。
  if (isActiveFrame(m, f.moveFrame) && !f.moveHit) {
    const dist = Math.abs(toPx(opp.x) - toPx(f.x));
    const inFront = f.facingRight ? opp.x >= f.x - px(8) : opp.x <= f.x + px(8);
    const oppAir = opp.y > 0;
    const grabbable =
      dist <= spec.range &&
      inFront &&
      ((oppAir && spec.hitsAir) || (!oppAir && spec.hitsGround)) &&
      !isStunned(opp) &&
      opp.state !== 'grabbed';
    if (grabbable && !opp.invulnFrames) {
      if (spec.techable && opp.throwTechWindow > 0) {
        // 投げ抜け。
        f.moveHit = true;
        opp.throwTechWindow = 0;
        f.hitstop = 12;
        opp.hitstop = 12;
        f.state = 'idle';
        f.moveIndex = -1;
        opp.state = 'idle';
        opp.moveIndex = -1;
        f.vx = f.facingRight ? -px(3) : px(3);
        opp.vx = opp.facingRight ? -px(3) : px(3);
        emit(s, { type: 'throwTech', x: Math.round((toPx(f.x) + toPx(opp.x)) / 2), y: toPx(f.y) + 40 });
        return;
      }
      f.moveHit = true;
      opp.state = 'grabbed';
      opp.stateFrame = 0;
      opp.stateDuration = spec.holdFrames;
      opp.moveIndex = -1;
      opp.vx = 0;
      opp.vy = 0;
      opp.y = 0;
      opp.grabbedBy = f.side;
      f.grabTarget = opp.side;
      emit(s, { type: 'throw', side: f.side, x: toPx(f.x), y: toPx(f.y) + 40 });
    }
  }

  // 掴んでいるあいだは相手を自分の前に固定する。
  if (f.grabTarget >= 0 && opp.state === 'grabbed') {
    const sign = f.facingRight ? 1 : -1;
    opp.x = f.x + px(28) * sign;
    opp.facingRight = !f.facingRight;
  }

  // 投げ切りのフレーム。
  if (f.grabTarget >= 0 && f.moveFrame === m.startup + spec.holdFrames) {
    const sign = f.facingRight ? 1 : -1;
    applyDamage(s, opp, spec.damage, true);
    opp.stunValue += Math.round(spec.damage / 2);
    addMeter(f, spec.meterGainAttacker);
    addMeter(opp, spec.meterGainDefender);
    opp.x = f.x + px(spec.dropX) * sign;
    opp.grabbedBy = -1;
    f.grabTarget = -1;
    if (spec.launchY > 0) {
      // 投げ上げる。着地でダウンになる。
      opp.state = 'hitstun';
      opp.stateFrame = 0;
      opp.stateDuration = 999;
      opp.vx = spec.launchX * (spec.dropX >= 0 ? sign : -sign);
      opp.vy = spec.launchY;
      opp.y = 1;
    } else if (spec.knockdown !== 'none') {
      // その場に叩きつける。
      toKnockdown(s, opp, spec.knockdown === 'hard');
      opp.stateDuration = spec.hitstun;
    } else {
      opp.state = 'hitstun';
      opp.stateFrame = 0;
      opp.stateDuration = spec.hitstun;
      opp.vx = spec.launchX * (spec.dropX >= 0 ? sign : -sign);
      opp.vy = 0;
    }
    f.hitstop = 10;
    opp.hitstop = 10;
    emit(s, {
      type: 'hit',
      side: opp.side,
      x: toPx(opp.x),
      y: toPx(opp.y) + 40,
      props: {
        ...(m.hit as HitProps),
        damage: spec.damage,
        effect: 'heavy',
        shake: 6,
      },
      counter: false,
      combo: 1,
      damage: spec.damage,
    });
  }
  void char;
}

/* ------------------------------------------------------------------ */
/* 飛び道具                                                             */
/* ------------------------------------------------------------------ */

function updateProjectiles(s: MatchState, chars: [CharacterDef, CharacterDef]): void {
  for (const p of s.projectiles) {
    if (p.dead) continue;
    const owner = s.fighters[p.owner];
    if (owner.freeze > 0) continue;
    p.age++;
    p.x += p.vx;
    p.life--;
    if (p.life <= 0) p.dead = true;
    if (Math.abs(toPx(p.x)) > STAGE_HALF + 80) p.dead = true;
  }

  // 弾どうしの相殺。
  for (let i = 0; i < s.projectiles.length; i++) {
    const a = s.projectiles[i];
    if (a.dead) continue;
    for (let j = i + 1; j < s.projectiles.length; j++) {
      const b = s.projectiles[j];
      if (b.dead || a.owner === b.owner) continue;
      const ab = projBox(a);
      const bb = projBox(b);
      if (overlaps(ab, bb)) {
        const c = centerOf(ab, bb);
        if (a.power <= b.power) a.dead = true;
        if (b.power <= a.power) b.dead = true;
        emit(s, { type: 'clash', x: c.x, y: c.y });
      }
    }
  }

  // 弾が人に当たる。
  for (const p of s.projectiles) {
    if (p.dead) continue;
    const target = s.fighters[1 - p.owner];
    const tChar = chars[1 - p.owner];
    if (target.state === 'grabbed') continue;
    if (hasInvuln(target, tChar, 'projectile') || hasInvuln(target, tChar, 'strike')) continue;
    const pb = projBox(p);
    for (const hu of hurtboxes(target, tChar)) {
      const d = worldBox(target, hu);
      if (overlaps(pb, d)) {
        const attacker = s.fighters[p.owner];
        applyHit(s, attacker, target, chars, p.hit, centerOf(pb, d), null);
        p.dead = true;
        break;
      }
    }
  }

  s.projectiles = s.projectiles.filter((p) => !p.dead);
}

function projBox(p: Projectile): { l: number; r: number; b: number; t: number } {
  const x = toPx(p.x);
  const y = toPx(p.y);
  if (p.facingRight) {
    return { l: x + p.box.x, r: x + p.box.x + p.box.w, b: y + p.box.y, t: y + p.box.y + p.box.h };
  }
  return { l: x - p.box.x - p.box.w, r: x - p.box.x, b: y + p.box.y, t: y + p.box.y + p.box.h };
}

/* ------------------------------------------------------------------ */
/* 押し合いと画面まわり                                                  */
/* ------------------------------------------------------------------ */

function resolvePush(s: MatchState, chars: [CharacterDef, CharacterDef]): void {
  const [a, b] = s.fighters;
  if (a.state === 'grabbed' || b.state === 'grabbed') return;
  const pa = worldBox(a, pushbox(a, chars[0]));
  const pb = worldBox(b, pushbox(b, chars[1]));
  if (!overlaps(pa, pb)) return;
  // 縦に離れていれば押し合わない（飛び越し）。
  const overlapX = Math.min(pa.r, pb.r) - Math.max(pa.l, pb.l);
  if (overlapX <= 0) return;

  const push = px(overlapX) / 2;
  const aLeft = a.x <= b.x;
  const aAtWall = Math.abs(toPx(a.x)) >= STAGE_HALF - 30;
  const bAtWall = Math.abs(toPx(b.x)) >= STAGE_HALF - 30;

  if (aAtWall && !bAtWall) {
    b.x += aLeft ? push * 2 : -push * 2;
  } else if (bAtWall && !aAtWall) {
    a.x += aLeft ? -push * 2 : push * 2;
  } else {
    a.x += aLeft ? -push : push;
    b.x += aLeft ? push : -push;
  }
  clampToStage(a, STAGE_HALF, chars[0]);
  clampToStage(b, STAGE_HALF, chars[1]);
}

function enforceSeparation(s: MatchState, chars: [CharacterDef, CharacterDef]): void {
  const [a, b] = s.fighters;
  const dx = toPx(b.x) - toPx(a.x);
  const dist = Math.abs(dx);
  if (dist <= MAX_SEPARATION) return;
  const over = px(dist - MAX_SEPARATION);
  const aAtWall = Math.abs(toPx(a.x)) >= STAGE_HALF - 30;
  const bAtWall = Math.abs(toPx(b.x)) >= STAGE_HALF - 30;
  const sign = dx > 0 ? 1 : -1;
  if (aAtWall && !bAtWall) {
    b.x -= over * sign;
  } else if (bAtWall && !aAtWall) {
    a.x += over * sign;
  } else {
    a.x += (over * sign) / 2;
    b.x -= (over * sign) / 2;
  }
  clampToStage(a, STAGE_HALF, chars[0]);
  clampToStage(b, STAGE_HALF, chars[1]);
}

function updateCamera(s: MatchState): void {
  const mid = Math.round((toPx(s.fighters[0].x) + toPx(s.fighters[1].x)) / 2);
  const half = Math.round(VIEW_W / 2);
  // 壁ぎわで少しだけ外を見せる。こうしないと、端に押し込まれた側の
  // 腕や足が画面の外に切れてしまい、何をされているのか見えなくなる。
  const margin = 26;
  let target = mid;
  if (target < -STAGE_HALF + half - margin) target = -STAGE_HALF + half - margin;
  if (target > STAGE_HALF - half + margin) target = STAGE_HALF - half + margin;
  // すこしだけ追従を遅らせる（整数のまま）。
  const diff = target - s.cameraX;
  if (diff !== 0) {
    const step = Math.trunc(diff / 4);
    s.cameraX += step !== 0 ? step : diff > 0 ? 1 : -1;
  }
}

/* ------------------------------------------------------------------ */
/* トレーニングの相手                                                    */
/* ------------------------------------------------------------------ */

function trainingDummyInput(s: MatchState, chars: [CharacterDef, CharacterDef]): number {
  const d = s.fighters[1];
  const p = s.fighters[0];
  const action = s.config.dummyAction;
  if (action === 'stand') return 0;
  if (action === 'crouch') return IN_DOWN;
  if (action === 'jump') return d.y === 0 && d.state === 'idle' ? IN_UP : 0;
  const back = d.facingRight ? IN_LEFT : IN_RIGHT;
  if (action === 'guardAll') return back;
  if (action === 'guard') {
    // 攻撃が当たる瞬間だけガードを入れる。空振りにはガードしない。
    const m = currentMove(p, chars[0]);
    if (!m) return 0;
    const willHit = p.state === 'attack' && p.moveFrame >= m.startup - 3 && p.moveFrame < m.startup + m.active;
    if (!willHit) return 0;
    const low = m.hit.guard === 'low';
    return back | (low ? IN_DOWN : 0);
  }
  return 0;
}

/* ------------------------------------------------------------------ */
/* ラウンド進行                                                         */
/* ------------------------------------------------------------------ */

function resetRound(s: MatchState, chars: [CharacterDef, CharacterDef]): void {
  const meterA = s.fighters[0].meter;
  const meterB = s.fighters[1].meter;
  const a = createFighter(0, 0, chars[0], px(-70));
  const b = createFighter(1, 1, chars[1], px(70));
  b.facingRight = false;
  a.meter = s.config.infiniteMeter ? METER_PER_BAR * 3 : Math.round(meterA / 2);
  b.meter = s.config.infiniteMeter ? METER_PER_BAR * 3 : Math.round(meterB / 2);
  s.fighters = [a, b];
  s.projectiles = [];
  s.timer = s.config.timeLimit;
  s.phase = 'intro';
  s.phaseFrame = 0;
  s.cameraX = 0;
  s.roundWinner = -1;
  emit(s, { type: 'roundStart', round: s.round });
}

function checkRoundEnd(s: MatchState): void {
  const [a, b] = s.fighters;
  if (s.phase !== 'fight') return;
  const aDead = a.health <= 0;
  const bDead = b.health <= 0;
  const timeUp = s.config.timeLimit > 0 && s.timer <= 0;
  if (!aDead && !bDead && !timeUp) return;

  let winner = -1;
  if (aDead && bDead) winner = -1;
  else if (bDead) winner = 0;
  else if (aDead) winner = 1;
  else if (timeUp) {
    const ra = a.health / a.maxHealth;
    const rb = b.health / b.maxHealth;
    winner = ra > rb ? 0 : rb > ra ? 1 : -1;
  }

  s.roundWinner = winner;
  s.phase = 'ko';
  s.phaseFrame = 0;
  s.slowmo = 40;
  if (winner >= 0) {
    s.wins[winner]++;
    emit(s, { type: 'ko', side: 1 - winner });
  } else {
    s.wins[0]++;
    s.wins[1]++;
    emit(s, { type: 'ko', side: 0 });
  }
  const [wa, wb] = s.wins;
  if (wa >= s.config.roundsToWin || wb >= s.config.roundsToWin) {
    s.matchWinner = wa > wb ? 0 : wb > wa ? 1 : -1;
  }
}

/* ------------------------------------------------------------------ */
/* トップレベル                                                         */
/* ------------------------------------------------------------------ */

/**
 * 1 フレーム進める。inputs は 2 人ぶんの生入力ビット。
 */
export function stepMatch(
  s: MatchState,
  chars: [CharacterDef, CharacterDef],
  inputs: [number, number],
): void {
  s.events = [];
  s.frame++;

  // トレーニングの相手は入力を差し替える。
  let ins = inputs;
  if (s.config.training && s.config.dummyAction !== 'cpu') {
    ins = [inputs[0], trainingDummyInput(s, chars)];
  }

  for (let i = 0; i < 2; i++) {
    const f = s.fighters[i];
    pushInput(f.input, ins[i], f.facingRight);
    f.lastInput = ins[i];
    // 投げ抜けの受付。投げボタン（LP+LK）を押した瞬間から数フレーム。
    if (
      (ins[i] & (1 << 4)) !== 0 &&
      (ins[i] & (1 << 7)) !== 0 &&
      (inputAt(f.input, 1) & ((1 << 4) | (1 << 7))) !== ((1 << 4) | (1 << 7))
    ) {
      f.throwTechWindow = 5;
    }
  }

  if (s.phase === 'intro') {
    s.phaseFrame++;
    if (s.phaseFrame >= ROUND_INTRO_FRAMES) {
      s.phase = 'fight';
      s.phaseFrame = 0;
    }
    updateCamera(s);
    return;
  }

  if (s.phase === 'ko' || s.phase === 'roundEnd' || s.phase === 'matchEnd') {
    s.phaseFrame++;
    if (s.slowmo > 0) s.slowmo--;
    // 決着後も物理だけは動かす（吹き飛びが止まらないように）。
    for (let i = 0; i < 2; i++) {
      const f = s.fighters[i];
      if (f.hitstop > 0) {
        f.hitstop--;
        continue;
      }
      if (f.y > 0) {
        applyGravity(f, chars[i]);
        f.y += f.vy;
        f.x += f.vx;
        if (f.y <= 0) {
          f.y = 0;
          f.vy = 0;
          f.vx = 0;
          f.state = 'knockdown';
          f.stateFrame = 0;
          f.stateDuration = 999;
        }
      } else if (f.state === 'hitstun' || f.state === 'blockstun') {
        f.x += f.vx;
        const decel = px(0.32);
        if (f.vx > 0) f.vx = Math.max(0, f.vx - decel);
        else if (f.vx < 0) f.vx = Math.min(0, f.vx + decel);
      }
      clampToStage(f, STAGE_HALF, chars[i]);
    }
    updateCamera(s);
    // 決着から少し経ったら、勝ったほうが勝ちポーズを取る。
    if (s.phase === 'ko' && s.phaseFrame === 70 && s.roundWinner >= 0) {
      const w = s.fighters[s.roundWinner];
      if (w.y === 0 && w.state !== 'knockdown' && w.state !== 'hitstun') {
        w.state = 'win';
        w.stateFrame = 0;
        w.moveIndex = -1;
      }
    }

    if (s.phase === 'ko' && s.phaseFrame >= ROUND_OUTRO_FRAMES) {
      if (s.matchWinner >= 0 || (s.wins[0] >= s.config.roundsToWin || s.wins[1] >= s.config.roundsToWin)) {
        s.phase = 'matchEnd';
        s.phaseFrame = 0;
        emit(s, { type: 'matchEnd', winner: s.matchWinner });
      } else {
        emit(s, { type: 'roundEnd', winner: s.roundWinner });
        s.round++;
        resetRound(s, chars);
      }
    }
    return;
  }

  // --- 対戦中 ---
  updateFighter(s, 0, chars);
  updateFighter(s, 1, chars);

  for (let i = 0; i < 2; i++) clampToStage(s.fighters[i], STAGE_HALF, chars[i]);
  resolvePush(s, chars);
  resolveStrikes(s, chars);
  updateProjectiles(s, chars);
  enforceSeparation(s, chars);

  // コンボ数のリセット。相手が動けるようになったら切れる。
  for (let i = 0; i < 2; i++) {
    const att = s.fighters[i];
    const def = s.fighters[1 - i];
    if (!isStunned(def) && def.hitstop === 0) {
      att.comboHits = 0;
      att.comboDamage = 0;
    }
  }

  // トレーニングの自動回復。
  if (s.config.training && s.config.autoRecover) {
    for (const f of s.fighters) {
      if (f.state === 'idle' && f.stateFrame > 30) {
        f.health = Math.min(f.maxHealth, f.health + 3);
        f.stunValue = 0;
      }
      if (s.config.infiniteMeter) f.meter = METER_PER_BAR * 3;
    }
  }

  // 制限時間。ヒットストップ中は止まる。
  if (s.config.timeLimit > 0 && s.fighters[0].hitstop === 0 && s.fighters[1].hitstop === 0) {
    s.timer = Math.max(0, s.timer - 1);
  }

  updateCamera(s);
  checkRoundEnd(s);
}

/** 表示用：残り秒数。 */
export function remainingSeconds(s: MatchState): number {
  return Math.ceil(s.timer / 60);
}

/** 表示用：ゲージ本数。 */
export function meterBars(f: Fighter): number {
  return Math.floor(f.meter / METER_PER_BAR);
}

export { ALL_BUTTONS, FP, cloneHistory };
