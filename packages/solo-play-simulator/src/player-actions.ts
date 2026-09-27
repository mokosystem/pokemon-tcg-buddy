/**
 * 今できる行動の一覧(番の中でプレイヤーが選べる行動)と、その実行。何が合法かはルールの側の責任なので、
 * プレイングの判断基準(探索)ではなくここに置く(docs/setup-rate-design.md「探索の形」)。
 *
 * 場のポケモンは listPokemonInPlay の並び(バトル場が先頭)の何番目か、ベンチのポケモンはベンチの何番目かで指す。
 * 探索は状態を複製して同じ行動を試し、複製では場のポケモンの参照が変わるため。カードは同じ参照を枚数分並べて
 * 表しているので、参照のまま指す。
 */

import {
  attachEnergyFromHandToPokemon,
  attachToolFromHand,
  canEvolvePokemonFromHand,
  canPlayTrainerFromHand,
  canUseAbility,
  canUseAbilityFromHand,
  canUseStadiumEffect,
  evolvePokemonFromHand,
  placeBasicPokemonOnBenchFromHand,
  playTrainerFromHand,
  retreatActive,
  useAbility,
  useAbilityFromHand,
  useStadiumEffect,
} from "./card-effects.ts";
import { CardCategory } from "./card-record-schema.ts";
import { type Card, isBasicPokemon, isEnergy } from "./cards.ts";
import {
  calculateRetreatCost,
  countEmptyBenchSlots,
  resolveEnergyProvision,
  toEnergyUnits,
} from "./continuous-effects.ts";
import type { EffectContext } from "./effect-choices.ts";
import type { GameState, PokemonInPlay } from "./state.ts";

export type PlayerAction =
  | { readonly kind: "playTrainer"; readonly card: Card }
  | { readonly kind: "placeOnBench"; readonly card: Card }
  | {
      readonly card: Card;
      readonly kind: "evolve";
      readonly targetIndex: number;
    }
  | {
      readonly card: Card;
      readonly kind: "attachEnergy";
      readonly targetIndex: number;
    }
  | {
      readonly card: Card;
      readonly kind: "attachTool";
      readonly targetIndex: number;
    }
  | {
      readonly abilityName: string;
      readonly kind: "useAbility";
      readonly pokemonIndex: number;
    }
  | {
      readonly abilityName: string;
      readonly card: Card;
      readonly kind: "useAbilityFromHand";
    }
  | { readonly kind: "useStadiumEffect" }
  | {
      readonly benchIndex: number;
      readonly energiesToDiscard: readonly Card[];
      readonly kind: "retreat";
    }
  | { readonly kind: "endTurn" };

type ActionOf<Kind extends PlayerAction["kind"]> = Extract<
  PlayerAction,
  { kind: Kind }
>;

function listAbilityNames(card: Card): string[] {
  return card.record.category === CardCategory.Pokemon
    ? card.record.abilities.map((ability) => ability.name)
    : [];
}

/** 同じ参照のカードを 1 枚にまとめた並び(先に出てきた順)。同じカードで同じ行動を何度も試さないため。 */
function listDistinctCards(cards: readonly Card[]): Card[] {
  return [...new Set(cards)];
}

/** 手札のカード 1 枚で今できる行動(トレーナーズ、ベンチに出す、手札の特性、進化、エネルギー、どうぐ)。 */
function listHandCardActions(
  context: EffectContext,
  card: Card,
  inPlay: readonly PokemonInPlay[]
): PlayerAction[] {
  const { state } = context;
  const actions: PlayerAction[] = [];
  if (canPlayTrainerFromHand(context, card)) {
    actions.push({ card, kind: "playTrainer" });
  }
  if (isBasicPokemon(card) && countEmptyBenchSlots(state) > 0) {
    actions.push({ card, kind: "placeOnBench" });
  }
  for (const abilityName of listAbilityNames(card)) {
    if (canUseAbilityFromHand(context, card, abilityName)) {
      actions.push({ abilityName, card, kind: "useAbilityFromHand" });
    }
  }
  inPlay.forEach((pokemon, targetIndex) => {
    if (canEvolvePokemonFromHand(context, pokemon, card)) {
      actions.push({ card, kind: "evolve", targetIndex });
    }
    if (isEnergy(card) && !state.hasAttachedEnergy) {
      actions.push({ card, kind: "attachEnergy", targetIndex });
    }
    if (card.category === CardCategory.Tool && pokemon.tool === null) {
      actions.push({ card, kind: "attachTool", targetIndex });
    }
  });
  return actions;
}

function countEnergyUnits(
  state: GameState,
  pokemon: PokemonInPlay,
  energies: readonly Card[]
): number {
  return energies.reduce(
    (total, energy) =>
      total +
      toEnergyUnits(resolveEnergyProvision(state, pokemon, energy)).length,
    0
  );
}

/**
 * にげるときにトラッシュできるエネルギーの組(card-effects.ts の retreatActive が認める組: にげるエネルギーの数に足り、
 * どの 1 枚を除いても足りなくなる)。同じ参照のエネルギーは区別しないので、同じ組を 2 度は返さない。
 */
function listRetreatPayments(
  state: GameState,
  active: PokemonInPlay
): Card[][] {
  const cost = calculateRetreatCost(state, active);
  const kinds = listDistinctCards(active.energies);
  const payments: Card[][] = [];
  const extend = (kindIndex: number, chosen: Card[]): void => {
    const kind = kinds[kindIndex];
    if (kind === undefined) {
      const paid = countEnergyUnits(state, active, chosen);
      const isMinimal = chosen.every(
        (energy) => paid - countEnergyUnits(state, active, [energy]) < cost
      );
      if (paid >= cost && isMinimal) {
        payments.push(chosen);
      }
      return;
    }
    const available = active.energies.filter(
      (energy) => energy === kind
    ).length;
    for (let count = 0; count <= available; count += 1) {
      extend(kindIndex + 1, [
        ...chosen,
        ...Array.from({ length: count }, () => kind),
      ]);
    }
  };
  extend(0, []);
  return payments;
}

