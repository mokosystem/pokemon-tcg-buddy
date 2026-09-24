/**
 * 効果の記法の基本操作を、骨組みの状態に対して実行する。操作ごとの処理は、記法の部品の一覧と
 * 1 対 1 に対応する表(operationRunners、firstStepTargetChecks)に置く。部品を足すときは、
 * card-record-schema.ts の部品とこの 2 つの表に 1 行ずつ足す(docs/setup-rate-design.md「部品を足す手順」)。
 */

import {
  type BasicOperation,
  type CardEffect,
  type CardFilter,
  type DrawCount,
  type Effect,
  type EffectStep,
  EvolutionStage,
  type PokemonInPlayFilter,
} from "./card-record-schema.ts";
import {
  type Card,
  isBasicPokemon,
  isEnergy,
  isPokemon,
  matchesCardFilter,
} from "./cards.ts";
import {
  areConditionsMet,
  type EffectSource,
  listHandExcludingOneCopy,
  matchesPokemonFilter,
} from "./conditions.ts";
import {
  calculateBenchLimit,
  countEmptyBenchSlots,
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
  addFromDiscardToHand: (step, { state }) =>
    listMatching(state.discard, step.filter).length >=
    Math.max(step.minCount, 1),
  attachEnergyFromDiscardDistributedToPokemon: (step, { state }) =>
    listMatching(state.discard, step.energyFilter).some(isEnergy) &&
    listOwnPokemonMatching(state, step.targetFilter).length > 0,
  attachEnergyFromDiscardToEachChosenPokemon: (step, { state }) =>
    listMatching(state.discard, step.energyFilter).some(isEnergy) &&
    listOwnPokemonMatching(state, step.targetFilter).length > 0,
  attachEnergyFromHand: (step, { hand, state }) =>
    listMatching(hand, step.energyFilter).some(isEnergy) &&
    listOwnPokemonMatching(state, step.targetFilter).length > 0,
  attachEnergyFromHandToSelf: (step, { hand, source }) =>
    listMatching(hand, step.energyFilter).some(isEnergy) &&
    source.pokemon !== null,
  branchOnCondition: alwaysHasTarget,
  discardFromHand: (step, { hand }) =>
    listMatchingOrAll(hand, step.filter).length >= Math.max(step.minCount, 1),
  // 手札が 0 枚でも使える(公式 Q&A「ゼイユ」: 手札がゼイユだけのときも使える、2026-09-24 確認)
  discardHand: alwaysHasTarget,
  discardSelf: alwaysHasTarget,
  drawCards: deckHasCards,
  evolveBasicToStage2FromHand: (_, { state }) =>
    listRareCandyPairs(state).length > 0,
  evolveFromDeck: (_, { state }) =>
    state.deck.length > 0 && listEvolvableBasics(state).length > 0,
  increaseAttackDamageThisTurn: alwaysHasTarget,
  // 山札が 4 枚に満たなくても、ある分だけ見て使える(公式 Q&A「はしゃのほうこう」、2026-09-23 確認)
  lookAtDeckTopAndAttachEnergyToSelf: (_, { source, state }) =>
    state.deck.length > 0 && source.pokemon !== null,
  lookAtDeckTopAndTakeIntoHand: deckHasCards,
  moveAnyEnergyFromOwnPokemonToSelf: (_, { source, state }) =>
    listOtherPokemonWithEnergy(state, source.pokemon).length > 0,
  moveEnergyToAnotherOwnPokemon: (step, { state }) =>
    state.listPokemonInPlay().length >= 2 &&
    listPokemonWithEnergyMatching(state, step.energyFilter).length > 0,
  placeFromDiscardOntoBench: (step, { state }) =>
    countEmptyBenchSlots(state) > 0 &&
    listMatching(state.discard, step.filter).some(isBasicPokemon),
  placeHandCardsOnDeckTop: (step, { hand }) => hand.length >= step.count,
  placeSelfOnBenchFromHand: (_, { state }) => countEmptyBenchSlots(state) > 0,
  returnFromDiscardToDeck: (step, { state }) =>
    listMatching(state.discard, step.filter).length >=
    Math.max(step.minCount, 1),
  returnPokemonToHand: (step, { source, state }) =>
    step.target === "self"
      ? source.pokemon !== null
      : state.listPokemonInPlay().length > 0,
  returnSelfToDeck: alwaysHasTarget,
  searchDeckAndAttachEnergyToEachPokemon: deckHasCards,
  searchDeckAndAttachEnergyToOnePokemon: (step, { state }) =>
    state.deck.length > 0 &&
    listOwnPokemonMatching(state, step.targetFilter).length > 0,
  searchDeckAndPlaceOnTopAfterShuffle: deckHasCards,
  searchDeckIntoHand: deckHasCards,
  searchDeckIntoHandAndAttachRest: deckHasCards,
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
  /** この効果の中でここまでに手札からトラッシュした枚数(ムクの「その枚数×3 枚ぶん引く」)。 */
  readonly progress: { discardedCount: number };
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

/** 山札かトラッシュのたねポケモンを、ベンチの空きの範囲でベンチに出す。どちらも条件の付いた選び方なので 0 枚でもよい。 */
function placeOntoBenchFrom(
  run: OperationRun,
  zone: Extract<CardSource, "deck" | "discard">,
  step: { readonly filter: CardFilter; readonly maxCount: number }
): void {
  const { state } = run.context;
  const cards = zone === "deck" ? state.deck : state.discard;
  const candidates = listMatching(cards, step.filter).filter(isBasicPokemon);
  const chosen = chooseCardsWithin(
    run.context,
    candidates,
    {
      maxCount: Math.min(step.maxCount, countEmptyBenchSlots(state)),
      minCount: 0,
    },
    `${run.label}: ベンチに出すたねポケモン`
  );
  for (const card of chosen) {
    state.placeOnBench(card, {
      benchLimit: calculateBenchLimit(state),
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

/**
 * 山札かトラッシュから、条件に合うエネルギーを 0〜maxCount 枚選ぶ。つける先の候補(条件に合う自分のポケモン)が
 * いなければ選ばない。
 */
function chooseEnergiesForOwnPokemon(
  run: OperationRun,
  step: {
    readonly energyFilter: CardFilter;
    readonly maxCount: number;
    readonly targetFilter: PokemonInPlayFilter;
  },
  zone: Extract<CardSource, "deck" | "discard">
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

/** 山札からエネルギーを 0〜maxCount 枚選び、1 匹にまとめてつけて切る(公式 Q&A「バーニングチャージ」: 1 枚も選ばなくてよい)。 */
function searchDeckAndAttachToOnePokemon(
  run: OperationRun,
  step: Extract<
    BasicOperation,
    { operation: "searchDeckAndAttachEnergyToOnePokemon" }
  >
): void {
  const { context, label } = run;
  const { state } = context;
  const { chosen, targets } = chooseEnergiesForOwnPokemon(run, step, "deck");
  const target =
    chosen.length === 0
      ? null
      : chooseOnePokemon(
          context,
          targets,
          `${label}: 山札のエネルギーをつけるポケモン`
        );
  if (target !== null) {
    for (const energy of chosen) {
      state.attachEnergyByEffect(energy, target, "deck");
    }
  }
  state.shuffleDeck();
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
function attachFromDiscardDistributed(
  run: OperationRun,
  step: Extract<
    BasicOperation,
    { operation: "attachEnergyFromDiscardDistributedToPokemon" }
  >
): void {
  const { context, label } = run;
  const { state } = context;
  const { chosen, targets } = chooseEnergiesForOwnPokemon(run, step, "discard");
  for (const energy of chosen) {
    const target = chooseOnePokemon(
      context,
      targets,
      `${label}: ${energy.name} をつけるポケモン`
    );
    if (target !== null) {
      state.attachEnergyByEffect(energy, target, "discard");
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

/** つけ替える元のポケモンを 0 匹以上選び、それぞれからエネルギーを 0 枚以上選んで、効果の持ち主につけ替える。 */
function moveEnergyToHolder(run: OperationRun): void {
  const { context, label, source } = run;
  const { state } = context;
  const holder = source.pokemon;
  if (holder === null) {
    return;
  }
  const origins = listOtherPokemonWithEnergy(state, holder);
  for (const from of choosePokemonUpTo(
    context,
    origins,
    origins.length,
    `${label}: ${holder.name} にエネルギーをつけ替える元のポケモン`
  )) {
    const chosen = chooseCardsWithin(
      context,
      from.energies,
      { maxCount: from.energies.length, minCount: 0 },
      `${label}: ${from.name} から ${holder.name} につけ替えるエネルギー`
    );
    for (const energy of chosen) {
      state.moveAttachedEnergy(from, holder, energy);
    }
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
  }
}

const operationRunners: {
  readonly [Name in BasicOperation["operation"]]: OperationRunner<Name>;
} = {
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
    attachFromDiscardDistributed(run, step),
  attachEnergyFromDiscardToEachChosenPokemon: (step, run) =>
    attachFromDiscardToEachChosenPokemon(run, step),
  attachEnergyFromHand: (step, run) => attachEnergyChosenFromHand(run, step),
  attachEnergyFromHandToSelf: (step, run) =>
    attachEnergyFromHandToHolder(run, step),
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
  searchDeckAndAttachEnergyToOnePokemon: (step, run) =>
    searchDeckAndAttachToOnePokemon(run, step),
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
  searchDeckOntoBench: (step, run) => {
    placeOntoBenchFrom(run, "deck", step);
    run.context.state.shuffleDeck();
  },
  shuffleHandIntoDeck: (_, { context }) => context.state.returnHandToDeck(),
  switchActiveWithBench: (step, { context, label }) => {
    const { state } = context;
    const benched = chooseOnePokemon(
      context,
      state.active === null
        ? []
        : listBenchMatchingOrAll(state, step.benchFilter),
      `${label}: バトル場と入れ替えるベンチポケモン`
    );
    if (benched !== null) {
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
    progress: { discardedCount: 0 },
    source,
  };
  for (const step of effect.steps) {
    if (step.operation === "branchOnCondition") {
      const branch = areConditionsMet(context.state, [step.condition], source)
        ? step.stepsWhenMet
        : step.stepsOtherwise;
      for (const inner of branch) {
        runOperation(inner, run);
      }
    } else {
      runOperation(step, run);
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
