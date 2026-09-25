/**
 * 効果の記法の基本操作を、骨組みの状態に対して実行する。操作ごとの処理は、記法の部品の一覧と
 * 1 対 1 に対応する表(operationRunners、firstStepTargetChecks)に置く。部品を足すときは、
 * card-record-schema.ts の部品とこの 2 つの表に 1 行ずつ足す(docs/setup-rate-design.md「部品を足す手順」)。
 */

import {
  type AttachCount,
  type BasicOperation,
  CardCategory,
  type CardEffect,
  type CardFilter,
  type DrawCount,
  type Effect,
  type EffectStep,
  EvolutionStage,
  type PokemonInPlayFilter,
} from "./card-record-schema.ts";
import { type Card, isEnergy, isPokemon, matchesCardFilter } from "./cards.ts";
import {
  areConditionsMet,
  type EffectSource,
  listHandExcludingOneCopy,
  matchesPokemonFilter,
} from "./conditions.ts";
import {
  calculateBenchLimit,
  countEmptyBenchSlots,
  isAbilityNegated,
} from "./continuous-effects.ts";
import {
  chooseCards,
  chooseCardsWithin,
  chooseOnePokemon,
  choosePokemonUpTo,
  type EffectContext,
} from "./effect-choices.ts";
import type { CardSource, GameState, PokemonInPlay } from "./state.ts";

// ---- 対象の候補 ----

function listMatching(cards: readonly Card[], filter: CardFilter): Card[] {
  return cards.filter((card) => matchesCardFilter(card, filter));
}

function listMatchingOrAll(
  cards: readonly Card[],
  filter: CardFilter | undefined
): Card[] {
  return filter === undefined ? [...cards] : listMatching(cards, filter);
}

function listOwnPokemonMatching(
  state: GameState,
  filter: PokemonInPlayFilter
): PokemonInPlay[] {
  return state
    .listPokemonInPlay()
    .filter((pokemon) => matchesPokemonFilter(state, pokemon, filter));
}

/**
 * 山札から探すときに選ぶ最小の枚数。条件の付いたカードを探すときは 1 枚も選ばなくてよく
 * (公式 Q&A「テクノレーダー」: 山札から指定のカードを選ぶ場合、1 枚も選ばずに山札を切って終えられる)、
 * 好きなカードを探すときは必ず 1 枚選ぶ(公式 Q&A「ジュペッタ」「カシオペア」)。いずれも 2026-09-23 確認。
 */
function minCountForDeckSearch(filter: CardFilter, available: number): number {
  return Object.keys(filter).length === 0 ? Math.min(1, available) : 0;
}

function listOtherPokemonWithEnergy(
  state: GameState,
  holder: PokemonInPlay | null
): PokemonInPlay[] {
  return state
    .listPokemonInPlay()
    .filter((pokemon) => pokemon !== holder && pokemon.energies.length > 0);
}

function listBenchMatchingOrAll(
  state: GameState,
  filter: CardFilter | undefined
): PokemonInPlay[] {
  return filter === undefined
    ? [...state.bench]
    : state.bench.filter((pokemon) => matchesCardFilter(pokemon.card, filter));
}

function listEvolvableBasics(state: GameState): PokemonInPlay[] {
  return state
    .listPokemonInPlay()
    .filter(
      (pokemon) =>
        pokemon.card.stage === EvolutionStage.Basic &&
        state.canEvolveThisTurn(pokemon)
    );
}

/** 条件に合うエネルギーがついている自分のポケモン。 */
function listPokemonWithEnergyMatching(
  state: GameState,
  filter: CardFilter
): PokemonInPlay[] {
  return state
    .listPokemonInPlay()
    .filter((pokemon) => listMatching(pokemon.energies, filter).length > 0);
}

function listRareCandyPairs(
  state: GameState
): { stage2: Card; target: PokemonInPlay }[] {
  const stage2Cards = state.hand.filter(
    (card) => isPokemon(card) && card.stage === EvolutionStage.Stage2
  );
  return listEvolvableBasics(state).flatMap((target) =>
    stage2Cards
      .filter((card) => card.basicPokemonOfEvolutionLine === target.name)
      .map((stage2) => ({ stage2, target }))
  );
}

// ---- 使えるかの判定 ----

type StepOf<Name extends EffectStep["operation"]> = Extract<
  EffectStep,
  { operation: Name }
>;

interface TargetCheckInput {
  /** 手札から使おうとしているカードを 1 枚除いた手札。 */
  readonly hand: readonly Card[];
  readonly source: EffectSource;
  readonly state: GameState;
}

type TargetCheck<Name extends EffectStep["operation"]> = (
  step: StepOf<Name>,
  input: TargetCheckInput
) => boolean;

function deckHasCards(_: unknown, { state }: TargetCheckInput): boolean {
  return state.deck.length > 0;
}

function alwaysHasTarget(): boolean {
  return true;
}

/** トラッシュに条件に合うエネルギーがあり、つける先の自分のポケモンがいるか。 */
function discardHasEnergyForOwnPokemon(
  step: {
    readonly energyFilter: CardFilter;
    readonly targetFilter: PokemonInPlayFilter;
  },
  { state }: TargetCheckInput
): boolean {
  return (
    listMatching(state.discard, step.energyFilter).some(isEnergy) &&
    listOwnPokemonMatching(state, step.targetFilter).length > 0
  );
}

/**
 * 効果の最初の操作に対象があるか。対象が無いときは、その効果を使えない。公式 Q&A で確かめた例: ベンチに
 * ポケモンがいないときポケモンいれかえは使えない、ベンチが 5 匹のときなかよしポフィンは使えない、山札が 0 枚の
 * ときノココッチの「にげあしドロー」は使えない、最初の自分の番に偉大な大樹は使えない(2026-09-23 確認)。
 * 対象の有無は公開された情報(場、手札、トラッシュ、山札の枚数)だけで決め、山札の中身は見ない
 * (山札に目当てのカードが無くても探す効果は使える。公式 Q&A「ハイパーボール」)。
 */
