/**
 * 道の揃い具合を見る評価(goal-prospects.ts)が使う、山札から持ってくる効果の読み取りと割り当て。手札と場のカードの
 * 記録の効果の翻訳から、山札のカードを手札か場に持ってくる操作の条件を集めて探す手段(CONTEXT.md「探す手段」)の
 * 一覧にし、見えていないカード(山札とサイド)から持ってくる必要のあるものに、探す手段を 1 枚につき 1 つずつ割り当てる。
 */

import {
  canPlayTrainerIfInHand,
  canUseAbility,
  canUseStadiumEffect,
} from "./card-effects.ts";
import {
  CardCategory,
  type CardFilter,
  type CardRecord,
  type EffectStep,
  type PokemonInPlayFilter,
  type PokemonRecord,
} from "./card-record-schema.ts";
import {
  type Card,
  type CardsOfRecord,
  countCardsByRecord,
  matchesCardFilter,
} from "./cards.ts";
import { matchesPokemonFilter } from "./conditions.ts";
import type { DeadlineTiming } from "./deadline-timing.ts";
import { type EffectContext, firstCandidateChoices } from "./effect-choices.ts";
import { listPossibleOperations } from "./effect-operations.ts";
import { findOrCreate } from "./find-or-create.ts";
import {
  classifyOnceInTurnKind,
  type GameState,
  type OnceInTurnKind,
  type PokemonInPlay,
} from "./state.ts";

/** 見えていないカード(山札とサイド)の、記録ごとの枚数と代表の 1 枚。 */
export type UnseenCards = ReadonlyMap<CardRecord, CardsOfRecord>;

/** 効果の操作のうち、山札のカードを手札か場に持ってくるものの条件。条件の分かれ道とコインの中の操作も含める。 */
function listDeckFetchFilters(steps: readonly EffectStep[]): CardFilter[] {
  return listPossibleOperations(steps).flatMap((step): CardFilter[] => {
    switch (step.operation) {
      case "searchDeckIntoHand":
      case "searchDeckIntoHandFromOneOfPicks":
        return step.picks.map((pick) => pick.filter);
      case "searchDeckOntoBench":
      case "searchDeckIntoHandAndAttachRest":
      case "lookAtDeckTopAndTakeIntoHand":
        return [step.filter];
      default:
        return [];
    }
  });
}

/**
 * 効果の操作のうち、山札から持ってきたエネルギーを効果でポケモンにつけるもの(searchDeckIntoHandAndAttachRest)の、
 * つける先の条件。条件の分かれ道とコインの中の操作も含める。
 */
function listEffectAttachTargetFilters(
  steps: readonly EffectStep[]
): PokemonInPlayFilter[] {
  return listPossibleOperations(steps).flatMap((step) =>
    step.operation === "searchDeckIntoHandAndAttachRest"
      ? [step.targetFilter]
      : []
  );
}

/** カードの置き場所ごとに、使えば山札から持ってこられるカードの条件。 */
interface FetchFilters {
  /** 手札にあるとき(グッズ・サポートを使う、スタジアムを出して効果を使う、ベンチに出す・進化させる・手札の特性、エネルギーをつける)。 */
  readonly inHand: readonly CardFilter[];
  /**
   * 手札にあるときの効果のうち、持ってきたエネルギーを効果でつける操作の、つける先の条件。場にあるときの効果からは
   * 集めない。この操作を持つ記録はアカマツ(049412。サポート)だけで、場で使う特性やスタジアムの効果には無いため。
   */
  readonly inHandEffectAttachTargets: readonly PokemonInPlayFilter[];
  /** 場のポケモンの特性(特性の名前ごと)。この番に使えるかを特性ごとに骨組みで判定するため、名前ごとに分ける。 */
  readonly inPlayAbilities: readonly {
    readonly abilityName: string;
    readonly filters: readonly CardFilter[];
  }[];
  /** 場のスタジアムの効果。 */
  readonly inPlayStadium: readonly CardFilter[];
}

const fetchFiltersByRecord = new WeakMap<CardRecord, FetchFilters>();

function filtersOf(
  effects: readonly { readonly steps: readonly EffectStep[] }[]
) {
  return effects.flatMap((effect) => listDeckFetchFilters(effect.steps));
}

