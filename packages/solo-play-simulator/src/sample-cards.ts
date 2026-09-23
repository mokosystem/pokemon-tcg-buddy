/**
 * テストで使う小さなカードの記録と、効果の中の選択。実在のカードではなく、たね → 1進化 → 2進化の
 * 1 本の線とトレーナーズ 3 種、基本エネルギー 1 種だけを持つ。カード ID は実在のカードと重ならない 9 から始まる番号。
 */

import {
  CARD_RECORD_SCHEMA_REFERENCE,
  CardCategory,
  type CardRecord,
  EvolutionStage,
  type PokemonRecord,
} from "./card-record-schema.ts";
import { buildCardFromRecord, type Card } from "./cards.ts";
import type { CardChoiceRequest, EffectChoices } from "./effect-choices.ts";
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
    ...attributes,
    abilities: [],
    attacks: [
      {
        cost: ["psychic"],
        damage: { amount: 10, kind: "fixed" },
        name: "ワザ",
      },
    ],
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

/** 山札を切らないテスト用。乱数の値は使われない。 */
export const neverShuffled: RandomSource = { nextFloat: () => 0 };

/** タイプの違うエネルギーを選ぶ求め(アカマツ)では、同じタイプの 2 枚目以降を候補から外す。 */
function listCandidatesToChoose(request: CardChoiceRequest): readonly Card[] {
  if (!request.mustHaveDistinctTypes) {
    return request.candidates;
  }
  const seenTypes = new Set<string>();
  return request.candidates.filter((card) => {
    const type = card.provision?.kind === "type" ? card.provision.type : "any";
    if (seenTypes.has(type)) {
      return false;
    }
    seenTypes.add(type);
    return true;
  });
}

/** 候補の先頭から選べるだけ選び、「のぞむなら」の効果は必ず起こす。 */
export const firstCandidateChoices: EffectChoices = {
  chooseCards: (_state, request) =>
    listCandidatesToChoose(request).slice(0, request.maxCount),
  choosePokemon: (_state, request) =>
    request.candidates.slice(0, request.maxCount),
  choosesToApplyOptionalEffect: () => true,
};
