/**
 * ワザのダメージを、カードの記録の規則と今の場から求める。狙いの 3 段目「ワザを N 以上で打てる」の判定に使う。
 *
 * 相手がいないため、弱点・抵抗力と相手の側で決まる上乗せは計算しない。記録はそうした上乗せを持たず、
 * 含めなかった効果に書いている(docs/setup-rate-design.md「カードの記録の形」)。
 */

import {
  type Attack,
  CardCategory,
  type DamageBonus,
} from "./card-record-schema.ts";
import { countEnergyUnitsOfTypes } from "./continuous-effects.ts";
import type { GameState } from "./state.ts";

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

/** ワザのダメージ。ダメージの無いワザは null。 */
export function calculateAttackDamage(
  state: GameState,
  attack: Attack
): number | null {
  const { damage } = attack;
  if (damage.kind === "none") {
    return null;
  }
  return (
    damage.amount +
    (damage.bonus === undefined ? 0 : calculateBonus(state, damage.bonus))
  );
}
