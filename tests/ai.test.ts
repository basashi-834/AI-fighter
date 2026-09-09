/**
 * CPU の強さの検証。
 *
 * 「強い設定のほうがちゃんと強い」ことを、実際に何十試合も回して確かめます。
 * 難易度の名前だけ変えて中身が同じ、という状態を防ぐためのテストです。
 */

import { describe, expect, it } from 'vitest';
import { GOUZAN, ROSTER, RYUGA, SAYA } from '../src/data';
import { createMatch, stepMatch } from '../src/engine/match';
import { CpuBrain, type Difficulty } from '../src/ai/cpu';
import type { CharacterDef } from '../src/engine/types';

/** 1 試合させて、勝ったほうの番号を返す（-1 は引き分け）。 */
function duel(
  a: Difficulty,
  b: Difficulty,
  seed: number,
  chars: [CharacterDef, CharacterDef] = [RYUGA, RYUGA],
): number {
  const s = createMatch(chars, {
    roundsToWin: 1,
    timeLimit: 45 * 60,
    training: false,
    autoRecover: false,
    dummyAction: 'stand',
    infiniteMeter: false,
  });
  s.phase = 'fight';
  const A = new CpuBrain(0, a, 100 + seed * 13);
  const B = new CpuBrain(1, b, 500 + seed * 29);
  let f = 0;
  while (s.matchWinner < 0 && f < 60 * 60 * 3) {
    stepMatch(s, chars, [A.think(s, chars), B.think(s, chars)]);
    f++;
  }
  return s.matchWinner;
}

function winRate(a: Difficulty, b: Difficulty, n: number): number {
  let w = 0;
  for (let i = 0; i < n; i++) if (duel(a, b, i) === 0) w++;
  return w / n;
}

describe('難易度の階段', () => {
  it('鬼 は やさしい にほぼ確実に勝つ', () => {
    expect(winRate('expert', 'easy', 12)).toBeGreaterThanOrEqual(0.85);
  }, 60000);

  it('つよい は やさしい に勝ち越す', () => {
    expect(winRate('hard', 'easy', 12)).toBeGreaterThanOrEqual(0.7);
  }, 60000);

  it('鬼 は ふつう に勝ち越す', () => {
    expect(winRate('expert', 'normal', 12)).toBeGreaterThanOrEqual(0.6);
  }, 60000);

  it('ふつう は やさしい に勝ち越す', () => {
    expect(winRate('normal', 'easy', 12)).toBeGreaterThanOrEqual(0.6);
  }, 60000);
});

describe('CPU の中身', () => {
  it('必殺技をコマンド入力で出している', () => {
    const chars: [CharacterDef, CharacterDef] = [RYUGA, SAYA];
    const s = createMatch(chars, {
      roundsToWin: 5, timeLimit: 0, training: false,
      autoRecover: false, dummyAction: 'stand', infiniteMeter: false,
    });
    s.phase = 'fight';
    const a = new CpuBrain(0, 'expert', 7);
    const b = new CpuBrain(1, 'hard', 8);
    const used = new Set<string>();
    for (let i = 0; i < 60 * 60; i++) {
      stepMatch(s, chars, [a.think(s, chars), b.think(s, chars)]);
      for (const f of s.fighters) {
        if (f.moveIndex >= 0 && f.moveFrame === 1) {
          const m = chars[f.side].moves[f.moveIndex];
          if (m.input.motion !== 'none') used.add(`${chars[f.side].id}/${m.id}`);
        }
      }
    }
    expect(used.size, `使われた必殺技: ${[...used].join(', ')}`).toBeGreaterThanOrEqual(2);
  }, 60000);

  it('コンボ（キャンセル）をつないでいる', () => {
    const chars: [CharacterDef, CharacterDef] = [RYUGA, GOUZAN];
    const s = createMatch(chars, {
      roundsToWin: 5, timeLimit: 0, training: false,
      autoRecover: false, dummyAction: 'stand', infiniteMeter: false,
    });
    s.phase = 'fight';
    const a = new CpuBrain(0, 'expert', 21);
    const b = new CpuBrain(1, 'normal', 42);
    let maxCombo = 0;
    for (let i = 0; i < 60 * 60; i++) {
      stepMatch(s, chars, [a.think(s, chars), b.think(s, chars)]);
      maxCombo = Math.max(maxCombo, s.fighters[0].comboHits, s.fighters[1].comboHits);
    }
    expect(maxCombo, 'CPU が一度もコンボをつないでいない').toBeGreaterThanOrEqual(2);
  }, 60000);
});

