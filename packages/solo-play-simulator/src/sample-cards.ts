/**
 * テストで使う小さなカード表。実在のカードではなく、たね → 1 進化 → 2 進化の 1 本の線と
 * トレーナーズ 3 種、基本エネルギー 1 種だけを持つ。
 */

import {
  defineBasicEnergyCard,
  defineGoodsCard,
  definePokemonCard,
  defineStadiumCard,
  defineSupporterCard,
  EvolutionStage,
} from "./cards.ts";
import type { RandomSource } from "./state.ts";

export const BASIC = definePokemonCard({
  cardId: "1",
  hp: 60,
  name: "たね",
  pokemonType: "psychic",
  retreatCost: 1,
  stage: EvolutionStage.Basic,
});
export const STAGE1 = definePokemonCard({
  cardId: "2",
  evolvesFrom: "たね",
  hp: 90,
  name: "1進化",
  pokemonType: "psychic",
  stage: EvolutionStage.Stage1,
});
export const STAGE2 = definePokemonCard({
  cardId: "3",
  evolvesFrom: "1進化",
  hasRuleBox: true,
  hp: 300,
  name: "2進化",
  pokemonType: "psychic",
  stage: EvolutionStage.Stage2,
});
export const ENERGY = defineBasicEnergyCard("基本超エネルギー", "4", "psychic");
export const SUPPORTER = defineSupporterCard("サポート", "5");
export const GOODS = defineGoodsCard("グッズ", "6");
export const STADIUM = defineStadiumCard("スタジアム", "7");

export const SAMPLE_CARD_TABLE = new Map(
  [BASIC, STAGE1, STAGE2, ENERGY, SUPPORTER, GOODS, STADIUM].map((card) => [
    card.name,
    card,
  ])
);

/** 山札を切らないテスト用。乱数の値は使われない。 */
export const neverShuffled: RandomSource = { nextFloat: () => 0 };
