/**
 * フレームデータの検証。
 *
 * 「データに書いた硬直差」と「実際に試合を回したときの硬直差」が
 * 1 フレームも違わないことを確かめます。ここが合っていないと、
 * コンボ表も確定反撃の表もぜんぶ嘘になってしまいます。
 */

import { describe, expect, it } from 'vitest';
import { ROSTER, RYUGA, SAYA, GOUZAN, KUROHA } from '../src/data';
import { hitstunOf, moveTotal, isActionable } from '../src/engine/fighter';
import { findMove, makeRig, measureAdvantage, press } from './harness';

describe('技の全体フレーム', () => {
  it('全体フレーム = (発生 - 1) + 持続 + 硬直', () => {
    const m = findMove(RYUGA, '5lp');
    expect(moveTotal(m)).toBe(m.startup - 1 + m.active + m.recovery);
  });

  it('全キャラの全技で、発生・持続・硬直が 1 以上', () => {
    for (const c of ROSTER) {
      for (const m of c.moves) {
        expect(m.startup, `${c.id}/${m.id} 発生`).toBeGreaterThanOrEqual(1);
        expect(m.active, `${c.id}/${m.id} 持続`).toBeGreaterThanOrEqual(1);
        expect(m.recovery, `${c.id}/${m.id} 硬直`).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it('技 ID が重複していない', () => {
    for (const c of ROSTER) {
      const ids = c.moves.map((m) => m.id);
      expect(new Set(ids).size, c.id).toBe(ids.length);
    }
  });
});

describe('発生フレーム', () => {
  it('「発生 4F」の技は、技を出した 4 フレーム目に当たる', () => {
    const rig = makeRig(RYUGA, RYUGA, 40);
    const m = findMove(RYUGA, '5lp');
    rig.step(press('LP'), 0);
    expect(rig.state.fighters[0].moveFrame).toBe(1);
    let hitAt = -1;
    for (let i = 0; i < 30; i++) {
      const evs = rig.step(0, 0);
      if (evs.some((e) => e.type === 'hit')) {
        hitAt = rig.state.fighters[0].moveFrame;
        break;
      }
    }
    expect(hitAt).toBe(m.startup);
  });
});

describe('硬直差', () => {
  const cases: [string, string][] = [
    ['ryuga', '5lp'],
    ['ryuga', '5mp'],
    ['ryuga', '5mk'],
    ['ryuga', '2mk'],
    ['ryuga', '2lp'],
    ['saya', '5lp'],
    ['saya', '5mk'],
    ['gouzan', '5mk'],
    ['kuroha', '5mk'],
    ['kuroha', '2mk'],
  ];

  for (const [charId, moveId] of cases) {
    const char = ROSTER.find((c) => c.id === charId)!;
    const move = findMove(char, moveId);

    it(`${char.nameJa} ${move.nameJa}: ヒット時 ${move.hit.hitAdvantage >= 0 ? '+' : ''}${move.hit.hitAdvantage}F`, () => {
      const r = measureAdvantage(char, RYUGA, moveId, {
        crouchDefender: move.hit.guard === 'low',
      });
      expect(r.hitFrame).toBeGreaterThan(0);
      expect(r.advantage).toBe(move.hit.hitAdvantage);
    });

    it(`${char.nameJa} ${move.nameJa}: ガード時 ${move.hit.blockAdvantage >= 0 ? '+' : ''}${move.hit.blockAdvantage}F`, () => {
      const r = measureAdvantage(char, RYUGA, moveId, {
        block: true,
        crouchDefender: move.hit.guard === 'low',
      });
      expect(r.blocked).toBe(true);
      expect(r.advantage).toBe(move.hit.blockAdvantage);
    });
  }
});

describe('コンボの成立条件', () => {
  /**
   * 「前の技のヒット時硬直差 >= 次の技の発生」ならコンボになる、というルールが
   * 本当かどうかを、実際にキャンセルなしのつなぎ（リンク）で確かめる。
   */
  it('立ち弱P(+5) から 立ち弱P(発生4F) はつながる', () => {
    const first = findMove(RYUGA, '5lp');
    expect(first.hit.hitAdvantage).toBeGreaterThanOrEqual(first.startup);

    const rig = makeRig(RYUGA, RYUGA, 40);
    rig.step(press('LP'), 0);
    // 1 発目が当たるまで進める。
    let hit = false;
    for (let i = 0; i < 30 && !hit; i++) {
      hit = rig.step(0, 0).some((e) => e.type === 'hit');
    }
    expect(hit).toBe(true);

    // 攻撃側が動けるようになった最初のフレームに 2 発目を押す。
    const a = rig.state.fighters[0];
    const b = rig.state.fighters[1];
    let combo = false;
    for (let i = 0; i < 60; i++) {
      const bits = isActionable(a) ? press('LP') : 0;
      const evs = rig.step(bits, 0);
      const second = evs.find((e) => e.type === 'hit');
      if (second) {
        // 相手がのけぞったままなら「コンボ」。
        combo = a.comboHits >= 2;
        break;
      }
      if (isActionable(b) && !isActionable(a)) break;
    }
    expect(combo).toBe(true);
  });

  it('のけぞり時間 = 硬直差 + (全体 - 発生) + 1', () => {
    const m = findMove(RYUGA, '5mp');
    expect(hitstunOf(m)).toBe(m.hit.hitAdvantage + (moveTotal(m) - m.startup) + 1);
  });
});

describe('確定反撃', () => {
  it('昇龍拳をガードすると、相手の最速技が確定する', () => {
    const shoryu = findMove(RYUGA, 'shoryu');
    const fastest = Math.min(
      ...RYUGA.moves.filter((m) => m.input.motion === 'none' && m.input.button).map((m) => m.startup),
    );
    // ルール上、確定するはず。
    expect(Math.abs(shoryu.hit.blockAdvantage)).toBeGreaterThanOrEqual(fastest);
  });
});

describe('ガードの種類', () => {
  it('下段は立ちガードでは防げない', () => {
    const r = measureAdvantage(RYUGA, RYUGA, '2mk', { block: true, crouchDefender: false });
    expect(r.blocked).toBe(false);
  });

  it('下段はしゃがみガードで防げる', () => {
    const r = measureAdvantage(RYUGA, RYUGA, '2mk', { block: true, crouchDefender: true });
    expect(r.blocked).toBe(true);
  });

  it('ジャンプ攻撃（中段）はしゃがみガードでは防げない', () => {
    const jmk = findMove(SAYA, 'jmk');
    expect(jmk.hit.guard).toBe('high');
  });
});

describe('キャラクターの個性が数値に出ている', () => {
  it('黒羽はリーチが長いかわりに発生が遅い', () => {
    const k = KUROHA.moves.find((m) => m.id === '5mk')!;
    const r = RYUGA.moves.find((m) => m.id === '5mk')!;
    const reach = (m: typeof k) => m.hitboxes.reduce((x, b) => Math.max(x, b.x + b.w), 0);
    expect(reach(k)).toBeGreaterThan(reach(r));
    expect(k.startup).toBeGreaterThan(r.startup);
  });

  it('紗夜は最速、剛山は最も体力が多い', () => {
    expect(SAYA.moves.find((m) => m.id === '5lp')!.startup).toBe(3);
    expect(GOUZAN.health).toBeGreaterThan(RYUGA.health);
    expect(SAYA.health).toBeLessThan(RYUGA.health);
    expect(SAYA.walkForward).toBeGreaterThan(GOUZAN.walkForward);
  });
});
