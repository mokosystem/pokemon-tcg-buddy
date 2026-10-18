/**
 * 道の揃い具合を見る評価(goal-prospects.ts)が使う、山札から持ってくる効果の読み取りと割り当て。手札と場のカードの
 * 記録の効果の翻訳から、山札のカードを手札か場に持ってくる操作の条件を集めて探す手段(CONTEXT.md「探す手段」)の
 * 一覧にし、見えていないカード(山札とサイド)から持ってくる必要のあるものに、探す手段を 1 枚につき 1 つずつ割り当てる。
 */

import {
  canPlayTrainerFromHand,
  canPlayTrainerIfInHand,
  canUseAbility,
  canUseStadiumEffect,
} from "./card-effects.ts";
import {
  CardCategory,
  type CardFilter,
  type CardRecord,
  type EffectStep,
} from "./card-record-schema.ts";
import { type Card, matchesCardFilter } from "./cards.ts";
import type { DeadlineTiming } from "./deadline-timing.ts";
import { type EffectContext, firstCandidateChoices } from "./effect-choices.ts";
import {
  classifyOnceInTurnKind,
  type GameState,
  type OnceInTurnKind,
} from "./state.ts";

/** 見えていないカード(山札とサイド)の、記録ごとの枚数と代表の 1 枚。 */
export type UnseenCards = ReadonlyMap<
  CardRecord,
  { readonly card: Card; readonly count: number }
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

function listFetchFiltersOf(record: CardRecord): FetchFilters {
  const cached = fetchFiltersByRecord.get(record);
  if (cached !== undefined) {
    return cached;
  }
  let filters: FetchFilters;
  if (record.category === CardCategory.Pokemon) {
    const effectsOf = (kinds: readonly string[]) =>
      record.abilities.flatMap((ability) =>
        ability.translation !== undefined &&
        "effect" in ability.translation &&
        kinds.includes(ability.translation.kind)
          ? [{ abilityName: ability.name, effect: ability.translation.effect }]
          : []
      );
    filters = {
      inHand: filtersOf(
        effectsOf([
          "activatedFromHand",
          "triggeredWhenPlacedOnBenchFromHand",
          "triggeredWhenEvolvedFromHand",
        ]).map(({ effect }) => effect)
      ),
      inPlayAbilities: effectsOf(["activatedInPlay"])
        .map(({ abilityName, effect }) => ({
          abilityName,
          filters: listDeckFetchFilters(effect.steps),
        }))
        .filter(({ filters: abilityFilters }) => abilityFilters.length > 0),
      inPlayStadium: [],
    };
  } else {
    const cardEffects = "cardEffects" in record ? record.cardEffects : [];
    const all = filtersOf(
      cardEffects.flatMap((cardEffect) =>
        "effect" in cardEffect ? [cardEffect.effect] : []
      )
    );
    const inPlayStadium = filtersOf(
      cardEffects.flatMap((cardEffect) =>
        cardEffect.kind === "activatedOncePerTurn" ? [cardEffect.effect] : []
      )
    );
    filters = { inHand: all, inPlayAbilities: [], inPlayStadium };
  }
  fetchFiltersByRecord.set(record, filters);
  return filters;
}

const filterMatchesByRecord = new WeakMap<
  readonly CardFilter[],
  Map<CardRecord, boolean>
>();

