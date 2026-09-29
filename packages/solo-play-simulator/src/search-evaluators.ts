/**
 * 探索の評価(docs/solo-play-simulator-design.md「宣言と探索(Issue 27 の順 7)」の評価の候補)。どれも「宣言の狙い
 * (3 段 × 締め切り)の成立確率の合計」を見積もる。判定がまだ済んでいない締め切りについて、狙いが今の場で成り立って
 * いれば 1、成り立っていなければ評価ごとの見積もりを足す。
 *
 * - その番の狙いだけを見る評価: 成り立っていなければ 0。1 番先を見ない基準
 * - 道の揃い具合を見る評価: 成り立っていなければ、主軸への道の必要なカードの揃い具合、ワザのエネルギー、ダメージの
 *   下限までの距離から 0 以上 1 未満の見込みを出す。1 番先を数え上げだけで見る
 */

import { calculateAttackDamage } from "./attack-damage.ts";
import { resolveEndOfTurnTriggers } from "./card-effects.ts";
import {
  CardCategory,
  type CardFilter,
  type CardRecord,
  type EffectStep,
} from "./card-record-schema.ts";
import { buildCardFromRecord, type Card, matchesCardFilter } from "./cards.ts";
import { calculateAttackCost, listEnergyUnits } from "./continuous-effects.ts";
import type {
  MainAttack,
  RequiredCard,
  ResolvedDeclaration,
} from "./declaration.ts";
import type { EffectChoices } from "./effect-choices.ts";
import { type PlayingPolicy, useAttacksOfTurn } from "./engine.ts";
import { SeededRandom } from "./random.ts";
import {
  createSearchPolicy,
  type EvaluationInput,
  type Evaluator,
  type TurnStage,
} from "./search-policy.ts";
import { type GameState, PokemonInPlay } from "./state.ts";

/** 判定がまだ済んでいない締め切りの数。今成り立っている狙いは、この数だけ成立確率の合計に効く。 */
function countOpenDeadlines(
  declaration: ResolvedDeclaration,
  fromTurn: number
): number {
  return declaration.deadlines.filter((deadline) => deadline >= fromTurn)
    .length;
}

/** その番の狙いだけを見る評価。今の場で成り立っている狙いの数 × 判定がまだ済んでいない締め切りの数。 */
export function createGoalOnlyEvaluator(
  declaration: ResolvedDeclaration
): Evaluator {
  return ({ fromTurn, state }) =>
    countOpenDeadlines(declaration, fromTurn) *
    declaration.goals.filter((goal) => goal.isAchieved(state)).length;
}

// ---- 道の揃い具合を見る評価 ----

/**
 * 見込みの重み。いずれも「成り立っている(1)」より小さく、置き場所に近いほど大きくする。値は題材の局面で
 * 決めたもので、根拠の強いものではない(設計文書に記録する)。
 */