function readPokemonFetchFilters(record: PokemonRecord): FetchFilters {
  const effectsOf = (kinds: readonly string[]) =>
    record.abilities.flatMap((ability) =>
      ability.translation !== undefined &&
      "effect" in ability.translation &&
      kinds.includes(ability.translation.kind)
        ? [{ abilityName: ability.name, effect: ability.translation.effect }]
        : []
    );
  const inHandEffects = effectsOf([
    "activatedFromHand",
    "triggeredWhenPlacedOnBenchFromHand",
    "triggeredWhenEvolvedFromHand",
  ]).map(({ effect }) => effect);
  return {
    inHand: filtersOf(inHandEffects),
    inHandEffectAttachTargets: inHandEffects.flatMap((effect) =>
      listEffectAttachTargetFilters(effect.steps)
    ),
    inPlayAbilities: effectsOf(["activatedInPlay"])
      .map(({ abilityName, effect }) => ({
        abilityName,
        filters: listDeckFetchFilters(effect.steps),
      }))
      .filter(({ filters: abilityFilters }) => abilityFilters.length > 0),
    inPlayStadium: [],
  };
}

function readTrainerOrEnergyFetchFilters(record: CardRecord): FetchFilters {
  const cardEffects = "cardEffects" in record ? record.cardEffects : [];
  const allEffects = cardEffects.flatMap((cardEffect) =>
    "effect" in cardEffect ? [cardEffect.effect] : []
  );
  return {
    inHand: filtersOf(allEffects),
    inHandEffectAttachTargets: allEffects.flatMap((effect) =>
      listEffectAttachTargetFilters(effect.steps)
    ),
    inPlayAbilities: [],
    inPlayStadium: filtersOf(
      cardEffects.flatMap((cardEffect) =>
        cardEffect.kind === "activatedOncePerTurn" ? [cardEffect.effect] : []
      )
    ),
  };
}

/** record の効果の翻訳から読み取った、置き場所ごとの山札から持ってこられるカードの条件(記録ごとに 1 回だけ読む)。 */
function listFetchFiltersOf(record: CardRecord): FetchFilters {
  return findOrCreate(fetchFiltersByRecord, record, () =>
    record.category === CardCategory.Pokemon
      ? readPokemonFetchFilters(record)
      : readTrainerOrEnergyFetchFilters(record)
  );
}

/** card が条件のどれかに合うか。 */
function matchesAnyFilter(filters: readonly CardFilter[], card: Card): boolean {
  return filters.some((filter) => matchesCardFilter(card, filter));
}

/**
 * card(見えていないカードの代表の 1 枚)を、sources のどれか 1 枚で山札から 1 段で持ってこられるか。割り当てをせず
 * 記録の単位で見る。締め切りによらない 1 つの値を出す見込み(バトル場に出せる見込み)が使う。
 */
export function canFetchInOneStep(
  sources: readonly DeckFetchSource[],
  card: Card
): boolean {
  return sources.some((source) => matchesAnyFilter(source.filters, card));
}

/** 見えていないカード(山札とサイド)の、記録ごとの枚数と代表の 1 枚。 */
export function countUnseenByRecord(state: GameState): UnseenCards {
  return countCardsByRecord(state.deck, state.prizes);
}

/**
 * 持ってきたエネルギーを効果でポケモンにつける操作の、つける先の条件(アカマツ 049412)。効果でつけるのは、手札から
 * つける 1 回の番に 1 枚の制限に数えない(state.ts の attachEnergyByEffect)。この操作の持ってくる条件とつける条件は
 * 同じ(記録の filter 1 つ)で、この操作を持つ記録はほかに山札から持ってくる操作を持たないため、操作ごとでなく
 * 探す手段・中継の単位で持つ。
 */
export interface EffectAttachTargets {
  readonly effectAttachTargetFilters?: readonly PokemonInPlayFilter[];
}

/** 探す手段 1 枚(CONTEXT.md「探す手段」)。 */
export interface DeckFetchSource extends EffectAttachTargets {
  /** 使うと山札から持ってこられるカードの条件。 */
  readonly filters: readonly CardFilter[];
  readonly onceInTurnKind?: OnceInTurnKind;
}

