/**
 * カードの記録を骨組みで実行するテストの準備。記録の表から実在のカードを作り、小さな場を組む。
 */

import { cardRecordTable } from "./card-record-table.ts";
import { buildCardFromRecord, type Card } from "./cards.ts";
import type {
  CardChoiceRequest,
  EffectChoices,
  EffectContext,
} from "./effect-choices.ts";
import { firstCandidateChoices, neverShuffled } from "./sample-cards.ts";
import { GameState, PokemonInPlay } from "./state.ts";

/** カード ID から、記録の表にあるカードを作る。 */
export function buildRecordedCard(cardId: string): Card {
  const record = cardRecordTable.get(cardId);
  if (record === undefined) {
    throw new Error(`カードの記録に ${cardId} が無い`);
  }
  return buildCardFromRecord(record, cardId);
}

export interface FieldSetup {
  readonly active?: Card;
  readonly bench?: readonly Card[];
  readonly deck?: readonly Card[];
  readonly discard?: readonly Card[];
  readonly hand?: readonly Card[];
  /** 何番目の自分の番か。既定は 2(進化とサポートの制限が外れる番)。 */
  readonly turn?: number;
  readonly wentFirst?: boolean;
}

/** 場を組む。場のポケモンは番 0 に出したものとして置く(この番に進化できる)。 */
export function buildState(setup: FieldSetup): GameState {
  const state = new GameState(
    neverShuffled,
    setup.deck ?? [],
    setup.wentFirst ?? false
  );
  state.hand = [...(setup.hand ?? [])];
  state.discard.push(...(setup.discard ?? []));
  state.prizes.push(
    ...Array.from({ length: 6 }, () => buildRecordedCard("049463"))
  );
  state.turn = setup.turn ?? 2;
  state.active =
    setup.active === undefined ? null : new PokemonInPlay(setup.active, 0);
  state.bench.push(
    ...(setup.bench ?? []).map((card) => new PokemonInPlay(card, 0))
  );
  return state;
}

export function buildContext(
  state: GameState,
  overrides: Partial<EffectChoices> = {}
): EffectContext {
  return { choices: { ...firstCandidateChoices, ...overrides }, state };
}

/** カード名の並びの順に、候補から 1 枚ずつ選ぶ。並びに無い名前は選ばない。 */
export function pickCardsByName(names: readonly string[]) {
  return (_: GameState, request: CardChoiceRequest): Card[] => {
    const remaining = [...request.candidates];
    const chosen: Card[] = [];
    for (const name of names) {
      const index = remaining.findIndex((candidate) => candidate.name === name);
      const card = remaining[index];
      if (card !== undefined && chosen.length < request.maxCount) {
        chosen.push(card);
        remaining.splice(index, 1);
      }
    }
    return chosen;
  };
}

export function activeOf(state: GameState): PokemonInPlay {
  if (state.active === null) {
    throw new Error("バトル場が空");
  }
  return state.active;
}

export function benchAt(state: GameState, index: number): PokemonInPlay {
  const pokemon = state.bench[index];
  if (pokemon === undefined) {
    throw new Error(`ベンチの ${index} 番目にポケモンがいない`);
  }
  return pokemon;
}

export function namesOf(cards: readonly { readonly name: string }[]): string[] {
  return cards.map((card) => card.name);
}
