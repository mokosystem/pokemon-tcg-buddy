/**
 * 記録をそろえたデッキ(Issue 22 の 4 デッキと、規則ファイルの無い開発責任者の 2 デッキ)を、カードの記録だけで
 * 組み立てて回す。使えるカードと特性を片端から使う手順で、翻訳した効果が基本ルールに反さずに最後まで動くかを
 * 確かめる(効果の中の選択は候補の先頭から選ぶ)。
 */

import { describe, expect, test } from "bun:test";
import {
  attachEnergyFromHandToPokemon,
  canEvolvePokemonFromHand,
  canPlayTrainerFromHand,
  canUseAbility,
  canUseAbilityFromHand,
  canUseStadiumEffect,
  evolvePokemonFromHand,
  listUsableAttacksOfActive,
  placeBasicPokemonOnBenchFromHand,
  playTrainerFromHand,
  useAbility,
  useAbilityFromHand,
  useStadiumEffect,
} from "./card-effects.ts";
import { CardCategory } from "./card-record-schema.ts";
import { cardRecordTable } from "./card-record-table.ts";
import { type Card, isBasicPokemon, isEnergy } from "./cards.ts";
import { countEmptyBenchSlots } from "./continuous-effects.ts";
import { DECKS_WITHOUT_RULE_FILES } from "./decks-without-rule-files.ts";
import type { EffectContext } from "./effect-choices.ts";
import { buildDeck, type PlayingPolicy, runGame } from "./engine.ts";
import { ISSUE22_DECKS } from "./issue22-decks.ts";
import { createSeededRandom } from "./random.ts";
import { firstCandidateChoices } from "./sample-cards.ts";

function listAbilityNames(card: Card): string[] {
  return card.record.category === CardCategory.Pokemon
    ? card.record.abilities.map((ability) => ability.name)
    : [];
}

/** 手札のカード 1 枚で今できる行動を 1 つ行い、行ったかを返す。 */
function playCardFromHand(context: EffectContext, card: Card): boolean {
  const { state } = context;
  if (canPlayTrainerFromHand(context, card)) {
    playTrainerFromHand(context, card);
    return true;
  }
  if (isBasicPokemon(card) && countEmptyBenchSlots(state) > 0) {
    placeBasicPokemonOnBenchFromHand(context, card);
    return true;
  }
  const abilityName = listAbilityNames(card).find((name) =>
    canUseAbilityFromHand(context, card, name)
  );
  if (abilityName !== undefined) {
    useAbilityFromHand(context, card, abilityName);
    return true;
  }
  const target = state
    .listPokemonInPlay()
    .find((pokemon) => canEvolvePokemonFromHand(context, pokemon, card));
  if (target !== undefined) {
    evolvePokemonFromHand(context, target, card);
    return true;
  }
  if (isEnergy(card) && !state.hasAttachedEnergy && state.active !== null) {
    attachEnergyFromHandToPokemon(context, card, state.active);
    return true;
  }
  return false;
}

/** 場のポケモンの特性か、スタジアムの効果で今使えるものを 1 つ使い、使ったかを返す。 */
function useAbilityOrStadiumEffect(context: EffectContext): boolean {
  for (const pokemon of context.state.listPokemonInPlay()) {
    const abilityName = listAbilityNames(pokemon.card).find((name) =>
      canUseAbility(context, pokemon, name)
    );
    if (abilityName !== undefined) {
      useAbility(context, pokemon, abilityName);
      return true;
    }
  }
  if (canUseStadiumEffect(context)) {
    useStadiumEffect(context);
    return true;
  }
  return false;
}

function doFirstAvailableAction(context: EffectContext): boolean {
  return (
    [...context.state.hand].some((card) => playCardFromHand(context, card)) ||
    useAbilityOrStadiumEffect(context)
  );
}

const MAX_ACTIONS_PER_TURN = 200;

const greedyPolicy: PlayingPolicy = {
  ...firstCandidateChoices,
  chooseActiveAtSetup: ([first]) => {
    if (first === undefined) {
      throw new Error("たねポケモンが無い");
    }
    return first;
  },
  chooseAttack: (context) => listUsableAttacksOfActive(context)[0] ?? null,
  chooseBenchAtSetup: (basics) => basics,
  playTurn: (context) => {
    for (let count = 0; count < MAX_ACTIONS_PER_TURN; count += 1) {
      if (!doFirstAvailableAction(context)) {
        return;
      }
    }
    throw new Error("1 つの番の行動が多すぎる(同じ行動を繰り返している)");
  },
};

describe("記録をそろえたデッキ", () => {
  for (const deck of [...ISSUE22_DECKS, ...DECKS_WITHOUT_RULE_FILES]) {
    test(`${deck.name}: 60 枚すべてをカードの記録から組み立てられる`, () => {
      expect(buildDeck(cardRecordTable, deck.decklist)).toHaveLength(60);
    });

    test(`${deck.name}: 使えるカードを片端から使う手順で、先攻・後攻とも 100 回ずつ 3 番目の番まで回せる`, () => {
      const cards = buildDeck(cardRecordTable, deck.decklist);
      const random = createSeededRandom(20_260_923);
      for (const wentFirst of [true, false]) {
        for (let game = 0; game < 100; game += 1) {
          const result = runGame({
            cards,
            goals: [],
            maxTurn: 3,
            policy: greedyPolicy,
            random,
            wentFirst,
          });
          expect(result.events.at(-1)).toStartWith("[3] ");
        }
      }
    });
  }
});
