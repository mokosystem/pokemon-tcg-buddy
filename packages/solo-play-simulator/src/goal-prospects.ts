/**
 * 道の揃い具合を見る評価(search-evaluators.ts の createPathProgressEvaluator)の、締め切りごと・狙いの段ごとの点。
 * 狙いが今の場で成り立っていれば 1、成り立っていなければ、主軸への道の必要なカードの揃い具合、ワザのエネルギー、
 * ダメージの下限までの距離から出した見込みに重みをかける。見込みは締め切りがこの番か後の番かで数え方が変わる。
 */

import { calculateAttackDamage } from "./attack-damage.ts";
import { canPlayTrainerFromHand } from "./card-effects.ts";
import {
  CardCategory,
  type CardFilter,
  type CardRecord,
  type EffectStep,
  type PokemonType,
} from "./card-record-schema.ts";
import {
  buildCardFromRecord,
  type Card,
  isEnergy,
  matchesCardFilter,
} from "./cards.ts";
import {
  calculateAttackCost,
  listEnergyUnits,
  resolveEnergyProvisionWhenAttached,
  toEnergyUnits,
} from "./continuous-effects.ts";
import { type DeadlineTiming, toDeadlineTiming } from "./deadline-timing.ts";
import {
  assignDeckFetchSources,
  canFetchInOneStep,
  countUnseenByRecord,
  type DeckFetchRelay,
  type DeckFetchSource,
  type FetchRequirement,
  type FetchRoute,
  listDeckFetchRelays,
  listDeckFetchSources,
  type UnseenCards,
} from "./deck-fetch-sources.ts";
import type {
  MainAttack,
  RequiredCard,
  ResolvedDeclaration,
} from "./declaration.ts";
import { type EffectContext, firstCandidateChoices } from "./effect-choices.ts";
import { findCardEffects } from "./effect-operations.ts";
import { canRetreatActive } from "./player-actions.ts";
import type { EvaluationInput } from "./search-policy.ts";
import {
  ENERGY_ATTACHMENTS_FROM_HAND_PER_TURN,
  type EnergyUnit,
  type GameState,
  listUnpaidCost,
  PokemonInPlay,
} from "./state.ts";

/**
 * 見込みの重み。いずれも「成り立っている(1)」より小さく、置き場所に近いほど大きくする。値は正しい手の局面で
 * 決めたもので、根拠の強いものではない。決めた局面と変えた経緯は設計文書(「順 7 で決めたこと(2 セッション目)」と
 * 「場の評価の数え漏れの修正(Issue 51)」)に記録している。
 */
export const PROGRESS_WEIGHTS = {
  /** 主軸の系統のポケモンがベンチにいて、この番にバトル場に出す手段(今使える手札の入れ替えるカード、にげる)がある。 */
  benchedWithWayToActiveThisTurn: 0.8,
  /** 必要なカードが山札かサイドにあるが、引くしかない(探す手段を割り当てられなかった)。 */
  drawOnly: 0.1,
  /** ワザに必要なエネルギーが手札にある(締め切りまでに手札からつけられる枚数まで)。場に出す必要なカードが手札にあるのと同じ尺度。 */
  energyInHand: 0.8,
  /** 場やスタジアムに必要なカードが手札にある(出す・進化させる・使うだけ)。 */
  inHandForPlace: 0.8,
  /** 主軸の系統のポケモンがベンチにいて、バトル場に出す手段が見当たらない。 */
  noWayToActive: 0.1,
  /** 必要なカードが山札かサイドにあり、手札や場の探す手段 1 枚を割り当てて山札から持ってこられる。 */
  searchableFromDeck: 0.4,
  /** 同上で、持ってくるのに 2 段(探すカードを探す)かかる。 */
  searchableInTwoSteps: 0.3,
  /** 主軸の系統のポケモンがベンチにいて、入れ替えるカードが山札かサイドにあり、手札や場の探す手段で持ってこられる。 */
  switchCardSearchable: 0.4,
  /** 狙いが成り立っていないときの見込みにかける重み。成り立っている狙い(1)より必ず小さくする。 */
  unachievedGoal: 0.5,
} as const;