const PROGRESS_WEIGHTS = {
  /** 必要なカードが山札かサイドにあるが、引くしかない。 */
  drawOnly: 0.1,
  /** 場やスタジアムに必要なカードが手札にある(出す・進化させる・使うだけ)。 */
  inHandForPlace: 0.8,
  /** 必要なカードが山札かサイドにあり、手札や場のカードの効果で山札から持ってこられる。 */
  searchableFromDeck: 0.5,
  /** 同上で、持ってくるのに 2 段(探すカードを探す)かかる。 */
  searchableInTwoSteps: 0.3,
  /** 狙いが成り立っていないときの見込みにかける重み。成り立っている狙い(1)より必ず小さくする。 */
  unachievedGoal: 0.5,
} as const;

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
function countUnseenByRecord(
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
function findSearchableRecords(
  state: GameState,
  unseen: ReadonlyMap<CardRecord, { card: Card; count: number }>
): { oneStep: Set<CardRecord>; twoSteps: Set<CardRecord> } {
  const inPlay = [
    ...(state.stadium === null ? [] : [state.stadium]),
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

type Zone = "hand" | "inPlay" | "unseen";

function countByRecord(cards: readonly Card[]): Map<CardRecord, number> {
  const counts = new Map<CardRecord, number>();
  for (const card of cards) {
    counts.set(card.record, (counts.get(card.record) ?? 0) + 1);
  }
  return counts;
}

interface PathView {
  readonly counts: Readonly<Record<Zone, ReadonlyMap<CardRecord, number>>>;
  readonly searchable: {
    readonly oneStep: ReadonlySet<CardRecord>;
    readonly twoSteps: ReadonlySet<CardRecord>;
  };
  readonly state: GameState;
}

/** 1 つの道を数えるときの、置き場所ごとの使った枚数。同じ道の中で同じ 1 枚を 2 つの必要なカードに数えないため。 */
class UsedCards {
  private readonly used: Record<Zone, Map<CardRecord, number>> = {
    hand: new Map(),
    inPlay: new Map(),
    unseen: new Map(),
  };
  private readonly view: PathView;

  constructor(view: PathView) {
    this.view = view;
  }

  /** zone に record のカードが残っていれば 1 枚使い、使えたかを返す。 */
  take(zone: Zone, record: CardRecord): boolean {
    const used = this.used[zone].get(record) ?? 0;
    if ((this.view.counts[zone].get(record) ?? 0) <= used) {
      return false;
    }
    this.used[zone].set(record, used + 1);
    return true;
  }
}

function scoreUnseen(view: PathView, record: CardRecord): number {
  if (view.searchable.oneStep.has(record)) {
    return PROGRESS_WEIGHTS.searchableFromDeck;
  }
  if (view.searchable.twoSteps.has(record)) {
    return PROGRESS_WEIGHTS.searchableInTwoSteps;
  }
  return PROGRESS_WEIGHTS.drawOnly;
}

function scoreFromUnseen(
  view: PathView,
  used: UsedCards,
  record: CardRecord
): number {
  return used.take("unseen", record) ? scoreUnseen(view, record) : 0;
}

/** 場に出す・進化させる・スタジアムとして出すカード: 手札にあれば出すだけ、無ければ山札かサイドから。 */
function scoreFromHandOrUnseen(
  view: PathView,
  used: UsedCards,
  record: CardRecord
): number {
  return used.take("hand", record)
    ? PROGRESS_WEIGHTS.inHandForPlace
    : scoreFromUnseen(view, used, record);
}

type RequiredCardScorer = (
  view: PathView,
  used: UsedCards,
  record: CardRecord
) => number;

/**
 * 必要なカード 1 つの揃い具合(0 以上 1 以下)を、置き場所ごとに求める。置き場所にあれば 1、近いほど大きい。
 * 置き場所の種類(declaration.ts の RequiredCardPlace)と 1 対 1 に対応させる。
 */
const requiredCardScorers: Readonly<
  Record<RequiredCard["place"], RequiredCardScorer>
> = {
  deck: (_, used, record) => (used.take("unseen", record) ? 1 : 0),
  hand: (view, used, record) =>
    used.take("hand", record) ? 1 : scoreFromUnseen(view, used, record),
  inPlay: (view, used, record) =>
    used.take("inPlay", record) ? 1 : scoreFromHandOrUnseen(view, used, record),
  inPlaySincePreviousTurn: (view, used, record) =>
    used.take("inPlay", record) ? 1 : scoreFromHandOrUnseen(view, used, record),
  stadium: (view, used, record) =>
    view.state.stadium?.record === record
      ? 1
      : scoreFromHandOrUnseen(view, used, record),
};

/** 1 本の道が揃う見込み。必要なカードごとの揃い具合を、それぞれ揃う見込みとみなして掛け合わせる。 */
function scorePath(
  view: PathView,
  requiredCards: readonly RequiredCard[]
): number {
  const used = new UsedCards(view);
  return requiredCards.reduce(
    (product, required) =>
      product *
      requiredCardScorers[required.place](view, used, required.record),
    1
  );
}

/** 主軸の進化の系統の名前(主軸、進化前、系統のたね)。これらのポケモンについたエネルギーは主軸のワザに使える。 */
function listEvolutionLineNames(main: MainAttack): Set<string> {
  const { record } = main;
  return new Set([
    record.name,
    ...("evolvesFrom" in record ? [record.evolvesFrom] : []),
    ...("basicPokemonOfEvolutionLine" in record
      ? [record.basicPokemonOfEvolutionLine]
      : []),
  ]);
}

/** 主軸の系統の場のポケモンについているエネルギーが、主軸のワザに必要な数にどれだけ届いているか(0 以上 1 以下)。 */
function scoreAttackEnergy(state: GameState, main: MainAttack): number {
  const lineNames = listEvolutionLineNames(main);
  const scores = state
    .listPokemonInPlay()
    .filter((pokemon) => lineNames.has(pokemon.name))
    .map((pokemon) => {
      const cost = calculateAttackCost(state, pokemon, main.attack).length;
      return cost === 0
        ? 1
        : Math.min(1, listEnergyUnits(state, pokemon).length / cost);
    });
  return scores.length === 0 ? 0 : Math.max(...scores);
}

const detachedCardsByRecord = new WeakMap<CardRecord, Card>();

/**
 * 主軸がワザを使ったときのダメージの見込み。主軸が場にいればそのポケモン(バトル場を先に)で、いなければ場に出たと
 * みなした主軸で、記録の規則から求める(ダメージの上乗せが場のエネルギーの数などで決まるため)。
 */
function estimateMainAttackDamage(state: GameState, main: MainAttack): number {
  const inPlay = state
    .listPokemonInPlay()
    .find((pokemon) => pokemon.card.record === main.record);
  let attacker = inPlay;
  if (attacker === undefined) {
    let card = detachedCardsByRecord.get(main.record);
    if (card === undefined) {
      card = buildCardFromRecord(main.record, main.record.cardIds[0] ?? "");
      detachedCardsByRecord.set(main.record, card);
    }
    attacker = new PokemonInPlay(card, state.turn);
  }
  return calculateAttackDamage(state, attacker, main.attack) ?? 0;
}

/**
 * 狙いの段ごとの点。成り立っていれば 1、成り立っていなければ見込みに unachievedGoal の重みをかけたもの。
 * 1 段目(立つ): 主軸への道ごとの見込み(必要なカードの揃い具合の積)から、少なくとも 1 本揃う見込み。
 * 2 段目(打てる): 1 段目の見込み(成り立っていれば 1)とワザのエネルギーの揃い具合の平均。
 * 3 段目(N 以上): 2 段目の見込みと、ダメージの見込みの下限に対する割合の平均。
 */
function scoreGoalsByPathProgress(
  declaration: ResolvedDeclaration,
  state: GameState
): number[] {
  const [standGoal, attackGoal, damageGoal] = declaration.goals;
  if (standGoal === undefined || attackGoal === undefined) {
    throw new Error("宣言から導いた狙いが 2 段に満たない");
  }
  const buildView = (): PathView => {
    const unseen = countUnseenByRecord(state);
    const unseenCounts = new Map<CardRecord, number>();
    for (const [record, { count }] of unseen) {
      unseenCounts.set(record, count);
    }
    return {
      counts: {
        hand: countByRecord(state.hand),
        inPlay: countByRecord(
          state.listPokemonInPlay().map((pokemon) => pokemon.card)
        ),
        unseen: unseenCounts,
      },
      searchable: findSearchableRecords(state, unseen),
      state,
    };
  };
  const weigh = (achieved: boolean, progress: () => number) =>
    achieved ? 1 : PROGRESS_WEIGHTS.unachievedGoal * progress();
  // どれか 1 本の道が揃えば立つので、道ごとの見込みを別々の機会とみなして「少なくとも 1 本揃う」見込みにする
  const standProgress = () => {
    const view = buildView();
    return (
      1 -
      declaration.paths.reduce(
        (product, path) => product * (1 - scorePath(view, path.requiredCards)),
        1
      )
    );
  };
  const isStanding = standGoal.isAchieved(state);
  const standScore = isStanding ? 1 : standProgress();
  const isAttacking = attackGoal.isAchieved(state);
  const attackProgress = () =>
    (standScore +
      Math.max(
        ...declaration.mainAttacks.map((main) => scoreAttackEnergy(state, main))
      )) /
    2;
  const scores = [
    weigh(isStanding, () => standScore),
    weigh(isAttacking, attackProgress),
  ];
  const { minimumDamage } = declaration;
  if (damageGoal !== undefined && minimumDamage !== undefined) {
    const attackScore = isAttacking ? 1 : attackProgress();
    scores.push(
      weigh(
        damageGoal.isAchieved(state),
        () =>
          (attackScore +
            Math.max(
              ...declaration.mainAttacks.map((main) =>
                Math.min(
                  1,
                  estimateMainAttackDamage(state, main) / minimumDamage
                )
              )
            )) /
          2
      )
    );
  }
  return scores;
}

/** 道の揃い具合を見る評価。狙いの段ごとの点(scoreGoalsByPathProgress)の合計 × 判定がまだ済んでいない締め切りの数。 */
export function createPathProgressEvaluator(
  declaration: ResolvedDeclaration
): Evaluator {
  return ({ fromTurn, state }) => {
    const openDeadlines = countOpenDeadlines(declaration, fromTurn);
    if (openDeadlines === 0) {
      return 0;
    }
    return (
      scoreGoalsByPathProgress(declaration, state).reduce(
        (total, score) => total + score,
        0
      ) * openDeadlines
    );
  };
}

// ---- 次の番を試す評価 ----

export interface NextTurnTrialOptions {
  /** 1 回の評価で試す回数。 */
  readonly trials: number;
}

/**
 * 次の番を試す評価。見えていないカードを混ぜ直した複製で、その番の残りと次の番を、道の揃い具合を見る評価の軽い探索
 * (効果の中の選択は候補の先頭から選び、結果が見えていないカードで決まる行動も 1 回だけ試す)で進め、trials 回の
 * 平均をとる。進めた番までの締め切りは、その番の終わり(ワザを使う前)に狙いが成り立ったかで 1 か 0、進めた番より
 * 後の締め切りは、進めた最後の番の終わりの場で道の揃い具合を見る評価の点を使う(2026-09-27 に開発責任者と決定)。
 */
export function createNextTurnTrialEvaluator(
  declaration: ResolvedDeclaration,
  options: NextTurnTrialOptions
): Evaluator {
  const lastDeadline = Math.max(...declaration.deadlines);
  return (input) => {
    const openDeadlines = declaration.deadlines.filter(
      (deadline) => deadline >= input.fromTurn
    );
    if (openDeadlines.length === 0) {
      return 0;
    }
    const lastTurn = Math.min(input.fromTurn + 1, lastDeadline);
    const seedRandom = new SeededRandom(input.seed);
    let total = 0;
    for (let trial = 0; trial < options.trials; trial += 1) {
      const result = playTrialTurns(
        declaration,
        input,
        lastTurn,
        seedRandom.nextSeed()
      );
      result.firstAchievedTurns.forEach((firstTurn, index) => {
        for (const deadline of openDeadlines) {
          if (firstTurn !== null && firstTurn <= deadline) {
            total += 1;
          } else if (deadline > lastTurn) {
            total += result.leafScores[index] ?? 0;
          }
        }
      });
    }
    return total / options.trials;
  };
}

/**
 * 見えていないカードを混ぜ直した複製で、fromTurn の番から lastTurn の番までを軽い探索で進める。狙いごとに最初に
 * 成り立った番と、最後の番の終わりの道の揃い具合を見る評価の点を返す。
 */
function playTrialTurns(
  declaration: ResolvedDeclaration,
  { fromTurn, stage, state, statistics }: EvaluationInput,
  lastTurn: number,
  trialSeed: number
): { firstAchievedTurns: (number | null)[]; leafScores: number[] } {
  const rollout = createSearchPolicy(
    declaration,
    createPathProgressEvaluator(declaration),
    {
      samplesForUncertainOutcome: 1,
      searchesEffectChoices: false,
      seed: trialSeed,
    }
  );
  const copy = state.clone(new SeededRandom(trialSeed));
  statistics.clones += 1;
  copy.remixUnseenCards();
  const context = { choices: rollout, state: copy };
  const firstAchievedTurns = declaration.goals.map((): number | null => null);
  let isPlayable = beginTrialTurn(copy, fromTurn, stage);
  for (let turn = fromTurn; isPlayable && turn <= lastTurn; turn += 1) {
    // 「番を終える」を試すときは、その番の行動をもう行わない
    if (turn > fromTurn || stage !== "actionsDone") {
      rollout.playTurn(context);
    }
    declaration.goals.forEach((goal, index) => {
      if (firstAchievedTurns[index] === null && goal.isAchieved(copy)) {
        firstAchievedTurns[index] = turn;
      }
    });
    if (turn < lastTurn) {
      isPlayable = finishTrialTurn(context, rollout);
    }
  }
  statistics.clones += rollout.statistics.clones;
  statistics.evaluations += rollout.statistics.evaluations;
  return {
    firstAchievedTurns,
    leafScores: scoreGoalsByPathProgress(declaration, copy),
  };
}

/**
 * 試しの番の終わり(ワザ、番の終わりの効果)を行い、次の番を始める。山札が無くて始められなければ偽。ワザは runGame と
 * 同じく、2 回目を使える効果(「おまつりおんど」)があれば 2 回目も選ばせる。
 */
function finishTrialTurn(
  context: { readonly choices: EffectChoices; readonly state: GameState },
  rollout: PlayingPolicy
): boolean {
  useAttacksOfTurn(context, rollout);
  resolveEndOfTurnTriggers(context);
  if (context.state.deck.length === 0) {
    return false;
  }
  context.state.beginTurn();
  return true;
}

/** 試しを fromTurn の番の中から始められるようにする。準備の後なら番を始め、番の最初の 1 枚を引く前なら引く。 */
function beginTrialTurn(
  state: GameState,
  fromTurn: number,
  stage: TurnStage
): boolean {
  if (state.turn < fromTurn) {
    if (state.deck.length === 0) {
      return false;
    }
    state.beginTurn();
    return true;
  }
  if (stage === "beforeDraw") {
    if (state.deck.length === 0) {
      return false;
    }
    state.draw(1);
  }
  return true;
}
