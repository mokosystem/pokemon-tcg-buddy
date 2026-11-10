import { calculateBenchLimit } from "./continuous-effects.ts";
import { chooseOnePokemon, type EffectContext } from "./effect-choices.ts";

/**
 * ベンチのポケモンが上限を超えていれば、上限になるまでベンチのポケモンを選んで、ついているカードごとトラッシュする
 * (ゼロの大空洞が場を離れたとき、場に「テラスタル」のポケモンがいなくなったとき)。どれをトラッシュするかは
 * プレイングの判断基準が選ぶ。トラッシュしたポケモンはきぜつではない(公式 Q&A「ゼロの大空洞」、2026-09-23 確認)。
 */
export function trimBenchToLimit(context: EffectContext): void {
  const { state } = context;
  const limit = calculateBenchLimit(state);
  while (state.bench.length > limit) {
    const target = chooseOnePokemon(
      context,
      state.bench,
      `ベンチを ${limit} 匹にするためにトラッシュするベンチポケモン`
    );
    if (target === undefined) {
      return;
    }
    state.discardBenchedPokemon(target);
  }
}