/**
 * 2 段で持ってくるときの中継に使える、見えていないカードの記録 1 つ(CONTEXT.md「見えていないカード」)。
 * 探す手段で手札に加えた後、そのカードの効果で山札からさらに持ってこられる。
 */
export interface DeckFetchRelay extends DeckFetchSource {
  /** 見えていないカードのうちの代表の 1 枚。 */
  readonly card: Card;
}

/** 山札から持ってくる必要のあるもの 1 つ。candidates のどれか 1 枚が来れば満たす。 */
export interface FetchRequirement {
  readonly candidates: readonly CardRecord[];
}

/**
 * 割り当ての結果。1 段で持ってこられる、2 段で持ってこられる、引くしかない、見えていないカードに
 * candidates が残っていない(同じ割り当ての中でほかの要るものか中継に使い切った)。
 */
export type FetchRoute = "oneStep" | "twoSteps" | "drawOnly" | "noCopyLeft";

/**
 * 要るもの 1 つの割り当ての結果。isAttachedByEffect は、持ってくる最後の段(1 段なら探す手段、2 段なら中継)が、
 * 持ってきたエネルギーを効果でつけ先のポケモンにつけるものか(割り当てにエネルギーをつける条件を渡したときだけ真になる)。
 */
export interface FetchAssignment {
  readonly isAttachedByEffect: boolean;
  readonly route: FetchRoute;
}

/** 持ってきたエネルギーを効果でつける先として見るポケモン。 */
export interface EffectAttachTarget {
  readonly pokemon: PokemonInPlay;
  readonly state: GameState;
}

/**
 * ワザのエネルギーの要求に割り当てるときの、エネルギーをつける条件。効果でつけない要求は、手札からつける 1 回の番に
 * 1 枚の制限(docs/pokemon-tcg/basic-rules.md 72 行)を使うので、手札からつけられる残りの回数分だけを割り当ての良さに
 * 数える。効果で effectAttachTarget につける要求は、この制限に数えない(state.ts の attachEnergyByEffect)。
 */
export interface EnergyAttachConditions {
  readonly attachableFromHand: number;
  readonly effectAttachTarget: EffectAttachTarget;
}

/** means(探す手段か中継)が、持ってきたエネルギーを効果で target につけられるか。つける先の条件は骨組みの matchesPokemonFilter で見る。 */
export function canAttachByEffectTo(
  means: EffectAttachTargets,
  target: EffectAttachTarget
): boolean {
  return (
    means.effectAttachTargetFilters?.some((filter) =>
      matchesPokemonFilter(target.state, target.pokemon, filter)
    ) ?? false
  );
}

/** 手札にある(来た)card を使ったときの探す手段。filters は card の手札にあるときの条件。 */
function buildHandFetchSource(
  card: Card,
  { inHand, inHandEffectAttachTargets }: FetchFilters
): DeckFetchSource {
  const onceInTurnKind = classifyOnceInTurnKind(card);
  return {
    filters: inHand,
    ...(onceInTurnKind === undefined ? {} : { onceInTurnKind }),
    ...(inHandEffectAttachTargets.length === 0
      ? {}
      : { effectAttachTargetFilters: inHandEffectAttachTargets }),
  };
}

/**
 * 手札にある(来た)card を、締め切り timing までに使えるか。この番の締め切りでは、グッズ・サポート・スタジアムを
 * 手札にあるとしたらこの番に使えるか(骨組みの canPlayTrainerIfInHand)で絞る。手札にあるカードでは、手札にあるかも
 * 見る canPlayTrainerFromHand と同じ結果になる。ポケモンとエネルギーは絞らない(listDeckFetchSources)。
 */
function isUsableByDeadline(
  context: EffectContext,
  card: Card,
  timing: DeadlineTiming
): boolean {
  const isTrainerPlayedFromHand =
    card.category === CardCategory.Goods ||
    card.category === CardCategory.Supporter ||
    card.category === CardCategory.Stadium;
  return (
    timing !== "thisTurn" ||
    !isTrainerPlayedFromHand ||
    canPlayTrainerIfInHand(context, card)
  );
}

