/**
 * 計測の単位(試行の番号 i で回す対戦の組)を、期限まで回して数える。プロセスごとに担当する試行の番号
 * (firstTrialIndex + k × trialIndexStride)を順に回す。試行の対戦の種は番号だけで決まる(random.ts の deriveTrialSeed)ので、
 * プロセスに分けて数えた結果を足すと、1 プロセスで同じ番号を回して数えた結果と同じになる。
 *
 * ライブラリの中では時刻を直接読まず、今の時刻を返す関数を受け取る(骨組みのライブラリは実行環境に依存しない。
 * docs/solo-play-simulator-design.md「README『提供形態』との関係」)。
 */

import {
  addPairToCounts,
  addResultToTally,
  type BattleStyleSoloPlayTally,
  createEmptyPairedOutcomeCounts,
  createEmptyTally,
  type GameCost,
  mergePairedOutcomeCounts,
  mergeTallies,
  type PairedOutcomeCounts,
} from "./battle-style-solo-play-statistics.ts";
import type { Card } from "./cards.ts";
import type { BattleStyleSoloPlayResult, PlayingPolicy } from "./engine.ts";
import { deriveTrialSeed } from "./random.ts";
import type { SearchStatistics } from "./search-policy.ts";
import { runBattleStyleSoloPlayTrial } from "./simulate.ts";

export interface MeasurementCutoffs {
  /** 単位が終わった時刻と比べる期限(エポックからのミリ秒、昇順)。期限ごとに、それまでに終わった単位だけの集計を残す。 */
  readonly cutoffsEpochMilliseconds: readonly number[];
  /**
   * 全プロセスを合わせた単位の数の上限。試行の番号がこの数以上の単位は始めないので、全プロセスで試行 0〜maxUnits - 1 を
   * 1 回ずつ回す(上限が無い計測では Number.POSITIVE_INFINITY)。
   */
  readonly maxUnits: number;
}

export interface MeasurementRunOptions<Tally> extends MeasurementCutoffs {
  readonly createEmptyTally: () => Tally;
  readonly firstTrialIndex: number;
  /** 今の時刻(エポックからのミリ秒)。テストでは決まった値を返す関数を渡す。 */
  readonly measureNowEpochMilliseconds: () => number;
  /** 試行 trialIndex の 1 単位を回し、tally に足した新しい集計を返す。 */
  readonly runUnit: (trialIndex: number, tally: Tally) => Tally;
  readonly trialIndexStride: number;
}

export interface MeasurementRunOutcome<Tally> {
  /** 最後の期限より後に終わったため、どの期限にも入れなかった単位の数。 */
  readonly discardedUnits: number;
  /** cutoffsEpochMilliseconds と同じ並びの、期限ごとの集計。 */
  readonly talliesAtCutoffs: readonly Tally[];
}

/**
 * 最後の期限を過ぎるか maxUnits に達するまで、担当の単位を順に回す。期限ごとに、その期限までに終わった単位だけの集計を返す。
 * 期限の後に終わった単位は、その期限の集計に入れない(15 分で回せた回数を、15 分を過ぎてから終わった対戦で水増ししないため)。
 * 単位は順に終わるので、ある期限までに終わった単位は、回した順の先頭からの並びになる。
 */
export function runMeasurementUntilCutoffs<Tally>(
  options: MeasurementRunOptions<Tally>
): MeasurementRunOutcome<Tally> {
  const cutoffs = options.cutoffsEpochMilliseconds;
  const lastCutoff = cutoffs.at(-1) ?? Number.NEGATIVE_INFINITY;
  const talliesAtCutoffs: Tally[] = [];
  let tally = options.createEmptyTally();
  let discardedUnits = 0;
  for (
    let trialIndex = options.firstTrialIndex;
    trialIndex < options.maxUnits &&
    options.measureNowEpochMilliseconds() < lastCutoff;
    trialIndex += options.trialIndexStride
  ) {
    const added = options.runUnit(trialIndex, tally);
    const finishedAt = options.measureNowEpochMilliseconds();
    while (
      talliesAtCutoffs.length < cutoffs.length &&
      finishedAt > (cutoffs[talliesAtCutoffs.length] ?? lastCutoff)
    ) {
      talliesAtCutoffs.push(tally);
    }
    if (talliesAtCutoffs.length === cutoffs.length) {
      discardedUnits += 1;
    } else {
      tally = added;
    }
  }
  while (talliesAtCutoffs.length < cutoffs.length) {
    talliesAtCutoffs.push(tally);
  }
  return { discardedUnits, talliesAtCutoffs };
}