const firstStepTargetChecks: {
  readonly [Name in EffectStep["operation"]]: TargetCheck<Name>;
} = {
  addCardsDiscardedFromDeckTopInThisEffectToHand: alwaysHasTarget,
  addFromDiscardToHand: (step, { state }) =>
    listMatching(state.discard, step.filter).length >=
    Math.max(step.minCount, 1),
  attachEnergyFromDiscardDistributedToPokemon: discardHasEnergyForOwnPokemon,
  attachEnergyFromDiscardToEachChosenPokemon: discardHasEnergyForOwnPokemon,
  attachEnergyFromDiscardToOnePokemon: discardHasEnergyForOwnPokemon,
  attachEnergyFromHand: (step, { hand, state }) =>
    listMatching(hand, step.energyFilter).some(isEnergy) &&
    listOwnPokemonMatching(state, step.targetFilter).length > 0,
  attachEnergyFromHandDistributedToPokemon: (step, { hand, state }) =>
    listMatching(hand, step.energyFilter).some(isEnergy) &&
    listOwnPokemonMatching(state, step.targetFilter).length > 0,
  attachEnergyFromHandToSelf: (step, { hand, source }) =>
    listMatching(hand, step.energyFilter).some(isEnergy) &&
    source.pokemon !== null,
  branchOnCoinFlip: (step, input) => {
    // コインを投げる前に、オモテのときの最初の操作に対象があるかで決める(対象が無ければ効果を使えない決まりと同じ)
    const [first] = step.stepsWhenHeads;
    return first !== undefined && hasTargetForStep(first, input);
  },
  branchOnCondition: alwaysHasTarget,
  discardFromDeckTop: deckHasCards,
  discardFromHand: (step, { hand }) =>
    listMatchingOrAll(hand, step.filter).length >= Math.max(step.minCount, 1),
  // 手札が 0 枚でも使える(公式 Q&A「ゼイユ」: 手札がゼイユだけのときも使える、2026-09-24 確認)
  discardHand: alwaysHasTarget,
  discardSelf: alwaysHasTarget,
  discardStadiumInPlay: (_, { state }) => state.stadium !== null,
  drawCards: deckHasCards,
  evolveBasicToStage2FromHand: (_, { state }) =>
    listRareCandyPairs(state).length > 0,
  evolveFromDeck: (_, { state }) =>
    state.deck.length > 0 && listEvolvableBasics(state).length > 0,
  increaseAttackDamageThisTurn: alwaysHasTarget,
  lookAtDeckTopAndAttachEnergyToOwnPokemon: (step, { state }) =>
    state.deck.length > 0 &&
    listOwnPokemonMatching(state, step.targetFilter).length > 0,
  // 山札が 4 枚に満たなくても、ある分だけ見て使える(公式 Q&A「はしゃのほうこう」、2026-09-23 確認)
  lookAtDeckTopAndAttachEnergyToSelf: (_, { source, state }) =>
    state.deck.length > 0 && source.pokemon !== null,
  lookAtDeckTopAndTakeIntoHand: deckHasCards,
  moveAnyEnergyFromOwnPokemonToSelf: (_, { source, state }) =>
    listOtherPokemonWithEnergy(state, source.pokemon).length > 0,
  moveEnergyFromBenchToActive: (_, { state }) =>
    state.active !== null &&
    state.bench.some((pokemon) => pokemon.energies.length > 0),
  moveEnergyFromSwitchedOutPokemonToActive: alwaysHasTarget,
  moveEnergyToAnotherOwnPokemon: (step, { state }) =>
    state.listPokemonInPlay().length >= 2 &&
    listPokemonWithEnergyMatching(state, step.energyFilter).length > 0,
  placeFromDiscardOntoBench: (step, { state }) =>
    countEmptyBenchSlots(state) > 0 &&
    listMatching(state.discard, step.filter).some(isPokemon),
  placeHandCardsOnDeckTop: (step, { hand }) => hand.length >= step.count,
  placeSelfOnBenchFromHand: (_, { state }) => countEmptyBenchSlots(state) > 0,
  replaceSelfWithPokemonFromDeck: (_, { source, state }) =>
    state.deck.length > 0 && source.pokemon !== null,
  returnFromDiscardToDeck: (step, { state }) =>
    listMatching(state.discard, step.filter).length >=
    Math.max(step.minCount, 1),
  returnPokemonToHand: (step, { source, state }) =>
    step.target === "self"
      ? source.pokemon !== null
      : state.listPokemonInPlay().length > 0,
  returnSelfToDeck: alwaysHasTarget,
  searchDeckAndAttachEnergyDistributedToPokemon: (step, { state }) =>
    state.deck.length > 0 &&
    listOwnPokemonMatching(state, step.targetFilter).length > 0,
  searchDeckAndAttachEnergyToEachPokemon: deckHasCards,
  searchDeckAndAttachEnergyToOnePokemon: (step, { state }) =>
    state.deck.length > 0 &&
    listOwnPokemonMatching(state, step.targetFilter).length > 0,
  searchDeckAndAttachEnergyToSelf: (_, { source, state }) =>
    state.deck.length > 0 && source.pokemon !== null,
  searchDeckAndPlaceOnTopAfterShuffle: deckHasCards,
  searchDeckIntoHand: deckHasCards,
  searchDeckIntoHandAndAttachRest: deckHasCards,
  searchDeckIntoHandFromOneOfPicks: deckHasCards,
  searchDeckOntoBench: (_, { state }) =>
    state.deck.length > 0 && countEmptyBenchSlots(state) > 0,
  shuffleHandIntoDeck: alwaysHasTarget,
  switchActiveWithBench: (step, { state }) =>
    state.active !== null &&
    listBenchMatchingOrAll(state, step.benchFilter).length > 0,
  switchSelfWithActive: (_, { source, state }) =>
    state.active !== null &&
    source.pokemon !== null &&
    state.bench.includes(source.pokemon),
};

function hasTargetForStep<Name extends EffectStep["operation"]>(
  step: StepOf<Name>,
  input: TargetCheckInput
): boolean {
  const check: TargetCheck<Name> = firstStepTargetChecks[step.operation];
  return check(step, input);
}

/**
 * 効果で自分の場のポケモンがいなくなるか。場にポケモンが 1 匹もいなくなったプレイヤーは負けになる
 * (docs/pokemon-tcg/basic-rules.md「きぜつと勝敗」)。相手のいない乱数試行では負けを扱えないため、
 * そうなる効果は使えないものとする(ノココッチ、ポケモン回収サイクロン、ニャースex の裁定のデータ)。
 */
export function wouldLeaveFieldEmpty(
  state: GameState,
  effect: Effect
): boolean {
  const removesPokemon = effect.steps.some(
    (step) =>
      step.operation === "returnSelfToDeck" ||
      step.operation === "returnPokemonToHand"
  );
  return removesPokemon && state.listPokemonInPlay().length < 2;
}

/**
 * 効果を使い始められるか(使える条件、最初の操作の対象、場が空にならないこと)。
 * cardBeingPlayed は手札から使おうとしているカード。手札を対象にする判定では、その 1 枚を除いた手札で数える。
 */