/** 手札の探す手段。excludedHandCounts の枚数分を除き、この番の締め切りではグッズ・サポート・スタジアムを今使えるものに絞る。 */
function listHandSources(
  context: EffectContext,
  timing: DeadlineTiming,
  excludedHandCounts: ReadonlyMap<CardRecord, number>
): DeckFetchSource[] {
  const sources: DeckFetchSource[] = [];
  const excluded = new Map(excludedHandCounts);
  for (const card of context.state.hand) {
    const filters = listFetchFiltersOf(card.record);
    if (filters.inHand.length === 0) {
      continue;
    }
    const excludedCount = excluded.get(card.record) ?? 0;
    if (excludedCount > 0) {
      excluded.set(card.record, excludedCount - 1);
      continue;
    }
    if (isUsableByDeadline(context, card, timing)) {
      sources.push(buildHandFetchSource(card, filters));
    }
  }
  return sources;
}

/** 場のポケモンの特性と場のスタジアムの効果の探す手段。この番の締め切りでは今使えるものに絞る。 */
function listInPlaySources(
  context: EffectContext,
  timing: DeadlineTiming
): DeckFetchSource[] {
  const { state } = context;
  const isThisTurn = timing === "thisTurn";
  const sources: DeckFetchSource[] = [];
  for (const pokemon of state.listPokemonInPlay()) {
    for (const { abilityName, filters } of listFetchFiltersOf(
      pokemon.card.record
    ).inPlayAbilities) {
      if (!isThisTurn || canUseAbility(context, pokemon, abilityName)) {
        sources.push({ filters });
      }
    }
  }
  const { stadium } = state;
  if (stadium !== undefined) {
    // 場のスタジアムの効果は「出す」ことではないので、スタジアムを出す 1 回の番に 1 枚の制限の種類を持たせない
    const { inPlayStadium } = listFetchFiltersOf(stadium.record);
    if (
      inPlayStadium.length > 0 &&
      (!isThisTurn || canUseStadiumEffect(context))
    ) {
      sources.push({ filters: inPlayStadium });
    }
  }
  return sources;
}

/**
 * 手札と場の探す手段(1 枚ずつ)。excludedHandCounts の枚数分の手札は除く(道の必要なカードとして手札から数えた
 * カードを、同じ道の探す手段に重ねないため)。この番の締め切り(thisTurn)では、骨組みの判定(canPlayTrainerIfInHand、
 * canUseAbility、canUseStadiumEffect)で今使えるものに絞る。手札のポケモンとエネルギーは絞らない。手札から出したとき・
 * つけたときの効果を今使えるかを 1 つで答える骨組みの関数が無く、評価の中で条件を書き直すことになるため。
 */
export function listDeckFetchSources(
  state: GameState,
  timing: DeadlineTiming,
  excludedHandCounts: ReadonlyMap<CardRecord, number>
): DeckFetchSource[] {
  const context: EffectContext = { choices: firstCandidateChoices, state };
  return [
    ...listHandSources(context, timing, excludedHandCounts),
    ...listInPlaySources(context, timing),
  ];
}

/**
 * 2 段の中継に使える見えていないカード(記録ごとに 1 つ)。この番の締め切りでは、手札の探す手段と同じく、手札に
 * 来たとしたらこの番に使えるかで絞る(isUsableByDeadline)。この番にサポートを使った後に、山札のサポートを中継に
 * 数えないため(docs/pokemon-tcg/basic-rules.md 75 行)。
 */
export function listDeckFetchRelays(
  state: GameState,
  timing: DeadlineTiming,
  unseen: UnseenCards
): DeckFetchRelay[] {
  const context: EffectContext = { choices: firstCandidateChoices, state };
  const relays: DeckFetchRelay[] = [];
  for (const { card } of unseen.values()) {
    const filters = listFetchFiltersOf(card.record);
    if (
      filters.inHand.length > 0 &&
      isUsableByDeadline(context, card, timing)
    ) {
      relays.push({ card, ...buildHandFetchSource(card, filters) });
    }
  }
  return relays;
}

/** 同じ条件・同じ種類の探す手段の束。同じ記録の手札は入れ替えても割り当ての結果が変わらないので、まとめて枚数で数える。 */
interface SourceGroup {
  /** 持ってきたエネルギーを効果で、割り当てに渡したつける先につけられるか。 */
  readonly attachesByEffect: boolean;
  remaining: number;
  readonly source: DeckFetchSource;
}