function listRetreatActions(state: GameState): PlayerAction[] {
  const { active } = state;
  if (active === null || state.hasRetreated || state.bench.length === 0) {
    return [];
  }
  const payments = listRetreatPayments(state, active);
  return state.bench.flatMap((_, benchIndex) =>
    payments.map(
      (energiesToDiscard): PlayerAction => ({
        benchIndex,
        energiesToDiscard,
        kind: "retreat",
      })
    )
  );
}

/**
 * 今できる行動の一覧。最後は必ず「番を終える」(endTurn)。手札の同じカードは 1 枚にまとめ、場のポケモンごと・
 * ベンチのポケモンごとに分ける。
 */
export function listAvailableActions(context: EffectContext): PlayerAction[] {
  const { state } = context;
  const inPlay = state.listPokemonInPlay();
  const actions = listDistinctCards(state.hand).flatMap((card) =>
    listHandCardActions(context, card, inPlay)
  );
  inPlay.forEach((pokemon, pokemonIndex) => {
    for (const abilityName of listAbilityNames(pokemon.card)) {
      if (canUseAbility(context, pokemon, abilityName)) {
        actions.push({ abilityName, kind: "useAbility", pokemonIndex });
      }
    }
  });
  if (canUseStadiumEffect(context)) {
    actions.push({ kind: "useStadiumEffect" });
  }
  actions.push(...listRetreatActions(state), { kind: "endTurn" });
  return actions;
}

function findPokemonInPlay(state: GameState, index: number): PokemonInPlay {
  const pokemon = state.listPokemonInPlay()[index];
  if (pokemon === undefined) {
    throw new Error(`場の ${index} 番目にポケモンがいない`);
  }
  return pokemon;
}

function findBenchPokemon(state: GameState, index: number): PokemonInPlay {
  const pokemon = state.bench[index];
  if (pokemon === undefined) {
    throw new Error(`ベンチの ${index} 番目にポケモンがいない`);
  }
  return pokemon;
}

type ActionRunner<Kind extends PlayerAction["kind"]> = (
  context: EffectContext,
  action: ActionOf<Kind>
) => void;

/** 行動の種類ごとの実行。行動の種類と 1 対 1 に対応させる。 */
const actionRunners: {
  readonly [Kind in PlayerAction["kind"]]: ActionRunner<Kind>;
} = {
  attachEnergy: (context, action) =>
    attachEnergyFromHandToPokemon(
      context,
      action.card,
      findPokemonInPlay(context.state, action.targetIndex)
    ),
  attachTool: (context, action) =>
    attachToolFromHand(
      context,
      action.card,
      findPokemonInPlay(context.state, action.targetIndex)
    ),
  endTurn: () => undefined,
  evolve: (context, action) =>
    evolvePokemonFromHand(
      context,
      findPokemonInPlay(context.state, action.targetIndex),
      action.card
    ),
  placeOnBench: (context, action) => {
    placeBasicPokemonOnBenchFromHand(context, action.card);
  },
  playTrainer: (context, action) => playTrainerFromHand(context, action.card),
  retreat: (context, action) =>
    retreatActive(
      context,
      findBenchPokemon(context.state, action.benchIndex),
      action.energiesToDiscard
    ),
  useAbility: (context, action) =>
    useAbility(
      context,
      findPokemonInPlay(context.state, action.pokemonIndex),
      action.abilityName
    ),
  useAbilityFromHand: (context, action) =>
    useAbilityFromHand(context, action.card, action.abilityName),
  useStadiumEffect: (context) => useStadiumEffect(context),
};

function runAction<Kind extends PlayerAction["kind"]>(
  context: EffectContext,
  action: ActionOf<Kind>
): void {
  const run: ActionRunner<Kind> = actionRunners[action.kind];
  run(context, action);
}

export function performAction(
  context: EffectContext,
  action: PlayerAction
): void {
  runAction(context, action);
}

/** 行動を人が読める短い文にする。テストの失敗の表示と、探索の比べ方を確かめるときに使う。 */
export function describeAction(state: GameState, action: PlayerAction): string {
  const nameAt = (index: number) =>
    state.listPokemonInPlay()[index]?.name ?? `場の ${index} 番目`;
  switch (action.kind) {
    case "playTrainer":
      return `${action.card.name} を使う`;
    case "placeOnBench":
      return `${action.card.name} をベンチに出す`;
    case "evolve":
      return `${nameAt(action.targetIndex)} を ${action.card.name} に進化させる`;
    case "attachEnergy":
    case "attachTool":
      return `${action.card.name} を ${nameAt(action.targetIndex)} につける`;
    case "useAbility":
      return `${nameAt(action.pokemonIndex)} の特性 ${action.abilityName}`;
    case "useAbilityFromHand":
      return `手札の ${action.card.name} の特性 ${action.abilityName}`;
    case "useStadiumEffect":
      return `スタジアム ${state.stadium?.name ?? ""} の効果を使う`;
    case "retreat":
      return `${state.bench[action.benchIndex]?.name ?? ""} ににげる(${action.energiesToDiscard.length} 枚トラッシュ)`;
    default:
      return "番を終える";
  }
}
