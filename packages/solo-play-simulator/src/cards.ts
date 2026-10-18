/**
 * 対戦で使う 1 枚のカード。カードの記録(card-record-schema.ts)から作る。
 *
 * カードテキストそのものは持たない。骨組みの判定がよく使う属性を記録から写して持ち、
 * 効果の翻訳は record から引く。同じカードは同じ参照を枚数分並べて表す。
 */

import {
  CardCategory,
  type CardFilter,
  type CardRecord,
  type EnergyProvision,
  EvolutionStage,
  type ExRule,
  type PokemonRecord,
  type PokemonType,
} from "./card-record-schema.ts";
import { findOrCreate } from "./find-or-create.ts";

export interface Card {
  readonly basicPokemonOfEvolutionLine?: string;
  readonly cardId: string;
  readonly category: CardCategory;
  readonly evolvesFrom?: string;
  readonly exRule?: ExRule;
  readonly hasRuleBox: boolean;
  readonly hp: number;
  readonly isTerastal: boolean;
  readonly name: string;
  readonly pokemonType?: PokemonType;
  /** エネルギーが場で供給するもの。場にある間ずっと働く効果で変わることがある(continuous-effects.ts)。 */
  readonly provision?: EnergyProvision;
  readonly record: CardRecord;
  readonly retreatCost: number;
  readonly stage?: EvolutionStage;
}

/** 進化前の名前と進化の系統のたねポケモンの名前。記録の進化の段階が持つものだけを返す。 */
function extractEvolution(
  record: PokemonRecord
): Pick<Card, "basicPokemonOfEvolutionLine" | "evolvesFrom"> {
  switch (record.stage) {
    case EvolutionStage.Stage2:
      return {
        basicPokemonOfEvolutionLine: record.basicPokemonOfEvolutionLine,
        evolvesFrom: record.evolvesFrom,
      };
    case EvolutionStage.Stage1:
      return { evolvesFrom: record.evolvesFrom };
    default:
      return {};
  }
}

/** 記録と、デッキに入っている印刷のカード ID から、対戦で使うカードを作る。 */
export function buildCardFromRecord(record: CardRecord, cardId: string): Card {
  const common = {
    cardId,
    category: record.category,
    hasRuleBox: false,
    hp: 0,
    isTerastal: false,
    name: record.name,
    record,
    retreatCost: 0,
  } satisfies Card;
  switch (record.category) {
    case CardCategory.Pokemon:
      return {
        ...common,
        ...extractEvolution(record),
        ...(record.exRule === undefined ? {} : { exRule: record.exRule }),
        hasRuleBox: record.hasRuleBox,
        hp: record.hp,
        isTerastal: record.isTerastal,
        pokemonType: record.pokemonType,
        retreatCost: record.retreatCost,
        stage: record.stage,
      };
    case CardCategory.BasicEnergy:
    case CardCategory.SpecialEnergy:
      return { ...common, provision: record.provision };
    default:
      return common;
  }
}

export function isPokemon(card: Card): boolean {
  return card.category === CardCategory.Pokemon;
}

export function isBasicPokemon(card: Card): boolean {
  return isPokemon(card) && card.stage === EvolutionStage.Basic;
}

export function isEnergy(card: Card): boolean {
  return (
    card.category === CardCategory.BasicEnergy ||
    card.category === CardCategory.SpecialEnergy
  );
}

export function isSupporter(card: Card): boolean {
  return card.category === CardCategory.Supporter;
}

/** エネルギーの記録にある供給のタイプ。場にある間ずっと働く効果による変化は含めない。 */
function listBaseProvidedTypes(card: Card): readonly PokemonType[] | "any" {
  if (card.provision === undefined) {
    return [];
  }
  return card.provision.kind === "anyType" ? "any" : [card.provision.type];
}

function includesIfListed<T>(
  allowed: readonly T[] | undefined,
  value: T | undefined
): boolean {
  return (
    allowed === undefined || (value !== undefined && allowed.includes(value))
  );
}

function providesListedType(card: Card, filter: CardFilter): boolean {
  if (filter.providedEnergyTypes === undefined) {
    return true;
  }
  const provided = listBaseProvidedTypes(card);
  const wanted = filter.providedEnergyTypes;
  return provided === "any" || provided.some((type) => wanted.includes(type));
}

