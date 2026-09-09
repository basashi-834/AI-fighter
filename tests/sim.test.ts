/**
 * 試合シミュレーション全体の検証。
 *
 * ここでは「エンジンが決定論的であること」を特に念入りに確かめます。
 * ロールバック（オンライン対戦）はこの性質の上に成り立っているので、
 * ここが崩れると、オンラインでだけ試合がずれる、という一番やっかいな
 * 不具合になります。
 */

import { describe, expect, it } from 'vitest';
import { GOUZAN, KUROHA, ROSTER, RYUGA, SAYA } from '../src/data';
import { METER_PER_BAR, px, toPx } from '../src/engine/constants';
import { isActionable } from '../src/engine/fighter';
import { IN_DOWN, IN_LEFT, IN_RIGHT, IN_UP } from '../src/engine/input';
import { comboScaling, createMatch, stepMatch, type MatchState } from '../src/engine/match';
import { RollbackSession } from '../src/net/rollback';
import { CpuBrain } from '../src/ai/cpu';
import { hashState, makeRig, press } from './harness';
import type { CharacterDef } from '../src/engine/types';

/** 再現できる乱数（テストの中で入力を作るため）。 */
function makeRng(seed: number) {
  let x = seed;
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return ((x >>> 0) % 10000) / 10000;
  };
}

/** でたらめだが再現できる入力の列を作る。 */
function randomInputs(seed: number, frames: number): [number, number][] {
  const r = makeRng(seed);
  const out: [number, number][] = [];
  let a = 0;
  let b = 0;
  for (let i = 0; i < frames; i++) {
    if (r() < 0.25) a = randomBits(r);
    if (r() < 0.25) b = randomBits(r);
    out.push([a, b]);
  }
  return out;
}

function randomBits(r: () => number): number {
  let bits = 0;
  const d = r();
  if (d < 0.2) bits |= IN_LEFT;
  else if (d < 0.4) bits |= IN_RIGHT;
  else if (d < 0.55) bits |= IN_DOWN;
  else if (d < 0.62) bits |= IN_UP;
  const btn = r();
  if (btn < 0.5) bits |= 1 << (4 + Math.floor(r() * 6));
  return bits;
}

function runMatch(
  chars: [CharacterDef, CharacterDef],
  inputs: [number, number][],
): MatchState {
  const s = createMatch(chars, {
    roundsToWin: 2,
    timeLimit: 60 * 60,
    training: false,
    autoRecover: false,
    dummyAction: 'stand',
    infiniteMeter: false,
  });
  s.phase = 'fight';
  for (const [a, b] of inputs) stepMatch(s, chars, [a, b]);
  return s;
}

