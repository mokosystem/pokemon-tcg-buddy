/**
 * ワザのダメージを、カードの記録の規則と今の場から求める。狙いの 3 段目「ワザを N 以上で打てる」の判定に使う。
 * 求めるのは相手のバトルポケモンに与えるダメージ。
 *
 * 相手がいないため、弱点・抵抗力と相手の側で決まる上乗せは計算しない。記録はそうした上乗せを持たず、
 * 含めなかった効果に書いている(docs/setup-rate-design.md「カードの記録の形」)。自分の側のカードが
 * ダメージを増やす効果(場にある間ずっと働く効果と、この番だけ働く効果)は足す。
 */

import {
  type Attack,
  CardCategory,
  type DamageBonus,
} from "./card-record-schema.ts";
import { matchesPokemonFilter } from "./conditions.ts";
import {
  countEnergyUnitsOfTypes,
  sumAttackDamageIncrease,
} from "./continuous-effects.ts";
import type { GameState, PokemonInPlay } from "./state.ts";

function countDamageTarget(
  state: GameState,
  target: DamageBonus["target"]
): number {
  switch (target.count) {
    case "energyAttachedToOwnPokemon":
      return state
        .listPokemonInPlay()
        .reduce(
          (total, pokemon) =>
            total + countEnergyUnitsOfTypes(state, pokemon, target.energyTypes),
          0
        );
    case "discardPokemonWithAbilityName":
      return state.discard.filter(
        (card) =>
          card.record.category === CardCategory.Pokemon &&
          card.record.abilities.some(
            (ability) => ability.name === target.abilityName
          )
      ).length;
    case "ownBenchedPokemon":
      return state.bench.length;
    default:
      return 0;
  }
}

function calculateBonus(state: GameState, bonus: DamageBonus): number {
  const count = countDamageTarget(state, bonus.target);
  if (bonus.kind === "perCount") {
    return count * bonus.unit;
  }
  return count >= bonus.atLeast ? bonus.add : 0;
}

function sumAttackDamageIncreaseThisTurn(
  state: GameState,
  attacker: PokemonInPlay
): number {
  return state.attackDamageIncreasesThisTurn.reduce(
    (total, increase) =>
      matchesPokemonFilter(state, attacker, increase.attackerFilter)
        ? total + increase.amount
        : total,
    0
  );
}

/**
 * attacker が attack を使ったときのダメージ。ダメージの無いワザは null。attacker はワザを使うポケモン
 * (バトルポケモン)で、ベンチのポケモンのワザを使う効果(ミュウex の「きおくのらせん」)でもワザの持ち主ではない。
 * ダメージを増やす効果の条件(タイプ、名前)はワザを使うポケモンに当てる(公式 Q&A「パワープロテイン」:
 * 超タイプのミュウex がメガルカリオex のワザを使っても、闘ポケモンのワザを増やす効果は働かない)。
 * 基本のダメージ(ワザ自身の数値と上乗せ)が 0 なら、ダメージを増やす効果を足さずに 0 で終える
 * (公式 Q&A「サイドン」「ビリリダマ」、検索語「ダメージが0」、2026-09-23 確認: 基本のダメージが 0 になった時点で
 * ダメージの計算を終え、ワザを使うポケモンにかかるダメージを変える効果は計算しない)。
 */
export function calculateAttackDamage(
  state: GameState,
  attacker: PokemonInPlay,
  attack: Attack
): number | null {
  const { damage } = attack;
  if (damage.kind === "none") {
    return null;
  }
  const base =
    damage.amount +
    (damage.bonus === undefined ? 0 : calculateBonus(state, damage.bonus));
  if (base === 0) {
    return 0;
  }
  return (
    base +
    sumAttackDamageIncrease(state, attacker) +
    sumAttackDamageIncreaseThisTurn(state, attacker)
  );
}
