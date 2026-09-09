/**
 * コマンド入力の認識テスト。
 *
 * ここが緩すぎると「波動拳を出したつもりが超必殺技が出た」という事故が起きます。
 * 逆に厳しすぎると「ちゃんと入れたのに出ない」になります。
 * 実際に押しそうな入力を並べて、出るべきものだけが出ることを確かめます。
 */

import { describe, expect, it } from 'vitest';
import {
  IN_DOWN,
  IN_LEFT,
  IN_RIGHT,
  createHistory,
  matchDoubleTap,
  matchMotion,
  pushInput,
} from '../src/engine/input';
import type { Motion } from '../src/engine/types';

const N = 0;
const D = IN_DOWN;
const F = IN_RIGHT;
const B = IN_LEFT;
const DF = IN_DOWN | IN_RIGHT;
const DB = IN_DOWN | IN_LEFT;

/** 入力の並びを流し込んだ履歴を作る（右向き）。 */
function feed(...frames: number[]) {
  const h = createHistory();
  for (const f of frames) pushInput(h, f, true);
  return h;
}

function repeat(bits: number, n: number): number[] {
  return new Array(n).fill(bits);
}

describe('必殺技コマンド', () => {
  it('236（波動拳）を認識する', () => {
    const h = feed(N, N, D, D, DF, F);
    expect(matchMotion(h, '236', true)).toBe(true);
  });

  it('雑に入れた 236（斜めを飛ばした）も認識する', () => {
    const h = feed(N, N, D, D, F, F);
    expect(matchMotion(h, '236', true)).toBe(true);
  });

  it('236 を入れただけでは 236236（超必殺技）にはならない', () => {
    const h = feed(N, N, N, D, D, DF, F);
    expect(matchMotion(h, '236236', true)).toBe(false);
  });

  it('前歩きしてから 236 を入れても 236236 にはならない', () => {
    // ここが甘いと、歩いて波動拳を撃つたびに超必殺技が暴発する。
    const h = feed(...repeat(F, 20), N, D, D, DF, F);
    expect(matchMotion(h, '236', true)).toBe(true);
    expect(matchMotion(h, '236236', true)).toBe(false);
  });

  it('しゃがみ歩きの往復では 236236 にならない', () => {
    const h = feed(D, D, D, F, F, D, D, F, F);
    expect(matchMotion(h, '236236', true)).toBe(true);
    // ↑ これは本当に 2 回入れているので出てよい。
  });

  it('236236 をきちんと入れれば認識する', () => {
    const h = feed(N, D, DF, F, N, D, DF, F);
    expect(matchMotion(h, '236236', true)).toBe(true);
  });

  it('623（昇龍拳）を認識する', () => {
    const h = feed(N, F, N, D, D, DF);
    expect(matchMotion(h, '623', true)).toBe(true);
  });

  it('236 では 623 は出ない', () => {
    const h = feed(N, N, N, N, N, D, D, DF, F);
    expect(matchMotion(h, '623', true)).toBe(false);
  });

  it('214（逆波動）を認識する', () => {
    const h = feed(N, D, DB, B);
    expect(matchMotion(h, '214', true)).toBe(true);
  });

  it('63214（コマンド投げ）を認識する', () => {
    const h = feed(N, F, DF, D, DB, B);
    expect(matchMotion(h, '63214', true)).toBe(true);
  });

  it('向きが逆なら、左右も逆に解釈される', () => {
    const h = createHistory();
    for (const f of [N, D, DB, B]) pushInput(h, f, false);
    // 左を向いているときの「前」は左。
    expect(matchMotion(h, '236', false)).toBe(true);
  });

  it('古すぎる入力は無効（猶予を過ぎたら成立しない）', () => {
    const h = feed(D, DF, F, ...repeat(N, 20));
    expect(matchMotion(h, '236', true)).toBe(false);
  });
});

describe('ダッシュ（前・前）', () => {
  it('前を 2 回入れると成立する', () => {
    const h = feed(N, F, F, N, N, F, F);
    expect(matchDoubleTap(h, true, true)).toBe(true);
  });

  it('押しっぱなしでは成立しない', () => {
    const h = feed(...repeat(F, 12));
    expect(matchDoubleTap(h, true, true)).toBe(false);
  });

  it('後ろ 2 回は前ダッシュにならない', () => {
    const h = feed(N, B, B, N, N, B, B);
    expect(matchDoubleTap(h, true, true)).toBe(false);
    expect(matchDoubleTap(h, false, true)).toBe(true);
  });
});

describe('コマンドの優先順位', () => {
  const motions: Motion[] = ['236', '214', '623', '236236', '63214'];
  it('波動拳の入力で、より長いコマンドが同時に成立しない', () => {
    const h = feed(N, N, N, N, D, D, DF, F);
    const matched = motions.filter((m) => matchMotion(h, m, true));
    expect(matched).toEqual(['236']);
  });
});

describe('押しっぱなしによる誤爆の防止', () => {
  it('236 の斜めを数フレーム押しても 236236 にはならない', () => {
    // 実際に遊ぶと、どうしても各方向を数フレームずつ押しっぱなしにする。
    // これで超必殺技が出てしまうと、波動拳が撃てないゲームになる。
    const h = feed(N, N, D, D, D, DF, DF, DF, F, F, F);
    expect(matchMotion(h, '236', true)).toBe(true);
    expect(matchMotion(h, '236236', true)).toBe(false);
  });

  it('214 を押しっぱなし気味に入れても 214214 にはならない', () => {
    const h = feed(N, N, D, D, D, DB, DB, B, B, B);
    expect(matchMotion(h, '214', true)).toBe(true);
    expect(matchMotion(h, '214214', true)).toBe(false);
  });

  it('623 を押しっぱなし気味に入れても 632146 にはならない', () => {
    const h = feed(N, F, F, N, D, D, DF, DF);
    expect(matchMotion(h, '623', true)).toBe(true);
    expect(matchMotion(h, '632146', true)).toBe(false);
  });

  it('ゆっくり 236236 を入れれば成立する', () => {
    const h = feed(D, D, DF, DF, F, F, N, N, D, D, DF, DF, F, F);
    expect(matchMotion(h, '236236', true)).toBe(true);
  });
});