/** 探す手段の割り当ての結果ごとの揃い具合。持ってくる先が残っていなければ 0(見えていない枚数を使い切った)。 */
const FETCH_ROUTE_WEIGHTS: Readonly<Record<FetchRoute, number>> = {
  drawOnly: PROGRESS_WEIGHTS.drawOnly,
  noCopyLeft: 0,
  oneStep: PROGRESS_WEIGHTS.searchableFromDeck,
  twoSteps: PROGRESS_WEIGHTS.searchableInTwoSteps,
};

/** 必要なカードを数える置き場所。evolvableThisTurn は場のポケモンのうち、この番に進化させられるもの。 */
type Zone = "hand" | "inPlay" | "evolvableThisTurn" | "unseen";

function countByRecord(cards: readonly Card[]): Map<CardRecord, number> {
  const counts = new Map<CardRecord, number>();
  for (const card of cards) {
    counts.set(card.record, (counts.get(card.record) ?? 0) + 1);
  }
  return counts;
}

interface PathView {
  readonly counts: Readonly<Record<Zone, ReadonlyMap<CardRecord, number>>>;
  /** 2 段の中継の一覧。道によらないので、締め切りの種類ごとに 1 回だけ作る。 */
  readonly relaysByTiming: Map<DeadlineTiming, readonly DeckFetchRelay[]>;
  readonly state: GameState;
  readonly unseen: UnseenCards;
}

function listRelaysOnce(
  view: PathView,
  timing: DeadlineTiming
): readonly DeckFetchRelay[] {
  let relays = view.relaysByTiming.get(timing);
  if (relays === undefined) {
    relays = listDeckFetchRelays(view.state, timing, view.unseen);
    view.relaysByTiming.set(timing, relays);
  }
  return relays;
}

