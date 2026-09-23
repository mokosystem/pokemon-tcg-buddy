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
  type PokemonType,
} from "./card-record-schema.ts";

export interface Card {
  readonly basicPokemonOfEvolutionLine: string | null;
  readonly cardId: string;
  readonly category: CardCategory;
  readonly evolvesFrom: string | null;
  readonly exRule: ExRule | null;
  readonly hasRuleBox: boolean;
  readonly hp: number;
  readonly isTerastal: boolean;
  readonly name: string;
  readonly pokemonType: PokemonType | null;
  /** エネルギーが場で供給するもの。場にある間ずっと働く効果で変わることがある(continuous-effects.ts)。 */
  readonly provision: EnergyProvision | null;
  readonly record: CardRecord;
  readonly retreatCost: number;
  readonly stage: EvolutionStage | null;
}

/** 記録と、デッキに入っている印刷のカード ID から、対戦で使うカードを作る。 */
export function buildCardFromRecord(record: CardRecord, cardId: string): Card {
  const common = {
    basicPokemonOfEvolutionLine: null,
    cardId,
    category: record.category,
    evolvesFrom: null,
    exRule: null,
    hasRuleBox: false,
    hp: 0,
    isTerastal: false,
    name: record.name,
    pokemonType: null,
    provision: null,
    record,
    retreatCost: 0,
    stage: null,
  } satisfies Card;
  switch (record.category) {
    case CardCategory.Pokemon:
      return {
        ...common,
        basicPokemonOfEvolutionLine: record.basicPokemonOfEvolutionLine,
        evolvesFrom: record.evolvesFrom,
        exRule: record.exRule,
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
  if (card.provision === null) {
    return [];
  }
  return card.provision.kind === "anyType" ? "any" : [card.provision.type];
}

function includesIfListed<T>(
  allowed: readonly T[] | undefined,
  value: T | null
): boolean {
  return allowed === undefined || (value !== null && allowed.includes(value));
}

/** カードを選ぶ条件(CardFilter)に合うか。書かれた欄はすべて満たし、欄の中の並びはどれか 1 つでよい。 */
export function matchesCardFilter(card: Card, filter: CardFilter): boolean {
  if (filter.providedEnergyTypes !== undefined) {
    const provided = listBaseProvidedTypes(card);
    const wanted = filter.providedEnergyTypes;
    if (provided !== "any" && !provided.some((type) => wanted.includes(type))) {
      return false;
    }
  }
  return (
    includesIfListed(filter.categories, card.category) &&
    includesIfListed(filter.stages, card.stage) &&
    includesIfListed(filter.names, card.name) &&
    includesIfListed(filter.pokemonTypes, card.pokemonType) &&
    includesIfListed(filter.exRules, card.exRule) &&
    (filter.maxHp === undefined ||
      (isPokemon(card) && card.hp <= filter.maxHp)) &&
    !(filter.excludesPokemonWithRuleBox === true && card.hasRuleBox)
  );
}
