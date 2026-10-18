/**
 * 道の揃い具合を見る評価(search-evaluators.ts)が使う、山札から持ってくる効果の読み取り。手札と場のカードの記録の
 * 効果の翻訳から、山札のカードを手札か場に持ってくる操作の条件を集め、見えていないカード(山札とサイド)のうち、
 * その条件で持ってこられるものを記録の単位で出す。
 */

import {
  CardCategory,
  type CardFilter,
  type CardRecord,
  type EffectStep,
} from "./card-record-schema.ts";
import { type Card, matchesCardFilter } from "./cards.ts";
import type { GameState } from "./state.ts";

/** 見えていないカード(山札とサイド)の、記録ごとの枚数と代表の 1 枚。 */
export type UnseenCards = ReadonlyMap<
  CardRecord,
  { card: Card; count: number }
>;

/** 効果の操作のうち、山札のカードを手札か場に持ってくるものの条件。条件の分かれ道とコインの中の操作も含める。 */
function listDeckFetchFilters(steps: readonly EffectStep[]): CardFilter[] {
  return steps.flatMap((step): CardFilter[] => {
    switch (step.operation) {
      case "searchDeckIntoHand":
      case "searchDeckIntoHandFromOneOfPicks":
        return step.picks.map((pick) => pick.filter);
      case "searchDeckOntoBench":
      case "searchDeckIntoHandAndAttachRest":
      case "lookAtDeckTopAndTakeIntoHand":
        return [step.filter];
      case "branchOnCondition":
        return listDeckFetchFilters([
          ...step.stepsWhenMet,
          ...step.stepsOtherwise,
        ]);
      case "branchOnCoinFlip":
        return listDeckFetchFilters(step.stepsWhenHeads);
      default:
        return [];
    }
  });
}

/** カードの置き場所ごとに、使えば山札から持ってこられるカードの条件。 */
interface FetchFilters {
  /** 手札にあるとき(グッズ・サポートを使う、スタジアムを出して効果を使う、ベンチに出す・進化させる・手札の特性、エネルギーをつける)。 */
  readonly inHand: readonly CardFilter[];
  /** 場にあるとき(場のポケモンの特性、場のスタジアムの効果)。 */
  readonly inPlay: readonly CardFilter[];
}

const fetchFiltersByRecord = new WeakMap<CardRecord, FetchFilters>();

function filtersOf(
  effects: readonly { readonly steps: readonly EffectStep[] }[]
) {
  return effects.flatMap((effect) => listDeckFetchFilters(effect.steps));
}

function listFetchFiltersOf(record: CardRecord): FetchFilters {
  const cached = fetchFiltersByRecord.get(record);
  if (cached !== undefined) {
    return cached;
  }
  let filters: FetchFilters;
  if (record.category === CardCategory.Pokemon) {
    const translations = record.abilities.flatMap((ability) =>
      ability.translation === undefined ? [] : [ability.translation]
    );
    const effectsOf = (kinds: readonly string[]) =>
      translations.flatMap((translation) =>
        "effect" in translation && kinds.includes(translation.kind)
          ? [translation.effect]
          : []
      );
    filters = {
      inHand: filtersOf(
        effectsOf([
          "activatedFromHand",
          "triggeredWhenPlacedOnBenchFromHand",
          "triggeredWhenEvolvedFromHand",
        ])
      ),
      inPlay: filtersOf(effectsOf(["activatedInPlay"])),
    };
  } else {
    const cardEffects = "cardEffects" in record ? record.cardEffects : [];
    const all = filtersOf(
      cardEffects.flatMap((cardEffect) =>
        "effect" in cardEffect ? [cardEffect.effect] : []
      )
    );
    const inPlay = filtersOf(
      cardEffects.flatMap((cardEffect) =>
        cardEffect.kind === "activatedOncePerTurn" ? [cardEffect.effect] : []
      )
    );
    filters = { inHand: all, inPlay };
  }
  fetchFiltersByRecord.set(record, filters);
  return filters;
}

/** 見えていないカード(山札とサイド)の、記録ごとの枚数と代表の 1 枚。 */
export function countUnseenByRecord(
  state: GameState
): Map<CardRecord, { card: Card; count: number }> {
  const counts = new Map<CardRecord, { card: Card; count: number }>();
  for (const card of [...state.deck, ...state.prizes]) {
    const entry = counts.get(card.record);
    if (entry === undefined) {
      counts.set(card.record, { card, count: 1 });
    } else {
      entry.count += 1;
    }
  }
  return counts;
}

/**
 * 見えていないカードのうち、手札と場のカードの効果で山札から持ってこられる記録。1 段で持ってこられるものと、
 * 1 段で持ってこられるカードの効果でさらに持ってこられるもの(2 段)に分ける。
 */
export function findSearchableRecords(
  state: GameState,
  unseen: UnseenCards
): { oneStep: Set<CardRecord>; twoSteps: Set<CardRecord> } {
  const inPlay = [
    ...(state.stadium === undefined ? [] : [state.stadium]),
    ...state.listPokemonInPlay().map((pokemon) => pokemon.card),
  ];
  const reachableBy = (filters: readonly CardFilter[]): Set<CardRecord> => {
    const reached = new Set<CardRecord>();
    for (const [record, { card }] of unseen) {
      if (filters.some((filter) => matchesCardFilter(card, filter))) {
        reached.add(record);
      }
    }
    return reached;
  };
  const oneStep = reachableBy([
    ...state.hand.flatMap((card) => listFetchFiltersOf(card.record).inHand),
    ...inPlay.flatMap((card) => listFetchFiltersOf(card.record).inPlay),
  ]);
  // 1 段で持ってきたカードは手札か場(ベンチ)に来る。手札に来たものとして、手札から使う効果を見る
  const twoSteps = reachableBy(
    [...oneStep].flatMap((record) => listFetchFiltersOf(record).inHand)
  );
  return { oneStep, twoSteps };
}