/**
 * 条件ごと・記録ごとの、条件に合うかの結果。条件が見る属性はどれも記録から写したもの(buildCardFromRecord。カード ID は
 * 見ない)で、同じ記録のカードは結果が同じなので、記録の単位で覚える。探索は同じ山札や手札から何度も候補を出すため、
 * 比べ直さない。
 */
const filterMatchesByRecord = new WeakMap<
  CardFilter,
  WeakMap<CardRecord, boolean>
>();

function createRecordMatches(): WeakMap<CardRecord, boolean> {
  return new WeakMap();
}

/** カードを選ぶ条件(CardFilter)に合うか。書かれた欄はすべて満たし、欄の中の並びと anyOf はどれか 1 つでよい。 */
export function matchesCardFilter(card: Card, filter: CardFilter): boolean {
  const byRecord = findOrCreate(
    filterMatchesByRecord,
    filter,
    createRecordMatches
  );
  // 記録ごとの結果は findOrCreate を使わずに引く。探索でいちばん多く呼ばれる所で、card と filter を閉じ込めた関数を
  // 呼ぶたびに作ると、所要時間の計測(measure:search-time path-progress 1500)が 53.1 秒から 56 秒台に延びたため
  const found = byRecord.get(card.record);
  if (found !== undefined) {
    return found;
  }
  const matched = evaluateCardFilter(card, filter);
  byRecord.set(card.record, matched);
  return matched;
}

function evaluateCardFilter(card: Card, filter: CardFilter): boolean {
  return (
    matchesListedAttributes(card, filter) &&
    matchesUnlistedAttributes(card, filter) &&
    !isExcludedByFilter(card, filter) &&
    (filter.anyOf === undefined ||
      filter.anyOf.some((inner) => matchesCardFilter(card, inner)))
  );
}

/** 条件のうち、並びで書く欄(供給するタイプ、カードの種類、進化の段階、名前、タイプ、ex のルール)をすべて満たすか。 */
function matchesListedAttributes(card: Card, filter: CardFilter): boolean {
  return (
    providesListedType(card, filter) &&
    includesIfListed(filter.categories, card.category) &&
    includesIfListed(filter.stages, card.stage) &&
    includesIfListed(filter.names, card.name) &&
    includesIfListed(filter.pokemonTypes, card.pokemonType) &&
    includesIfListed(filter.exRules, card.exRule)
  );
}

/** 条件のうち、並びで書かない欄(名前に含む文字、テラスタル、HP の上限)をすべて満たすか。 */
function matchesUnlistedAttributes(card: Card, filter: CardFilter): boolean {
  return (
    (filter.nameIncludes === undefined ||
      card.name.includes(filter.nameIncludes)) &&
    (filter.isTerastal === undefined || card.isTerastal) &&
    (filter.maxHp === undefined || (isPokemon(card) && card.hp <= filter.maxHp))
  );
}

/** 条件の除く欄(ルールを持つポケモン、名前)に当たるか。 */
function isExcludedByFilter(card: Card, filter: CardFilter): boolean {
  return (
    (filter.excludesPokemonWithRuleBox === true && card.hasRuleBox) ||
    (filter.excludesNames?.includes(card.name) ?? false)
  );
}

/** 同じ記録のカードの枚数と、そのうち最初に数えた 1 枚(代表)。 */
export interface CardsOfRecord {
  readonly card: Card;
  readonly count: number;
}

/** zones のカードを並びの順に数えた、記録ごとの枚数と代表の 1 枚(記録は最初に出てきた順に並ぶ)。 */
export function countCardsByRecord(
  ...zones: readonly (readonly Card[])[]
): Map<CardRecord, CardsOfRecord> {
  const counts = new Map<CardRecord, { card: Card; count: number }>();
  for (const zone of zones) {
    for (const card of zone) {
      const entry = counts.get(card.record);
      if (entry === undefined) {
        counts.set(card.record, { card, count: 1 });
      } else {
        entry.count += 1;
      }
    }
  }
  return counts;
}
