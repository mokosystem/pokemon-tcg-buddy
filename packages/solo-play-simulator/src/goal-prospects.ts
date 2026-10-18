/**
 * 道の揃い具合を見る評価(search-evaluators.ts の createPathProgressEvaluator)の、締め切りごと・狙いの段ごとの点。
 * 狙いが今の場で成り立っていれば 1、成り立っていなければ、主軸への道の必要なカードの揃い具合、ワザのエネルギー、
 * ダメージの下限までの距離から出した見込みに重みをかける。見込みは締め切りがこの番か後の番かで数え方が変わる。
 */

import { estimateAttackDamageWithPartialThresholds } from "./attack-damage.ts";
import { listUsableAttacksOfActive, useAttack } from "./card-effects.ts";
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
  type CardsOfRecord,
  countCardsByRecord,
  isEnergy,
  matchesCardFilter,
} from "./cards.ts";
import {
  calculateAttackCost,
  listEnergyUnits,
  resolveEnergyProvisionWhenAttached,
  toEnergyUnits,
  type UsableAttack,
} from "./continuous-effects.ts";
import { type DeadlineTiming, toDeadlineTiming } from "./deadline-timing.ts";
import {
  assignDeckFetchSources,
  canAttachByEffectTo,
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
import {
  isMainAttackCandidate,
  type MainAttack,
  type RequiredCard,
  type ResolvedDeclaration,
} from "./declaration.ts";
import { type EffectContext, firstCandidateChoices } from "./effect-choices.ts";
import {
  findCardEffects,
  listPossibleOperations,
} from "./effect-operations.ts";
import { findOrCreate } from "./find-or-create.ts";
import { canRetreatActive } from "./player-actions.ts";
import { SeededRandom } from "./random.ts";
import { type EvaluationInput, endTurnForEvaluation } from "./search-policy.ts";
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
  /** 主軸の系統のポケモンがベンチにいて、この番にバトル場に出す手段(手札の入れ替えるカード、にげる)がある。 */
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

/** 見えていないカード(view.unseen から数える)のほかの置き場所。 */
type CountedZone = Exclude<Zone, "unseen">;

interface PathView {
  /** 置き場所ごとの記録ごとの枚数。道によって要る置き場所が違う(この番に進化させられるものはこの番の締め切りの進化の元だけ)ので、初めて要るときに数える。 */
  readonly counts: Map<CountedZone, ReadonlyMap<CardRecord, CardsOfRecord>>;
  /** 2 段の中継の一覧。道によらないので、締め切りの種類ごとに 1 回だけ作る。 */
  readonly relaysByTiming: Map<DeadlineTiming, readonly DeckFetchRelay[]>;
  readonly state: GameState;
  readonly unseen: UnseenCards;
}

function listCardsInZone(state: GameState, zone: CountedZone): Card[] {
  switch (zone) {
    case "hand":
      return state.hand;
    case "inPlay":
      return state.listPokemonInPlay().map((pokemon) => pokemon.card);
    default:
      return state
        .listPokemonInPlay()
        .filter((pokemon) => state.canEvolveThisTurn(pokemon))
        .map((pokemon) => pokemon.card);
  }
}

/** zone にある record のカードの枚数。 */
function countInZone(view: PathView, zone: Zone, record: CardRecord): number {
  if (zone === "unseen") {
    return view.unseen.get(record)?.count ?? 0;
  }
  return (
    findOrCreate(view.counts, zone, () =>
      countCardsByRecord(listCardsInZone(view.state, zone))
    ).get(record)?.count ?? 0
  );
}

function listRelaysOnce(
  view: PathView,
  timing: DeadlineTiming
): readonly DeckFetchRelay[] {
  return findOrCreate(view.relaysByTiming, timing, () =>
    listDeckFetchRelays(view.state, timing, view.unseen)
  );
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
    if (countInZone(this.view, zone, record) <= used) {
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
    const remaining = new Map<CardRecord, CardsOfRecord>();
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
  const assignments = assignDeckFetchSources(
    requirements,
    listDeckFetchSources(view.state, timing, used.countUsedInHand()),
    listRelaysOnce(view, timing),
    used.countRemainingUnseen(),
    timing
  );
  return assignments.reduce(
    (total, { route }) => total * FETCH_ROUTE_WEIGHTS[route],
    product
  );
}

/** 主軸の進化の系統の名前(主軸、進化前、系統のたねポケモン)。これらのポケモンについたエネルギーは主軸のワザに使える。 */
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
 * ポケモンの条件(条件が無ければ undefined)。条件の分かれ道とコインの中も見る(listPossibleOperations)。
 */
function listSwitchBenchFilters(
  steps: readonly EffectStep[]
): (CardFilter | undefined)[] {
  return listPossibleOperations(steps).flatMap(
    (step): (CardFilter | undefined)[] =>
      step.operation === "switchActiveWithBench" ? [step.benchFilter] : []
  );
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
  const filters = findOrCreate(switchBenchFiltersByRecord, card.record, () =>
    findCardEffects(card, "whenPlayed").flatMap((cardEffect) =>
      listSwitchBenchFilters(cardEffect.effect.steps)
    )
  );
  return filters.some(
    (filter) => filter === undefined || matchesCardFilter(pokemon.card, filter)
  );
}

/** 場に出たとみなした主軸のカード。記録ごとに 1 枚だけ作る。 */
const detachedCardsByRecord = new WeakMap<CardRecord, Card>();

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

/**
 * バトルポケモンが今使えるワザのうち、主軸のワザでなく効果のあるもの。効果の無いワザは、使っても番の終わりの処理の
 * ほかに場が変わらない(ダメージは相手がいないため与えない。card-effects.ts の useAttack)ので試さない。
 */
function listNonMainAttacksWithEffect(
  declaration: ResolvedDeclaration,
  context: EffectContext
): UsableAttack[] {
  return listUsableAttacksOfActive(context).filter(
    (candidate) =>
      candidate.attack.effect !== undefined &&
      !isMainAttackCandidate(candidate, declaration.mainAttacks)
  );
}

function buildPathView(state: GameState): PathView {
  return {
    counts: new Map(),
    relaysByTiming: new Map(),
    state,
    unseen: countUnseenByRecord(state),
  };
}

/**
 * 1 つの状態について、狙いの見込みを数える。道の揃い具合を見る評価は判定が済んでいない締め切りごとに点を出すため、
 * 締め切りによらない部分(狙いが成り立っているか、置き場所ごとの枚数、エネルギーの供給、ダメージ)は 1 回だけ数えて
 * 締め切りの間で使い回す。
 */
export class GoalProspects {
  private readonly input: EvaluationInput;
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
  private readonly unpaidCosts = new Map<
    MainAttack,
    Map<
      PokemonInPlay,
      {
        readonly cost: readonly PokemonType[];
        readonly unpaid: readonly PokemonType[];
      }
    >
  >();
  private view: PathView | undefined;
  private damageRatio: number | undefined;
  private canRetreat: boolean | undefined;
  private oneStepSources: readonly DeckFetchSource[] | undefined;
  /** 主軸の系統のほかのワザを試すか。試した後の見込みでは偽にし、試した中でさらに試さない。 */
  private readonly triesNonMainAttacks: boolean;
  private prospectsAfterNonMainAttacks: readonly GoalProspects[] | undefined;

  constructor(
    declaration: ResolvedDeclaration,
    input: EvaluationInput,
    options: { readonly triesNonMainAttacks?: boolean } = {}
  ) {
    this.declaration = declaration;
    this.input = input;
    this.triesNonMainAttacks = options.triesNonMainAttacks ?? true;
  }

  /**
   * 主軸の進化の系統のバトルポケモンが今使えるワザのうち、主軸のワザ以外で効果のあるもの(メガサーナイトex 048464 の
   * 「あふれるねがい」)を 1 つずつ複製の上で 1 回だけ使い、番の終わりの効果を起こして次の番に進めた後の見込み
   * (Issue 51 の数え漏れ 6)。後の番の締め切りの 2 段目と 3 段目を、試す前の見込みと比べて高いほうにするために使う。
   * 1 回だけ作って覚える。
   *
   * - 複製は見えていないカードを混ぜ直してから使う。見えていないカードを知って試さないため。混ぜ直しの種は評価の
   *   seed で、同じ場面で比べる候補どうしで試しの引きがそろう
   * - 試すのは状態の番が fromTurn のとき(番の中の行動を試した後と、ワザを試して次の番に進めた後)だけ。対戦の準備の
   *   評価(番 0)では、canAttack が番 0 を最初の番と見なさずワザの一覧が出るため除く
   * - バトルポケモンが系統でないときは試さない。系統でないポケモンが系統のポケモンのワザを使う候補(ミュウex 050669 の
   *   「きおくのらせん」)は、Issue の「主軸の進化の系統の場のポケモンが今使えるワザ」に当たらないため
   * - 試した後の見込みでは、さらに試さない。1 回の評価で何番もの先を進めないため(Issue の「1 回だけ」)
   */
  listProspectsAfterNonMainAttacks(): readonly GoalProspects[] {
    this.prospectsAfterNonMainAttacks ??= this.tryNonMainAttacks();
    return this.prospectsAfterNonMainAttacks;
  }

  private tryNonMainAttacks(): GoalProspects[] {
    const { fromTurn, seed, state, statistics } = this.input;
    const { active } = state;
    if (
      !this.triesNonMainAttacks ||
      state.turn !== fromTurn ||
      active === undefined ||
      !this.declaration.mainAttacks.some((main) =>
        listEvolutionLineNames(main).has(active.name)
      )
    ) {
      return [];
    }
    const candidateCount = listNonMainAttacksWithEffect(this.declaration, {
      choices: firstCandidateChoices,
      state,
    }).length;
    const prospects: GoalProspects[] = [];
    for (let index = 0; index < candidateCount; index += 1) {
      const trial = state.clone(new SeededRandom(seed));
      trial.remixUnseenCards();
      statistics.clones += 1;
      const context: EffectContext = {
        choices: firstCandidateChoices,
        state: trial,
      };
      // 複製ではワザの持ち主の参照が変わるため、候補は複製の上で出し直す(search-policy.ts の useAttackAt と同じ)。
      // 山札の上のカードで決まる候補は混ぜ直しで変わりうるので、同じ何番目かが無ければ試さない
      const candidate = listNonMainAttacksWithEffect(this.declaration, context)[
        index
      ];
      if (candidate === undefined) {
        continue;
      }
      useAttack(context, candidate);
      // 使ったワザの記録が残ると次の番の使えるワザの一覧が空になるため、次の番に進めてから数える
      endTurnForEvaluation(trial);
      prospects.push(
        new GoalProspects(
          this.declaration,
          {
            fromTurn: fromTurn + 1,
            seed,
            stage: "beforeDraw",
            state: trial,
            statistics,
          },
          { triesNonMainAttacks: false }
        )
      );
    }
    return prospects;
  }

  /** 宣言から導いた狙いの index 段目(0 が立つ)が、今の場で成り立っているか。 */
  isGoalAchieved(index: number): boolean {
    return findOrCreate(this.achievements, index, () => {
      const achieved = this.declaration.goals[index]?.isAchieved(
        this.input.state
      );
      if (achieved === undefined) {
        throw new Error(`宣言から導いた狙いに ${index + 1} 段目が無い`);
      }
      return achieved;
    });
  }

  /** 主軸への道のどれか 1 本が、締め切りまでに揃う見込み(0 以上 1 以下)。 */
  calculateStandProspect(timing: DeadlineTiming): number {
    return findOrCreate(this.standProspects, timing, () => {
      const view = this.countPathViewOnce();
      // どれか 1 本の道が揃えば立つので、道ごとの見込みを別々の機会とみなして「少なくとも 1 本揃う」見込みにする
      return (
        1 -
        this.declaration.paths.reduce(
          (product, path) =>
            product * (1 - scorePath(view, path.requiredCards, timing)),
          1
        )
      );
    });
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
    return findOrCreate(this.attackProspects, deadline, () => {
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
      return (standScore + bestLineScore) / 3;
    });
  }

  /**
   * 場のポケモン pokemon(主軸の進化の系統)を、ワザを使うバトル場に出せる見込み(0 以上 1 以下。締め切りによらない)。
   * バトル場にいれば 1(対戦の準備でバトル場に置いたたねポケモンも)。ベンチにいて、手札に入れ替えるカードがあるか、
   * 今のバトルポケモンがにげられれば benchedWithWayToActiveThisTurn。入れ替えるカードが見えていないカードにあり、手札か
   * 場の探す手段で 1 段で持ってこられれば switchCardSearchable。どれでもなければ noWayToActive。にげるエネルギーを
   * 0 にするカード(ラティアスex 046248 の「スカイライン」)は、ベンチに出す手を試した後の場で canRetreatActive が
   * 真になることで数え、手札にあるそのカードを先回りして数えない(Issue 51 の数え漏れ 4)。
   */
  calculateActiveSpotProspect(pokemon: PokemonInPlay): number {
    return findOrCreate(this.activeSpotProspects, pokemon, () => {
      const { state } = this.input;
      if (state.active === pokemon) {
        return 1;
      }
      // 手札の入れ替えるカードを、今使えるか(canPlayTrainerFromHand)で絞らない。Issue 51 の数え漏れ 4 は「手札に
      // 入れ替えるカードがある」で数えると決めており、絞ると、この番にサポートを使った後の手札のスグリが山札の段
      // (switchCardSearchable)にも当たらず noWayToActive に落ち、山札にあるときより低くなる(置き場所に近いほど高く
      // する重みの尺度が逆になる。Issue 51「重みの扱い」)
      const hasSwitchCard = state.hand.some((card) =>
        canSwitchIntoActive(card, pokemon)
      );
      this.canRetreat ??= canRetreatActive(state);
      if (hasSwitchCard || this.canRetreat) {
        return PROGRESS_WEIGHTS.benchedWithWayToActiveThisTurn;
      }
      return this.canFetchSwitchCardFor(pokemon)
        ? PROGRESS_WEIGHTS.switchCardSearchable
        : PROGRESS_WEIGHTS.noWayToActive;
    });
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
   * つけたとしたら供給するもので数える(プリズムエネルギー 049455 は 2進化の主軸には無色 1 個)。手札のエネルギーと
   * 山札から手札に持ってくるエネルギーは、合わせて締め切りまでに手札からつけられる回数まで数え、超えた要求は 0 にする。
   * 山札から持ってきたエネルギーを効果で attacker につける探す手段(アカマツ 049412)で満たした要求は、この回数に数えない。
   */
  calculateAttackEnergyProspect(
    main: MainAttack,
    attacker: PokemonInPlay,
    deadline: number
  ): number {
    const { fromTurn, stage, state } = this.input;
    const { cost, unpaid } = this.listUnpaidCostOnce(main, attacker);
    if (cost.length === 0 || unpaid.length === 0) {
      return 1;
    }
    const holder =
      attacker.card.record === main.record
        ? attacker
        : this.placeDetachedMainOnce(main);
    // 手札からつけられるのは 1 回の番に 1 枚(docs/pokemon-tcg/basic-rules.md 72 行)。この番に既につけていれば、
    // この番の分を数えない。「番を終える」を試すとき(stage が actionsDone)も、番を終えた後はこの番にもう何も
    // つけられないので数えない(Issue 51 の決定事項 2026-10-18 と同じ理由)
    const canAttachThisTurn =
      stage !== "actionsDone" && !state.hasAttachedEnergy;
    const attachable =
      (deadline - fromTurn + (canAttachThisTurn ? 1 : 0)) *
      ENERGY_ATTACHMENTS_FROM_HAND_PER_TURN;
    const fromHand = selectHandEnergies(
      this.listHandEnergies(holder),
      unpaid,
      attachable
    );
    // 山札から手札に持ってきたエネルギーも、つけるには手札からつける同じ 1 回を使う(basic-rules.md 72 行)ので、
    // 手札で組に選んだ枚数を引いた残りの回数までしか山札の分を数えない
    const attachableFromDeck =
      attachable -
      [...fromHand.counts.values()].reduce((sum, count) => sum + count, 0);
    return (
      (cost.length -
        unpaid.length +
        fromHand.filled * PROGRESS_WEIGHTS.energyInHand +
        this.scoreEnergiesFromDeck(
          { attacker, holder },
          fromHand,
          attachableFromDeck,
          deadline
        )) /
      cost.length
    );
  }

  /**
   * 手札で埋めきれなかった要求(fromHand.rest)のうち、山札から持ってこられるものの揃い具合の合計。手札からつける回数の
   * 残り attachableFromDeck を超えた要求は 0 にし、山札から持ってきたエネルギーを効果で attacker につける探す手段・中継で
   * 満たした要求は、回数に数えない。
   */
  private scoreEnergiesFromDeck(
    {
      attacker,
      holder,
    }: { readonly attacker: PokemonInPlay; readonly holder: PokemonInPlay },
    fromHand: HandEnergySelection,
    attachableFromDeck: number,
    deadline: number
  ): number {
    if (fromHand.rest.length === 0) {
      return 0;
    }
    const { fromTurn, state } = this.input;
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
    if (requirements.length === 0) {
      return 0;
    }
    const timing = toDeadlineTiming(deadline, fromTurn);
    // エネルギーの見込みは道の見込みと別の見込みとして平均するので、探す手段と見えていないカードを道と分け合わない
    const sources = listDeckFetchSources(state, timing, fromHand.counts);
    const relays = listRelaysOnce(view, timing);
    // 効果でつける先は、ワザを使う場のポケモン attacker。主軸の進化前でも、ついているエネルギーは進化しても引き継ぐ
    // (docs/pokemon-tcg/basic-rules.md 82 行)
    const attachTarget = { pokemon: attacker, state };
    if (
      attachableFromDeck === 0 &&
      !sources.some((source) => canAttachByEffectTo(source, attachTarget)) &&
      !relays.some((relay) => canAttachByEffectTo(relay, attachTarget))
    ) {
      return 0;
    }
    const assignments = assignDeckFetchSources(
      requirements,
      sources,
      relays,
      view.unseen,
      timing,
      attachTarget
    );
    // 効果でつける要求は、手札からつける 1 回の制限に数えない(state.ts の attachEnergyByEffect)ので、回数の上限を
    // 掛けずに足す
    const attachedByEffect = assignments
      .filter(({ isAttachedByEffect }) => isAttachedByEffect)
      .reduce((sum, { route }) => sum + FETCH_ROUTE_WEIGHTS[route], 0);
    // 回数の上限を割り当てに渡してやり直さないのは、割り当てが (持ってこられた数, 割り当てた数, 1 段の数) を辞書式に
    // 最大にしており、その結果を重みの大きい順に残りの回数分だけ採れば、1 段・2 段で持ってこられる要求から先に数えるため
    return (
      attachedByEffect +
      assignments
        .filter(({ isAttachedByEffect }) => !isAttachedByEffect)
        .map(({ route }) => FETCH_ROUTE_WEIGHTS[route])
        .sort((left, right) => right - left)
        .slice(0, attachableFromDeck)
        .reduce((sum, weight) => sum + weight, 0)
    );
  }

  /** attacker が main のワザを使うのに必要なエネルギーと、ついているエネルギーで払えない分。締め切りによらないので使い回す。 */
  private listUnpaidCostOnce(
    main: MainAttack,
    attacker: PokemonInPlay
  ): {
    readonly cost: readonly PokemonType[];
    readonly unpaid: readonly PokemonType[];
  } {
    return findOrCreate(
      findOrCreate(this.unpaidCosts, main, () => new Map()),
      attacker,
      () => {
        const { state } = this.input;
        const cost = calculateAttackCost(state, attacker, main.attack);
        return {
          cost,
          unpaid:
            cost.length === 0
              ? []
              : listUnpaidCost(cost, listEnergyUnits(state, attacker)),
        };
      }
    );
  }

  /**
   * 場に出たとみなした主軸(場には置かない)。主軸が場にいないときに、ダメージやつけたエネルギーの供給を数えるため。
   * 主軸の記録ごとに 1 匹だけ作り、エネルギーの見込みとダメージの見込みで同じものを使う。
   */
  private placeDetachedMainOnce(main: MainAttack): PokemonInPlay {
    return findOrCreate(this.detachedMains, main.record, () => {
      const card = findOrCreate(detachedCardsByRecord, main.record, () =>
        buildCardFromRecord(main.record, main.record.cardIds[0] ?? "")
      );
      return new PokemonInPlay(card, this.input.state.turn);
    });
  }

  /** energy を holder につけたとしたら供給する 1 個ずつのタイプ(記録ごとに覚える)。 */
  private resolveUnitsWhenAttached(
    holder: PokemonInPlay,
    energy: Card
  ): EnergyUnit[] {
    return findOrCreate(
      findOrCreate(this.provisions, holder, () => new Map()),
      energy.record,
      () =>
        toEnergyUnits(
          resolveEnergyProvisionWhenAttached(this.input.state, holder, energy)
        )
    );
  }

  /** 手札のエネルギーの、記録ごとの枚数と holder につけたとしたら供給するもの。 */
  private listHandEnergies(holder: PokemonInPlay) {
    return [...countCardsByRecord(this.input.state.hand.filter(isEnergy))].map(
      ([record, { card, count }]) => ({
        count,
        record,
        units: this.resolveUnitsWhenAttached(holder, card),
      })
    );
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
        Math.min(1, this.estimateMainAttackDamageProspect(main) / minimumDamage)
      )
    );
    return this.damageRatio;
  }

  /**
   * 主軸がワザを使ったときのダメージの見込み。主軸が場にいればそのポケモン(バトル場を先に)で、いなければ場に出たと
   * みなした主軸で、記録の規則から求める(ダメージの上乗せが場のエネルギーの数などで決まるため)。上乗せ「N 以上なら
   * M を足す」は数が N に届く前から途中経過に比例して数える(estimateAttackDamageWithPartialThresholds)ので、狙いの
   * 判定のダメージとは違う。
   */
  private estimateMainAttackDamageProspect(main: MainAttack): number {
    const { state } = this.input;
    const attacker =
      state
        .listPokemonInPlay()
        .find((pokemon) => pokemon.card.record === main.record) ??
      this.placeDetachedMainOnce(main);
    return (
      estimateAttackDamageWithPartialThresholds(state, attacker, main.attack) ??
      0
    );
  }

  /**
   * 締め切り deadline についての、狙いの段ごとの点。成り立っていれば 1、成り立っていなければ見込みに unachievedGoal の
   * 重みをかけたもの。
   * 1 段目(立つ): 主軸への道ごとの見込み(必要なカードの揃い具合の積)から、少なくとも 1 本揃う見込み。
   * 2 段目(打てる): 1 段目の見込み(成り立っていれば 1)、ワザのエネルギーの見込み、バトル場に出せる見込みの平均
   * (calculateAttackProspect)。
   * 3 段目(N 以上): 2 段目の見込みと、ダメージの見込みの下限に対する割合の平均。
   * 後の番の締め切りの 2 段目と 3 段目は、主軸の系統のほかのワザを試した後の場の点と比べて高いほう
   * (raiseByNonMainAttacks)。
   */
  scoreGoals(deadline: number): number[] {
    const [standGoal, attackGoal, damageGoal] = this.declaration.goals;
    if (standGoal === undefined || attackGoal === undefined) {
      throw new Error("宣言から導いた狙いが 2 段に満たない");
    }
    const timing = toDeadlineTiming(deadline, this.input.fromTurn);
    // 「番を終える」を試すとき(stage が actionsDone)は、この番の狙いにもう何も届かないので、成り立っていない狙いの
    // 見込みを 0 にする(Issue 51 の決定事項 2026-10-18)。手札に残した探すカードの見込みを番を終える手に数えると、
    // 探すカードを使う手(見えていないカードを混ぜ直した数通りの平均)が番を終える手を下回ることがあるため
    const unachievedWeight =
      this.input.stage === "actionsDone" && timing === "thisTurn"
        ? 0
        : PROGRESS_WEIGHTS.unachievedGoal;
    const weigh = (achieved: boolean, progress: () => number) => {
      if (achieved) {
        return 1;
      }
      return unachievedWeight === 0 ? 0 : unachievedWeight * progress();
    };
    const isAttacking = this.isGoalAchieved(1);
    const attackProgress = () => this.calculateAttackProspect(deadline);
    const scores = [
      weigh(this.isGoalAchieved(0), () => this.calculateStandProspect(timing)),
      weigh(isAttacking, attackProgress),
    ];
    const { minimumDamage } = this.declaration;
    if (damageGoal !== undefined && minimumDamage !== undefined) {
      scores.push(
        weigh(
          this.isGoalAchieved(2),
          () =>
            ((isAttacking ? 1 : attackProgress()) +
              this.calculateDamageRatio()) /
            2
        )
      );
    }
    if (timing === "laterTurn") {
      this.raiseByNonMainAttacks(deadline, scores);
    }
    return scores;
  }

  /**
   * 後の番の締め切り deadline の 2 段目と 3 段目の点 scores を、主軸の系統のほかのワザを試した後の場の点
   * (listProspectsAfterNonMainAttacks)と比べて高いほうにする(Issue 51 の数え漏れ 6)。この番の締め切りには使わない
   * (ワザは狙いの判定の後に使うため)。成り立っている段は 1 で比べても変わらないので、試した後の見込みは成り立って
   * いない段があるときに初めて作る。
   */
  private raiseByNonMainAttacks(deadline: number, scores: number[]): void {
    let scoresAfterAttacks: number[][] | undefined;
    for (let index = 1; index < scores.length; index += 1) {
      if (this.isGoalAchieved(index)) {
        continue;
      }
      scoresAfterAttacks ??= this.listProspectsAfterNonMainAttacks().map(
        (after) => after.scoreGoals(deadline)
      );
      for (const after of scoresAfterAttacks) {
        scores[index] = Math.max(scores[index] ?? 0, after[index] ?? 0);
      }
    }
  }
}
