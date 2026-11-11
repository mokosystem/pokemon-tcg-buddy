/**
 * 対戦風の一人回しの結果を数え、勝率などの割合と 95 % の誤差の幅を求める。数えた数は足し合わせられる形で持ち、
 * 複数のプロセスで数えた結果を足してから、最後に誤差の幅を求める。
 */

import type { BattleStyleSoloPlayResult } from "./engine.ts";
import type { BattleStyleSoloPlayDecisionReason } from "./state.ts";

/** 標準正規分布の 97.5 % 点。95 % の幅の係数。 */
const Z_95 = 1.959_963_984_540_054;
/** Tango の区間の端を二分法で求めるときの繰り返しの回数。 */
const BISECTION_ITERATIONS = 100;

/** 1 本(1 デッキの先攻か後攻)の対戦の結果を数えたもの。 */
export interface BattleStyleSoloPlayTally {
  /** 勝敗が決まった理由ごとの対戦の数。 */
  readonly decisionReasonCounts: Readonly<
    Record<BattleStyleSoloPlayDecisionReason, number>
  >;
  readonly games: number;
  /** 探索が状態を複製した回数の合計(探索でない設定は 0)。 */
  readonly totalClones: number;
  /** 対戦にかかった時間の合計(ミリ秒。1 プロセスの中で測った値)。 */
  readonly totalGameMilliseconds: number;
  /** 探索が試しの点数を出した回数の合計(探索でない設定は 0)。 */
  readonly totalTrialScores: number;
  /** 勝った対戦の、サイドを取り切った自分の番の回数ごとの数(キーは番の回数)。 */
  readonly winningTurnCounts: Readonly<Record<string, number>>;
  readonly wins: number;
}

/** 1 回の対戦にかかった仕事の量。 */
export interface GameCost {
  readonly clones: number;
  readonly milliseconds: number;
  readonly trialScores: number;
}

export function createEmptyTally(): BattleStyleSoloPlayTally {
  return {
    decisionReasonCounts: {
      cannotDrawAtTurnStart: 0,
      noOwnPokemonInPlay: 0,
      opponentPrizesTaken: 0,
      ownPrizesTaken: 0,
    },
    games: 0,
    totalClones: 0,
    totalGameMilliseconds: 0,
    totalTrialScores: 0,
    winningTurnCounts: {},
    wins: 0,
  };
}

function addCounts<Key extends string>(
  left: Readonly<Record<Key, number>>,
  right: Readonly<Record<Key, number>>
): Record<Key, number> {
  const sum = { ...left } as Record<Key, number>;
  for (const [key, count] of Object.entries(right) as [Key, number][]) {
    sum[key] = (sum[key] ?? 0) + count;
  }
  return sum;
}

/** tally に 1 回の対戦の結果を足した新しい集計。 */
export function addResultToTally(
  tally: BattleStyleSoloPlayTally,
  result: BattleStyleSoloPlayResult,
  cost: GameCost
): BattleStyleSoloPlayTally {
  const won = result.outcome === "win";
  return {
    decisionReasonCounts: addCounts(tally.decisionReasonCounts, {
      [result.reason]: 1,
    } as Record<BattleStyleSoloPlayDecisionReason, number>),
    games: tally.games + 1,
    totalClones: tally.totalClones + cost.clones,
    totalGameMilliseconds: tally.totalGameMilliseconds + cost.milliseconds,
    totalTrialScores: tally.totalTrialScores + cost.trialScores,
    winningTurnCounts: won
      ? addCounts(tally.winningTurnCounts, {
          [String(result.decidedTurn.ordinal)]: 1,
        })
      : tally.winningTurnCounts,
    wins: tally.wins + (won ? 1 : 0),
  };
}