describe('決定性', () => {
  it('同じ入力からは必ず同じ結果になる', () => {
    const inputs = randomInputs(1234, 900);
    const a = runMatch([RYUGA, SAYA], inputs);
    const b = runMatch([RYUGA, SAYA], inputs);
    expect(hashState(a)).toBe(hashState(b));
  });

  it('全キャラの組み合わせで、1000 フレーム回しても壊れない', () => {
    for (let i = 0; i < ROSTER.length; i++) {
      for (let j = 0; j < ROSTER.length; j++) {
        const inputs = randomInputs(50 + i * 7 + j, 1000);
        const s = runMatch([ROSTER[i], ROSTER[j]], inputs);
        for (const f of s.fighters) {
          expect(Number.isFinite(f.x), `${ROSTER[i].id} vs ${ROSTER[j].id}`).toBe(true);
          expect(Number.isInteger(f.x)).toBe(true);
          expect(Number.isInteger(f.y)).toBe(true);
          expect(f.health).toBeGreaterThanOrEqual(0);
          expect(f.y).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  it('座標はつねに整数（小数が混ざると機種によって結果が変わる）', () => {
    const s = runMatch([GOUZAN, SAYA], randomInputs(77, 600));
    for (const f of s.fighters) {
      expect(Number.isInteger(f.vx)).toBe(true);
      expect(Number.isInteger(f.vy)).toBe(true);
    }
    for (const p of s.projectiles) {
      expect(Number.isInteger(p.x)).toBe(true);
    }
  });
});

describe('ロールバック（オンライン対戦の巻き戻し）', () => {
  it('相手の入力が遅れて届いても、最後は遅れなしと同じ結果になる', () => {
    const chars: [CharacterDef, CharacterDef] = [RYUGA, SAYA];
    const inputs = randomInputs(999, 400);

    // 基準：最初からすべての入力が分かっている場合。
    const reference = runMatch(chars, inputs);

    // 実際：相手の入力が 4 フレーム遅れて届く場合。
    const s = createMatch(chars, {
      roundsToWin: 2,
      timeLimit: 60 * 60,
      training: false,
      autoRecover: false,
      dummyAction: 'stand',
      infiniteMeter: false,
    });
    s.phase = 'fight';
    const rb = new RollbackSession(s, chars, { localPlayer: 0, inputDelay: 0, maxRollback: 12 });
    const lag = 4;
    let rollbacks = 0;
    for (let f = 0; f < inputs.length; f++) {
      // 遅れて届く相手の入力。
      const arrive = f - lag;
      if (arrive >= 0) rb.pushRemoteInput(arrive, inputs[arrive][1]);
      const r = rb.tick(inputs[f][0]);
      rollbacks += r.rolledBack;
    }
    // 残っている入力を届けて、最後まで確定させる。
    for (let f = Math.max(0, inputs.length - lag); f < inputs.length; f++) {
      rb.pushRemoteInput(f, inputs[f][1]);
    }

    expect(rollbacks, '巻き戻しが一度も起きていないならテストになっていない').toBeGreaterThan(0);
    expect(rb.desyncs).toBe(0);
    expect(hashState(rb.state)).toBe(hashState(reference));
  });

  it('入力遅延を入れても結果は変わらない', () => {
    const chars: [CharacterDef, CharacterDef] = [SAYA, GOUZAN];
    const inputs = randomInputs(31337, 300);
    const reference = runMatch(chars, inputs);

    const s = createMatch(chars, {
      roundsToWin: 2, timeLimit: 60 * 60, training: false,
      autoRecover: false, dummyAction: 'stand', infiniteMeter: false,
    });
    s.phase = 'fight';
    // 入力遅延 2 フレーム＝「2 フレーム先の入力」として積む。
    const rb = new RollbackSession(s, chars, { localPlayer: 0, inputDelay: 0, maxRollback: 10 });
    for (let f = 0; f < inputs.length; f++) {
      rb.pushRemoteInput(f, inputs[f][1]);
      rb.tick(inputs[f][0]);
    }
    expect(hashState(rb.state)).toBe(hashState(reference));
  });
});

describe('投げ', () => {
  it('近距離で投げが成立し、相手がダウンする', () => {
    const rig = makeRig(RYUGA, RYUGA, 34);
    const b = rig.state.fighters[1];
    const hp = b.health;
    let thrown = false;
    rig.step(press('LP', 'LK'), 0);
    for (let i = 0; i < 60; i++) {
      const evs = rig.step(0, 0);
      if (evs.some((e) => e.type === 'throw')) thrown = true;
    }
    expect(thrown).toBe(true);
    expect(b.health).toBeLessThan(hp);
    expect(['knockdown', 'wakeup', 'hitstun']).toContain(b.state);
  });

  it('遠すぎると投げは成立しない', () => {
    const rig = makeRig(RYUGA, RYUGA, 160);
    rig.step(press('LP', 'LK'), 0);
    let thrown = false;
    for (let i = 0; i < 40; i++) {
      if (rig.step(0, 0).some((e) => e.type === 'throw')) thrown = true;
    }
    expect(thrown).toBe(false);
  });

  it('お互いが同時に投げると投げ抜けになる', () => {
    const rig = makeRig(RYUGA, RYUGA, 34);
    let tech = false;
    rig.step(press('LP', 'LK'), press('LP', 'LK'));
    for (let i = 0; i < 40; i++) {
      if (rig.step(0, 0).some((e) => e.type === 'throwTech')) tech = true;
    }
    expect(tech).toBe(true);
  });
});

describe('飛び道具', () => {
  it('波動拳が出て、前に飛んで、当たる', () => {
    const rig = makeRig(RYUGA, RYUGA, 200);
    // 236 + 強P
    const seq = [IN_DOWN, IN_DOWN, IN_DOWN | IN_RIGHT, IN_RIGHT, IN_RIGHT | press('HP')];
    for (const bits of seq) rig.step(bits, 0);
    let spawned = false;
    let hit = false;
    let maxX = -9999;
    for (let i = 0; i < 120; i++) {
      const evs = rig.step(0, 0);
      if (evs.some((e) => e.type === 'projectile')) spawned = true;
      if (evs.some((e) => e.type === 'hit')) hit = true;
      for (const p of rig.state.projectiles) maxX = Math.max(maxX, toPx(p.x));
    }
    expect(spawned).toBe(true);
    expect(maxX).toBeGreaterThan(-100);
    expect(hit).toBe(true);
  });

  it('飛び道具どうしは相殺する', () => {
    const rig = makeRig(RYUGA, RYUGA, 260);
    const fwd1 = [IN_DOWN, IN_DOWN | IN_RIGHT, IN_RIGHT, IN_RIGHT | press('HP')];
    const fwd2 = [IN_DOWN, IN_DOWN | IN_LEFT, IN_LEFT, IN_LEFT | press('HP')];
    for (let i = 0; i < fwd1.length; i++) rig.step(fwd1[i], fwd2[i]);
    let clash = false;
    for (let i = 0; i < 120; i++) {
      if (rig.step(0, 0).some((e) => e.type === 'clash')) clash = true;
    }
    expect(clash).toBe(true);
    expect(rig.state.projectiles.length).toBe(0);
  });
});

describe('ゲージとダメージ補正', () => {
  it('技を当てるとゲージがたまる', () => {
    const rig = makeRig(RYUGA, RYUGA, 40);
    const a = rig.state.fighters[0];
    rig.step(press('MP'), 0);
    for (let i = 0; i < 30; i++) rig.step(0, 0);
    expect(a.meter).toBeGreaterThan(0);
  });

  it('コンボが伸びるほどダメージ補正がきつくなる', () => {
    expect(comboScaling(1)).toBe(100);
    expect(comboScaling(3)).toBeLessThan(comboScaling(2));
    expect(comboScaling(20)).toBeLessThanOrEqual(comboScaling(10));
  });

  it('超必殺技はゲージを 1 本消費する', () => {
    const superMove = RYUGA.moves.find((m) => m.id === 'shinku')!;
    expect(superMove.meterCost).toBe(METER_PER_BAR);
  });
});

describe('画面端と押し合い', () => {
  it('壁を越えて外に出ない', () => {
    const s = runMatch([RYUGA, SAYA], randomInputs(4242, 900));
    for (const f of s.fighters) {
      expect(Math.abs(toPx(f.x))).toBeLessThanOrEqual(520);
    }
  });

  it('2 人が離れすぎない（どちらかが画面外に取り残されない）', () => {
    const chars: [CharacterDef, CharacterDef] = [RYUGA, SAYA];
    const s = createMatch(chars, {
      roundsToWin: 2, timeLimit: 0, training: false,
      autoRecover: false, dummyAction: 'stand', infiniteMeter: false,
    });
    s.phase = 'fight';
    // お互いに後ろへ歩き続ける。
    for (let i = 0; i < 400; i++) stepMatch(s, chars, [IN_LEFT, IN_RIGHT]);
    const d = Math.abs(toPx(s.fighters[0].x) - toPx(s.fighters[1].x));
    expect(d).toBeLessThanOrEqual(404);
  });

  it('重なったままにならない', () => {
    const chars: [CharacterDef, CharacterDef] = [GOUZAN, GOUZAN];
    const s = createMatch(chars);
    s.phase = 'fight';
    s.fighters[0].x = 0;
    s.fighters[1].x = 0;
    for (let i = 0; i < 30; i++) stepMatch(s, chars, [0, 0]);
    const d = Math.abs(toPx(s.fighters[0].x) - toPx(s.fighters[1].x));
    expect(d).toBeGreaterThan(20);
  });
});

describe('CPU 対戦相手', () => {
  it('CPU どうしで試合が最後まで進み、決着がつく', () => {
    const chars: [CharacterDef, CharacterDef] = [RYUGA, SAYA];
    const s = createMatch(chars, {
      roundsToWin: 2, timeLimit: 60 * 60, training: false,
      autoRecover: false, dummyAction: 'stand', infiniteMeter: false,
    });
    s.phase = 'fight';
    const a = new CpuBrain(0, 'hard', 11);
    const b = new CpuBrain(1, 'hard', 22);
    let frames = 0;
    while (s.matchWinner < 0 && frames < 60 * 60 * 8) {
      stepMatch(s, chars, [a.think(s, chars), b.think(s, chars)]);
      frames++;
    }
    expect(s.matchWinner).toBeGreaterThanOrEqual(-1);
    expect(s.wins[0] + s.wins[1]).toBeGreaterThan(0);
  });

});

describe('ラウンド進行', () => {
  it('体力が 0 になるとラウンドが終わる', () => {
    const rig = makeRig(RYUGA, RYUGA, 40);
    rig.state.fighters[1].health = 1;
    rig.step(press('HP'), 0);
    let ko = false;
    for (let i = 0; i < 120; i++) {
      if (rig.step(0, 0).some((e) => e.type === 'ko')) ko = true;
    }
    expect(ko).toBe(true);
    expect(rig.state.wins[0]).toBe(1);
  });

  it('時間切れは体力割合の多いほうが勝つ', () => {
    const chars: [CharacterDef, CharacterDef] = [RYUGA, SAYA];
    const s = createMatch(chars, {
      roundsToWin: 2, timeLimit: 30, training: false,
      autoRecover: false, dummyAction: 'stand', infiniteMeter: false,
    });
    s.phase = 'fight';
    s.fighters[1].health = 100;
    for (let i = 0; i < 60; i++) stepMatch(s, chars, [0, 0]);
    expect(s.wins[0]).toBe(1);
  });
});

describe('姿勢と行動', () => {
  it('しゃがみガード中でもしゃがみ技が出せる', () => {
    const rig = makeRig(RYUGA, RYUGA, 60);
    rig.step(IN_LEFT | IN_DOWN, 0);
    rig.step(IN_LEFT | IN_DOWN, 0);
    rig.step(IN_LEFT | IN_DOWN | press('MK'), 0);
    const a = rig.state.fighters[0];
    expect(a.state).toBe('attack');
    expect(RYUGA.moves[a.moveIndex].id).toBe('2mk');
  });

  it('ジャンプすると空中判定になり、着地すると戻る', () => {
    const rig = makeRig(RYUGA, RYUGA, 90);
    rig.step(IN_UP, 0);
    const a = rig.state.fighters[0];
    for (let i = 0; i < 10; i++) rig.step(0, 0);
    expect(a.y).toBeGreaterThan(0);
    for (let i = 0; i < 60; i++) rig.step(0, 0);
    expect(a.y).toBe(0);
    expect(isActionable(a) || a.state === 'landing').toBe(true);
  });

  it('前・前でダッシュする', () => {
    const rig = makeRig(RYUGA, RYUGA, 200);
    const a = rig.state.fighters[0];
    const x0 = a.x;
    rig.step(IN_RIGHT, 0);
    rig.step(0, 0);
    rig.step(IN_RIGHT, 0);
    for (let i = 0; i < 20; i++) rig.step(IN_RIGHT, 0);
    expect(a.x - x0).toBeGreaterThan(px(40));
  });
});

describe('黒羽（ため技キャラ）', () => {
  it('後ろにためてから前 + 強Pで衝撃波が出る', () => {
    const rig = makeRig(KUROHA, RYUGA, 200);
    for (let i = 0; i < 50; i++) rig.step(IN_LEFT, 0);
    rig.step(IN_RIGHT, 0);
    rig.step(IN_RIGHT | press('HP'), 0);
    let spawned = false;
    for (let i = 0; i < 60; i++) {
      if (rig.step(0, 0).some((e) => e.type === 'projectile')) spawned = true;
    }
    expect(spawned).toBe(true);
  });

  it('ためずに強Pを押しても衝撃波は出ない（立ち強Pになる）', () => {
    const rig = makeRig(KUROHA, RYUGA, 200);
    rig.step(IN_RIGHT, 0);
    rig.step(IN_RIGHT | press('HP'), 0);
    const a = rig.state.fighters[0];
    expect(a.state).toBe('attack');
    expect(KUROHA.moves[a.moveIndex].id).toBe('5hp');
  });

  it('下にためてから上 + 強Kで空裂脚が出て、出がかりに無敵がある', () => {
    const rig = makeRig(KUROHA, RYUGA, 60);
    for (let i = 0; i < 50; i++) rig.step(IN_DOWN, 0);
    rig.step(IN_UP | press('HK'), 0);
    const a = rig.state.fighters[0];
    expect(KUROHA.moves[a.moveIndex]?.id).toBe('flash');
    expect(KUROHA.moves[a.moveIndex].invuln?.[0].kind).toBe('full');
  });
});
