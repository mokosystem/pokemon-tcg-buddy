/**
 * 対戦風の一人回しを、試行ごとの種で繰り返す枠。試行 i の対戦は、基準の種と試行の番号 i だけで決まる種から始まる。
 * 前の試行が乱数をいくつ使ったかで次の試行が変わらないので、カードを入れ替える前と後を同じ種で回して比べられ
 * (GLOSSARY.md「種をそろえた対」)、試行を複数のプロセスに分けても試行ごとの結果は分け方によらない。
 */

import type { Card } from "./cards.ts";
import {
  type BattleStyleSoloPlayResult,
  type PlayingPolicy,
  runBattleStyleSoloPlayGame,
} from "./engine.ts";
import {
  createSeededRandom,
  derivePolicySeed,
  deriveTrialSeed,
} from "./random.ts";

export interface BattleStyleSoloPlayTrialOptions {
  readonly cards: readonly Card[];
  /** 試行ごとにプレイングの判断基準を作る。探索は試行の中で記憶を持つため、試行をまたいで使い回さない。 */
  readonly createPolicy: (policySeed: number) => PlayingPolicy;
  readonly trialSeed: number;
  readonly wentFirst: boolean;
}

/** 種 trialSeed の対戦を 1 回行う。プレイングの判断基準には、trialSeed からずらした種を渡す。 */
export function runBattleStyleSoloPlayTrial(
  options: BattleStyleSoloPlayTrialOptions
): BattleStyleSoloPlayResult {
  return runBattleStyleSoloPlayGame({
    cards: options.cards,
    policy: options.createPolicy(derivePolicySeed(options.trialSeed)),
    random: createSeededRandom(options.trialSeed),
    wentFirst: options.wentFirst,
  });
}

export interface BattleStyleSoloPlaySimulationOptions {
  readonly baseSeed: number;
  readonly cards: readonly Card[];
  readonly createPolicy: (policySeed: number) => PlayingPolicy;
  readonly trials: number;
  readonly wentFirst: boolean;
}

/** 試行 0〜trials - 1 を、試行ごとの種(deriveTrialSeed)で回し、行った順に結果を並べて返す。 */
export function simulateBattleStyleSoloPlay(
  options: BattleStyleSoloPlaySimulationOptions
): BattleStyleSoloPlayResult[] {
  return Array.from({ length: options.trials }, (_, trialIndex) =>
    runBattleStyleSoloPlayTrial({
      cards: options.cards,
      createPolicy: options.createPolicy,
      trialSeed: deriveTrialSeed(options.baseSeed, trialIndex),
      wentFirst: options.wentFirst,
    })
  );
}