export function mergeTallies(
  left: BattleStyleSoloPlayTally,
  right: BattleStyleSoloPlayTally
): BattleStyleSoloPlayTally {
  return {
    decisionReasonCounts: addCounts(
      left.decisionReasonCounts,
      right.decisionReasonCounts
    ),
    games: left.games + right.games,
    totalClones: left.totalClones + right.totalClones,
    totalGameMilliseconds:
      left.totalGameMilliseconds + right.totalGameMilliseconds,
    totalTrialScores: left.totalTrialScores + right.totalTrialScores,
    winningTurnCounts: addCounts(
      left.winningTurnCounts,
      right.winningTurnCounts
    ),
    wins: left.wins + right.wins,
  };
}

/** 種をそろえた対(GLOSSARY.md)で、ある出来事(勝った、場に自分のポケモンがいなくなって負けた)が起きたかの組ごとの数。 */
export interface PairedOutcomeCounts {
  readonly bothOccurred: number;
  readonly neitherOccurred: number;
  readonly onlyAfterOccurred: number;
  readonly onlyBeforeOccurred: number;
}

export function createEmptyPairedOutcomeCounts(): PairedOutcomeCounts {
  return {
    bothOccurred: 0,
    neitherOccurred: 0,
    onlyAfterOccurred: 0,
    onlyBeforeOccurred: 0,
  };
}

/** counts に、入れ替える前と後で出来事が起きたかの 1 組を足した新しい数。 */
export function addPairToCounts(
  counts: PairedOutcomeCounts,
  occurredBefore: boolean,
  occurredAfter: boolean
): PairedOutcomeCounts {
  return mergePairedOutcomeCounts(counts, {
    bothOccurred: occurredBefore && occurredAfter ? 1 : 0,
    neitherOccurred: occurredBefore || occurredAfter ? 0 : 1,
    onlyAfterOccurred: !occurredBefore && occurredAfter ? 1 : 0,
    onlyBeforeOccurred: occurredBefore && !occurredAfter ? 1 : 0,
  });
}

export function mergePairedOutcomeCounts(
  left: PairedOutcomeCounts,
  right: PairedOutcomeCounts
): PairedOutcomeCounts {
  return addCounts(left, right);
}

export interface ProportionInterval {
  readonly lower: number;
  readonly upper: number;
  readonly value: number;
}

/**
 * 割合の 95 % の誤差の幅(ウィルソンのスコア区間)。trials が 0 なら区間を出せないので undefined を返す。数は整数でなくてよい。
 * 中心 (p + z²/2n) / (1 + z²/n)、半幅 z × sqrt(p(1 - p)/n + z²/4n²) / (1 + z²/n)。出典:
 * https://en.wikipedia.org/wiki/Binomial_proportion_confidence_interval 節「Wilson score interval」(2026-11-12 確認)。
 * 正規近似の区間を採らないのは、出来事が 0 回のとき幅が 0 になり、勝率が 0 % 近い手順と比べられないため。
 */
export function calculateWilsonInterval(
  occurrences: number,
  trials: number
): ProportionInterval | undefined {
  if (trials <= 0) {
    return undefined;
  }
  const proportion = occurrences / trials;
  const zSquared = Z_95 * Z_95;
  const denominator = 1 + zSquared / trials;
  const center = (proportion + zSquared / (2 * trials)) / denominator;
  const halfWidth =
    (Z_95 *
      Math.sqrt(
        (proportion * (1 - proportion)) / trials +
          zSquared / (4 * trials * trials)
      )) /
    denominator;
  return {
    lower: Math.max(0, center - halfWidth),
    upper: Math.min(1, center + halfWidth),
    value: proportion,
  };
}

function countPairs(counts: PairedOutcomeCounts): number {
  return (
    counts.bothOccurred +
    counts.onlyBeforeOccurred +
    counts.onlyAfterOccurred +
    counts.neitherOccurred
  );
}

