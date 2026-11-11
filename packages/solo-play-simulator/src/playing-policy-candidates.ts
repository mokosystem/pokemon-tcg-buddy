/**
 * Issue 70 で計測するプレイングの判断基準の設定の一覧。設定の名前は計測スクリプトの引数と設計文書の表に使う。
 * 候補 2〜4 は、設定(先を試す回数など)を 2 通りずつ測る(Issue 70 の決定事項「候補」)。
 */

import {
  createFirstActionPolicy,
  createPlayoutActionPolicy,
  createRandomActionPolicy,
} from "./action-list-playing-policies.ts";
import type { PlayingPolicy } from "./engine.ts";
import {
  createLearnedEvaluationTrialScorer,
  type LearnedWinRateModel,
} from "./learned-win-rate-evaluation.ts";
import { createPlayoutTrialScorer } from "./playout-trial-scorers.ts";
import { derivePolicySeed } from "./random.ts";
import {
  createSearchPolicy,
  type TrialScorer,
  type TrialScoreTieBreak,
} from "./search-policy.ts";
import { createTurnSequenceSearchPolicy } from "./turn-sequence-search-policy.ts";

/** 計測する設定の名前。設計文書の表と計測スクリプトの引数に使う。 */
export type PlayingPolicySettingName =
  | "first-action"
  | "random-action"
  | "playout-win-rate-8"
  | "playout-win-rate-32"
  | "playout-prize-tie-break-8"
  | "playout-prize-tie-break-32"
  | "turn-sequence-32"
  | "turn-sequence-128"
  | "learned-evaluation-500"
  | "learned-evaluation-2000";

/** 設定の数。設定ごとに使う欄だけを持つ。 */
export interface PlayingPolicyParameters {
  /** 調べる並びの数(候補 3)。 */
  readonly maxEvaluatedSequences?: number;
  /** 候補の手 1 つを何回試すか(候補 2、2b、4)。 */
  readonly samplesPerCandidate?: number;
  /** 1 つの並びの試し回しの回数(候補 3)。 */
  readonly samplesPerSequence?: number;
  /** デッキごとの学習の対戦の回数(候補 4)。 */
  readonly trainingGamesPerDeck?: number;
}

/** デッキごとの準備の結果。learnedModel は学習が要る設定(候補 4)だけが持つ。 */
export interface PlayingPolicyPreparation {
  /** デッキの 60 枚の並びで最初に出てきた順のカードの名前。候補 4 の盤面の特徴に使う。 */
  readonly deckCardNames: readonly string[];
  readonly learnedModel?: LearnedWinRateModel;
}

export interface PlayingPolicySetting {
  /** Issue 70 の候補の番号("1"、"2"、"2b"、"3"、"4")。 */
  readonly candidate: string;
  /**
   * 準備が済んだデッキの情報と数から、試行ごとのプレイングの判断基準を作る。テストは数を 1〜2 に下げて渡し、
   * 計測は parameters をそのまま渡す。
   */
  readonly createPolicy: (
    preparation: PlayingPolicyPreparation,
    parameters: PlayingPolicyParameters,
    policySeed: number
  ) => PlayingPolicy;
  /** 計測で使う数。 */
  readonly parameters: PlayingPolicyParameters;
}

/** 候補 4 の 1 つの候補の手を試す回数(Issue 70 の実装計画「5.4」で決めた値。値を変えて比べた計測は無い)。 */
const LEARNED_EVALUATION_SAMPLES_PER_CANDIDATE = 4;
/** 候補 3 の 1 つの並びの試し回しの回数。 */
const TURN_SEQUENCE_SAMPLES_PER_SEQUENCE = 8;
/** 候補 3 が、ワザと効果の中の選択などを任せる候補 2b の試す回数。 */
const TURN_SEQUENCE_BASE_SAMPLES_PER_CANDIDATE = 8;

const playoutTrialScorer = createPlayoutTrialScorer(createPlayoutActionPolicy);

function requireParameter(
  parameters: PlayingPolicyParameters,
  name: keyof PlayingPolicyParameters
): number {
  const value = parameters[name];
  if (value === undefined) {
    throw new Error(`設定の数 ${name} が無い`);
  }
  return value;
}

/** 試しの点数で 1 手ずつ選ぶ探索(候補 2、2b、4)を作る。 */
function createOneStepSearch(
  scoreTrial: TrialScorer,
  samplesPerCandidate: number,
  tieBreak: TrialScoreTieBreak,
  policySeed: number
) {
  return createSearchPolicy({
    samplesPerCandidate,
    scoreTrial,
    searchesEffectChoices: true,
    seed: policySeed,
    tieBreak,
  });
}

