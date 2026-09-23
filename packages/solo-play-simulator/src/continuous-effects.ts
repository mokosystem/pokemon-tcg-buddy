/**
 * 場にある間ずっと働く効果(特性、スタジアム、ポケモンのどうぐ、特殊エネルギー)を集め、判定に当てる。
 *
 * 状態を書き換えず、判定のたびに場にある効果を集めて実効値を求める。場を離れた効果は集めた中に
 * 入らないので、効果を消すための記録が要らない(docs/setup-rate-design.md「場にある間ずっと働く効果」)。
 */

import {
  type Attack,
  CardCategory,
  type ContinuousEffect,
  type EnergyProvision,
  type PokemonType,
} from "./card-record-schema.ts";
import type { Card } from "./cards.ts";
import { areConditionsMet, matchesPokemonFilter } from "./conditions.ts";
import type { EnergyUnit, GameState, PokemonInPlay } from "./state.ts";

interface CollectedContinuousEffect {
  readonly effect: ContinuousEffect;
  /** 特性のポケモン、どうぐ・特殊エネルギーをつけているポケモン。スタジアムは null。 */
  readonly holder: PokemonInPlay | null;
  readonly sourceCard: Card;
}

function listCardContinuousEffects(card: Card): ContinuousEffect[] {
  if (!("cardEffects" in card.record)) {
    return [];
  }
  return card.record.cardEffects.flatMap((cardEffect) =>
    cardEffect.kind === "continuous" ? [cardEffect.continuousEffect] : []
  );
}

function listAbilityContinuousEffects(card: Card): ContinuousEffect[] {
  if (card.record.category !== CardCategory.Pokemon) {
    return [];
  }
  return card.record.abilities.flatMap((ability) =>
    ability.translation?.kind === "continuous"
      ? [ability.translation.continuousEffect]
      : []
  );
}

function appliesTo(
  state: GameState,
  collected: CollectedContinuousEffect,
  pokemon: PokemonInPlay
): boolean {
  const { scope } = collected.effect;
  switch (scope.scope) {
    case "self":
    case "attachedPokemon":
      return collected.holder === pokemon;
    case "ownPokemon":
      return matchesPokemonFilter(state, pokemon, scope.filter);
    default:
      return false;
  }
}

function isEffectConditionMet(
  state: GameState,
  collected: CollectedContinuousEffect
): boolean {
  return areConditionsMet(state, collected.effect.conditions, {
    card: collected.sourceCard,
    pokemon: collected.holder,
  });
}

function toCollected(
  sourceCard: Card,
  holder: PokemonInPlay | null,
  effects: readonly ContinuousEffect[]
): CollectedContinuousEffect[] {
  return effects.map((effect) => ({ effect, holder, sourceCard }));
}

/**
 * 今働いている効果を集める。特性やどうぐを無くす効果は、スタジアムが持つものだけを先に集めて当てる。
 * 特性やどうぐが特性・どうぐを無くすカードはまだ翻訳に無く、無くす効果どうしの優先も決めていない
 * (docs/setup-rate-design.md「場にある間ずっと働く効果」)。
 */
function collectContinuousEffects(
  state: GameState
): CollectedContinuousEffect[] {
  const { stadium } = state;
  const activeStadiumEffects = (
    stadium === null
      ? []
      : toCollected(stadium, null, listCardContinuousEffects(stadium))
  ).filter((collected) => isEffectConditionMet(state, collected));
  const isNegatedBy = (
    change: "negateAbilities" | "negateToolEffects",
    pokemon: PokemonInPlay
  ) =>
    activeStadiumEffects.some(
      (collected) =>
        collected.effect.change.change === change &&
        appliesTo(state, collected, pokemon)
    );
  const pokemonEffects = state.listPokemonInPlay().flatMap((pokemon) => {
    const { tool } = pokemon;
    return [
      ...(isNegatedBy("negateAbilities", pokemon)
        ? []
        : toCollected(
            pokemon.card,
            pokemon,
            listAbilityContinuousEffects(pokemon.card)
          )),
      ...(tool === null || isNegatedBy("negateToolEffects", pokemon)
        ? []
        : toCollected(tool, pokemon, listCardContinuousEffects(tool))),
      ...pokemon.energies.flatMap((energy) =>
        toCollected(energy, pokemon, listCardContinuousEffects(energy))
      ),
    ];
  });
  return [
    ...activeStadiumEffects,
    ...pokemonEffects.filter((collected) =>
      isEffectConditionMet(state, collected)
    ),
  ];
}