/** card が条件のどれかに合うか。条件はカードの記録だけで決まるので、条件の並びと記録の組で覚えて評価ごとに繰り返さない。 */
function matchesAnyFilter(filters: readonly CardFilter[], card: Card): boolean {
  let matches = filterMatchesByRecord.get(filters);
  if (matches === undefined) {
    matches = new Map();
    filterMatchesByRecord.set(filters, matches);
  }
  let matched = matches.get(card.record);
  if (matched === undefined) {
    matched = filters.some((filter) => matchesCardFilter(card, filter));
    matches.set(card.record, matched);
  }
  return matched;
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
export function countUnseenByRecord(
  state: GameState
): Map<CardRecord, { card: Card; count: number }> {
  const counts = new Map<CardRecord, { card: Card; count: number }>();
  for (const zone of [state.deck, state.prizes]) {
    for (const card of zone) {
      const entry = counts.get(card.record);
      if (entry === undefined) {
        counts.set(card.record, { card, count: 1 });
      } else {
        entry.count += 1;
      }
    }
  }
  return counts;
}

/** 手札から使うトレーナーズ(グッズ・サポート・スタジアム)か。使えるかを骨組みの canPlayTrainerFromHand で判定できる。 */
function isTrainerPlayedFromHand(card: Card): boolean {
  return (
    card.category === CardCategory.Goods ||
    card.category === CardCategory.Supporter ||
    card.category === CardCategory.Stadium
  );
}

/** 探す手段 1 枚(CONTEXT.md「探す手段」)。 */
export interface DeckFetchSource {
  /** 使うと山札から持ってこられるカードの条件。 */
  readonly filters: readonly CardFilter[];
  readonly onceInTurnKind?: OnceInTurnKind;
}

/**
 * 2 段で持ってくるときの中継に使える、見えていないカードの記録 1 つ(CONTEXT.md「見えていないカード」)。
 * 探す手段で手札に加えた後、そのカードの効果で山札からさらに持ってこられる。
 */
export interface DeckFetchRelay {
  /** 見えていないカードのうちの代表の 1 枚。 */
  readonly card: Card;
  /** 手札に来た後に使うと山札から持ってこられるカードの条件。 */
  readonly filters: readonly CardFilter[];
  readonly onceInTurnKind?: OnceInTurnKind;
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

function withOnceInTurnKind(card: Card): { onceInTurnKind?: OnceInTurnKind } {
  const onceInTurnKind = classifyOnceInTurnKind(card);
  return onceInTurnKind === undefined ? {} : { onceInTurnKind };
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
    const { inHand } = listFetchFiltersOf(card.record);
    if (inHand.length === 0) {
      continue;
    }
    const excludedCount = excluded.get(card.record) ?? 0;
    if (excludedCount > 0) {
      excluded.set(card.record, excludedCount - 1);
      continue;
    }
    if (
      timing === "thisTurn" &&
      isTrainerPlayedFromHand(card) &&
      !canPlayTrainerFromHand(context, card)
    ) {
      continue;
    }
    sources.push({ filters: inHand, ...withOnceInTurnKind(card) });
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
 * カードを、同じ道の探す手段に重ねないため)。この番の締め切り(thisTurn)では、骨組みの判定(canPlayTrainerFromHand、
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
 * 2 段の中継に使える見えていないカード(記録ごとに 1 つ)。この番の締め切りでは、グッズ・サポート・スタジアムを、
 * 手札に来たとしたらこの番に使えるか(骨組みの canPlayTrainerIfInHand)で絞る。この番にサポートを使った後に、山札の
 * サポートを中継に数えないため(docs/pokemon-tcg/basic-rules.md 75 行)。ポケモンとエネルギーは listDeckFetchSources と
 * 同じ理由で絞らない。
 */
export function listDeckFetchRelays(
  state: GameState,
  timing: DeadlineTiming,
  unseen: UnseenCards
): DeckFetchRelay[] {
  const context: EffectContext = { choices: firstCandidateChoices, state };
  const relays: DeckFetchRelay[] = [];
  for (const { card } of unseen.values()) {
    const { inHand } = listFetchFiltersOf(card.record);
    if (inHand.length === 0) {
      continue;
    }
    if (
      timing === "thisTurn" &&
      isTrainerPlayedFromHand(card) &&
      !canPlayTrainerIfInHand(context, card)
    ) {
      continue;
    }
    relays.push({ card, filters: inHand, ...withOnceInTurnKind(card) });
  }
  return relays;
}

/** 同じ条件・同じ種類の探す手段の束。同じ記録の手札は入れ替えても割り当ての結果が変わらないので、まとめて枚数で数える。 */
interface SourceGroup {
  remaining: number;
  readonly source: DeckFetchSource;
}

function groupSources(sources: readonly DeckFetchSource[]): SourceGroup[] {
  const groups: SourceGroup[] = [];
  for (const source of sources) {
    const group = groups.find(
      (entry) =>
        entry.source.filters === source.filters &&
        entry.source.onceInTurnKind === source.onceInTurnKind
    );
    if (group === undefined) {
      groups.push({ remaining: 1, source });
    } else {
      group.remaining += 1;
    }
  }
  return groups;
}

/** 割り当ての良さ。持ってくる先を選べた数、探す手段を割り当てた数、1 段の数の順に比べる。 */
type AssignmentScore = readonly [number, number, number];

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
  private best: { routes: FetchRoute[]; score: AssignmentScore } | undefined;
  private readonly groups: SourceGroup[];
  private readonly relays: readonly DeckFetchRelay[];
  /** 記録ごとの、この割り当てで使った枚数。残りは unseen の枚数から引いて出す。 */
  private readonly consumed = new Map<CardRecord, number>();
  private readonly requirements: readonly FetchRequirement[];
  private readonly routes: FetchRoute[] = [];
  private readonly timing: DeadlineTiming;
  private readonly unseen: UnseenCards;
  private readonly usedKinds = new Set<OnceInTurnKind>();

  constructor(
    requirements: readonly FetchRequirement[],
    sources: readonly DeckFetchSource[],
    relays: readonly DeckFetchRelay[],
    unseen: UnseenCards,
    timing: DeadlineTiming
  ) {
    this.requirements = requirements;
    this.groups = groupSources(sources);
    this.relays = relays;
    this.unseen = unseen;
    this.timing = timing;
  }

  findBestRoutes(): FetchRoute[] {
    this.search(0, [0, 0, 0]);
    return this.best?.routes ?? [];
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

  private search(index: number, score: AssignmentScore): void {
    const left = this.requirements.length - index;
    // 残りの要るものがすべて 1 段になっても今の最善を超えなければ、これより先を試さない
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
      this.best = { routes: [...this.routes], score };
      return;
    }
    const [fetched, assigned, oneStep] = score;
    for (const record of requirement.candidates) {
      const target = this.unseen.get(record);
      if (target === undefined || this.countRemaining(record) < 1) {
        continue;
      }
      this.consume(record, 1);
      this.tryOneStep(index, target.card, [
        fetched + 1,
        assigned + 1,
        oneStep + 1,
      ]);
      this.tryTwoSteps(index, target.card, [
        fetched + 1,
        assigned + 1,
        oneStep,
      ]);
      this.descend(index, "drawOnly", [fetched + 1, assigned, oneStep]);
      this.consume(record, -1);
    }
    this.descend(index, "noCopyLeft", score);
  }

  private descend(index: number, route: FetchRoute, next: AssignmentScore) {
    this.routes.push(route);
    this.search(index + 1, next);
    this.routes.pop();
  }

  private tryOneStep(index: number, target: Card, next: AssignmentScore) {
    for (const group of this.groups) {
      if (
        this.isGroupAvailable(group) &&
        matchesAnyFilter(group.source.filters, target)
      ) {
        this.withGroupUsed(group, () => this.descend(index, "oneStep", next));
      }
    }
  }

  private tryTwoSteps(index: number, target: Card, next: AssignmentScore) {
    for (const group of this.groups) {
      // 1 段で持ってこられる手段は 2 段に使わない。同じ手段と持ってくる先を消費して 1 段のほうが必ず良いため
      if (
        !this.isGroupAvailable(group) ||
        matchesAnyFilter(group.source.filters, target)
      ) {
        continue;
      }
      this.withGroupUsed(group, () => {
        for (const relay of this.relays) {
          if (this.canRelay(group, relay, target)) {
            this.consume(relay.card.record, 1);
            this.markKind(relay.onceInTurnKind, true);
            this.descend(index, "twoSteps", next);
            this.markKind(relay.onceInTurnKind, false);
            this.consume(relay.card.record, -1);
          }
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
 * (サポート、スタジアム)を種類ごとに 1 回で使い切る(docs/pokemon-tcg/basic-rules.md 75・76 行)。
 */
export function assignDeckFetchSources(
  requirements: readonly FetchRequirement[],
  sources: readonly DeckFetchSource[],
  relays: readonly DeckFetchRelay[],
  unseen: UnseenCards,
  timing: DeadlineTiming
): FetchRoute[] {
  return new DeckFetchAssignment(
    requirements,
    sources,
    relays,
    unseen,
    timing
  ).findBestRoutes();
}