/** 1 デッキの計測(先攻と後攻)の集計。 */
export interface DeckMeasurementTally {
  readonly firstPlayer: BattleStyleSoloPlayTally;
  readonly secondPlayer: BattleStyleSoloPlayTally;
}

export function createEmptyDeckMeasurementTally(): DeckMeasurementTally {
  return { firstPlayer: createEmptyTally(), secondPlayer: createEmptyTally() };
}

export function mergeDeckMeasurementTallies(
  left: DeckMeasurementTally,
  right: DeckMeasurementTally
): DeckMeasurementTally {
  return {
    firstPlayer: mergeTallies(left.firstPlayer, right.firstPlayer),
    secondPlayer: mergeTallies(left.secondPlayer, right.secondPlayer),
  };
}

/** カードの入れ替えの計測の、先攻か後攻の 1 本ぶんの集計。 */
export interface CardSwapTurnOrderTally {
  readonly after: BattleStyleSoloPlayTally;
  readonly before: BattleStyleSoloPlayTally;
  readonly noOwnPokemonLosses: PairedOutcomeCounts;
  readonly wins: PairedOutcomeCounts;
}

/** カードの入れ替えの計測(先攻と後攻)の集計。 */
export interface CardSwapMeasurementTally {
  readonly firstPlayer: CardSwapTurnOrderTally;
  readonly secondPlayer: CardSwapTurnOrderTally;
}

function createEmptyCardSwapTurnOrderTally(): CardSwapTurnOrderTally {
  return {
    after: createEmptyTally(),
    before: createEmptyTally(),
    noOwnPokemonLosses: createEmptyPairedOutcomeCounts(),
    wins: createEmptyPairedOutcomeCounts(),
  };
}

export function createEmptyCardSwapMeasurementTally(): CardSwapMeasurementTally {
  return {
    firstPlayer: createEmptyCardSwapTurnOrderTally(),
    secondPlayer: createEmptyCardSwapTurnOrderTally(),
  };
}

/** 種をそろえた対の 2 回の対戦の結果を、先攻か後攻の 1 本ぶんの集計に足した新しい集計。 */
function addPairedResultsToTally(
  tally: CardSwapTurnOrderTally,
  before: {
    readonly cost: GameCost;
    readonly result: BattleStyleSoloPlayResult;
  },
  after: { readonly cost: GameCost; readonly result: BattleStyleSoloPlayResult }
): CardSwapTurnOrderTally {
  const lostWithNoOwnPokemon = (result: BattleStyleSoloPlayResult) =>
    result.reason === "noOwnPokemonInPlay";
  return {
    after: addResultToTally(tally.after, after.result, after.cost),
    before: addResultToTally(tally.before, before.result, before.cost),
    noOwnPokemonLosses: addPairToCounts(
      tally.noOwnPokemonLosses,
      lostWithNoOwnPokemon(before.result),
      lostWithNoOwnPokemon(after.result)
    ),
    wins: addPairToCounts(
      tally.wins,
      before.result.outcome === "win",
      after.result.outcome === "win"
    ),
  };
}

function mergeCardSwapTurnOrderTallies(
  left: CardSwapTurnOrderTally,
  right: CardSwapTurnOrderTally
): CardSwapTurnOrderTally {
  return {
    after: mergeTallies(left.after, right.after),
    before: mergeTallies(left.before, right.before),
    noOwnPokemonLosses: mergePairedOutcomeCounts(
      left.noOwnPokemonLosses,
      right.noOwnPokemonLosses
    ),
    wins: mergePairedOutcomeCounts(left.wins, right.wins),
  };
}

