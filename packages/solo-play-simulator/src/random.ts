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
 *
 * 状態を欄に持つのは、探索が状態の複製を作るときに、乱数も同じ続きから写すため(copy)。
 */
export class SeededRandom implements RandomSource {
  private state: number;

  constructor(seed: number) {
    // biome-ignore lint/suspicious/noBitwiseOperators: 種を 32 ビット整数にそろえる。生成器の定義に合わせる
    this.state = seed | 0;
  }

  nextFloat(): number {
    // biome-ignore-start lint/suspicious/noBitwiseOperators: 生成器は 32 ビット整数のビット演算で定義されており、算術演算に置き換えると出典の生成器と別物になる
    this.state = (this.state + 0x9e_37_79_b9) | 0;
    let mixed = this.state ^ (this.state >>> 16);
    mixed = Math.imul(mixed, 0x21_f0_aa_ad);
    mixed ^= mixed >>> 15;
    mixed = Math.imul(mixed, 0x73_5a_2d_97);
    mixed ^= mixed >>> 15;
    return (mixed >>> 0) / TWO_TO_THE_32;
    // biome-ignore-end lint/suspicious/noBitwiseOperators: 生成器の定義はここまで
  }

  /** 今の状態を写した生成器。写した後は、元と写しがそれぞれ同じ乱数列を出す。 */
  copy(): SeededRandom {
    const copied = new SeededRandom(0);
    copied.state = this.state;
    return copied;
  }

  /** 0 以上 2^32 未満の整数。探索が、試すたびに使う別の生成器の種を作るのに使う。 */
  nextSeed(): number {
    return Math.floor(this.nextFloat() * TWO_TO_THE_32);
  }
}

export function createSeededRandom(seed: number): SeededRandom {
  return new SeededRandom(seed);
}