export function canStartEffect(
  state: GameState,
  effect: Effect,
  source: EffectSource,
  cardBeingPlayed: Card | null
): boolean {
  const [firstStep] = effect.steps;
  const input: TargetCheckInput = {
    hand: listHandExcludingOneCopy(state, cardBeingPlayed),
    source,
    state,
  };
  return (
    areConditionsMet(state, effect.useConditions, source) &&
    firstStep !== undefined &&
    hasTargetForStep(firstStep, input) &&
    !wouldLeaveFieldEmpty(state, effect)
  );
}

// ---- 操作の実行 ----

interface OperationRun {
  readonly context: EffectContext;
  readonly label: string;
  /**
   * この効果の中でここまでに起きたこと。手札からトラッシュした枚数(ムクの「その枚数×3 枚ぶん引く」)と、
   * 入れ替えでベンチに下がったポケモン(ヒガナの信頼の「ベンチに入れ替えたポケモン」)。
   */
  readonly progress: {
    /** 山札の上からトラッシュしたカード(モルペコの「その中から」)。 */
    cardsDiscardedFromDeckTop: Card[];
    discardedCount: number;
    switchedOutPokemon: PokemonInPlay | null;
  };
  readonly source: EffectSource;
}

function calculateDrawCount(
  count: DrawCount,
  state: GameState,
  progress: OperationRun["progress"]
): number {
  switch (count.kind) {
    case "fixed":
      return count.value;
    case "perCardDiscardedEarlierInThisEffect":
      return progress.discardedCount * count.multiplier;
    default:
      return Math.max(0, count.handSize - state.hand.length);
  }
}

type OperationRunner<Name extends BasicOperation["operation"]> = (
  step: Extract<BasicOperation, { operation: Name }>,
  run: OperationRun
) => void;

/**
 * ベンチのポケモンが上限を超えていれば、上限になるまでベンチのポケモンを選んで、ついているカードごとトラッシュする
 * (ゼロの大空洞が場を離れたとき、場に「テラスタル」のポケモンがいなくなったとき)。どれをトラッシュするかは
 * プレイングの判断基準が選ぶ。トラッシュしたポケモンはきぜつではない(公式 Q&A「ゼロの大空洞」、2026-09-23 確認)。
 */
export function trimBenchToLimit(context: EffectContext): void {
  const { state } = context;
  const limit = calculateBenchLimit(state);
  while (state.bench.length > limit) {
    const target = chooseOnePokemon(
      context,
      state.bench,
      `ベンチを ${limit} 匹にするためにトラッシュするベンチポケモン`
    );
    if (target === null) {
      return;
    }
    state.discardBenchedPokemon(target);
  }
}

function promoteIfActiveIsEmpty(context: EffectContext): void {
  const { state } = context;
  if (state.active !== null) {
    return;
  }
  const next = chooseOnePokemon(
    context,
    state.bench,
    "バトル場に出すベンチポケモン"
  );
  if (next !== null) {
    state.promoteToActive(next);
  }
}

function returnToZone(
  context: EffectContext,
  target: PokemonInPlay | null,
  zone: "deck" | "hand"
): void {
  if (target === null) {
    return;
  }
  if (zone === "deck") {
    context.state.returnPokemonToDeck(target);
  } else {
    context.state.returnPokemonToHand(target);
  }
  // 場に「テラスタル」のポケモンがいなくなってベンチの上限が下がったときは、ベンチをトラッシュしてから
  // バトル場に出す(公式 Q&A「ゼロの大空洞」、2026-09-23 確認)
  trimBenchToLimit(context);
  promoteIfActiveIsEmpty(context);
}

/**
 * 山札かトラッシュの条件に合うポケモンを、ベンチの空きの範囲でベンチに出す。どちらも条件の付いた選び方なので 0 枚でもよい。
 * 進化段階は記録の条件で決める。効果が進化段階を指定しなければ進化ポケモンも出せる(公式 Q&A「おうのごうれい」
 * 「さいきのいのり」、検索語「トラッシュから進化ポケモンをベンチ」、2026-09-25 確認)。
 */
function placeOntoBenchFrom(
  run: OperationRun,
  zone: Extract<CardSource, "deck" | "discard">,
  step: { readonly filter: CardFilter; readonly maxCount: number }
): void {
  const { state } = run.context;
  const cards = zone === "deck" ? state.deck : state.discard;
  const candidates = listMatching(cards, step.filter).filter(isPokemon);
  const chosen = chooseCardsWithin(
    run.context,
    candidates,
    {
      maxCount: Math.min(step.maxCount, countEmptyBenchSlots(state)),
      minCount: 0,
    },
    `${run.label}: ベンチに出すポケモン`
  );
  for (const card of chosen) {
    state.placeOnBench(card, {
      benchLimit: calculateBenchLimit(state),
      byEffect: true,
      from: zone,
    });
  }
}

/** 手札からエネルギーを 1〜maxCount 枚選び、1 匹につける(公式 Q&A「こんじきのほのお」: 2 枚までのところ 1 枚だけでもよい)。 */
function attachEnergyChosenFromHand(
  run: OperationRun,
  step: Extract<BasicOperation, { operation: "attachEnergyFromHand" }>
): void {
  const { context, label } = run;
  const { state } = context;
  const energies = listMatching(state.hand, step.energyFilter).filter(isEnergy);
  const chosen = chooseCardsWithin(
    context,
    energies,
    { maxCount: step.maxCount, minCount: 1 },
    `${label}: 手札からつけるエネルギー`
  );
  const target =
    chosen.length === 0
      ? null
      : chooseOnePokemon(
          context,
          listOwnPokemonMatching(state, step.targetFilter),
          `${label}: 手札のエネルギーをつけるポケモン`
        );
  if (target === null) {
    return;
  }
  for (const energy of chosen) {
    state.attachEnergyByEffect(energy, target, "hand");
    resolveAttachedFromHandTriggers(context, energy, target);
  }
}

/** 山札かトラッシュのエネルギーを、条件に合う自分のポケモンにつける操作の引数。 */
interface EnergyForOwnPokemonStep {
  readonly energyFilter: CardFilter;
  readonly maxCount: number;
  readonly targetFilter: PokemonInPlayFilter;
}

type EnergySourceZone = Extract<CardSource, "deck" | "discard">;

/**
 * 山札かトラッシュから、条件に合うエネルギーを 0〜maxCount 枚選ぶ。つける先の候補(条件に合う自分のポケモン)が
 * いなければ選ばない。
 */
