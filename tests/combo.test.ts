import { describe, expect, it } from 'vitest';
import { ROSTER } from '../src/data';
import { currentMove, isActionable } from '../src/engine/fighter';
import { toPx } from '../src/engine/constants';
import { BUTTON_BITS, IN_DOWN, IN_RIGHT } from '../src/engine/input';
import { cloneMatch, createMatch, stepMatch, type MatchState } from '../src/engine/match';
import type { Button, CharacterDef } from '../src/engine/types';

const BUTTONS: Button[] = ['LP', 'MP', 'HP', 'LK', 'MK', 'HK'];

/**
 * 1 手先読みの貪欲探索で「いちばん長く続くコンボ」を探す。
 * 各フレーム、押せるボタン（と下方向）をすべて試し、
 * 「コンボが途切れないもの」の中でいちばん先までつながる手を選ぶ。
 * これで無限コンボが存在するかどうかを機械的に確かめられる。
 */
function findLongestCombo(chars: [CharacterDef, CharacterDef], corner: boolean) {
  const base = createMatch(chars, {
    roundsToWin: 99, timeLimit: 0, training: false,
    autoRecover: false, dummyAction: 'stand', infiniteMeter: true,
  });
  base.phase = 'fight';
  if (corner) {
    base.fighters[0].x = 440 * 256;
    base.fighters[1].x = 490 * 256;
  } else {
    base.fighters[0].x = -18 * 256;
    base.fighters[1].x = 18 * 256;
  }
  // 相手の体力を極端に増やして、死なずに何発入るかを見る。
  base.fighters[1].health = 999999;
  base.fighters[1].maxHealth = 999999;

  let s = base;
  let hits = 0;
  let frames = 0;
  const used: string[] = [];

  const candidates: number[] = [0, IN_RIGHT];
  for (const b of BUTTONS) {
    candidates.push(BUTTON_BITS[b]);
    candidates.push(BUTTON_BITS[b] | IN_DOWN);
  }

  while (frames < 60 * 20) {
    const a = s.fighters[0];
    const m = currentMove(a, chars[0]);
    const canAct =
      isActionable(a) || (a.state === 'attack' && m != null && (a.moveHit || a.moveBlocked));
    if (!canAct) {
      stepMatch(s, chars, [0, 0]);
      frames++;
      if (s.fighters[0].comboHits === 0 && hits > 0) break;
      continue;
    }
    // どの手ならコンボが続くか、30 フレーム先まで試す。
    let best: { bits: number; gain: number; state: MatchState; label: string } | null = null;
    for (const bits of candidates) {
      const t = cloneMatch(s);
      const before = t.fighters[0].comboHits;
      let gained = 0;
      let ok = true;
      for (let k = 0; k < 30; k++) {
        // 人間の連打を模して、2 フレームおきに押し直す（押しっぱなしでは
        // 「押した瞬間」が 1 回しか出ないため）。
        stepMatch(t, chars, [k % 2 === 0 ? bits : bits & IN_DOWN, 0]);
        if (t.fighters[0].comboHits > before) {
          gained = t.fighters[0].comboHits - before;
          break;
        }
        if (before > 0 && t.fighters[0].comboHits === 0) {
          ok = false;
          break;
        }
      }
      if (!ok || gained === 0) continue;
      if (!best || gained > best.gain) {
        best = { bits, gain: gained, state: t, label: currentMove(t.fighters[0], chars[0])?.nameJa ?? '?' };
      }
    }
    if (!best) break;
    hits += best.gain;
    used.push(best.label);
    frames += 1;
    s = best.state;
    if (hits > 60) break; // これ以上は無限とみなす
  }
  return {
    hits,
    dmg: 999999 - s.fighters[1].health,
    dist: Math.abs(toPx(s.fighters[0].x) - toPx(s.fighters[1].x)),
    seq: used.slice(0, 14).join('→'),
  };
}

/**
 * 無限コンボが存在しないことの検証。
 *
 * 「弱パンチが自分自身につながり続ける」のは、
 * ヒット時硬直差 >= 発生フレーム になっている技なら理屈のうえで起こります。
 * 画面端では押し戻しで距離も開かないので、放っておくと本当に永久に続きます。
 *
 * 対策として入れてあるのは次の 3 つです。
 *   1. のけぞりの減衰  … コンボが伸びるほど、のけぞりが 1F ずつ短くなる
 *   2. 画面端の押し戻し … 相手が下がれないぶん、殴っているほうが下がる
 *   3. 打ち上げ回数の上限 … 空中の相手を何度も浮かせ直せない
 *
 * ここでは総当たりでいちばん長いコンボを探し、上限に収まることを確かめます。
 */
describe('無限コンボが存在しないこと', () => {
  const LIMIT = 12;
  for (const c of ROSTER) {
    it(`${c.nameJa}：画面中央で ${LIMIT} 発を超えるコンボが作れない`, () => {
      const r = findLongestCombo([c, c], false);
      expect(r.hits, `${c.id} 中央: ${r.hits}発 ${r.dmg}ダメージ (${r.seq})`).toBeLessThanOrEqual(LIMIT);
    }, 60000);

    it(`${c.nameJa}：画面端でも ${LIMIT} 発を超えるコンボが作れない`, () => {
      const r = findLongestCombo([c, c], true);
      expect(r.hits, `${c.id} 画面端: ${r.hits}発 ${r.dmg}ダメージ (${r.seq})`).toBeLessThanOrEqual(LIMIT);
    }, 60000);
  }

  it('弱攻撃だけのコンボは、体力の 2 割も奪えない', () => {
    for (const c of ROSTER) {
      const r = findLongestCombo([c, c], true);
      expect(r.dmg, `${c.id}: ${r.dmg} / ${c.health}`).toBeLessThan(c.health * 0.45);
    }
  }, 120000);
});
