/**
 * カードの種別と、計算に使う属性。
 *
 * カードテキストそのものは持たない。公式のカード詳細ページで確認した事実を、
 * 計算に必要な属性だけに落として書く。
 */

export const CardCategory = {
  BasicEnergy: "基本エネルギー",
  Goods: "グッズ",
  Pokemon: "ポケモン",
  SpecialEnergy: "特殊エネルギー",
  Stadium: "スタジアム",
  Supporter: "サポート",
  Tool: "ポケモンのどうぐ",
} as const;

export type CardCategory = (typeof CardCategory)[keyof typeof CardCategory];

export const EvolutionStage = {
  Basic: "たね",
  Stage1: "1進化",
  Stage2: "2進化",
} as const;

export type EvolutionStage =
  (typeof EvolutionStage)[keyof typeof EvolutionStage];

export interface Card {
  readonly cardId: string;
  readonly category: CardCategory;
  readonly evolvesFrom: string;
  readonly hasRuleBox: boolean;
  readonly hp: number;
  readonly name: string;
  readonly pokemonType: string;
  /** エネルギーカードが供給するタイプ。ポケモンやトレーナーズでは空。 */
  readonly provides: readonly string[];
  readonly retreatCost: number;
  readonly stage: EvolutionStage | null;
}

const nonPokemonDefaults = {
  evolvesFrom: "",
  hasRuleBox: false,
  hp: 0,
  pokemonType: "",
  provides: [],
  retreatCost: 0,
  stage: null,
} as const satisfies Omit<Card, "name" | "category" | "cardId">;

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

export interface PokemonCardDefinition {
  cardId: string;
  evolvesFrom?: string;
  hasRuleBox?: boolean;
  hp: number;
  name: string;
  pokemonType: string;
  retreatCost?: number;
  stage: EvolutionStage;
}

export function definePokemonCard(definition: PokemonCardDefinition): Card {
  return {
    cardId: definition.cardId,
    category: CardCategory.Pokemon,
    evolvesFrom: definition.evolvesFrom ?? "",
    hasRuleBox: definition.hasRuleBox ?? false,
    hp: definition.hp,
    name: definition.name,
    pokemonType: definition.pokemonType,
    provides: [],
    retreatCost: definition.retreatCost ?? 0,
    stage: definition.stage,
  };
}

export function defineGoodsCard(name: string, cardId: string): Card {
  return { ...nonPokemonDefaults, cardId, category: CardCategory.Goods, name };
}

export function defineSupporterCard(name: string, cardId: string): Card {
  return {
    ...nonPokemonDefaults,
    cardId,
    category: CardCategory.Supporter,
    name,
  };
}

export function defineStadiumCard(name: string, cardId: string): Card {
  return {
    ...nonPokemonDefaults,
    cardId,
    category: CardCategory.Stadium,
    name,
  };
}

export function defineBasicEnergyCard(
  name: string,
  cardId: string,
  energyType: string
): Card {
  return {
    ...nonPokemonDefaults,
    cardId,
    category: CardCategory.BasicEnergy,
    name,
    provides: [energyType],
  };
}

export function defineSpecialEnergyCard(
  name: string,
  cardId: string,
  provides: readonly string[]
): Card {
  return {
    ...nonPokemonDefaults,
    cardId,
    category: CardCategory.SpecialEnergy,
    name,
    provides,
  };
}
