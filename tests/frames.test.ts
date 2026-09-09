/**
 * フレームデータの検証。
 *
 * 「データに書いた硬直差」と「実際に試合を回したときの硬直差」が
 * 1 フレームも違わないことを確かめます。ここが合っていないと、
 * コンボ表も確定反撃の表もぜんぶ嘘になってしまいます。
 */

import { describe, expect, it } from 'vitest';
import { ROSTER, RYUGA, SAYA, GOUZAN, KUROHA } from '../src/data';
import { hitstunOf, moveTotal } from '../src/engine/fighter';
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
  it('立ち弱パンチが自分自身につながる（ヒット時硬直差 >= 発生）', () => {
    const first = findMove(RYUGA, '5lp');
    // スト 6 のリュウと同じく「発生 4F / ヒット +4F」なので、理屈のうえではつながる。
    expect(first.hit.hitAdvantage).toBeGreaterThanOrEqual(first.startup);

    const rig = makeRig(RYUGA, RYUGA, 40);
    const a = rig.state.fighters[0];
    // 押しっぱなしでは「押した瞬間」が 1 回しか出ないので、1 フレームおきに押し直す。
    // 実際に遊ぶときの連打と同じで、これで入力バッファに常に押しが残る。
    let combo = false;
    for (let i = 0; i < 60; i++) {
      rig.step(i % 2 === 0 ? press('LP') : 0, 0);
      if (a.comboHits >= 2) {
        combo = true;
        break;
      }
    }
    expect(combo).toBe(true);
  });

  it('ただし、のけぞりの減衰で永久には続かない', () => {
    // 詳しい検証は tests/combo.test.ts。ここでは「必ずどこかで切れる」ことだけ見る。
    const rig = makeRig(RYUGA, RYUGA, 40);
    const a = rig.state.fighters[0];
    let maxCombo = 0;
    for (let i = 0; i < 60 * 10; i++) {
      rig.step(i % 2 === 0 ? press('LP') : 0, 0);
      maxCombo = Math.max(maxCombo, a.comboHits);
    }
    expect(maxCombo).toBeGreaterThanOrEqual(2);
    expect(maxCombo).toBeLessThanOrEqual(8);
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

  it('紗夜は最速の下段を持ち、剛山は最も体力が多い', () => {
    // 参考にしたスト 6 のキャミィと同じく、立ち弱Pは 4F。
    // 速さの持ち味は「4F の下段」と「5F の中パンチ」、そして歩きの速さに出る。
    expect(SAYA.moves.find((m) => m.id === '2lk')!.startup).toBe(4);
    expect(SAYA.moves.find((m) => m.id === '5mp')!.startup).toBe(5);
    expect(GOUZAN.health).toBeGreaterThan(RYUGA.health);
    expect(SAYA.health).toBeLessThan(RYUGA.health);
    expect(SAYA.walkForward).toBeGreaterThan(GOUZAN.walkForward);
  });

  it('剛山はどの技も龍牙より発生が遅い（そのぶん重い）', () => {
    for (const id of ['5lp', '5mp', '5hp', '2lk', '2mk', '2hk']) {
      const g = GOUZAN.moves.find((m) => m.id === id)!;
      const r = RYUGA.moves.find((m) => m.id === id)!;
      expect(g.startup, `${id}`).toBeGreaterThanOrEqual(r.startup);
      expect(g.hit.damage, `${id}`).toBeGreaterThanOrEqual(r.hit.damage);
    }
  });
});

/**
 * スト 6 のフレームデータを参照した値になっていることの確認。
 *
 * ここに書いてある数字が、そのままゲーム内の技表に出ます。
 * 調整したときに「参照元とずれた」ことに気づけるよう、表として残しておきます。
 *
 * 注：ダメージはスト 6 が体力 10000、このゲームが 1000 なので 1/10 にしてあります。
 */
describe('スト 6 を参照したフレームデータ', () => {
  // [技ID, 発生, 持続, 硬直, ヒット時, ガード時]
  const RYU_SF6: [string, number, number, number, number, number][] = [
    ['5lp', 4, 3, 9, 4, -1],
    ['5mp', 6, 4, 11, 7, -1],
    ['5hp', 9, 3, 20, 3, -3],
    ['5lk', 5, 3, 8, 4, -1],
    ['5mk', 7, 3, 15, 3, -3],
    ['5hk', 12, 4, 16, 5, 1],
    ['2lp', 4, 2, 9, 4, -1],
    ['2mp', 6, 3, 12, 5, -1],
    ['2hp', 8, 4, 22, 12, -6],
    ['2lk', 5, 3, 9, 2, -3],
    ['2mk', 8, 4, 15, 2, -4],
    ['2hk', 9, 4, 24, 20, -12],
  ];

  for (const [id, st, ac, rc, hit, blk] of RYU_SF6) {
    it(`龍牙 ${id}: ${st}/${ac}/${rc}  ヒット${hit >= 0 ? '+' : ''}${hit} / ガード${blk >= 0 ? '+' : ''}${blk}`, () => {
      const m = findMove(RYUGA, id);
      expect([m.startup, m.active, m.recovery]).toEqual([st, ac, rc]);
      expect([m.hit.hitAdvantage, m.hit.blockAdvantage]).toEqual([hit, blk]);
    });
  }

  it('昇龍拳は発生 5F・出がかり無敵・ガードされると 30F 以上不利', () => {
    const m = findMove(RYUGA, 'shoryu');
    expect(m.startup).toBe(5);
    expect(m.invuln?.[0]).toMatchObject({ from: 1, kind: 'full' });
    expect(m.hit.blockAdvantage).toBeLessThanOrEqual(-30);
  });

  it('紗夜の昇り蹴り・黒羽の空裂脚も、無敵つきで大きく不利', () => {
    for (const [c, id] of [[SAYA, 'rising'], [KUROHA, 'flash']] as const) {
      const m = findMove(c, id);
      expect(m.startup, `${c.id}/${id}`).toBe(5);
      expect(m.invuln?.[0].kind).toBe('full');
      expect(m.hit.blockAdvantage).toBeLessThanOrEqual(-30);
    }
  });

  it('立ち中K・足払いは、どのキャラもガードされると不利', () => {
    for (const c of ROSTER) {
      for (const id of ['5mk', '2mk', '2hk']) {
        const m = findMove(c, id);
        expect(m.hit.blockAdvantage, `${c.id}/${id}`).toBeLessThan(0);
      }
    }
  });
});
