/**
 * 入力の表現と、コマンド技の認識。
 *
 * 入力は 1 フレームぶんを 16 ビットの整数 1 個で表します。
 * こうしておくとオンライン対戦で送る量が小さく、履歴の保存も速く、
 * ロールバック（巻き戻し）のときの比較も == 1 回で済みます。
 */

import { DASH_WINDOW, INPUT_BUFFER_FRAMES, MOTION_WINDOW } from './constants';
import type { Button, Motion } from './types';

export const IN_UP = 1 << 0;
export const IN_DOWN = 1 << 1;
export const IN_LEFT = 1 << 2;
export const IN_RIGHT = 1 << 3;
export const IN_LP = 1 << 4;
export const IN_MP = 1 << 5;
export const IN_HP = 1 << 6;
export const IN_LK = 1 << 7;
export const IN_MK = 1 << 8;
export const IN_HK = 1 << 9;

export const BUTTON_BITS: Record<Button, number> = {
  LP: IN_LP,
  MP: IN_MP,
  HP: IN_HP,
  LK: IN_LK,
  MK: IN_MK,
  HK: IN_HK,
};

export const ALL_BUTTONS: Button[] = ['LP', 'MP', 'HP', 'LK', 'MK', 'HK'];

/** ボタンのビット → 0..5 の添字。 */
export const BUTTON_INDEX: Record<Button, number> = {
  LP: 0, MP: 1, HP: 2, LK: 3, MK: 4, HK: 5,
};

/** 履歴の長さ。コマンド認識に使う 32 フレームぶん。 */
export const HISTORY_LEN = 32;

export interface InputHistory {
  /** 直近 HISTORY_LEN フレームの入力。ring[pos] が最も古い枠（次に書く場所）。 */
  ring: number[];
  pos: number;
  /** 現在のフレーム番号（履歴に積んだ回数）。 */
  frame: number;
  /** ボタンごとの「最後に押された瞬間」のフレーム番号。 */
  pressFrame: number[];
  /** ボタンごとの「すでに技として使った押し」のフレーム番号。 */
  consumedFrame: number[];
  /** ため時間（後ろ / 下）。 */
  chargeBack: number;
  chargeDown: number;
  /** ため成立時刻（後ろ / 下を離した瞬間の残り猶予）。 */
  chargeBackReady: number;
  chargeDownReady: number;
}

export function createHistory(): InputHistory {
  return {
    ring: new Array<number>(HISTORY_LEN).fill(0),
    pos: 0,
    frame: 0,
    pressFrame: [-999, -999, -999, -999, -999, -999],
    consumedFrame: [-999, -999, -999, -999, -999, -999],
    chargeBack: 0,
    chargeDown: 0,
    chargeBackReady: 0,
    chargeDownReady: 0,
  };
}

export function cloneHistory(h: InputHistory): InputHistory {
  return {
    ring: h.ring.slice(),
    pos: h.pos,
    frame: h.frame,
    pressFrame: h.pressFrame.slice(),
    consumedFrame: h.consumedFrame.slice(),
    chargeBack: h.chargeBack,
    chargeDown: h.chargeDown,
    chargeBackReady: h.chargeBackReady,
    chargeDownReady: h.chargeDownReady,
  };
}

/** ago フレーム前の入力を取り出す（0 = 今のフレーム）。 */
export function inputAt(h: InputHistory, ago: number): number {
  if (ago < 0 || ago >= HISTORY_LEN) return 0;
  const idx = (h.pos - 1 - ago + HISTORY_LEN * 2) % HISTORY_LEN;
  return h.ring[idx];
}

/**
 * 1 フレームぶん入力を積む。facing は「右を向いているか」。
 * ため時間の管理もここで行う。
 */
export function pushInput(h: InputHistory, bits: number, facingRight: boolean): void {
  h.ring[h.pos] = bits;
  h.pos = (h.pos + 1) % HISTORY_LEN;
  h.frame++;

  const prev = inputAt(h, 1);
  for (let i = 0; i < 6; i++) {
    const bit = 1 << (4 + i);
    if ((bits & bit) !== 0 && (prev & bit) === 0) h.pressFrame[i] = h.frame;
  }

  // ため。後ろ = 向きの反対側。
  const backBit = facingRight ? IN_LEFT : IN_RIGHT;
  if ((bits & backBit) !== 0) {
    h.chargeBack++;
  } else {
    if (h.chargeBack >= 45) h.chargeBackReady = 10;
    h.chargeBack = 0;
  }
  if (h.chargeBackReady > 0) h.chargeBackReady--;

  if ((bits & IN_DOWN) !== 0) {
    h.chargeDown++;
  } else {
    if (h.chargeDown >= 45) h.chargeDownReady = 10;
    h.chargeDown = 0;
  }
  if (h.chargeDownReady > 0) h.chargeDownReady--;
}

/** 入力を「テンキー表記」の 1〜9 に変換する（向きを考えた前後）。 */
export function toNumpad(bits: number, facingRight: boolean): number {
  let x = 0;
  if ((bits & IN_RIGHT) !== 0) x += 1;
  if ((bits & IN_LEFT) !== 0) x -= 1;
  if (!facingRight) x = -x; // 前 = +x になるよう反転
  let y = 0;
  if ((bits & IN_UP) !== 0) y += 1;
  if ((bits & IN_DOWN) !== 0) y -= 1;
  // 1..9 のテンキー（5 が中立）
  return 5 + x + y * 3;
}

/** ボタンがこのフレームに押されたか。 */
export function justPressed(h: InputHistory, button: Button): boolean {
  const i = BUTTON_INDEX[button];
  return h.pressFrame[i] === h.frame;
}