function chooseEnergiesForOwnPokemon(
  run: OperationRun,
  step: EnergyForOwnPokemonStep,
  zone: EnergySourceZone
): { chosen: readonly Card[]; targets: PokemonInPlay[] } {
  const { state } = run.context;
  const targets = listOwnPokemonMatching(state, step.targetFilter);
  const cards = zone === "deck" ? state.deck : state.discard;
  const chosen =
    targets.length === 0
      ? []
      : chooseCardsWithin(
          run.context,
          listMatching(cards, step.energyFilter).filter(isEnergy),
          { maxCount: step.maxCount, minCount: 0 },
          `${run.label}: ${ZONE_NAMES[zone]}から選ぶエネルギー`
        );
  return { chosen, targets };
}

const ZONE_NAMES = { deck: "山札", discard: "トラッシュ" } as const;

/**
 * 山札かトラッシュからエネルギーを 0〜maxCount 枚選び、1 匹にまとめてつける(公式 Q&A「バーニングチャージ」:
 * 1 枚も選ばなくてよい)。山札から選んだときは、呼び出し側が山札を切る。
 */
function attachEnergyToOnePokemon(
  run: OperationRun,
  step: EnergyForOwnPokemonStep,
  zone: EnergySourceZone
): void {
  const { context, label } = run;
  const { state } = context;
  const { chosen, targets } = chooseEnergiesForOwnPokemon(run, step, zone);
  const target =
    chosen.length === 0
      ? null
      : chooseOnePokemon(
          context,
          targets,
          `${label}: ${ZONE_NAMES[zone]}のエネルギーをつけるポケモン`
        );
  if (target !== null) {
    for (const energy of chosen) {
      state.attachEnergyByEffect(energy, target, zone);
    }
  }
}

/** 山札の上から見て、条件に合うエネルギーを効果の持ち主につけ、残りを山札に戻す。山札が見る枚数に満たなければある分だけ見る。 */
function lookAtDeckTopAndAttachToSelf(
  run: OperationRun,
  step: Extract<
    BasicOperation,
    { operation: "lookAtDeckTopAndAttachEnergyToSelf" }
  >
): void {
  const { context, label, source } = run;
  const { state } = context;
  const holder = source.pokemon;
  if (holder === null) {
    return;
  }
  const looked = state.deck.slice(0, step.lookCount);
  const chosen = chooseCardsWithin(
    context,
    listMatching(looked, step.filter).filter(isEnergy),
    { maxCount: step.maxAttachCount, minCount: step.minAttachCount },
    `${label}: 山札の上から見て ${holder.name} につけるエネルギー`
  );
  state.attachFromDeckTop(step.lookCount, chosen, holder, step.restPlacement);
}

/** 山札の上から見て、条件に合うエネルギーを選び、1 枚ずつつける先のポケモンを選ぶ。 */
function lookAtDeckTopAndAttachToOwnPokemon(
  run: OperationRun,
  step: Extract<
    BasicOperation,
    { operation: "lookAtDeckTopAndAttachEnergyToOwnPokemon" }
  >
): void {
  const { context, label } = run;
  const { state } = context;
  const targets = listOwnPokemonMatching(state, step.targetFilter);
  const chosen = chooseCardsWithin(
    context,
    listMatching(state.deck.slice(0, step.lookCount), step.filter).filter(
      isEnergy
    ),
    { maxCount: step.maxAttachCount, minCount: step.minAttachCount },
    `${label}: 山札の上から見てつけるエネルギー`
  );
  const assignments = chosen.flatMap((energy) => {
    const target = chooseOnePokemon(
      context,
      targets,
      `${label}: ${energy.name} をつけるポケモン`
    );
    return target === null ? [] : [{ energy, target }];
  });
  state.attachFromDeckTopToEach(
    step.lookCount,
    assignments,
    step.restPlacement
  );
}

/** つけ替える元のポケモン、エネルギー、つけ替える先のポケモンの順に選ぶ。 */
function moveEnergyBetweenOwnPokemon(
  run: OperationRun,
  step: Extract<BasicOperation, { operation: "moveEnergyToAnotherOwnPokemon" }>
): void {
  const { context, label } = run;
  const { state } = context;
  const from = chooseOnePokemon(
    context,
    listPokemonWithEnergyMatching(state, step.energyFilter),
    `${label}: エネルギーをつけ替える元のポケモン`
  );
  const [energy] =
    from === null
      ? []
      : chooseCardsWithin(
          context,
          listMatching(from.energies, step.energyFilter),
          { maxCount: 1, minCount: 1 },
          `${label}: ${from.name} からつけ替えるエネルギー`
        );
  const to =
    from === null || energy === undefined
      ? null
      : chooseOnePokemon(
          context,
          state.listPokemonInPlay().filter((pokemon) => pokemon !== from),
          `${label}: ${energy.name} をつけ替える先のポケモン`
        );
  if (from !== null && energy !== undefined && to !== null) {
    state.moveAttachedEnergy(from, to, energy);
  }
}

/** ポケモンを 0〜maxPokemonCount 匹選び、それぞれにトラッシュのエネルギーを 1 枚ずつつける。 */
function attachFromDiscardToEachChosenPokemon(
  run: OperationRun,
  step: Extract<
    BasicOperation,
    { operation: "attachEnergyFromDiscardToEachChosenPokemon" }
  >
): void {
  const { context, label } = run;
  const { state } = context;
  const targets = choosePokemonUpTo(
    context,
    listOwnPokemonMatching(state, step.targetFilter),
    step.maxPokemonCount,
    `${label}: トラッシュのエネルギーをつけるポケモン`
  );
  for (const target of targets) {
    const [energy] = chooseCardsWithin(
      context,
      listMatching(state.discard, step.energyFilter).filter(isEnergy),
      { maxCount: 1, minCount: 1 },
      `${label}: ${target.name} につけるトラッシュのエネルギー`
    );
    if (energy !== undefined) {
      state.attachEnergyByEffect(energy, target, "discard");
    }
  }
}

/** トラッシュのエネルギーを 0〜maxCount 枚選び、1 枚ずつつける先のポケモンを選ぶ(同じポケモンに何枚つけてもよい)。 */
function attachEnergyDistributed(
  run: OperationRun,
  step: EnergyForOwnPokemonStep,
  zone: EnergySourceZone
): void {
  const { context, label } = run;
  const { state } = context;
  const { chosen, targets } = chooseEnergiesForOwnPokemon(run, step, zone);
  for (const energy of chosen) {
    const target = chooseOnePokemon(
      context,
      targets,
      `${label}: ${energy.name} をつけるポケモン`
    );
    if (target !== null) {
      state.attachEnergyByEffect(energy, target, zone);
    }
  }
}

