/**
 * 種を指定できる乱数の生成器。
 *
 * 同じ種からは同じ乱数列が出る。枚数を変えたときの比較を同じ種で回すと、
 * 差を試行の揺れではなく変更の効果として読める。Math.random は種を指定できない。
 */

import type { RandomSource } from "./state.ts";

const TWO_TO_THE_32 = 4_294_967_296;

/**
 * splitmix32。32 ビットの状態を 1 つ持つ小さな生成器で、山札を切る入れ替え先を選ぶには十分。
 * 出典: https://github.com/bryc/code/blob/master/jshash/PRNGs.md (確認日 2026-09-21)。
 * 同じ出典にある mulberry32 を採らなかったのは、出典が「32 ビットの値の 3 分の 1 を出さない」と記し、
 * 代わりに splitmix32 を勧めているため。
 */
export function createSeededRandom(seed: number): RandomSource {
  // biome-ignore-start lint/suspicious/noBitwiseOperators: 生成器は 32 ビット整数のビット演算で定義されており、算術演算に置き換えると出典の生成器と別物になる
  let state = seed | 0;
  return {
    nextFloat: () => {
      state = (state + 0x9e_37_79_b9) | 0;
      let mixed = state ^ (state >>> 16);
      mixed = Math.imul(mixed, 0x21_f0_aa_ad);
      mixed ^= mixed >>> 15;
      mixed = Math.imul(mixed, 0x73_5a_2d_97);
      mixed ^= mixed >>> 15;
      return (mixed >>> 0) / TWO_TO_THE_32;
    },
  };
  // biome-ignore-end lint/suspicious/noBitwiseOperators: 生成器の定義はここまで
}
