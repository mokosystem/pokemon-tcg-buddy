/**
 * 並べて回す 1 プロセスの入口。引数の JSON(MeasurementWorkerJob と担当の試行の番号)を読み、計測の単位を回し、数えた結果を
 * JSON で標準出力に 1 回だけ書く。ほかの出力は標準エラーに書く。measurement-process-pool.ts の runMeasurementWorkers が起こす。
 */

import { readFileSync } from "node:fs";
import {
  createEmptyCardSwapMeasurementTally,
  createEmptyDeckMeasurementTally,
  type MeasuredDeck,
  runCardSwapMeasurementUnit,
  runDeckMeasurementUnit,
  runMeasurementUntilCutoffs,
} from "../src/battle-style-solo-play-measurement.ts";
import type { Card } from "../src/cards.ts";
import {
  collectLearningSamplesOfTrial,
  type LabeledFeatureSample,
  type LearnedWinRateModel,
  listDeckCardNames,
} from "../src/learned-win-rate-evaluation.ts";
import {
  LEARNING_SAMPLE_GENERATOR_SETTING,
  PLAYING_POLICY_SETTINGS,
  type PlayingPolicySettingName,
} from "../src/playing-policy-candidates.ts";
import { deriveTrialSeed } from "../src/random.ts";
import {
  buildMeasuredDeckCards,
  CARD_SWAP_SUBJECT,
  type MeasurementWorkerJob,
  type MeasurementWorkerReport,
  measureNowEpochMilliseconds,
  type TrialIndexAssignment,
} from "./measurement-jobs.ts";

function readLearnedModel(path: string | undefined) {
  return path === undefined
    ? undefined
    : (JSON.parse(readFileSync(path, "utf8")) as LearnedWinRateModel);
}

/** 設定の名前と 60 枚と学習の結果から、計測で回すデッキの材料を作る。 */
function buildMeasuredDeck(
  settingName: PlayingPolicySettingName,
  cards: readonly Card[],
  learnedModelPath: string | undefined
): MeasuredDeck {
  const setting = PLAYING_POLICY_SETTINGS[settingName];
  const learnedModel = readLearnedModel(learnedModelPath);
  const preparation = {
    deckCardNames: listDeckCardNames(cards),
    ...(learnedModel === undefined ? {} : { learnedModel }),
  };
  return {
    cards,
    createPolicy: (policySeed) =>
      setting.createPolicy(preparation, setting.parameters, policySeed),
  };
}

type JobOf<Kind extends MeasurementWorkerJob["kind"]> = Extract<
  MeasurementWorkerJob,
  { kind: Kind }
> &
  TrialIndexAssignment;

function measureDeck(job: JobOf<"measureDeck">): MeasurementWorkerReport {
  const deck = buildMeasuredDeck(
    job.settingName,
    buildMeasuredDeckCards({ deckCode: job.deckCode }),
    job.learnedModelPath
  );
  return {
    kind: "measureDeck",
    outcome: runMeasurementUntilCutoffs({
      createEmptyTally: createEmptyDeckMeasurementTally,
      cutoffsEpochMilliseconds: job.cutoffsEpochMilliseconds,
      firstTrialIndex: job.firstTrialIndex,
      maxUnits: job.maxUnits ?? Number.POSITIVE_INFINITY,
      measureNowEpochMilliseconds,
      runUnit: (trialIndex, tally) =>
        runDeckMeasurementUnit(
          { baseSeeds: job.baseSeeds, deck, measureNowEpochMilliseconds },
          trialIndex,
          tally
        ),
      trialIndexStride: job.trialIndexStride,
    }),
  };
}

function measureCardSwap(
  job: JobOf<"measureCardSwap">
): MeasurementWorkerReport {
  const before = buildMeasuredDeck(
    job.settingName,
    buildMeasuredDeckCards({ deckCode: CARD_SWAP_SUBJECT.deckCode }),
    job.beforeLearnedModelPath
  );
  const after = buildMeasuredDeck(
    job.settingName,
    buildMeasuredDeckCards(CARD_SWAP_SUBJECT),
    job.afterLearnedModelPath
  );
  return {
    kind: "measureCardSwap",
    outcome: runMeasurementUntilCutoffs({
      createEmptyTally: createEmptyCardSwapMeasurementTally,
      cutoffsEpochMilliseconds: job.cutoffsEpochMilliseconds,
      firstTrialIndex: job.firstTrialIndex,
      maxUnits: job.maxUnits ?? Number.POSITIVE_INFINITY,
      measureNowEpochMilliseconds,
      runUnit: (trialIndex, tally) =>
        runCardSwapMeasurementUnit(
          {
            after,
            baseSeeds: job.baseSeeds,
            before,
            measureNowEpochMilliseconds,
          },
          trialIndex,
          tally
        ),
      trialIndexStride: job.trialIndexStride,
    }),
  };
}

/** 学習の対戦の回数の半分を先攻、半分を後攻で回し、担当の試行の記録を集める。 */
function collectLearningSamples(
  job: JobOf<"collectLearningSamples">
): MeasurementWorkerReport {
  const cards = buildMeasuredDeckCards(job.deck);
  const deckCardNames = listDeckCardNames(cards);
  const generator = PLAYING_POLICY_SETTINGS[LEARNING_SAMPLE_GENERATOR_SETTING];
  const samples: LabeledFeatureSample[] = [];
  const gamesPerTurnOrder = Math.floor(job.trainingGames / 2);
  for (
    let trialIndex = job.firstTrialIndex;
    trialIndex < gamesPerTurnOrder;
    trialIndex += job.trialIndexStride
  ) {
    for (const [baseSeed, wentFirst] of [
      [job.baseSeeds.firstPlayer, true],
      [job.baseSeeds.secondPlayer, false],
    ] as const) {
      samples.push(
        ...collectLearningSamplesOfTrial({
          cards,
          createGeneratorPolicy: (policySeed) =>
            generator.createPolicy(
              { deckCardNames },
              generator.parameters,
              policySeed
            ),
          deckCardNames,
          trialSeed: deriveTrialSeed(baseSeed, trialIndex),
          wentFirst,
        })
      );
    }
  }
  return { kind: "collectLearningSamples", samples };
}

function runJob(
  job: MeasurementWorkerJob & TrialIndexAssignment
): MeasurementWorkerReport {
  switch (job.kind) {
    case "measureDeck":
      return measureDeck(job);
    case "measureCardSwap":
      return measureCardSwap(job);
    default:
      return collectLearningSamples(job);
  }
}

const [, , argument] = process.argv;
if (argument === undefined) {
  throw new Error("仕事の JSON を引数に渡す");
}
console.log(
  JSON.stringify(
    runJob(JSON.parse(argument) as MeasurementWorkerJob & TrialIndexAssignment)
  )
);
