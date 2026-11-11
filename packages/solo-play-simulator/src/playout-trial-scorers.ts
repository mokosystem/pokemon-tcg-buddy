/**
 * 試し回し(GLOSSARY.md)で、探索の 1 回の試しの点数を出す。
 */

import {
  continueBattleStyleSoloPlayGame,
  type PlayingPolicy,
} from "./engine.ts";
import { derivePolicySeed } from "./random.ts";
import type { TrialScorer } from "./search-policy.ts";

/**
 * 試し回しで 1 回の試しの点数を出す。複製を、試しごとに作った軽い手順で、続ける場所から勝敗が決まるまで進める。
 */
export function createPlayoutTrialScorer(
  createPlayoutPolicy: (seed: number) => PlayingPolicy
): TrialScorer {
  return ({ resumePoint, seed, state }) => {
    // 複製の乱数は seed から作られているので、軽い手順にはずらした種を渡す
    const playoutPolicy = createPlayoutPolicy(derivePolicySeed(seed));
    const result = continueBattleStyleSoloPlayGame(
      { choices: playoutPolicy, state },
      playoutPolicy,
      resumePoint
    );
    return {
      prizeDifference: result.takenPrizeCount - result.opponentTakenPrizeCount,
      winRate: result.outcome === "win" ? 1 : 0,
    };
  };
}