function listEffectsApplyingTo(
  state: GameState,
  pokemon: PokemonInPlay
): CollectedContinuousEffect[] {
  return collectContinuousEffects(state).filter((collected) =>
    appliesTo(state, collected, pokemon)
  );
}

export function isAbilityNegated(
  state: GameState,
  pokemon: PokemonInPlay
): boolean {
  return listEffectsApplyingTo(state, pokemon).some(
    (collected) => collected.effect.change.change === "negateAbilities"
  );
}

/** にげるために必要なエネルギーの数。0 にする効果は減らす効果より優先する。 */
export function calculateRetreatCost(
  state: GameState,
  pokemon: PokemonInPlay
): number {
  const changes = listEffectsApplyingTo(state, pokemon).map(
    (collected) => collected.effect.change
  );
  if (changes.some((change) => change.change === "setRetreatCostToZero")) {
    return 0;
  }
  const reduction = changes.reduce(
    (total, change) =>
      change.change === "reduceRetreatCost" ? total + change.amount : total,
    0
  );
  return Math.max(0, pokemon.card.retreatCost - reduction);
}

/** ついているエネルギー 1 枚が今供給するもの。特殊エネルギー自身の効果(進化ポケモンについていれば 3 個ぶん、など)を当てる。 */
export function resolveEnergyProvision(
  state: GameState,
  pokemon: PokemonInPlay,
  energy: Card
): EnergyProvision {
  const base = energy.provision;
  if (base === undefined) {
    throw new Error(`${energy.name} はエネルギーではない`);
  }
  const override = collectContinuousEffects(state).find(
    (collected) =>
      collected.sourceCard === energy &&
      collected.holder === pokemon &&
      collected.effect.scope.scope === "self" &&
      collected.effect.change.change === "setEnergyProvision"
  );
  if (override?.effect.change.change === "setEnergyProvision") {
    return override.effect.change.provision;
  }
  return base;
}

export function toEnergyUnits(provision: EnergyProvision): EnergyUnit[] {
  const unit = provision.kind === "anyType" ? "any" : provision.type;
  return Array.from({ length: provision.units }, () => unit);
}

/** ポケモンについているエネルギーが今供給する 1 個ずつのタイプ。ワザのエネルギーの判定に使う。 */
export function listEnergyUnits(
  state: GameState,
  pokemon: PokemonInPlay
): EnergyUnit[] {
  return pokemon.energies.flatMap((energy) =>
    toEnergyUnits(resolveEnergyProvision(state, pokemon, energy))
  );
}

/** ついているエネルギーのうち、指定のタイプとして数えられる個数(すべてのタイプとして働くものを含む)。 */
export function countEnergyUnitsOfType(
  state: GameState,
  pokemon: PokemonInPlay,
  type: PokemonType
): number {
  return listEnergyUnits(state, pokemon).filter(
    (unit) => unit === type || unit === "any"
  ).length;
}

export interface UsableAttack {
  readonly attack: Attack;
  /** ワザを持っているポケモン。ミュウex の「きおくのらせん」ではベンチのポケモン。 */
  readonly owner: PokemonInPlay;
}

/**
 * このポケモンが使えるワザ。自身のワザに、ベンチのポケモンのワザを使えるようにする効果の分を足す。
 * ベンチのポケモンについては、そのポケモン自身が持つワザだけを足し、効果で使えるようになったワザは
 * 足さない(公式 Q&A: 効果で使えるようになったワザは、そのポケモンが持っているワザとして扱わない)。
 */
export function listUsableAttacks(
  state: GameState,
  pokemon: PokemonInPlay
): UsableAttack[] {
  const own =
    pokemon.card.record.category === CardCategory.Pokemon
      ? pokemon.card.record.attacks.map((attack) => ({
          attack,
          owner: pokemon,
        }))
      : [];
  const allowsBenchAttacks = listEffectsApplyingTo(state, pokemon).some(
    (collected) =>
      collected.effect.change.change === "allowBenchedPokemonAttacks"
  );
  if (!allowsBenchAttacks) {
    return own;
  }
  const fromBench = state.bench
    .filter((benched) => benched !== pokemon)
    .flatMap((benched) =>
      benched.card.record.category === CardCategory.Pokemon
        ? benched.card.record.attacks.map((attack) => ({
            attack,
            owner: benched,
          }))
        : []
    );
  return [...own, ...fromBench];
}