function groupSources(
  sources: readonly DeckFetchSource[],
  attachTarget: EffectAttachTarget | undefined
): SourceGroup[] {
  const groups: SourceGroup[] = [];
  for (const source of sources) {
    const group = groups.find(
      (entry) =>
        entry.source.filters === source.filters &&
        entry.source.onceInTurnKind === source.onceInTurnKind
    );
    if (group === undefined) {
      groups.push({
        attachesByEffect:
          attachTarget !== undefined &&
          canAttachByEffectTo(source, attachTarget),
        remaining: 1,
        source,
      });
    } else {
      group.remaining += 1;
    }
  }
  return groups;
}

/**
 * 割り当ての良さ。持ってくる先を選べた数、探す手段を割り当てた数、1 段の数の順に比べる。エネルギーの要求の割り当てでは、
 * 効果でつけない要求を手札からつけられる残りの回数分(1 段、2 段、引くしかないの順に良いほうから)だけ数え、効果でつける
 * 要求はすべて数える。3 つの数で、数えた要求の結果ごとの数が決まる。
 */
type AssignmentScore = readonly [number, number, number];

/** 割り当てた要るもののうち、持ってくる先を選べた数、探す手段を割り当てた数、1 段の数。 */
interface RouteCounts {
  assigned: number;
  fetched: number;
  oneStep: number;
}

function isGreater(left: AssignmentScore, right: AssignmentScore): boolean {
  for (let index = 0; index < left.length; index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) {
      return difference > 0;
    }
  }
  return false;
}

/**
 * 1 回の割り当ての途中経過(残りの枚数、使った探す手段と種類、決まった結果)と、ここまでの最善。選び方を深さ優先で
 * すべて試す。消費はこの 1 回の割り当ての中だけで数える(道ごとに別に割り当てる)。
 */
class DeckFetchAssignment {
  private best:
    | { assignments: FetchAssignment[]; score: AssignmentScore }
    | undefined;
  /** 効果でつけない要求を数える上限(手札からつけられる残りの回数)。道の見込みの割り当てでは上限が無い。 */
  private readonly attachableFromHand: number;
  private readonly groups: SourceGroup[];
  /** 2 段の中継と、持ってきたエネルギーを効果でつける先につけるか。 */
  private readonly relays: readonly {
    readonly attachesByEffect: boolean;
    readonly relay: DeckFetchRelay;
  }[];
  private readonly hasRelayAttachingByEffect: boolean;
  /** 記録ごとの、この割り当てで使った枚数。残りは unseen の枚数から引いて出す。 */
  private readonly consumed = new Map<CardRecord, number>();
  private readonly requirements: readonly FetchRequirement[];
  private readonly assignments: FetchAssignment[] = [];
  /** ここまでに割り当てた要るもののうち、効果でつけるものの数。 */
  private readonly attachedByEffectCounts: RouteCounts = {
    assigned: 0,
    fetched: 0,
    oneStep: 0,
  };
  /** ここまでに割り当てた要るもののうち、効果でつけないものの数。 */
  private readonly limitedCounts: RouteCounts = {
    assigned: 0,
    fetched: 0,
    oneStep: 0,
  };
  private readonly timing: DeadlineTiming;
  private readonly unseen: UnseenCards;
  private readonly usedKinds = new Set<OnceInTurnKind>();

  constructor(
    requirements: readonly FetchRequirement[],
    sources: readonly DeckFetchSource[],
    relays: readonly DeckFetchRelay[],
    unseen: UnseenCards,
    timing: DeadlineTiming,
    energyAttach: EnergyAttachConditions | undefined
  ) {
    this.requirements = requirements;
    this.attachableFromHand =
      energyAttach?.attachableFromHand ?? Number.POSITIVE_INFINITY;
    const attachTarget = energyAttach?.effectAttachTarget;
    this.groups = groupSources(sources, attachTarget);
    this.relays = relays.map((relay) => ({
      attachesByEffect:
        attachTarget !== undefined && canAttachByEffectTo(relay, attachTarget),
      relay,
    }));
    this.hasRelayAttachingByEffect = this.relays.some(
      ({ attachesByEffect }) => attachesByEffect
    );
    this.unseen = unseen;
    this.timing = timing;
  }