/** 手札からエネルギーを 1〜maxCount 枚選び、効果の持ち主につける。 */
function attachEnergyFromHandToHolder(
  run: OperationRun,
  step: Extract<BasicOperation, { operation: "attachEnergyFromHandToSelf" }>
): void {
  const { context, label, source } = run;
  const holder = source.pokemon;
  if (holder === null) {
    return;
  }
  const chosen = chooseCardsWithin(
    context,
    listMatching(context.state.hand, step.energyFilter).filter(isEnergy),
    { maxCount: step.maxCount, minCount: 1 },
    `${label}: ${holder.name} につける手札のエネルギー`
  );
  for (const energy of chosen) {
    context.state.attachEnergyByEffect(energy, holder, "hand");
    resolveAttachedFromHandTriggers(context, energy, holder);
  }
}

/** 手札からエネルギーを 0 枚以上選び、1 枚ずつつける先のポケモンを選ぶ(同じポケモンに何枚つけてもよい)。 */
function attachEnergyFromHandDistributed(
  run: OperationRun,
  step: Extract<
    BasicOperation,
    { operation: "attachEnergyFromHandDistributedToPokemon" }
  >
): void {
  const { context, label } = run;
  const { state } = context;
  const energies = listMatching(state.hand, step.energyFilter).filter(isEnergy);
  const chosen = chooseCardsWithin(
    context,
    energies,
    { maxCount: energies.length, minCount: 0 },
    `${label}: 手札からつけるエネルギー`
  );
  const targets = listOwnPokemonMatching(state, step.targetFilter);
  for (const energy of chosen) {
    const target = chooseOnePokemon(
      context,
      targets,
      `${label}: ${energy.name} をつけるポケモン`
    );
    if (target !== null) {
      state.attachEnergyByEffect(energy, target, "hand");
      resolveAttachedFromHandTriggers(context, energy, target);
    }
  }
}

/** コインを 1 回投げる。オモテとウラは 1/2 ずつとする(docs/setup-rate-design.md「順 4 から送られた論点の決定」の 1)。 */
function flipsHeads(state: GameState): boolean {
  return state.random.nextFloat() < 0.5;
}

/** つけるエネルギーの上限。コインで決まるときは、ここでウラが出るまで投げる(オモテとウラは 1/2 ずつ)。 */
function calculateAttachCount(
  count: AttachCount,
  { context, label }: OperationRun
): number {
  if (count.kind === "fixed") {
    return count.value;
  }
  let heads = 0;
  while (flipsHeads(context.state)) {
    heads += 1;
  }
  context.state.record(`${label}: コインのオモテ ${heads} 回`);
  return heads;
}

/** 山札からエネルギーを 0〜上限枚選び、効果の持ち主につけて切る。 */
function searchDeckAndAttachToHolder(
  run: OperationRun,
  step: Extract<
    BasicOperation,
    { operation: "searchDeckAndAttachEnergyToSelf" }
  >
): void {
  const { context, label, source } = run;
  const { state } = context;
  const holder = source.pokemon;
  const maxCount = calculateAttachCount(step.maxCount, run);
  if (holder !== null && maxCount > 0) {
    for (const energy of chooseCardsWithin(
      context,
      listMatching(state.deck, step.energyFilter).filter(isEnergy),
      { maxCount, minCount: 0 },
      `${label}: 山札から ${holder.name} につけるエネルギー`
    )) {
      state.attachEnergyByEffect(energy, holder, "deck");
    }
  }
  state.shuffleDeck();
}

/** つけ替える元のポケモンを 0 匹以上選び、それぞれからエネルギーを 0 枚以上選んで、効果の持ち主につけ替える。 */
function moveEnergyToHolder(run: OperationRun): void {
  const holder = run.source.pokemon;
  if (holder === null) {
    return;
  }
  moveChosenEnergies(
    run,
    listOtherPokemonWithEnergy(run.context.state, holder),
    holder,
    Number.POSITIVE_INFINITY
  );
}

/**
 * つけ替える元のポケモン(origins)を 0 匹以上選び、それぞれから合計 maxTotal 個までのエネルギーを選んで to につけ替える。
 * 同じカードは同じ参照を枚数分並べて表すため、エネルギーだけを選ぶとどのポケモンの 1 枚か決まらず、元のポケモンから選ぶ。
 */
function moveChosenEnergies(
  run: OperationRun,
  origins: readonly PokemonInPlay[],
  to: PokemonInPlay,
  maxTotal: number
): void {
  const { context, label } = run;
  let remaining = maxTotal;
  for (const from of choosePokemonUpTo(
    context,
    origins,
    origins.length,
    `${label}: ${to.name} にエネルギーをつけ替える元のポケモン`
  )) {
    const chosen = chooseCardsWithin(
      context,
      from.energies,
      { maxCount: Math.min(remaining, from.energies.length), minCount: 0 },
      `${label}: ${from.name} から ${to.name} につけ替えるエネルギー`
    );
    for (const energy of chosen) {
      context.state.moveAttachedEnergy(from, to, energy);
    }
    remaining -= chosen.length;
  }
}

/** 山札から count 枚(山札が足りなければ全部)を選び、残りを切ってから、選んだ順に山札の上に置く。 */
function searchDeckAndPlaceOnTop(run: OperationRun, count: number): void {
  const { context, label } = run;
  const { state } = context;
  const chosen = chooseCardsWithin(
    context,
    state.deck,
    { maxCount: count, minCount: count },
    `${label}: 山札の上に置くカード(先頭がいちばん上)`
  );
  state.placeOnDeckTopAfterShuffle(chosen);
}

