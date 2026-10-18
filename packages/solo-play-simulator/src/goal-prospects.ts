/**
 * 道の揃い具合を見る評価(search-evaluators.ts の createPathProgressEvaluator)の、締め切りごと・狙いの段ごとの点。
 * 狙いが今の場で成り立っていれば 1、成り立っていなければ、主軸への道の必要なカードの揃い具合、ワザのエネルギー、
 * ダメージの下限までの距離から出した見込みに重みをかける。見込みは締め切りがこの番か後の番かで数え方が変わる。
 */

import { calculateAttackDamage } from "./attack-damage.ts";
import type { CardRecord } from "./card-record-schema.ts";
import { buildCardFromRecord, type Card } from "./cards.ts";
import { calculateAttackCost, listEnergyUnits } from "./continuous-effects.ts";
import { type DeadlineTiming, toDeadlineTiming } from "./deadline-timing.ts";
import {
  assignDeckFetchSources,
  countUnseenByRecord,
  type DeckFetchRelay,
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
import type { EvaluationInput } from "./search-policy.ts";
import { type GameState, PokemonInPlay } from "./state.ts";

/**
 * 見込みの重み。いずれも「成り立っている(1)」より小さく、置き場所に近いほど大きくする。値は正しい手の局面で
 * 決めたもので、根拠の強いものではない。決めた局面と変えた経緯は設計文書(「順 7 で決めたこと(2 セッション目)」と
 * 「場の評価の数え漏れの修正(Issue 51)」)に記録している。
 */
export const PROGRESS_WEIGHTS = {
  /** 必要なカードが山札かサイドにあるが、引くしかない(探す手段を割り当てられなかった)。 */
  drawOnly: 0.1,
  /** 場やスタジアムに必要なカードが手札にある(出す・進化させる・使うだけ)。 */
  inHandForPlace: 0.8,
  /** 必要なカードが山札かサイドにあり、手札や場の探す手段 1 枚を割り当てて山札から持ってこられる。 */
  searchableFromDeck: 0.4,
  /** 同上で、持ってくるのに 2 段(探すカードを探す)かかる。 */
  searchableInTwoSteps: 0.3,
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
 * 締め切りによらない部分(狙いが成り立っているか、置き場所ごとの枚数、ワザのエネルギー、ダメージ)は 1 回だけ数えて
 * 締め切りの間で使い回す。
 */
export class GoalProspects {
  readonly input: EvaluationInput;
  private readonly declaration: ResolvedDeclaration;
  private readonly achievements = new Map<number, boolean>();
  private readonly standProspects = new Map<DeadlineTiming, number>();
  private view: PathView | undefined;
  private attachedEnergyRatio: number | undefined;
  private damageRatio: number | undefined;

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

  /** 主軸のワザのうち、系統の場のポケモンについているエネルギーがいちばん届いているものの割合(0 以上 1 以下)。 */
  calculateAttachedEnergyRatio(): number {
    this.attachedEnergyRatio ??= Math.max(
      ...this.declaration.mainAttacks.map((main) =>
        scoreAttackEnergy(this.input.state, main)
      )
    );
    return this.attachedEnergyRatio;
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
 * 2 段目(打てる): 1 段目の見込み(成り立っていれば 1)とワザのエネルギーの揃い具合の平均。
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
  const attackProgress = () =>
    (standScore + prospects.calculateAttachedEnergyRatio()) / 2;
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