  findBestAssignments(): FetchAssignment[] {
    this.search(0);
    return this.best?.assignments ?? [];
  }

  /**
   * ここまでの割り当ての良さ。効果でつけない要求は、良いほうから手札からつけられる残りの回数分だけ数える。1 段の要求は
   * 割り当てた要求に、割り当てた要求は持ってくる先を選べた要求に含まれるので、良いほうから回数分を採ったときの 3 つの
   * 数は、それぞれの数と回数の小さいほうになる。
   */
  private scoreAssignment(): AssignmentScore {
    const limit = this.attachableFromHand;
    const byEffect = this.attachedByEffectCounts;
    const limited = this.limitedCounts;
    return [
      byEffect.fetched + Math.min(limited.fetched, limit),
      byEffect.assigned + Math.min(limited.assigned, limit),
      byEffect.oneStep + Math.min(limited.oneStep, limit),
    ];
  }

  private countRemaining(record: CardRecord): number {
    return (
      (this.unseen.get(record)?.count ?? 0) - (this.consumed.get(record) ?? 0)
    );
  }

  private consume(record: CardRecord, count: number): void {
    this.consumed.set(record, (this.consumed.get(record) ?? 0) + count);
  }

  /** この番の締め切りでは、種類のある探す手段と中継(サポート、スタジアム)を種類ごとに 1 回で使い切る。 */
  private isKindAvailable(kind: OnceInTurnKind | undefined): boolean {
    return (
      this.timing !== "thisTurn" ||
      kind === undefined ||
      !this.usedKinds.has(kind)
    );
  }

  private markKind(kind: OnceInTurnKind | undefined, isUsed: boolean): void {
    if (this.timing !== "thisTurn" || kind === undefined) {
      return;
    }
    if (isUsed) {
      this.usedKinds.add(kind);
    } else {
      this.usedKinds.delete(kind);
    }
  }

  private isGroupAvailable(group: SourceGroup): boolean {
    return (
      group.remaining > 0 && this.isKindAvailable(group.source.onceInTurnKind)
    );
  }

  /** group の探す手段を 1 枚使った状態で then を行い、元に戻す。 */
  private withGroupUsed(group: SourceGroup, then: () => void): void {
    group.remaining -= 1;
    this.markKind(group.source.onceInTurnKind, true);
    then();
    this.markKind(group.source.onceInTurnKind, false);
    group.remaining += 1;
  }

  private search(index: number): void {
    const score = this.scoreAssignment();
    const left = this.requirements.length - index;
    // 残りの要るものがすべて数えられる 1 段になっても今の最善を超えなければ、これより先を試さない。要るもの 1 つで
    // 3 つの数はそれぞれ 1 までしか増えない(効果でつけない要求が回数を超えても、数える要求が良いほうに入れ替わるだけ)
    if (
      this.best !== undefined &&
      !isGreater(
        [score[0] + left, score[1] + left, score[2] + left],
        this.best.score
      )
    ) {
      return;
    }
    const requirement = this.requirements[index];
    if (requirement === undefined) {
      this.best = { assignments: [...this.assignments], score };
      return;
    }
    for (const record of requirement.candidates) {
      const target = this.unseen.get(record);
      if (target === undefined || this.countRemaining(record) < 1) {
        continue;
      }
      this.consume(record, 1);
      this.tryOneStep(index, target.card);
      this.tryTwoSteps(index, target.card);
      this.descend(index, "drawOnly", false);
      this.consume(record, -1);
    }
    this.descend(index, "noCopyLeft", false);
  }

  /** 要るもの index を route で満たしたとして次へ進む。効果でつけるかで、数える数を分ける。 */
  private descend(
    index: number,
    route: FetchRoute,
    isAttachedByEffect: boolean
  ): void {
    const counts = isAttachedByEffect
      ? this.attachedByEffectCounts
      : this.limitedCounts;
    const fetched = route === "noCopyLeft" ? 0 : 1;
    const assigned = route === "oneStep" || route === "twoSteps" ? 1 : 0;
    const oneStep = route === "oneStep" ? 1 : 0;
    counts.fetched += fetched;
    counts.assigned += assigned;
    counts.oneStep += oneStep;
    this.assignments.push({ isAttachedByEffect, route });
    this.search(index + 1);
    this.assignments.pop();
    counts.fetched -= fetched;
    counts.assigned -= assigned;
    counts.oneStep -= oneStep;
  }