function evolveFromDeck(run: OperationRun, canContinueToStage2: boolean): void {
  const { context, label } = run;
  const { state } = context;
  const basics = listEvolvableBasics(state);
  const basicNames = new Set(basics.map((pokemon) => pokemon.name));
  const [stage1] = chooseCardsWithin(
    context,
    state.deck.filter(
      (card) =>
        card.stage === EvolutionStage.Stage1 &&
        card.evolvesFrom !== undefined &&
        basicNames.has(card.evolvesFrom)
    ),
    { maxCount: 1, minCount: 0 },
    `${label}: 山札から進化させる 1進化ポケモン`
  );
  const target =
    stage1 === undefined
      ? null
      : chooseOnePokemon(
          context,
          basics.filter((pokemon) => pokemon.name === stage1.evolvesFrom),
          `${label}: 進化させるたねポケモン`
        );
  if (stage1 !== undefined && target !== null) {
    state.evolve(target, stage1, { from: "deck" });
    const [stage2] = canContinueToStage2
      ? chooseCardsWithin(
          context,
          state.deck.filter((card) => card.evolvesFrom === stage1.name),
          { maxCount: 1, minCount: 0 },
          `${label}: 続けて進化させる 2進化ポケモン`
        )
      : [];
    if (stage2 !== undefined) {
      state.evolve(target, stage2, { from: "deck", ignoreFreshness: true });
    }
  }
  state.shuffleDeck();
}

function searchIntoHandAndAttachRest(
  run: OperationRun,
  step: Extract<
    BasicOperation,
    { operation: "searchDeckIntoHandAndAttachRest" }
  >
): void {
  const { context, label } = run;
  const { state } = context;
  const candidates = listMatching(state.deck, step.filter);
  const chosen = chooseCards(context, {
    candidates,
    maxCount: Math.min(step.maxCount, candidates.length),
    minCount: 0,
    mustHaveDistinctTypes: step.requiresDistinctTypes,
    purpose: `${label}: 山札から選ぶエネルギー`,
  });
  // 1 枚だけ選んだときは、そのエネルギーを手札に加え、つけない(公式 Q&A「アカマツ」、2026-09-23 確認)
  const [toHand] =
    chosen.length <= 1
      ? chosen
      : chooseCardsWithin(
          context,
          chosen,
          { maxCount: 1, minCount: 1 },
          `${label}: 手札に加えるエネルギー`
        );
  const rest = [...chosen];
  if (toHand !== undefined) {
    state.takeFromDeckToHand(toHand);
    rest.splice(rest.indexOf(toHand), 1);
  }
  for (const energy of rest) {
    const target = chooseOnePokemon(
      context,
      listOwnPokemonMatching(state, step.targetFilter),
      `${label}: ${energy.name} をつけるポケモン`
    );
    if (target !== null) {
      state.attachEnergyByEffect(energy, target, "deck");
    }
  }
  state.shuffleDeck();
}

/**
 * 山札から、picks のうち 1 つの条件に合うカードを上限まで手札に加えて切る。1 枚目を全部の条件の候補から選ばせ、
 * それが合う最初の条件で残りを選ぶ(どの条件にするかを、選ぶカードで決める)。条件の付いた選び方なので 0 枚でもよい。
 */
function searchDeckIntoHandFromOneOfPicks(
  run: OperationRun,
  picks: readonly { readonly filter: CardFilter; readonly maxCount: number }[]
): void {
  const { context, label } = run;
  const { state } = context;
  const [first] = chooseCardsWithin(
    context,
    state.deck.filter((card) =>
      picks.some((candidate) => matchesCardFilter(card, candidate.filter))
    ),
    { maxCount: 1, minCount: 0 },
    `${label}: 山札から手札に加える 1 枚目のカード`
  );
  const pick =
    first === undefined
      ? undefined
      : picks.find((candidate) => matchesCardFilter(first, candidate.filter));
  if (first !== undefined && pick !== undefined) {
    state.takeFromDeckToHand(first);
    for (const card of chooseCardsWithin(
      context,
      listMatching(state.deck, pick.filter),
      { maxCount: pick.maxCount - 1, minCount: 0 },
      `${label}: 山札から続けて手札に加えるカード`
    )) {
      state.takeFromDeckToHand(card);
    }
  }
  state.shuffleDeck();
}

function evolveWithRareCandy(run: OperationRun): void {
  const { context, label } = run;
  const pairs = listRareCandyPairs(context.state);
  const [stage2] = chooseCardsWithin(
    context,
    [...new Set(pairs.map((pair) => pair.stage2))],
    { maxCount: 1, minCount: 1 },
    `${label}: 手札から出す 2進化ポケモン`
  );
  const target =
    stage2 === undefined
      ? null
      : chooseOnePokemon(
          context,
          pairs
            .filter((pair) => pair.stage2 === stage2)
            .map((pair) => pair.target),
          `${label}: ${stage2.name} に進化させるたねポケモン`
        );
  if (stage2 !== undefined && target !== null) {
    context.state.evolveSkippingStage1(target, stage2);
    // ふしぎなアメで手札から出した 2進化ポケモンも「手札から出して進化させたとき」に当たる(公式 Q&A「ふしぎなアメ」:
    // 手札からポケモンのカードを出して進化していれば、そのときに使える特性を使える。2026-09-24 確認)
    resolveAbilityTriggers(context, target, "triggeredWhenEvolvedFromHand");
  }
}

