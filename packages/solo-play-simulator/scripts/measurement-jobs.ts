/**
 * Issue 70 の計測で、親のプロセス(measurement-process-pool.ts)と子のプロセス(playing-policy-measurement-worker.ts)が
 * 共有する仕事の形と材料。親が子の入口のパスを持つため、子が親を読み込むと循環するので、両方が読むものをここに分けた。
 */

import type {
  CardSwapMeasurementTally,
  DeckMeasurementTally,
  MeasurementRunOutcome,
  TurnOrderBaseSeeds,
} from "../src/battle-style-solo-play-measurement.ts";
import { cardRecordTable } from "../src/card-record-table.ts";
import { buildSwappedDeckCards, type CardSwap } from "../src/card-swap.ts";
import type { Card } from "../src/cards.ts";
import { buildDeck } from "../src/engine.ts";
import type { LabeledFeatureSample } from "../src/learned-win-rate-evaluation.ts";
import type { PlayingPolicySettingName } from "../src/playing-policy-candidates.ts";
import { RECORDED_DECKS } from "../src/recorded-decks.ts";

/**
 * Issue 70 の決定事項「カードの入れ替えの題材」。シロナのガブリアスex デッキで、ファイトゴング(048677)を 3 枚から 4 枚に、
 * ロケット団のラムダ(048701)を 2 枚から 1 枚にする。
 */
export const CARD_SWAP_SUBJECT: {
  readonly deckCode: string;
  readonly swap: CardSwap;
} = {
  deckCode: "RS3MMy-FuGPRu-MypM2X",
  swap: { addedCardId: "048677", count: 1, removedCardId: "048701" },
};

/** 学習用の記録を集めるデッキ。入れ替えた後のデッキのときは swap を持つ。 */
export interface LearningDeck {
  readonly deckCode: string;
  readonly swap?: CardSwap;
}

/** 子のプロセスに渡す仕事。 */
export type MeasurementWorkerJob =
  | {
      readonly kind: "measureDeck";
      readonly settingName: PlayingPolicySettingName;
      readonly deckCode: string;
      readonly baseSeeds: TurnOrderBaseSeeds;
      readonly cutoffsEpochMilliseconds: readonly number[];
      /** 全プロセスを合わせた単位の数の上限。省くと上限なし。 */
      readonly maxUnits?: number;
      readonly learnedModelPath?: string;
    }
  | {
      readonly kind: "measureCardSwap";
      readonly settingName: PlayingPolicySettingName;
      readonly baseSeeds: TurnOrderBaseSeeds;
      readonly cutoffsEpochMilliseconds: readonly number[];
      readonly maxUnits?: number;
      readonly beforeLearnedModelPath?: string;
      readonly afterLearnedModelPath?: string;
    }
  | {
      /** 候補 5(Jev)の 1 デッキの計測。API キーは環境変数 TYPESAFE_API_KEY から読む。 */
      readonly kind: "measureJevDeck";
      readonly deckCode: string;
      readonly baseSeeds: TurnOrderBaseSeeds;
      readonly maxUnits: number;
    }
  | {
      readonly kind: "collectLearningSamples";
      readonly deck: LearningDeck;
      /** 学習の対戦の回数。半分を先攻、半分を後攻で回す。 */
      readonly trainingGames: number;
      readonly baseSeeds: TurnOrderBaseSeeds;
    };

/** 子のプロセスが担当する試行の番号の割り振り。 */
export interface TrialIndexAssignment {
  readonly firstTrialIndex: number;
  readonly trialIndexStride: number;
}

/** 子のプロセスの結果。 */
export type MeasurementWorkerReport =
  | {
      readonly kind: "measureDeck";
      readonly outcome: MeasurementRunOutcome<DeckMeasurementTally>;
    }
  | {
      readonly kind: "measureCardSwap";
      readonly outcome: MeasurementRunOutcome<CardSwapMeasurementTally>;
    }
  | {
      readonly kind: "measureJevDeck";
      readonly outcome: MeasurementRunOutcome<DeckMeasurementTally>;
      readonly usage: JevRequestUsage;
    }
  | {
      readonly kind: "collectLearningSamples";
      readonly samples: readonly LabeledFeatureSample[];
    };

/** 1 プロセスの Jev への問い合わせの回数と入力のトークン数。 */
export interface JevRequestUsage {
  /** このプロセスの最初の問い合わせの入力のトークン数(問い合わせが無ければ 0)。 */
  readonly firstInputTokens: number;
  readonly inputTokens: number;
  readonly maxInputTokens: number;
  readonly requests: number;
}

/** 今の時刻(エポックからのミリ秒)。複数のプロセスで同じ基準になる。 */
export function measureNowEpochMilliseconds(): number {
  return performance.timeOrigin + performance.now();
}

/** デッキコードの 60 枚(入れ替えがあれば入れ替えた後)を作る。 */
export function buildMeasuredDeckCards(deck: LearningDeck): Card[] {
  const recorded = RECORDED_DECKS.find(
    (candidate) => candidate.deckCode === deck.deckCode
  );
  if (recorded === undefined) {
    throw new Error(`記録済みのデッキに ${deck.deckCode} が無い`);
  }
  const cards = buildDeck(cardRecordTable, recorded.decklist);
  return deck.swap === undefined
    ? cards
    : buildSwappedDeckCards(cardRecordTable, cards, deck.swap);
}