describe('キャラクターの釣り合い', () => {
  it('同キャラ対戦なら、どちらかが一方的に勝ち続けることはない', () => {
    for (const c of ROSTER) {
      let w = 0;
      const n = 8;
      for (let i = 0; i < n; i++) if (duel('hard', 'hard', i, [c, c]) === 0) w++;
      // 先手の有利は多少あるが、8 戦全勝・全敗はさすがにおかしい。
      expect(w, `${c.id} の同キャラ対戦が偏りすぎ (${w}/${n})`).toBeGreaterThan(0);
      expect(w).toBeLessThan(n);
    }
  }, 120000);

  it('どのキャラも、他のキャラ相手に 1 勝もできない、ということがない', () => {
    for (const me of ROSTER) {
      let wins = 0;
      for (const other of ROSTER) {
        for (let i = 0; i < 3; i++) {
          if (duel('hard', 'hard', i, [me, other]) === 0) wins++;
          if (duel('hard', 'hard', i, [other, me]) === 1) wins++;
        }
      }
      expect(wins, `${me.id} が勝てなさすぎる`).toBeGreaterThan(2);
    }
  }, 180000);
});

/** 参考：紗夜は速いので、間合いを詰めるのが速いはず。 */
describe('キャラクターの個性', () => {
  it('紗夜のほうが剛山より速く間合いを詰める', () => {
    const measure = (c: CharacterDef): number => {
      const chars: [CharacterDef, CharacterDef] = [c, RYUGA];
      const s = createMatch(chars, {
        roundsToWin: 1, timeLimit: 0, training: false,
        autoRecover: false, dummyAction: 'stand', infiniteMeter: false,
      });
      s.phase = 'fight';
      s.fighters[0].x = -400 * 256;
      s.fighters[1].x = 0;
      let f = 0;
      const IN_RIGHT = 1 << 3;
      while (f < 600 && Math.abs(s.fighters[0].x - s.fighters[1].x) > 60 * 256) {
        stepMatch(s, chars, [IN_RIGHT, 0]);
        f++;
      }
      return f;
    };
    expect(measure(SAYA)).toBeLessThan(measure(GOUZAN));
  });
});

/**
 * ボタン連打だけの相手に負けるようでは、CPU とは呼べません。
 * 「近づいて中攻撃を連打する」という、初心者がいちばんやる動きを相手にします。
 */
describe('連打相手との勝負', () => {
  function masher(frame: number, facingRight: boolean): number {
    const IN_LEFT = 1 << 2;
    const IN_RIGHT = 1 << 3;
    const IN_MP = 1 << 5;
    const IN_MK = 1 << 8;
    const fwd = facingRight ? IN_RIGHT : IN_LEFT;
    const c = frame % 24;
    if (c < 10) return fwd;
    if (c < 13) return IN_MK;
    if (c < 20) return fwd;
    return IN_MP;
  }

  function vsMasher(diff: Difficulty, seed: number): number {
    const chars: [CharacterDef, CharacterDef] = [RYUGA, RYUGA];
    const s = createMatch(chars, {
      roundsToWin: 1, timeLimit: 45 * 60, training: false,
      autoRecover: false, dummyAction: 'stand', infiniteMeter: false,
    });
    s.phase = 'fight';
    const cpu = new CpuBrain(1, diff, 900 + seed * 17);
    let f = 0;
    while (s.matchWinner < 0 && f < 60 * 60 * 3) {
      stepMatch(s, chars, [masher(f, s.fighters[0].facingRight), cpu.think(s, chars)]);
      f++;
    }
    return s.matchWinner;
  }

  it('鬼 CPU は連打相手にほぼ確実に勝つ', () => {
    let w = 0;
    const n = 10;
    for (let i = 0; i < n; i++) if (vsMasher('expert', i) === 1) w++;
    expect(w, `鬼 CPU の対連打勝率 ${w}/${n}`).toBeGreaterThanOrEqual(8);
  }, 60000);

  it('つよい CPU も連打相手に勝ち越す', () => {
    let w = 0;
    const n = 10;
    for (let i = 0; i < n; i++) if (vsMasher('hard', i) === 1) w++;
    expect(w, `つよい CPU の対連打勝率 ${w}/${n}`).toBeGreaterThanOrEqual(6);
  }, 60000);

  it('やさしい CPU は連打相手に勝ちすぎない（初心者が勝てる余地がある）', () => {
    let w = 0;
    const n = 10;
    for (let i = 0; i < n; i++) if (vsMasher('easy', i) === 1) w++;
    expect(w, `やさしい CPU の対連打勝率 ${w}/${n}`).toBeLessThanOrEqual(6);
  }, 60000);
});
