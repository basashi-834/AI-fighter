/**
 * キー配置の検証。
 *
 * 1 台のキーボードで 2 人対戦をするので、
 * 1P と 2P で同じキーを使ってしまうと、片方を操作するともう片方も動きます。
 * 見た目には気づきにくく、対戦中に「なぜか相手が勝手に技を出す」という
 * 形で出てくる不具合なので、テストで塞いでおきます。
 */

import { describe, expect, it } from 'vitest';
import { DEFAULT_KEYS, type KeyMap } from '../src/game/controls';

function allKeys(m: KeyMap): string[] {
  return [...m.up, ...m.down, ...m.left, ...m.right, ...m.lp, ...m.mp, ...m.hp, ...m.lk, ...m.mk, ...m.hk];
}

describe('キー配置', () => {
  it('1P と 2P でキーが重なっていない', () => {
    const a = new Set(allKeys(DEFAULT_KEYS[0]));
    const dup = allKeys(DEFAULT_KEYS[1]).filter((k) => a.has(k));
    expect(dup, `重複しているキー: ${dup.join(', ')}`).toEqual([]);
  });

  it('同じプレイヤーの中でもキーが重なっていない', () => {
    for (const m of DEFAULT_KEYS) {
      const keys = allKeys(m);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it('2P はテンキーが無いキーボードでも遊べる', () => {
    const m = DEFAULT_KEYS[1];
    for (const list of [m.lp, m.mp, m.hp, m.lk, m.mk, m.hk]) {
      expect(list.some((k) => !k.startsWith('Numpad'))).toBe(true);
    }
  });
});
