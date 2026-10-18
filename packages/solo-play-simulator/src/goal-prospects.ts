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
  countUnseenByRecord,
  findSearchableRecords,
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
const PROGRESS_WEIGHTS = {
  /** 必要なカードが山札かサイドにあるが、引くしかない。 */
  drawOnly: 0.1,
  /** 場やスタジアムに必要なカードが手札にある(出す・進化させる・使うだけ)。 */
  inHandForPlace: 0.8,
  /** 必要なカードが山札かサイドにあり、手札や場のカードの効果で山札から持ってこられる。 */
  searchableFromDeck: 0.4,
  /** 同上で、持ってくるのに 2 段(探すカードを探す)かかる。 */
  searchableInTwoSteps: 0.3,
  /** 狙いが成り立っていないときの見込みにかける重み。成り立っている狙い(1)より必ず小さくする。 */
  unachievedGoal: 0.5,
} as const;

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
  readonly searchable: {
    readonly oneStep: ReadonlySet<CardRecord>;
    readonly twoSteps: ReadonlySet<CardRecord>;
  };
  readonly state: GameState;
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
  record: CardRecord,
  timing: DeadlineTiming
) => number;

/**
 * 進化の元(前の番から場)。この番の締め切りには、この番に進化させられる場のポケモンだけが間に合う。判定は骨組みの
 * canEvolveThisTurn に任せ、「自分の最初の番は進化できない」「出したばかり・進化したばかりの番は進化できない」
 * (docs/pokemon-tcg/basic-rules.md 77 行)を評価の中に書き直さない。手札や見えていないカードは、出してもこの番には
 * 進化できないので 0。後の番の締め切りには、この番に出したポケモンも間に合うので場にいれば 1。
 */
const scoreEvolutionBase: RequiredCardScorer = (view, used, record, timing) => {
  if (timing === "thisTurn") {
    if (!used.take("evolvableThisTurn", record)) {
      return 0;
    }
    // 同じポケモンを、同じ道の別の必要なカード(置き場所が場)に重ねて数えない
    used.take("inPlay", record);
    return 1;
  }
  return used.take("inPlay", record)
    ? 1
    : scoreFromHandOrUnseen(view, used, record);
};

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
  inPlaySincePreviousTurn: scoreEvolutionBase,
  stadium: (view, used, record) =>
    view.state.stadium?.record === record
      ? 1
      : scoreFromHandOrUnseen(view, used, record),
};

/** 1 本の道が揃う見込み。必要なカードごとの揃い具合を、それぞれ揃う見込みとみなして掛け合わせる。 */
function scorePath(
  view: PathView,
  requiredCards: readonly RequiredCard[],
  timing: DeadlineTiming
): number {
  const used = new UsedCards(view);
  return requiredCards.reduce(
    (product, required) =>
      product *
      requiredCardScorers[required.place](view, used, required.record, timing),
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
    searchable: findSearchableRecords(state, unseen),
    state,
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
