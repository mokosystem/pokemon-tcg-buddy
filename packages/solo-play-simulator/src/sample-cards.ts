/**
 * テストで使う小さなカードの記録と、効果の中の選択。実在のカードではなく、たね → 1進化 → 2進化の
 * 1 本の線とトレーナーズ 3 種、基本エネルギー 1 種、対戦風の一人回しのテストに使うたねポケモン 2 種だけを持つ。
 * カード ID は実在のカードと重ならない 9 から始まる番号。
 */

import {
  CARD_RECORD_SCHEMA_REFERENCE,
  CardCategory,
  type CardRecord,
  EvolutionStage,
  type PokemonRecord,
} from "./card-record-schema.ts";
import { buildCardFromRecord } from "./cards.ts";
import type { CardRecordTable } from "./engine.ts";
import type { RandomSource } from "./state.ts";

const commonEntries: Pick<
  CardRecord,
  "$schema" | "excludedEffects" | "rulings" | "verifiedOn"
> = {
  $schema: CARD_RECORD_SCHEMA_REFERENCE,
  excludedEffects: [],
  rulings: [],
  verifiedOn: "2026-09-23",
};

type SamplePokemonAttributes = Pick<
  PokemonRecord,
  "hasRuleBox" | "hp" | "retreatCost"
> &
  Partial<Pick<PokemonRecord, "attacks" | "exRule">> &
  (
    | { stage: typeof EvolutionStage.Basic }
    | { evolvesFrom: string; stage: typeof EvolutionStage.Stage1 }
    | {
        basicPokemonOfEvolutionLine: string;
        evolvesFrom: string;
        stage: typeof EvolutionStage.Stage2;
      }
  );

function definePokemonRecord(
  cardId: string,
  name: string,
  attributes: SamplePokemonAttributes
): CardRecord {
  return {
    ...commonEntries,
    abilities: [],
    attacks: [
      {
        cost: ["psychic"],
        damage: { amount: 10, kind: "fixed" },
        name: "ワザ",
      },
    ],
    ...attributes,
    cardIds: [cardId],
    category: CardCategory.Pokemon,
    isTerastal: false,
    name,
    pokemonType: "psychic",
    translationStatus: "irrelevantToCalculation",
  };
}

function defineTrainerRecord(
  cardId: string,
  name: string,
  category:
    | typeof CardCategory.Goods
    | typeof CardCategory.Supporter
    | typeof CardCategory.Stadium
): CardRecord {
  return {
    ...commonEntries,
    cardEffects: [],
    cardIds: [cardId],
    category,
    name,
    translationStatus: "irrelevantToCalculation",
  };
}

const SAMPLE_RECORDS: readonly CardRecord[] = [
  definePokemonRecord("900001", "たね", {
    hasRuleBox: false,
    hp: 60,
    retreatCost: 1,
    stage: EvolutionStage.Basic,
  }),
  definePokemonRecord("900002", "1進化", {
    evolvesFrom: "たね",
    hasRuleBox: false,
    hp: 90,
    retreatCost: 0,
    stage: EvolutionStage.Stage1,
  }),
  definePokemonRecord("900003", "2進化", {
    basicPokemonOfEvolutionLine: "たね",
    evolvesFrom: "1進化",
    hasRuleBox: true,
    hp: 300,
    retreatCost: 0,
    stage: EvolutionStage.Stage2,
  }),
  {
    ...commonEntries,
    cardIds: ["900004"],
    category: CardCategory.BasicEnergy,
    name: "基本超エネルギー",
    provision: { kind: "type", type: "psychic", units: 1 },
    translationStatus: "translated",
  },
  defineTrainerRecord("900005", "サポート", CardCategory.Supporter),
  defineTrainerRecord("900006", "グッズ", CardCategory.Goods),
  defineTrainerRecord("900007", "スタジアム", CardCategory.Stadium),
  // 相手の攻撃を何度受けてもきぜつしない(4 回目以降の 300 を 66 回受けても HP に届かない)たね。ワザは必要な
  // エネルギーが無く 300 ダメージで、使えば 1 回で相手の場のダメージからサイドを 3 枚取れる
  definePokemonRecord("900008", "HPの高いたね", {
    attacks: [
      { cost: [], damage: { amount: 300, kind: "fixed" }, name: "大きなワザ" },
    ],
    hasRuleBox: false,
    hp: 20_000,
    retreatCost: 1,
    stage: EvolutionStage.Basic,
  }),
  // きぜつすると相手がサイドを 3 枚取るたね(HP 60 で、相手の 2 回目の番の 100 できぜつする)
  definePokemonRecord("900009", "メガシンカexのたね", {
    exRule: "megaEvolutionEx",
    hasRuleBox: true,
    hp: 60,
    retreatCost: 1,
    stage: EvolutionStage.Basic,
  }),
];

export const SAMPLE_RECORD_TABLE: CardRecordTable = new Map(
  SAMPLE_RECORDS.map((record) => [record.cardIds[0] ?? "", record])
);

function buildSampleCard(cardId: string) {
  const record = SAMPLE_RECORD_TABLE.get(cardId);
  if (record === undefined) {
    throw new Error(`テスト用の記録に ${cardId} が無い`);
  }
  return buildCardFromRecord(record, cardId);
}

export const BASIC = buildSampleCard("900001");
export const STAGE1 = buildSampleCard("900002");
export const STAGE2 = buildSampleCard("900003");
export const ENERGY = buildSampleCard("900004");
export const SUPPORTER = buildSampleCard("900005");
export const GOODS = buildSampleCard("900006");
export const STADIUM = buildSampleCard("900007");
export const STURDY_BASIC = buildSampleCard("900008");
export const FRAGILE_MEGA_BASIC = buildSampleCard("900009");

/** 山札を切らないテスト用。乱数の値は使われない。 */
export const neverShuffled: RandomSource = { nextFloat: () => 0 };
