/**
 * 効果の記法の「条件」を場の状態に当てて判定する。状態は変えない。
 */

import type { Condition, PokemonInPlayFilter } from "./card-record-schema.ts";
import { type Card, matchesCardFilter } from "./cards.ts";
import type { GameState, PokemonInPlay } from "./state.ts";

/** 効果の持ち主。card はその効果を持つカード、pokemon は「このポケモン」(特性・ワザ)か、どうぐ・エネルギーをつけているポケモン。 */
export interface EffectSource {
  readonly card: Card;
  readonly pokemon: PokemonInPlay | null;
}

export function matchesPokemonFilter(
  state: GameState,
  pokemon: PokemonInPlay,
  filter: PokemonInPlayFilter
): boolean {
  const position = pokemon === state.active ? "active" : "bench";
  return (
    (filter.positions === undefined || filter.positions.includes(position)) &&
    matchesCardFilter(pokemon.card, filter)
  );
}

/** 手札のうち、使おうとしているカード 1 枚を除いた残り。同じカードは同じ参照を枚数分並べているため、参照で 1 枚だけ除く。 */
export function listHandExcludingOneCopy(
  state: GameState,
  card: Card | null
): Card[] {
  const rest = [...state.hand];
  const index = card === null ? -1 : rest.indexOf(card);
  if (index >= 0) {
    rest.splice(index, 1);
  }
  return rest;
}

type ConditionOf<Name extends Condition["condition"]> = Extract<
  Condition,
  { condition: Name }
>;

type ConditionEvaluator<Name extends Condition["condition"]> = (
  condition: ConditionOf<Name>,
  state: GameState,
  source: EffectSource
) => boolean;

/** 条件の部品ごとの判定。記法の部品の一覧と 1 対 1 に対応させる(部品を足すときはここにも 1 行足す)。 */
const conditionEvaluators: {
  readonly [Name in Condition["condition"]]: ConditionEvaluator<Name>;
} = {
  anyOf: (condition, state, source) =>
    condition.conditions.some((inner) => isConditionMet(inner, state, source)),
  attachedPokemonMatches: (condition, state, source) =>
    source.pokemon !== null &&
    matchesPokemonFilter(state, source.pokemon, condition.filter),
  deckHasCards: (condition, state) => state.deck.length >= condition.minCount,
  handHasCards: (condition, state, source) =>
    listHandExcludingOneCopy(state, source.card).filter(
      (card) =>
        condition.filter === undefined ||
        matchesCardFilter(card, condition.filter)
    ).length >= condition.minCountExcludingThisCard,
  noAbilityUsedThisTurnWithNameIncluding: (condition, state) =>
    !state.abilityNamesUsedThisTurn.some((name) =>
      name.includes(condition.text)
    ),
  ownPokemonInPlayExists: (condition, state) =>
    state
      .listPokemonInPlay()
      .some((pokemon) =>
        matchesPokemonFilter(state, pokemon, condition.filter)
      ),
  ownRemainingPrizesAre: (condition, state) =>
    state.prizes.length === condition.count,
  selfHasNoEnergyAttached: (_, __, source) =>
    source.pokemon !== null && source.pokemon.energies.length === 0,
  selfIsActive: (_, state, source) =>
    source.pokemon !== null && source.pokemon === state.active,
};

function isConditionMet<Name extends Condition["condition"]>(
  condition: ConditionOf<Name>,
  state: GameState,
  source: EffectSource
): boolean {
  const evaluate: ConditionEvaluator<Name> =
    conditionEvaluators[condition.condition];
  return evaluate(condition, state, source);
}

export function areConditionsMet(
  state: GameState,
  conditions: readonly Condition[],
  source: EffectSource
): boolean {
  return conditions.every((condition) =>
    isConditionMet(condition, state, source)
  );
}
