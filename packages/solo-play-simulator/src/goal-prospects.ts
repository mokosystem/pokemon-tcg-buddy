/**
 * 道の揃い具合を見る評価(search-evaluators.ts の createPathProgressEvaluator)の、狙いの段ごとの点。狙いが今の場で
 * 成り立っていれば 1、成り立っていなければ、主軸への道の必要なカードの揃い具合、ワザのエネルギー、ダメージの下限
 * までの距離から出した見込みに重みをかける。
 */

import { calculateAttackDamage } from "./attack-damage.ts";
import type { CardRecord } from "./card-record-schema.ts";
import { buildCardFromRecord, type Card } from "./cards.ts";
import { calculateAttackCost, listEnergyUnits } from "./continuous-effects.ts";
import {
  countUnseenByRecord,
  findSearchableRecords,
} from "./deck-fetch-sources.ts";
import type {
  MainAttack,
  RequiredCard,
  ResolvedDeclaration,
} from "./declaration.ts";
import { type GameState, PokemonInPlay } from "./state.ts";

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
export function scoreGoalsByPathProgress(
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