export function mergeCardSwapMeasurementTallies(
  left: CardSwapMeasurementTally,
  right: CardSwapMeasurementTally
): CardSwapMeasurementTally {
  return {
    firstPlayer: mergeCardSwapTurnOrderTallies(
      left.firstPlayer,
      right.firstPlayer
    ),
    secondPlayer: mergeCardSwapTurnOrderTallies(
      left.secondPlayer,
      right.secondPlayer
    ),
  };
}

/** 計測で 1 回の対戦を回すための材料。 */
export interface MeasuredDeck {
  readonly cards: readonly Card[];
  /** 試行ごとにプレイングの判断基準を作る。 */
  readonly createPolicy: (policySeed: number) => PlayingPolicy;
}

/** 種 trialSeed の対戦を 1 回回し、結果と、かかった時間と、探索の複製と試しの回数(探索でなければ 0)を返す。 */
function runMeasuredTrial(
  deck: MeasuredDeck,
  trialSeed: number,
  wentFirst: boolean,
  measureNowEpochMilliseconds: () => number
): { readonly cost: GameCost; readonly result: BattleStyleSoloPlayResult } {
  let policy: PlayingPolicy | undefined;
  const startedAt = measureNowEpochMilliseconds();
  const result = runBattleStyleSoloPlayTrial({
    cards: deck.cards,
    createPolicy: (policySeed) => {
      policy = deck.createPolicy(policySeed);
      return policy;
    },
    trialSeed,
    wentFirst,
  });
  const milliseconds = measureNowEpochMilliseconds() - startedAt;
  const statistics =
    policy !== undefined && "statistics" in policy
      ? (policy.statistics as SearchStatistics)
      : { clones: 0, trialScores: 0 };
  return {
    cost: {
      clones: statistics.clones,
      milliseconds,
      trialScores: statistics.trialScores,
    },
    result,
  };
}

/** 先攻と後攻の基準の種。 */
export interface TurnOrderBaseSeeds {
  readonly firstPlayer: number;
  readonly secondPlayer: number;
}

const TURN_ORDERS = [
  ["firstPlayer", true],
  ["secondPlayer", false],
] as const;

/** 1 デッキの計測の 1 単位(先攻 1 回と後攻 1 回)を回し、tally に足した新しい集計を返す。 */
export function runDeckMeasurementUnit(
  options: {
    readonly baseSeeds: TurnOrderBaseSeeds;
    readonly deck: MeasuredDeck;
    readonly measureNowEpochMilliseconds: () => number;
  },
  trialIndex: number,
  tally: DeckMeasurementTally
): DeckMeasurementTally {
  const next = { ...tally };
  for (const [turnOrder, wentFirst] of TURN_ORDERS) {
    const { cost, result } = runMeasuredTrial(
      options.deck,
      deriveTrialSeed(options.baseSeeds[turnOrder], trialIndex),
      wentFirst,
      options.measureNowEpochMilliseconds
    );
    next[turnOrder] = addResultToTally(next[turnOrder], result, cost);
  }
  return next;
}

/**
 * カードの入れ替えの計測の 1 単位(入れ替える前と後の、先攻 1 回ずつと後攻 1 回ずつ。前と後は同じ種)を回し、tally に足した
 * 新しい集計を返す。
 */
export function runCardSwapMeasurementUnit(
  options: {
    readonly after: MeasuredDeck;
    readonly baseSeeds: TurnOrderBaseSeeds;
    readonly before: MeasuredDeck;
    readonly measureNowEpochMilliseconds: () => number;
  },
  trialIndex: number,
  tally: CardSwapMeasurementTally
): CardSwapMeasurementTally {
  const next = { ...tally };
  for (const [turnOrder, wentFirst] of TURN_ORDERS) {
    const trialSeed = deriveTrialSeed(options.baseSeeds[turnOrder], trialIndex);
    next[turnOrder] = addPairedResultsToTally(
      next[turnOrder],
      runMeasuredTrial(
        options.before,
        trialSeed,
        wentFirst,
        options.measureNowEpochMilliseconds
      ),
      runMeasuredTrial(
        options.after,
        trialSeed,
        wentFirst,
        options.measureNowEpochMilliseconds
      )
    );
  }
  return next;
}