/** 1 つの道を数えるときの、置き場所ごとの使った枚数。同じ道の中で同じ 1 枚を 2 つの必要なカードに数えないため。 */
class UsedCards {
  private readonly used: Record<Zone, Map<CardRecord, number>> = {
    evolvableThisTurn: new Map(),
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

  /** 手札から必要なカードとして使った、記録ごとの枚数。 */
  countUsedInHand(): ReadonlyMap<CardRecord, number> {
    return this.used.hand;
  }

  /** 見えていないカードのうち、まだ使っていない記録ごとの枚数と代表の 1 枚(残りが 0 の記録は入れない)。 */
  countRemainingUnseen(): UnseenCards {
    if (this.used.unseen.size === 0) {
      return this.view.unseen;
    }
    const remaining = new Map<CardRecord, { card: Card; count: number }>();
    for (const [record, { card, count }] of this.view.unseen) {
      const rest = count - (this.used.unseen.get(record) ?? 0);
      if (rest > 0) {
        remaining.set(record, { card, count: rest });
      }
    }
    return remaining;
  }
}

/**
 * 必要なカード 1 つの揃い具合。"fromUnseen" は見えていないカードから持ってくる必要があることを表し、揃い具合は道の
 * 必要なカードをすべて見た後に、探す手段を割り当ててから決める(探す手段 1 枚を必要なカード 1 つにだけ数えるため)。
 */
type RequiredCardProgress = number | "fromUnseen";

/** 場に出す・進化させる・スタジアムとして出すカード: 手札にあれば出すだけ、無ければ山札かサイドから。 */
function scoreFromHandOrUnseen(
  used: UsedCards,
  record: CardRecord
): RequiredCardProgress {
  return used.take("hand", record)
    ? PROGRESS_WEIGHTS.inHandForPlace
    : "fromUnseen";
}

type RequiredCardScorer = (
  view: PathView,
  used: UsedCards,
  record: CardRecord,
  timing: DeadlineTiming
) => RequiredCardProgress;

/**
 * 進化の元(前の番から場)。この番の締め切りには、この番に進化させられる場のポケモンだけが間に合う。判定は骨組みの
 * canEvolveThisTurn に任せ、「自分の最初の番は進化できない」「出したばかり・進化したばかりの番は進化できない」
 * (docs/pokemon-tcg/basic-rules.md 77 行)を評価の中に書き直さない。手札や見えていないカードは、出してもこの番には
 * 進化できないので 0。後の番の締め切りには、この番に出したポケモンも間に合うので場にいれば 1。
 */
const scoreEvolutionBase: RequiredCardScorer = (_, used, record, timing) => {
  if (timing === "thisTurn") {
    if (!used.take("evolvableThisTurn", record)) {
      return 0;
    }
    // 同じポケモンを、同じ道の別の必要なカード(置き場所が場)に重ねて数えない
    used.take("inPlay", record);
    return 1;
  }
  return used.take("inPlay", record) ? 1 : scoreFromHandOrUnseen(used, record);
};

/**
 * 必要なカード 1 つの揃い具合(0 以上 1 以下)を、置き場所ごとに求める。置き場所にあれば 1、近いほど大きい。
 * 置き場所の種類(declaration.ts の RequiredCardPlace)と 1 対 1 に対応させる。
 */
const requiredCardScorers: Readonly<
  Record<RequiredCard["place"], RequiredCardScorer>
> = {
  deck: (_, used, record) => (used.take("unseen", record) ? 1 : 0),
  hand: (_, used, record) => (used.take("hand", record) ? 1 : "fromUnseen"),
  inPlay: (_, used, record) =>
    used.take("inPlay", record) ? 1 : scoreFromHandOrUnseen(used, record),
  inPlaySincePreviousTurn: scoreEvolutionBase,
  stadium: (view, used, record) =>
    view.state.stadium?.record === record
      ? 1
      : scoreFromHandOrUnseen(used, record),
};

/**
 * 1 本の道が揃う見込み。必要なカードごとの揃い具合を、それぞれ揃う見込みとみなして掛け合わせる。見えていないカードから
 * 持ってくる必要のある必要なカードは、まとめて探す手段を割り当て(deck-fetch-sources.ts の assignDeckFetchSources)、
 * 1 段・2 段・引くしかないで揃い具合を決める。探す手段の一覧は道で手札から数えたカードを除くため、道ごとに作る。
 */
function scorePath(
  view: PathView,
  requiredCards: readonly RequiredCard[],
  timing: DeadlineTiming
): number {
  const used = new UsedCards(view);
  const requirements: FetchRequirement[] = [];
  let product = 1;
  for (const required of requiredCards) {
    const progress = requiredCardScorers[required.place](
      view,
      used,
      required.record,
      timing
    );
    if (progress === "fromUnseen") {
      requirements.push({ candidates: [required.record] });
    } else {
      product *= progress;
    }
  }
  if (requirements.length === 0 || product === 0) {
    return product;
  }
  const routes = assignDeckFetchSources(
    requirements,
    listDeckFetchSources(view.state, timing, used.countUsedInHand()),
    listRelaysOnce(view, timing),
    used.countRemainingUnseen(),
    timing
  );
  return routes.reduce(
    (total, route) => total * FETCH_ROUTE_WEIGHTS[route],
    product
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

/**
 * 効果の操作のうち、バトルポケモンをベンチポケモンと入れ替える操作(switchActiveWithBench)の、バトル場に出すベンチ
 * ポケモンの条件(条件が無ければ undefined)。条件の分かれ道とコインの中も、山札から持ってくる操作の条件を集めるとき
 * (deck-fetch-sources.ts)と同じ辿り方で見る。
 */
function listSwitchBenchFilters(
  steps: readonly EffectStep[]
): (CardFilter | undefined)[] {
  return steps.flatMap((step): (CardFilter | undefined)[] => {
    switch (step.operation) {
      case "switchActiveWithBench":
        return [step.benchFilter];
      case "branchOnCondition":
        return listSwitchBenchFilters([
          ...step.stepsWhenMet,
          ...step.stepsOtherwise,
        ]);
      case "branchOnCoinFlip":
        return listSwitchBenchFilters(step.stepsWhenHeads);
      default:
        return [];
    }
  });
}

const switchBenchFiltersByRecord = new WeakMap<
  CardRecord,
  readonly (CardFilter | undefined)[]
>();

/**
 * card が、ベンチの pokemon をバトル場に出せる入れ替えるカード(グッズかサポートで、使ったときの効果に入れ替えがあり、
 * 条件が pokemon に合う)か。ワザで入れ替えるもの(ノコッチ 047086 の「いれかわる」)は、ワザを使うと番が終わる
 * (docs/pokemon-tcg/basic-rules.md 67 行)ので数えない。
 */
function canSwitchIntoActive(card: Card, pokemon: PokemonInPlay): boolean {
  if (
    card.category !== CardCategory.Goods &&
    card.category !== CardCategory.Supporter
  ) {
    return false;
  }
  let filters = switchBenchFiltersByRecord.get(card.record);
  if (filters === undefined) {
    filters = findCardEffects(card, "whenPlayed").flatMap((cardEffect) =>
      listSwitchBenchFilters(cardEffect.effect.steps)
    );
    switchBenchFiltersByRecord.set(card.record, filters);
  }
  return filters.some(
    (filter) => filter === undefined || matchesCardFilter(pokemon.card, filter)
  );
}

const detachedCardsByRecord = new WeakMap<CardRecord, Card>();

/** 場に出たとみなした主軸(場には置かない)。主軸が場にいないときに、ダメージやつけたエネルギーの供給を数えるため。 */
function buildDetachedMain(state: GameState, main: MainAttack): PokemonInPlay {
  let card = detachedCardsByRecord.get(main.record);
  if (card === undefined) {
    card = buildCardFromRecord(main.record, main.record.cardIds[0] ?? "");
    detachedCardsByRecord.set(main.record, card);
  }
  return new PokemonInPlay(card, state.turn);
}

/**
 * 主軸がワザを使ったときのダメージの見込み。主軸が場にいればそのポケモン(バトル場を先に)で、いなければ場に出たと
 * みなした主軸で、記録の規則から求める(ダメージの上乗せが場のエネルギーの数などで決まるため)。
 */
function estimateMainAttackDamage(state: GameState, main: MainAttack): number {
  const attacker =
    state
      .listPokemonInPlay()
      .find((pokemon) => pokemon.card.record === main.record) ??
    buildDetachedMain(state, main);
  return calculateAttackDamage(state, attacker, main.attack) ?? 0;
}

/** 手札から主軸につけるエネルギーの組。filled は払えない分のうち埋めた数。 */
interface HandEnergySelection {
  /** 組に選んだ、記録ごとの枚数。同じ見込みの中で、同じカードを探す手段に重ねて数えないため。 */
  readonly counts: ReadonlyMap<CardRecord, number>;
  readonly filled: number;
  /** 組で埋めきれなかった払えない分。 */
  readonly rest: readonly PokemonType[];
}

/**
 * 手札のエネルギーから attachable 枚以下を選ぶ組をすべて試し、払えない分(unpaid)をいちばん多く埋める組を返す。
 * 埋めた数が同じなら枚数の少ない組。埋め方は listUnpaidCost(ついているエネルギーの判定 canPayCost と同じ)。
 * 供給は記録だけで決まるので、記録ごとの枚数で組を数える。
 */
function selectHandEnergies(
  handEnergies: readonly {
    readonly count: number;
    readonly record: CardRecord;
    readonly units: readonly EnergyUnit[];
  }[],
  unpaid: readonly PokemonType[],
  attachable: number
): HandEnergySelection {
  let best: HandEnergySelection = {
    counts: new Map(),
    filled: 0,
    rest: unpaid,
  };
  let bestCardCount = 0;
  const chosen: number[] = handEnergies.map(() => 0);
  const visit = (index: number, cardCount: number) => {
    const group = handEnergies[index];
    if (group === undefined) {
      const units = handEnergies.flatMap((entry, at) =>
        Array.from({ length: chosen[at] ?? 0 }, () => entry.units).flat()
      );
      const rest = listUnpaidCost(unpaid, units);
      const filled = unpaid.length - rest.length;
      if (
        filled > best.filled ||
        (filled === best.filled && cardCount < bestCardCount)
      ) {
        best = {
          counts: new Map(
            handEnergies.flatMap((entry, at) =>
              (chosen[at] ?? 0) > 0 ? [[entry.record, chosen[at] ?? 0]] : []
            )
          ),
          filled,
          rest,
        };
        bestCardCount = cardCount;
      }
      return;
    }
    const most = Math.min(group.count, attachable - cardCount);
    for (let count = 0; count <= most; count += 1) {
      chosen[index] = count;
      visit(index + 1, cardCount + count);
    }
    chosen[index] = 0;
  };
  visit(0, 0);
  return best;
}

function buildPathView(state: GameState): PathView {
  const unseen = countUnseenByRecord(state);
  const unseenCounts = new Map<CardRecord, number>();
  for (const [record, { count }] of unseen) {
    unseenCounts.set(record, count);
  }
  const pokemonInPlay = state.listPokemonInPlay();
  return {
    counts: {
      evolvableThisTurn: countByRecord(
        pokemonInPlay
          .filter((pokemon) => state.canEvolveThisTurn(pokemon))
          .map((pokemon) => pokemon.card)
      ),
      hand: countByRecord(state.hand),
      inPlay: countByRecord(pokemonInPlay.map((pokemon) => pokemon.card)),
      unseen: unseenCounts,
    },
    relaysByTiming: new Map(),
    state,
    unseen,
  };
}

/**
 * 1 つの状態について、狙いの見込みを数える。道の揃い具合を見る評価は判定が済んでいない締め切りごとに点を出すため、
 * 締め切りによらない部分(狙いが成り立っているか、置き場所ごとの枚数、エネルギーの供給、ダメージ)は 1 回だけ数えて
 * 締め切りの間で使い回す。
 */
export class GoalProspects {
  readonly input: EvaluationInput;
  private readonly declaration: ResolvedDeclaration;
  private readonly achievements = new Map<number, boolean>();
  private readonly standProspects = new Map<DeadlineTiming, number>();
  private readonly attackProspects = new Map<number, number>();
  private readonly activeSpotProspects = new Map<PokemonInPlay, number>();
  private readonly detachedMains = new Map<CardRecord, PokemonInPlay>();
  /** つけるポケモンごと・エネルギーの記録ごとの供給。締め切りによらないので使い回す。 */
  private readonly provisions = new Map<
    PokemonInPlay,
    Map<CardRecord, EnergyUnit[]>
  >();
  private view: PathView | undefined;
  private damageRatio: number | undefined;
  private canRetreat: boolean | undefined;
  private oneStepSources: readonly DeckFetchSource[] | undefined;

  constructor(declaration: ResolvedDeclaration, input: EvaluationInput) {
    this.declaration = declaration;
    this.input = input;
  }

  /** 宣言から導いた狙いの index 段目(0 が立つ)が、今の場で成り立っているか。 */
  isGoalAchieved(index: number): boolean {
    let achieved = this.achievements.get(index);
    if (achieved === undefined) {
      achieved = this.declaration.goals[index]?.isAchieved(this.input.state);
      if (achieved === undefined) {
        throw new Error(`宣言から導いた狙いに ${index + 1} 段目が無い`);
      }
      this.achievements.set(index, achieved);
    }
    return achieved;
  }

  /** 主軸への道のどれか 1 本が、締め切りまでに揃う見込み(0 以上 1 以下)。 */
  calculateStandProspect(timing: DeadlineTiming): number {
    let prospect = this.standProspects.get(timing);
    if (prospect === undefined) {
      const view = this.countPathViewOnce();
      // どれか 1 本の道が揃えば立つので、道ごとの見込みを別々の機会とみなして「少なくとも 1 本揃う」見込みにする
      prospect =
        1 -
        this.declaration.paths.reduce(
          (product, path) =>
            product * (1 - scorePath(view, path.requiredCards, timing)),
          1
        );
      this.standProspects.set(timing, prospect);
    }
    return prospect;
  }

  /** 置き場所ごとの枚数と探して持ってこられる記録を、締め切りの間で使い回すため 1 回だけ数える。 */
  private countPathViewOnce(): PathView {
    this.view ??= buildPathView(this.input.state);
    return this.view;
  }

  /**
   * 2 段目(打てる)の見込み(0 以上 1 以下)。主軸のワザごと・系統の場のポケモン p ごとに、立つ見込み(立っていれば 1)、
   * p のエネルギーの見込み、p をバトル場に出せる見込みの 3 つを平均し、いちばん高いものを採る。系統のポケモンが場に
   * いなければ、エネルギーの見込みを 0、バトル場に出せる見込みを noWayToActive として平均する。
   */
  calculateAttackProspect(deadline: number): number {
    let prospect = this.attackProspects.get(deadline);
    if (prospect === undefined) {
      const standScore = this.isGoalAchieved(0)
        ? 1
        : this.calculateStandProspect(
            toDeadlineTiming(deadline, this.input.fromTurn)
          );
      const { state } = this.input;
      let bestLineScore: number = PROGRESS_WEIGHTS.noWayToActive;
      for (const main of this.declaration.mainAttacks) {
        const lineNames = listEvolutionLineNames(main);
        for (const attacker of state.listPokemonInPlay()) {
          if (lineNames.has(attacker.name)) {
            bestLineScore = Math.max(
              bestLineScore,
              this.calculateAttackEnergyProspect(main, attacker, deadline) +
                this.calculateActiveSpotProspect(attacker)
            );
          }
        }
      }
      prospect = (standScore + bestLineScore) / 3;
      this.attackProspects.set(deadline, prospect);
    }
    return prospect;
  }

  /**
   * 場のポケモン pokemon(主軸の進化の系統)を、ワザを使うバトル場に出せる見込み(0 以上 1 以下。締め切りによらない)。
   * バトル場にいれば 1(対戦の準備でバトル場に置いたたねも)。ベンチにいて、今使える手札の入れ替えるカードがあるか、
   * 今のバトルポケモンがにげられれば benchedWithWayToActiveThisTurn。入れ替えるカードが見えていないカードにあり、手札か
   * 場の探す手段で 1 段で持ってこられれば switchCardSearchable。どれでもなければ noWayToActive。にげるエネルギーを
   * 0 にするカード(ラティアスex 046248 の「スカイライン」)は、ベンチに出す手を試した後の場で canRetreatActive が
   * 真になることで数え、手札にあるそのカードを先回りして数えない(Issue 51 の数え漏れ 4)。
   */
  calculateActiveSpotProspect(pokemon: PokemonInPlay): number {
    let prospect = this.activeSpotProspects.get(pokemon);
    if (prospect === undefined) {
      prospect = this.measureActiveSpotProspect(pokemon);
      this.activeSpotProspects.set(pokemon, prospect);
    }
    return prospect;
  }

  private measureActiveSpotProspect(pokemon: PokemonInPlay): number {
    const { state } = this.input;
    if (state.active === pokemon) {
      return 1;
    }
    const context: EffectContext = { choices: firstCandidateChoices, state };
    const hasUsableSwitchCard = state.hand.some(
      (card) =>
        canSwitchIntoActive(card, pokemon) &&
        canPlayTrainerFromHand(context, card)
    );
    this.canRetreat ??= canRetreatActive(state);
    if (hasUsableSwitchCard || this.canRetreat) {
      return PROGRESS_WEIGHTS.benchedWithWayToActiveThisTurn;
    }
    return this.canFetchSwitchCardFor(pokemon)
      ? PROGRESS_WEIGHTS.switchCardSearchable
      : PROGRESS_WEIGHTS.noWayToActive;
  }

  /**
   * ベンチの pokemon をバトル場に出せる入れ替えるカードが見えていないカードにあり、手札か場の探す手段 1 枚で山札から
   * 持ってこられるか。バトル場に出せる見込みは締め切りによらない 1 つの値なので、探す手段を道やエネルギーと分け合わず、
   * 割り当てでなく記録の単位で見る。この番に使えるかで探す手段を絞らない(「この番に出す手段」は手札の入れ替えるカードと
   * にげるで数え、この段は後の番を含めて持ってこられるかを見るため)。
   */
  private canFetchSwitchCardFor(pokemon: PokemonInPlay): boolean {
    const view = this.countPathViewOnce();
    this.oneStepSources ??= listDeckFetchSources(
      this.input.state,
      "laterTurn",
      new Map()
    );
    const sources = this.oneStepSources;
    if (sources.length === 0) {
      return false;
    }
    for (const { card } of view.unseen.values()) {
      if (
        canSwitchIntoActive(card, pokemon) &&
        canFetchInOneStep(sources, card)
      ) {
        return true;
      }
    }
    return false;
  }

  /**
   * attacker が主軸のワザ main を使うのに必要なエネルギーが、締め切り deadline までに揃う見込み(0 以上 1 以下)。
   * ワザの要求 1 つごとの揃い具合(ついている 1、手札にある energyInHand、山札から 1 段・2 段で持ってこられる、引くしか
   * ない、見えていないカードにも供給の合うエネルギーが無ければ 0)の合計を要求の数で割る。要求を埋める順は
   * listUnpaidCost(ついているエネルギーの判定 canPayCost と同じ)。手札と見えていないカードのエネルギーは、主軸に
   * つけたとしたら供給するもので数える(プリズムエネルギー 049455 は 2進化の主軸には無色 1 個)。
   */
  calculateAttackEnergyProspect(
    main: MainAttack,
    attacker: PokemonInPlay,
    deadline: number
  ): number {
    const { fromTurn, state } = this.input;
    const cost = calculateAttackCost(state, attacker, main.attack);
    if (cost.length === 0) {
      return 1;
    }
    const unpaid = listUnpaidCost(cost, listEnergyUnits(state, attacker));
    if (unpaid.length === 0) {
      return 1;
    }
    const holder =
      attacker.card.record === main.record
        ? attacker
        : this.placeDetachedMainOnce(main);
    // 手札からつけられるのは 1 回の番に 1 枚(docs/pokemon-tcg/basic-rules.md 72 行)。この番に既につけていれば、
    // この番の分を数えない
    const attachable =
      (deadline - fromTurn + (state.hasAttachedEnergy ? 0 : 1)) *
      ENERGY_ATTACHMENTS_FROM_HAND_PER_TURN;
    const fromHand = selectHandEnergies(
      this.listHandEnergies(holder),
      unpaid,
      attachable
    );
    let total =
      cost.length -
      unpaid.length +
      fromHand.filled * PROGRESS_WEIGHTS.energyInHand;
    if (fromHand.rest.length === 0) {
      return total / cost.length;
    }
    const view = this.countPathViewOnce();
    // どの記録を持ってくる先にするかは割り当てが決め、同じ 1 枚を 2 つの要求に使わない。合うエネルギーが見えていない
    // カードに無い要求は 0 のまま割り当てに渡さない
    const requirements = fromHand.rest.flatMap((required) => {
      const candidates = this.listUnseenEnergiesProviding(
        view,
        holder,
        required
      );
      return candidates.length === 0 ? [] : [{ candidates }];
    });
    if (requirements.length > 0) {
      const timing = toDeadlineTiming(deadline, fromTurn);
      // エネルギーの見込みは道の見込みと別の見込みとして平均するので、探す手段と見えていないカードを道と分け合わない
      const routes = assignDeckFetchSources(
        requirements,
        listDeckFetchSources(state, timing, fromHand.counts),
        listRelaysOnce(view, timing),
        view.unseen,
        timing
      );
      total += routes.reduce(
        (sum, route) => sum + FETCH_ROUTE_WEIGHTS[route],
        0
      );
    }
    return total / cost.length;
  }

  private placeDetachedMainOnce(main: MainAttack): PokemonInPlay {
    let holder = this.detachedMains.get(main.record);
    if (holder === undefined) {
      holder = buildDetachedMain(this.input.state, main);
      this.detachedMains.set(main.record, holder);
    }
    return holder;
  }

  /** energy を holder につけたとしたら供給する 1 個ずつのタイプ(記録ごとに覚える)。 */
  private resolveUnitsWhenAttached(
    holder: PokemonInPlay,
    energy: Card
  ): EnergyUnit[] {
    let byRecord = this.provisions.get(holder);
    if (byRecord === undefined) {
      byRecord = new Map();
      this.provisions.set(holder, byRecord);
    }
    let units = byRecord.get(energy.record);
    if (units === undefined) {
      units = toEnergyUnits(
        resolveEnergyProvisionWhenAttached(this.input.state, holder, energy)
      );
      byRecord.set(energy.record, units);
    }
    return units;
  }

  /** 手札のエネルギーの、記録ごとの枚数と holder につけたとしたら供給するもの。 */
  private listHandEnergies(holder: PokemonInPlay) {
    const counts = countByRecord(this.input.state.hand.filter(isEnergy));
    const representatives = new Map(
      this.input.state.hand.map((card) => [card.record, card])
    );
    return [...counts].flatMap(([record, count]) => {
      const card = representatives.get(record);
      return card === undefined
        ? []
        : [
            {
              count,
              record,
              units: this.resolveUnitsWhenAttached(holder, card),
            },
          ];
    });
  }

  /** 見えていないエネルギーのうち、holder につけたとしたら要求 required を 1 つ埋められるものの記録。 */
  private listUnseenEnergiesProviding(
    view: PathView,
    holder: PokemonInPlay,
    required: PokemonType
  ): CardRecord[] {
    const records: CardRecord[] = [];
    for (const [record, { card }] of view.unseen) {
      if (
        isEnergy(card) &&
        listUnpaidCost([required], this.resolveUnitsWhenAttached(holder, card))
          .length === 0
      ) {
        records.push(record);
      }
    }
    return records;
  }

  /** 主軸のワザのダメージの見込みが、ダメージの下限に対してどれだけ届いているか(0 以上 1 以下)。 */
  calculateDamageRatio(): number {
    const { minimumDamage } = this.declaration;
    if (minimumDamage === undefined) {
      throw new Error("宣言にダメージの下限が無い");
    }
    this.damageRatio ??= Math.max(
      ...this.declaration.mainAttacks.map((main) =>
        Math.min(
          1,
          estimateMainAttackDamage(this.input.state, main) / minimumDamage
        )
      )
    );
    return this.damageRatio;
  }
}

/**
 * 締め切り deadline についての、狙いの段ごとの点。成り立っていれば 1、成り立っていなければ見込みに unachievedGoal の
 * 重みをかけたもの。
 * 1 段目(立つ): 主軸への道ごとの見込み(必要なカードの揃い具合の積)から、少なくとも 1 本揃う見込み。
 * 2 段目(打てる): 1 段目の見込み(成り立っていれば 1)、ワザのエネルギーの見込み、バトル場に出せる見込みの平均
 * (GoalProspects の calculateAttackProspect)。
 * 3 段目(N 以上): 2 段目の見込みと、ダメージの見込みの下限に対する割合の平均。
 */
export function scoreGoalsByPathProgress(
  declaration: ResolvedDeclaration,
  prospects: GoalProspects,
  deadline: number
): number[] {
  const [standGoal, attackGoal, damageGoal] = declaration.goals;
  if (standGoal === undefined || attackGoal === undefined) {
    throw new Error("宣言から導いた狙いが 2 段に満たない");
  }
  const timing = toDeadlineTiming(deadline, prospects.input.fromTurn);
  // 「番を終える」を試すとき(stage が actionsDone)は、この番の狙いにもう何も届かないので、成り立っていない狙いの
  // 見込みを 0 にする(Issue 51 の決定事項 2026-10-18)。手札に残した探すカードの見込みを番を終える手に数えると、
  // 探すカードを使う手(見えていないカードを混ぜ直した数通りの平均)が番を終える手を下回ることがあるため
  const unachievedWeight =
    prospects.input.stage === "actionsDone" && timing === "thisTurn"
      ? 0
      : PROGRESS_WEIGHTS.unachievedGoal;
  const weigh = (achieved: boolean, progress: () => number) => {
    if (achieved) {
      return 1;
    }
    return unachievedWeight === 0 ? 0 : unachievedWeight * progress();
  };
  const isStanding = prospects.isGoalAchieved(0);
  const standScore = isStanding ? 1 : prospects.calculateStandProspect(timing);
  const isAttacking = prospects.isGoalAchieved(1);
  const attackProgress = () => prospects.calculateAttackProspect(deadline);
  const scores = [
    weigh(isStanding, () => standScore),
    weigh(isAttacking, attackProgress),
  ];
  const { minimumDamage } = declaration;
  if (damageGoal !== undefined && minimumDamage !== undefined) {
    scores.push(
      weigh(
        prospects.isGoalAchieved(2),
        () =>
          ((isAttacking ? 1 : attackProgress()) +
            prospects.calculateDamageRatio()) /
          2
      )
    );
  }
  return scores;
}
