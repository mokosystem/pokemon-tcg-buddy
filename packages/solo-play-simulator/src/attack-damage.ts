/**
 * ワザのダメージを、カードの記録の規則と今の場から求める。狙いの 3 段目「ワザを N 以上で打てる」の判定と、場の評価の
 * ダメージの見込みに使う。求めるのは相手のバトルポケモンに与えるダメージ。
 *
 * 相手がいないため、弱点・抵抗力と相手の側で決まる上乗せは計算しない。記録はそうした上乗せを持たず、
 * 含めなかった効果に書いている(docs/solo-play-simulator-design.md「カードの記録の形」)。自分の側のカードが
 * ダメージを増やす効果(場にある間ずっと働く効果と、この番だけ働く効果)は足す。
 */

import {
  type Attack,
  CardCategory,
  type DamageBonus,
} from "./card-record-schema.ts";
import { type Card, matchesCardFilter } from "./cards.ts";
import { matchesPokemonFilter } from "./conditions.ts";
import {
  countEnergyUnitsOfTypes,
  listEnergyUnits,
  sumAttackDamageIncrease,
} from "./continuous-effects.ts";
import type { GameState, PokemonInPlay } from "./state.ts";

type DamageCountTarget = DamageBonus["target"];

type DamageTargetCounter<Name extends DamageCountTarget["count"]> = (
  target: Extract<DamageCountTarget, { count: Name }>,
  state: GameState,
  attacker: PokemonInPlay
) => number;

function listAttachedBasicEnergies(state: GameState): Card[] {
  return state
    .listPokemonInPlay()
    .flatMap((pokemon) =>
      pokemon.energies.filter(
        (energy) => energy.category === CardCategory.BasicEnergy
      )
    );
}

/** 数える対象の部品ごとの数え方。記法の部品の一覧と 1 対 1 に対応させる(部品を足すときはここにも 1 行足す)。 */
const damageTargetCounters: {
  readonly [Name in DamageCountTarget["count"]]: DamageTargetCounter<Name>;
} = {
  basicEnergyAttachedToOwnPokemon: (_, state) =>
    listAttachedBasicEnergies(state).length,
  basicEnergyTypesAttachedToOwnPokemon: (_, state) =>
    new Set(
      listAttachedBasicEnergies(state).flatMap((energy) =>
        energy.provision?.kind === "type" ? [energy.provision.type] : []
      )
    ).size,
  cardsInHand: (_, state) => state.hand.length,
  discardCardsMatching: (target, state) =>
    state.discard.filter((card) => matchesCardFilter(card, target.filter))
      .length,
  discardPokemonWithAbilityName: (target, state) =>
    state.discard.filter(
      (card) =>
        card.record.category === CardCategory.Pokemon &&
        card.record.abilities.some(
          (ability) => ability.name === target.abilityName
        )
    ).length,
  energyAttachedToAttackingPokemon: (target, state, attacker) =>
    target.energyTypes === undefined
      ? listEnergyUnits(state, attacker).length
      : countEnergyUnitsOfTypes(state, attacker, target.energyTypes),
  energyAttachedToOwnPokemon: (target, state) =>
    state
      .listPokemonInPlay()
      .reduce(
        (total, pokemon) =>
          total + countEnergyUnitsOfTypes(state, pokemon, target.energyTypes),
        0
      ),
  ownPokemonInPlay: (target, state) =>
    state
      .listPokemonInPlay()
      .filter(
        (pokemon) =>
          target.filter === undefined ||
          matchesPokemonFilter(state, pokemon, target.filter)
      ).length,
  stadiumsInPlay: (_, state) => (state.stadium === undefined ? 0 : 1),
  toolAttachedToAttackingPokemon: (_, __, attacker) =>
    attacker.tool === undefined ? 0 : 1,
};

function countDamageTarget<Name extends DamageCountTarget["count"]>(
  state: GameState,
  attacker: PokemonInPlay,
  target: Extract<DamageCountTarget, { count: Name }>
): number {
  const count: DamageTargetCounter<Name> = damageTargetCounters[target.count];
  return count(target, state, attacker);
}

/**
 * 上乗せの量。countsPartialThreshold が真なら、「N 以上なら M を足す」で数がまだ N に届かないとき M × 数 ÷ N を足す。
 * 場の評価の見込みだけに使い、狙いの判定(calculateAttackDamage)では届くまで足さない(Issue 51「数え漏れ 5」)。
 */
function calculateBonus(
  state: GameState,
  attacker: PokemonInPlay,
  bonus: DamageBonus,
  countsPartialThreshold: boolean
): number {
  const count = countDamageTarget(state, attacker, bonus.target);
  if (bonus.kind === "perCount") {
    return count * bonus.unit;
  }
  if (count >= bonus.atLeast) {
    return bonus.add;
  }
  return countsPartialThreshold ? (bonus.add * count) / bonus.atLeast : 0;
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

function calculateDamage(
  state: GameState,
  attacker: PokemonInPlay,
  attack: Attack,
  countsPartialThreshold: boolean
): number | undefined {
  const { damage } = attack;
  if (damage.kind === "none") {
    return undefined;
  }
  const base =
    damage.amount +
    (damage.bonus === undefined
      ? 0
      : calculateBonus(state, attacker, damage.bonus, countsPartialThreshold));
  if (base === 0) {
    return 0;
  }
  return (
    base +
    sumAttackDamageIncrease(state, attacker) +
    sumAttackDamageIncreaseThisTurn(state, attacker)
  );
}

/**
 * attacker が attack を使ったときのダメージ。ダメージの無いワザは undefined。attacker はワザを使うポケモン
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
): number | undefined {
  return calculateDamage(state, attacker, attack, false);
}

/**
 * 場の評価に使うダメージの見込み。calculateAttackDamage と同じ規則で求め、上乗せ「N 以上なら M を足す」だけは、数が
 * N に届く前でも M × 数 ÷ N を足す(階段を坂にする。Issue 51「数え漏れ 5」)。届くまで見込みが変わらないと、数を
 * 増やす手(トラッシュに送るなど)が評価に出ないため。狙いが成り立ったかの判定には使わない。
 */
export function estimateAttackDamageWithPartialThresholds(
  state: GameState,
  attacker: PokemonInPlay,
  attack: Attack
): number | undefined {
  return calculateDamage(state, attacker, attack, true);
}