  private tryOneStep(index: number, target: Card): void {
    for (const group of this.groups) {
      if (
        this.isGroupAvailable(group) &&
        matchesAnyFilter(group.source.filters, target)
      ) {
        this.withGroupUsed(group, () =>
          this.descend(index, "oneStep", group.attachesByEffect)
        );
      }
    }
  }

  private tryTwoSteps(index: number, target: Card): void {
    for (const group of this.groups) {
      if (!this.isGroupAvailable(group)) {
        continue;
      }
      const canFetchTargetDirectly = matchesAnyFilter(
        group.source.filters,
        target
      );
      // 1 段で持ってこられる手段は、ふつうは 2 段に使わない。同じ手段と持ってくる先を消費して 1 段のほうが必ず良いため。
      // ただし 1 段では効果でつけず、2 段の中継が効果でつけるときは、手札からつける回数が残っていなければ 2 段のほうが
      // 良い(ドロンチ 049263 の「ていさつしれい」は山札のどのカードも持ってこられ、山札のアカマツ 049412 にも届く)
      if (
        canFetchTargetDirectly &&
        (group.attachesByEffect || !this.hasRelayAttachingByEffect)
      ) {
        continue;
      }
      this.withGroupUsed(group, () => {
        // 2 段では、効果でつけるかは持ってくる最後の段の中継で決まる(中継のアカマツが山札のエネルギーをつける)
        for (const { attachesByEffect, relay } of this.relays) {
          if (
            (canFetchTargetDirectly && !attachesByEffect) ||
            !this.canRelay(group, relay, target)
          ) {
            continue;
          }
          this.consume(relay.card.record, 1);
          this.markKind(relay.onceInTurnKind, true);
          this.descend(index, "twoSteps", attachesByEffect);
          this.markKind(relay.onceInTurnKind, false);
          this.consume(relay.card.record, -1);
        }
      });
    }
  }

  private canRelay(
    group: SourceGroup,
    relay: DeckFetchRelay,
    target: Card
  ): boolean {
    return (
      this.countRemaining(relay.card.record) > 0 &&
      this.isKindAvailable(relay.onceInTurnKind) &&
      matchesAnyFilter(group.source.filters, relay.card) &&
      matchesAnyFilter(relay.filters, target)
    );
  }
}

/**
 * 持ってくる必要のあるものに、探す手段を 1 枚につき 1 つずつ割り当てる(要るものと同じ並びで結果を返す)。
 * unseen は、この割り当てで使ってよい見えていないカードの記録ごとの残りの枚数。要るものごとに持ってくる先の 1 枚と、
 * 2 段の中継の 1 枚を同じ残りの枚数から消費し、同じ 1 枚を 2 度使わない。選び方をすべて試し、持ってくる先を選べた数、
 * 探す手段を割り当てた数、1 段の数がいちばん大きいものを返す。この番の締め切りでは、種類のある探す手段と中継
 * (サポート、スタジアム)を種類ごとに 1 回で使い切る(docs/pokemon-tcg/basic-rules.md 75・76 行)。energyAttach を
 * 渡すと(ワザのエネルギーの要求)、持ってきたエネルギーを効果でつける先につける探す手段・中継で満たした要るものに
 * isAttachedByEffect を付け、3 つの数は、効果でつけない要求を手札からつけられる残りの回数分だけ数えて比べる。
 */
export function assignDeckFetchSources(
  requirements: readonly FetchRequirement[],
  sources: readonly DeckFetchSource[],
  relays: readonly DeckFetchRelay[],
  unseen: UnseenCards,
  timing: DeadlineTiming,
  energyAttach?: EnergyAttachConditions
): FetchAssignment[] {
  return new DeckFetchAssignment(
    requirements,
    sources,
    relays,
    unseen,
    timing,
    energyAttach
  ).findBestAssignments();
}
