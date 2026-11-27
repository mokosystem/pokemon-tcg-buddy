import { createSeededRandom, derivePolicySeed } from "./random.ts";
import type { TrialScore, TrialScorer } from "./search-policy.ts";

/** 最大4本の試し回しのうち、勝率の点数が高い2本の平均。点数が同じなら元の種、続いて派生した種の順を保つ。 */
export function createBestPrizeProgressScorer(
  scoreContinuation: TrialScorer
): TrialScorer {
  return (input) => {
    if (input.state.decision !== undefined) {
      return scoreContinuation(input);
    }

    // 元の種では行動の途中まで進んだ乱数を引き継ぐ。残りの3本は同じ場から別の種で始める。
    const originalPosition = input.state.clone(createSeededRandom(input.seed));
    const best: TrialScore[] = [scoreContinuation(input)];
    let { seed } = input;
    for (let index = 1; index < 4; index += 1) {
      seed = derivePolicySeed(seed);
      const state = originalPosition.clone(createSeededRandom(seed));
      best.push(scoreContinuation({ ...input, seed, state }));
      best.sort((left, right) => right.winRate - left.winRate);
      best.length = 2;
      if (best[1]?.winRate === 1) {
        // 後の種が同じ満点でも先の2本が選ばれる。サイドの差もその2本で決まる。
        break;
      }
    }
    return {
      prizeDifference:
        best.reduce((total, trial) => total + trial.prizeDifference, 0) / 2,
      winRate: best.reduce((total, trial) => total + trial.winRate, 0) / 2,
    };
  };
}