/** Tango のスコア統計量。仮の差 difference について減少する。 */
function calculateTangoScore(
  onlyBefore: number,
  onlyAfter: number,
  pairs: number,
  difference: number
): number {
  const a = 2 * pairs;
  const b =
    -onlyBefore - onlyAfter + (2 * pairs - onlyAfter + onlyBefore) * difference;
  const c = -onlyBefore * difference * (1 - difference);
  const q = (Math.sqrt(b * b - 4 * a * c) - b) / (2 * a);
  return (
    (onlyAfter - onlyBefore - pairs * difference) /
    Math.sqrt(pairs * (2 * q + difference * (1 - difference)))
  );
}

/** [low, high] の中で score(x) = target になる x を二分法で求める。score は x について減少する。 */
function bisectDecreasing(
  score: (x: number) => number,
  target: number,
  low: number,
  high: number
): number {
  let lower = low;
  let upper = high;
  for (let iteration = 0; iteration < BISECTION_ITERATIONS; iteration += 1) {
    const middle = (lower + upper) / 2;
    if (score(middle) > target) {
      lower = middle;
    } else {
      upper = middle;
    }
  }
  return (lower + upper) / 2;
}

/**
 * 種をそろえた対の差(後 - 前)の 95 % の誤差の幅(Tango のスコア区間。Tango, Statistics in Medicine 17, 891–908, 1998)。
 * 対の数が 0 なら undefined を返す。前と後の結果がすべての対で同じでも、幅は 0 にならない。数は整数でなくてよい。
 * 式は R の PropCIs 0.3-0 の scoreci.mp(https://raw.githubusercontent.com/cran/PropCIs/master/R/scoreci.mp.R 、
 * 2026-11-12 に計画の作成時に確認)と同じ。PropCIs は GPL なので、コードは写さず式から書いた。
 * 正規近似を採らないのは、前と後で結果が違う対が 0 のとき幅が 0 になり、差を観測できなかった設定を最も精密だと
 * 読んでしまうため。
 */
export function calculatePairedDifferenceInterval(
  counts: PairedOutcomeCounts
): ProportionInterval | undefined {
  const pairs = countPairs(counts);
  if (pairs <= 0) {
    return undefined;
  }
  const { onlyAfterOccurred: onlyAfter, onlyBeforeOccurred: onlyBefore } =
    counts;
  const value = (onlyAfter - onlyBefore) / pairs;
  const score = (difference: number) =>
    calculateTangoScore(onlyBefore, onlyAfter, pairs, difference);
  return {
    lower: onlyBefore >= pairs ? -1 : bisectDecreasing(score, Z_95, -1, value),
    upper: onlyAfter >= pairs ? 1 : bisectDecreasing(score, -Z_95, value, 1),
    value,
  };
}

/**
 * 同じ数を、対にしないで比べたときの差(後 - 前)の 95 % の誤差の幅(Newcombe のハイブリッドスコア区間。Newcombe,
 * Statistics in Medicine 17, 873–890, 1998 の方法 10)。対の数が 0 なら undefined を返す。数は整数でなくてよい。
 * 式は statsmodels 0.14.4 の confint_proportions_2indep の method="newcomb"
 * (https://raw.githubusercontent.com/statsmodels/statsmodels/v0.14.4/statsmodels/stats/proportion.py 、
 * 2026-11-12 に計画の作成時に確認。差の向きを後 - 前に読み替えた)と同じ。
 */
export function calculateUnpairedDifferenceInterval(
  counts: PairedOutcomeCounts
): ProportionInterval | undefined {
  const pairs = countPairs(counts);
  const beforeInterval = calculateWilsonInterval(
    counts.bothOccurred + counts.onlyBeforeOccurred,
    pairs
  );
  const afterInterval = calculateWilsonInterval(
    counts.bothOccurred + counts.onlyAfterOccurred,
    pairs
  );
  if (beforeInterval === undefined || afterInterval === undefined) {
    return undefined;
  }
  const before = beforeInterval.value;
  const after = afterInterval.value;
  const value = after - before;
  return {
    lower:
      value -
      Math.hypot(after - afterInterval.lower, beforeInterval.upper - before),
    upper:
      value +
      Math.hypot(afterInterval.upper - after, before - beforeInterval.lower),
    value,
  };
}
