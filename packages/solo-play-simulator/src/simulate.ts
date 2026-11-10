/**
 * 対戦風の一人回しを、同じ種の乱数で繰り返す枠。勝率などの集計は Issue 70 以降で作る。
 */

import type { Card } from "./cards.ts";
import {
  type BattleStyleSoloPlayResult,
  type PlayingPolicy,
  runBattleStyleSoloPlayGame,
} from "./engine.ts";
import { createSeededRandom } from "./random.ts";

export interface BattleStyleSoloPlaySimulationOptions {
  readonly cards: readonly Card[];
  readonly policy: PlayingPolicy;
  readonly seed: number;
  readonly trials: number;
  readonly wentFirst: boolean;
}

/** trials 回の対戦の結果を、行った順に並べて返す。同じ種なら同じ並びになる。 */
export function simulateBattleStyleSoloPlay(
  options: BattleStyleSoloPlaySimulationOptions
): BattleStyleSoloPlayResult[] {
  const random = createSeededRandom(options.seed);
  return Array.from({ length: options.trials }, () =>
    runBattleStyleSoloPlayGame({
      cards: options.cards,
      policy: options.policy,
      random,
      wentFirst: options.wentFirst,
    })
  );
}