const operationRunners: {
  readonly [Name in BasicOperation["operation"]]: OperationRunner<Name>;
} = {
  addCardsDiscardedFromDeckTopInThisEffectToHand: (
    step,
    { context, label, progress }
  ) => {
    const { state } = context;
    const available = progress.cardsDiscardedFromDeckTop.filter((card) =>
      state.discard.includes(card)
    );
    for (const card of chooseCardsWithin(
      context,
      available,
      step,
      `${label}: 山札の上からトラッシュしたカードから手札に加えるカード`
    )) {
      state.takeFromDiscardToHand(card);
    }
  },
  addFromDiscardToHand: (step, { context, label }) => {
    const chosen = chooseCardsWithin(
      context,
      listMatching(context.state.discard, step.filter),
      step,
      `${label}: トラッシュから手札に加えるカード`
    );
    for (const card of chosen) {
      context.state.takeFromDiscardToHand(card);
    }
  },
  attachEnergyFromDiscardDistributedToPokemon: (step, run) =>
    attachEnergyDistributed(run, step, "discard"),
  attachEnergyFromDiscardToEachChosenPokemon: (step, run) =>
    attachFromDiscardToEachChosenPokemon(run, step),
  attachEnergyFromDiscardToOnePokemon: (step, run) =>
    attachEnergyToOnePokemon(run, step, "discard"),
  attachEnergyFromHand: (step, run) => attachEnergyChosenFromHand(run, step),
  attachEnergyFromHandDistributedToPokemon: (step, run) =>
    attachEnergyFromHandDistributed(run, step),
  attachEnergyFromHandToSelf: (step, run) =>
    attachEnergyFromHandToHolder(run, step),
  discardFromDeckTop: (step, { context, progress }) => {
    progress.cardsDiscardedFromDeckTop.push(
      ...context.state.discardFromDeckTop(step.count)
    );
  },
  discardFromHand: (step, { context, label, progress }) => {
    const chosen = chooseCardsWithin(
      context,
      listMatchingOrAll(context.state.hand, step.filter),
      step,
      `${label}: トラッシュする手札`
    );
    context.state.discardFromHand(chosen);
    progress.discardedCount += chosen.length;
  },
  discardHand: (_, { context, label }) => {
    context.state.record(
      `${label}: 手札 ${context.state.hand.length} 枚をトラッシュ`
    );
    context.state.discardHand();
  },
  discardSelf: (_, { context, label, source }) => {
    const holder = source.pokemon;
    if (holder?.energies.includes(source.card)) {
      context.state.discardAttachedEnergy(holder, source.card);
      context.state.record(`${label}: ${source.card.name} をトラッシュ`);
    }
  },
  discardStadiumInPlay: (_, { context }) => {
    context.state.discardStadium();
    // ゼロの大空洞がトラッシュされてベンチの上限が下がったら、ベンチをトラッシュする
    trimBenchToLimit(context);
  },
  drawCards: (step, { context, label, progress }) => {
    const count = calculateDrawCount(step.count, context.state, progress);
    context.state.draw(count);
    context.state.record(`${label}: ${count} 枚引く`);
  },
  evolveBasicToStage2FromHand: (_, run) => evolveWithRareCandy(run),
  evolveFromDeck: (step, run) => evolveFromDeck(run, step.canContinueToStage2),
  increaseAttackDamageThisTurn: (step, { context, label }) => {
    context.state.increaseAttackDamageThisTurn({
      amount: step.amount,
      attackerFilter: step.attackerFilter,
    });
    context.state.record(`${label}: この番のワザのダメージ +${step.amount}`);
  },
  lookAtDeckTopAndAttachEnergyToOwnPokemon: (step, run) =>
    lookAtDeckTopAndAttachToOwnPokemon(run, step),
  lookAtDeckTopAndAttachEnergyToSelf: (step, run) =>
    lookAtDeckTopAndAttachToSelf(run, step),
  lookAtDeckTopAndTakeIntoHand: (step, { context, label }) => {
    const looked = context.state.deck.slice(0, step.lookCount);
    const chosen = chooseCardsWithin(
      context,
      listMatching(looked, step.filter),
      { maxCount: step.maxTakeCount, minCount: step.minTakeCount },
      `${label}: 山札の上から見て手札に加えるカード`
    );
    context.state.takeFromDeckTop(step.lookCount, chosen, step.restPlacement);
  },
  moveAnyEnergyFromOwnPokemonToSelf: (_, run) => moveEnergyToHolder(run),
  moveEnergyFromBenchToActive: (step, run) => {
    const { active, bench } = run.context.state;
    if (active !== null) {
      moveChosenEnergies(
        run,
        bench.filter((pokemon) => pokemon.energies.length > 0),
        active,
        step.maxCount
      );
    }
  },
  moveEnergyFromSwitchedOutPokemonToActive: (
    _,
    { context, label, progress }
  ) => {
    const { state } = context;
    const from = progress.switchedOutPokemon;
    const to = state.active;
    if (from === null || to === null) {
      return;
    }
    // ベンチに下がったポケモンにエネルギーがあれば、つけ替えないことは選べない(公式 Q&A「ヒガナの信頼」、2026-09-24 確認)
    for (const energy of chooseCardsWithin(
      context,
      from.energies,
      { maxCount: 1, minCount: 1 },
      `${label}: ${from.name} から ${to.name} につけ替えるエネルギー`
    )) {
      state.moveAttachedEnergy(from, to, energy);
    }
  },
  moveEnergyToAnotherOwnPokemon: (step, run) =>
    moveEnergyBetweenOwnPokemon(run, step),
  placeFromDiscardOntoBench: (step, run) =>
    placeOntoBenchFrom(run, "discard", step),
  placeHandCardsOnDeckTop: (step, { context, label }) => {
    const chosen = chooseCardsWithin(
      context,
      context.state.hand,
      { maxCount: step.count, minCount: step.count },
      `${label}: 山札の上に置く手札(先頭がいちばん上)`
    );
    context.state.placeHandCardsOnDeckTop(chosen);
  },
  placeSelfOnBenchFromHand: (_, { context, source }) => {
    const { state } = context;
    state.placeOnBench(source.card, {
      benchLimit: calculateBenchLimit(state),
      byEffect: true,
      from: "hand",
    });
  },
  replaceSelfWithPokemonFromDeck: (step, { context, label, source }) => {
    const { state } = context;
    const holder = source.pokemon;
    const [card] =
      holder === null
        ? []
        : chooseCardsWithin(
            context,
            listMatching(state.deck, step.filter).filter(isPokemon),
            { maxCount: 1, minCount: 0 },
            `${label}: ${holder.name} と入れ替える山札のポケモン`
          );
    if (holder !== null && card !== undefined) {
      state.replacePokemonWithDeckCard(holder, card);
    }
    state.shuffleDeck();
  },
  returnFromDiscardToDeck: (step, { context, label }) => {
    const chosen = chooseCardsWithin(
      context,
      listMatching(context.state.discard, step.filter),
      step,
      `${label}: トラッシュから山札に戻すカード`
    );
    context.state.returnFromDiscardToDeck(chosen);
  },
  returnPokemonToHand: (step, { context, label, source }) =>
    returnToZone(
      context,
      step.target === "self"
        ? source.pokemon
        : chooseOnePokemon(
            context,
            context.state.listPokemonInPlay(),
            `${label}: 手札に戻すポケモン`
          ),
      "hand"
    ),
  returnSelfToDeck: (_, { context, source }) =>
    returnToZone(context, source.pokemon, "deck"),
  searchDeckAndAttachEnergyDistributedToPokemon: (step, run) => {
    attachEnergyDistributed(run, step, "deck");
    run.context.state.shuffleDeck();
  },
  searchDeckAndAttachEnergyToEachPokemon: (step, { context, label }) => {
    const { state } = context;
    for (const target of listOwnPokemonMatching(state, step.targetFilter)) {
      const [energy] = chooseCardsWithin(
        context,
        listMatching(state.deck, step.energyFilter),
        { maxCount: 1, minCount: 0 },
        `${label}: ${target.name} につけるエネルギー`
      );
      if (energy !== undefined) {
        state.attachEnergyByEffect(energy, target, "deck");
      }
    }
    state.shuffleDeck();
  },
  searchDeckAndAttachEnergyToOnePokemon: (step, run) => {
    attachEnergyToOnePokemon(run, step, "deck");
    run.context.state.shuffleDeck();
  },
  searchDeckAndAttachEnergyToSelf: (step, run) =>
    searchDeckAndAttachToHolder(run, step),
  searchDeckAndPlaceOnTopAfterShuffle: (step, run) =>
    searchDeckAndPlaceOnTop(run, step.count),
  searchDeckIntoHand: (step, { context, label }) => {
    const { state } = context;
    for (const pick of step.picks) {
      const candidates = listMatching(state.deck, pick.filter);
      const chosen = chooseCardsWithin(
        context,
        candidates,
        {
          maxCount: pick.maxCount,
          minCount: minCountForDeckSearch(pick.filter, candidates.length),
        },
        `${label}: 山札から手札に加えるカード`
      );
      for (const card of chosen) {
        state.takeFromDeckToHand(card);
      }
    }
    state.shuffleDeck();
  },
  searchDeckIntoHandAndAttachRest: (step, run) =>
    searchIntoHandAndAttachRest(run, step),
  searchDeckIntoHandFromOneOfPicks: (step, run) =>
    searchDeckIntoHandFromOneOfPicks(run, step.picks),
  searchDeckOntoBench: (step, run) => {
    placeOntoBenchFrom(run, "deck", step);
    run.context.state.shuffleDeck();
  },
  shuffleHandIntoDeck: (_, { context }) => context.state.returnHandToDeck(),
  switchActiveWithBench: (step, { context, label, progress }) => {
    const { state } = context;
    const benched = chooseOnePokemon(
      context,
      state.active === null
        ? []
        : listBenchMatchingOrAll(state, step.benchFilter),
      `${label}: バトル場と入れ替えるベンチポケモン`
    );
    if (benched !== null) {
      progress.switchedOutPokemon = state.active;
      state.switchActive(benched);
    }
  },
  switchSelfWithActive: (_, { context, source }) => {
    const holder = source.pokemon;
    if (holder !== null && context.state.bench.includes(holder)) {
      context.state.switchActive(holder);
    }
  },
};