function createPlayoutSetting(
  candidate: string,
  samplesPerCandidate: number,
  tieBreak: TrialScoreTieBreak
): PlayingPolicySetting {
  return {
    candidate,
    createPolicy: (_, parameters, policySeed) =>
      createOneStepSearch(
        playoutTrialScorer,
        requireParameter(parameters, "samplesPerCandidate"),
        tieBreak,
        policySeed
      ),
    parameters: { samplesPerCandidate },
  };
}

function createTurnSequenceSetting(
  maxEvaluatedSequences: number
): PlayingPolicySetting {
  return {
    candidate: "3",
    createPolicy: (_, parameters, policySeed) =>
      createTurnSequenceSearchPolicy(
        createOneStepSearch(
          playoutTrialScorer,
          requireParameter(parameters, "samplesPerCandidate"),
          "prizeDifference",
          policySeed
        ),
        {
          maxEvaluatedSequences: requireParameter(
            parameters,
            "maxEvaluatedSequences"
          ),
          samplesPerSequence: requireParameter(
            parameters,
            "samplesPerSequence"
          ),
          scoreTrial: playoutTrialScorer,
          seed: derivePolicySeed(policySeed),
          tieBreak: "prizeDifference",
        }
      ),
    parameters: {
      maxEvaluatedSequences,
      samplesPerCandidate: TURN_SEQUENCE_BASE_SAMPLES_PER_CANDIDATE,
      samplesPerSequence: TURN_SEQUENCE_SAMPLES_PER_SEQUENCE,
    },
  };
}

function createLearnedEvaluationSetting(
  trainingGamesPerDeck: number
): PlayingPolicySetting {
  return {
    candidate: "4",
    createPolicy: (preparation, parameters, policySeed) => {
      const { learnedModel } = preparation;
      if (learnedModel === undefined) {
        throw new Error("学習した場の評価の設定に、学習の結果が渡されていない");
      }
      return createOneStepSearch(
        createLearnedEvaluationTrialScorer(
          learnedModel,
          preparation.deckCardNames,
          createPlayoutActionPolicy
        ),
        requireParameter(parameters, "samplesPerCandidate"),
        "none",
        policySeed
      );
    },
    parameters: {
      samplesPerCandidate: LEARNED_EVALUATION_SAMPLES_PER_CANDIDATE,
      trainingGamesPerDeck,
    },
  };
}

export const PLAYING_POLICY_SETTINGS: Readonly<
  Record<PlayingPolicySettingName, PlayingPolicySetting>
> = {
  "first-action": {
    candidate: "1",
    createPolicy: () => createFirstActionPolicy(),
    parameters: {},
  },
  "learned-evaluation-500": createLearnedEvaluationSetting(500),
  "learned-evaluation-2000": createLearnedEvaluationSetting(2000),
  "playout-prize-tie-break-8": createPlayoutSetting("2b", 8, "prizeDifference"),
  "playout-prize-tie-break-32": createPlayoutSetting(
    "2b",
    32,
    "prizeDifference"
  ),
  "playout-win-rate-8": createPlayoutSetting("2", 8, "none"),
  "playout-win-rate-32": createPlayoutSetting("2", 32, "none"),
  "random-action": {
    candidate: "1",
    createPolicy: (_, __, policySeed) => createRandomActionPolicy(policySeed),
    parameters: {},
  },
  "turn-sequence-32": createTurnSequenceSetting(32),
  "turn-sequence-128": createTurnSequenceSetting(128),
};

/** 設定の名前の一覧(計測の表の並び)。 */
export const PLAYING_POLICY_SETTING_NAMES: readonly PlayingPolicySettingName[] =
  [
    "first-action",
    "random-action",
    "playout-win-rate-8",
    "playout-win-rate-32",
    "playout-prize-tie-break-8",
    "playout-prize-tie-break-32",
    "turn-sequence-32",
    "turn-sequence-128",
    "learned-evaluation-500",
    "learned-evaluation-2000",
  ];
/** 候補 4 の学習用の記録を生成する設定。手を選ばない手順は勝率がほぼ 0 で、勝ちの記録が集まらないため。 */
export const LEARNING_SAMPLE_GENERATOR_SETTING: PlayingPolicySettingName =
  "playout-prize-tie-break-8";

export function isPlayingPolicySettingName(
  name: string
): name is PlayingPolicySettingName {
  return (PLAYING_POLICY_SETTING_NAMES as readonly string[]).includes(name);
}