/** ボタンが押されっぱなしか。 */
export function isHeld(h: InputHistory, button: Button): boolean {
  return (inputAt(h, 0) & BUTTON_BITS[button]) !== 0;
}

/**
 * 入力バッファに「まだ使っていないボタンの押し」が残っているか。
 * 硬直が明けた瞬間に技を出すための猶予。
 */
export function hasBufferedPress(h: InputHistory, button: Button, window = INPUT_BUFFER_FRAMES): boolean {
  const i = BUTTON_INDEX[button];
  const p = h.pressFrame[i];
  return p > h.consumedFrame[i] && h.frame - p <= window;
}

/** バッファの押しを使ったことにする。 */
export function consumePress(h: InputHistory, button: Button): void {
  const i = BUTTON_INDEX[button];
  h.consumedFrame[i] = h.pressFrame[i];
}

/**
 * コマンドの並び（テンキー表記。前方向は 6 に正規化済み）。
 *
 * 各段は「このどれかならOK」の集合で、**古いほうから新しいほうへ**並べています。
 * 途中の斜めは書きません。「下 → 前」のように要点だけを見て、
 * あいだに何が挟まっていても通します。斜めを必須にすると、
 * 斜めを飛ばして入れたときに出なくなってしまうためです。
 *
 * 逆に、同じ方向を 2 段に登場させないようにしています。
 * 押しっぱなしの 1 回の入力が 2 回ぶんに数えられて、
 * 236 のつもりが 236236 になる、という暴発を防ぐためです。
 */
const MOTION_SEQUENCES: Record<Exclude<Motion, 'none' | 'charge_back' | 'charge_down'>, number[][]> = {
  '236': [[2, 1, 3], [6, 9]],
  '214': [[2, 3, 1], [4, 7]],
  '623': [[6, 9], [2, 1], [3, 6, 9]],
  '421': [[4, 7], [2, 3], [1, 4, 7]],
  '41236': [[4, 7, 1], [2, 1, 3], [6, 9]],
  '63214': [[6, 9, 3], [2, 3, 1], [4, 7]],
  '236236': [[2, 1, 3], [6, 9], [2, 1, 3], [6, 9]],
  '214214': [[2, 3, 1], [4, 7], [2, 3, 1], [4, 7]],
  '632146': [[6, 9, 3], [2, 3, 1], [4, 7], [2, 1, 3], [6, 9]],
};

/**
 * コマンドが成立しているか調べる。
 *
 * 履歴を新しいほうから古いほうへたどり、必要な方向が「順番どおり」に
 * 出てきているかを見ます。あいだに関係ない方向が挟まっていても、
 * 全体が window フレーム以内なら成立とします。
 * 実際の格闘ゲームと同じで、少し雑に入れても通るくらいの寛容さです。
 */
export function matchMotion(
  h: InputHistory,
  motion: Motion,
  facingRight: boolean,
  window = MOTION_WINDOW,
): boolean {
  if (motion === 'none') return true;
  // ため技は「ためている」だけでは出ません。ためたうえで反対方向を入れて初めて成立します。
  // ここを省くと、ガードで後ろを入れているだけで技が暴発します。
  if (motion === 'charge_back') {
    const charged = h.chargeBack >= 45 || h.chargeBackReady > 0;
    return charged && recentDirection(h, facingRight, [6, 9, 3], 6);
  }
  if (motion === 'charge_down') {
    const charged = h.chargeDown >= 45 || h.chargeDownReady > 0;
    return charged && recentDirection(h, facingRight, [7, 8, 9], 6);
  }

  const seq = MOTION_SEQUENCES[motion];
  if (!seq) return false;

  // 長いコマンドは猶予も長めに取る。
  const span = Math.min(HISTORY_LEN - 1, window + Math.max(0, seq.length - 2) * 6);

  let stage = seq.length - 1;
  let ago = 0;
  while (ago <= span) {
    const dir = toNumpad(inputAt(h, ago), facingRight);
    if (seq[stage].includes(dir)) {
      stage--;
      if (stage < 0) return true;
      // 同じ方向を押しっぱなしにしている間は「1 回の入力」として数える。
      //
      // これをやらないと、236 の「3」を 2 フレーム押しただけで
      // 3 が 2 回ぶんに数えられ、236236（超必殺技）まで成立してしまいます。
      // 実際に遊ぶと必ず数フレームは押しっぱなしになるので、
      // ここを分けないと波動拳のたびに超必殺技が暴発します。
      while (ago + 1 <= span && toNumpad(inputAt(h, ago + 1), facingRight) === dir) ago++;
    }
    ago++;
  }
  return false;
}

/** 直近 window フレームのあいだに、指定の方向が入っていたか。 */
function recentDirection(h: InputHistory, facingRight: boolean, dirs: number[], window: number): boolean {
  for (let ago = 0; ago <= window; ago++) {
    if (dirs.includes(toNumpad(inputAt(h, ago), facingRight))) return true;
  }
  return false;
}

/** 前・前（ダッシュ）／後ろ・後ろ（バックダッシュ）の判定。 */
export function matchDoubleTap(h: InputHistory, forward: boolean, facingRight: boolean): boolean {
  const want = forward ? 6 : 4;
  // 「押した → 離した → 押した」を新しいほうからたどる。
  let phase = 0; // 0:2回目の押しを探す 1:離しを探す 2:1回目の押しを探す
  for (let ago = 0; ago <= DASH_WINDOW; ago++) {
    const dir = toNumpad(inputAt(h, ago), facingRight);
    const pressed = dir === want || dir === want + 3 || dir === want - 3;
    if (phase === 0) {
      if (pressed) phase = 1;
      else if (ago > 3) return false; // 直近に入っていなければ不成立
    } else if (phase === 1) {
      if (!pressed) phase = 2;
    } else {
      if (pressed) return true;
    }
  }
  return false;
}