function runOperation<Name extends BasicOperation["operation"]>(
  step: Extract<BasicOperation, { operation: Name }>,
  run: OperationRun
): void {
  const runner: OperationRunner<Name> = operationRunners[step.operation];
  runner(step, run);
}

/** 操作の列の 1 歩を、実行する基本操作の並びにする。条件やコインで分かれる歩は、ここで条件を判定し、コインを投げる。 */
function resolveBranch(step: EffectStep, run: OperationRun): BasicOperation[] {
  const { context, label, source } = run;
  switch (step.operation) {
    case "branchOnCondition":
      return areConditionsMet(context.state, [step.condition], source)
        ? step.stepsWhenMet
        : step.stepsOtherwise;
    case "branchOnCoinFlip": {
      const isHeads = flipsHeads(context.state);
      context.state.record(`${label}: コインは${isHeads ? "オモテ" : "ウラ"}`);
      return isHeads ? step.stepsWhenHeads : [];
    }
    default:
      return [step];
  }
}

/** 効果を実行する。「のぞむなら」の効果は、起こすかを問い合わせてから実行する。 */
export function runEffect(
  context: EffectContext,
  effect: Effect,
  source: EffectSource,
  label: string
): void {
  if (
    effect.isOptional &&
    !context.choices.choosesToApplyOptionalEffect(context.state, label)
  ) {
    return;
  }
  const run: OperationRun = {
    context,
    label,
    progress: {
      cardsDiscardedFromDeckTop: [],
      discardedCount: 0,
      switchedOutPokemon: null,
    },
    source,
  };
  for (const step of effect.steps) {
    for (const inner of resolveBranch(step, run)) {
      runOperation(inner, run);
    }
  }
}

// ---- 特性を使った記録と、場に出したとき・進化させたときのきっかけ ----

export function markAbilityUsed(
  state: GameState,
  pokemon: PokemonInPlay | null,
  abilityName: string
): void {
  pokemon?.abilitiesUsedThisTurn.add(abilityName);
  state.abilityNamesUsedThisTurn.push(abilityName);
  state.record(`特性 ${abilityName}`);
}

/**
 * 「手札からベンチに出したとき」「手札から出して進化させたとき」の特性で、使えるものを、使うかを問い合わせてから使う。
 * 対戦の準備でベンチに出したときと、山札から進化させたときは呼ばない(公式 Q&A「ニャースex」)。
 */
export function resolveAbilityTriggers(
  context: EffectContext,
  pokemon: PokemonInPlay,
  kind: "triggeredWhenPlacedOnBenchFromHand" | "triggeredWhenEvolvedFromHand"
): void {
  const { state } = context;
  const { card } = pokemon;
  if (card.record.category !== CardCategory.Pokemon) {
    return;
  }
  for (const ability of card.record.abilities) {
    const { translation } = ability;
    if (
      translation?.kind === kind &&
      !isAbilityNegated(state, pokemon) &&
      canStartEffect(state, translation.effect, { card, pokemon }, null) &&
      context.choices.choosesToApplyOptionalEffect(state, ability.name)
    ) {
      markAbilityUsed(state, pokemon, ability.name);
      runEffect(context, translation.effect, { card, pokemon }, ability.name);
    }
  }
}

// ---- カードの効果の検索と、手札からつけたときのきっかけ ----

export function findCardEffects<Kind extends CardEffect["kind"]>(
  card: Card,
  kind: Kind
): Extract<CardEffect, { kind: Kind }>[] {
  if (!("cardEffects" in card.record)) {
    return [];
  }
  return card.record.cardEffects.filter(
    (cardEffect): cardEffect is Extract<CardEffect, { kind: Kind }> =>
      cardEffect.kind === kind
  );
}

/** 手札からエネルギーをつけたときの効果(テレパス超エネルギー)を実行する。 */
export function resolveAttachedFromHandTriggers(
  context: EffectContext,
  energy: Card,
  target: PokemonInPlay
): void {
  const source: EffectSource = { card: energy, pokemon: target };
  for (const cardEffect of findCardEffects(
    energy,
    "triggeredWhenAttachedFromHand"
  )) {
    // ベンチが 5 匹のときテレパス超エネルギーはつけられるが、山札を見ることはできない
    // (公式 Q&A「テレパス超エネルギー」、2026-09-23 確認)。最初の操作に対象が無ければ効果は起きない
    if (canStartEffect(context.state, cardEffect.effect, source, null)) {
      runEffect(context, cardEffect.effect, source, energy.name);
    }
  }
}
