import { describe, expect, test } from "bun:test";
import { createFirstActionPolicy } from "./action-list-playing-policies.ts";
import {
  type CardSwapMeasurementTally,
  createEmptyCardSwapMeasurementTally,
  createEmptyDeckMeasurementTally,
  type DeckMeasurementTally,
  mergeCardSwapMeasurementTallies,
  mergeDeckMeasurementTallies,
  runCardSwapMeasurementUnit,
  runDeckMeasurementUnit,
  runMeasurementUntilCutoffs,
} from "./battle-style-solo-play-measurement.ts";
import { cardRecordTable } from "./card-record-table.ts";
import { buildSwappedDeckCards } from "./card-swap.ts";
import { buildDeck } from "./engine.ts";
import { RECORDED_DECKS } from "./recorded-decks.ts";

/** 呼ぶたびに 1 ずつ進む時刻。 */
function createTickingClock(start = 0): () => number {
  let now = start;
  return () => {
    const current = now;
    now += 1;
    return current;
  };
}

/** 回した試行の番号を並べる集計。 */
function recordTrialIndices(options: {
  readonly cutoffsEpochMilliseconds: readonly number[];
  readonly firstTrialIndex: number;
  readonly maxUnits: number;
  readonly measureNowEpochMilliseconds: () => number;
  readonly trialIndexStride: number;
}) {
  return runMeasurementUntilCutoffs<readonly number[]>({
    ...options,
    createEmptyTally: () => [],
    runUnit: (trialIndex, tally) => [...tally, trialIndex],
  });
}

describe("計測の単位を期限まで回す", () => {
  test("期限ごとに、その期限までに終わった単位だけを数え、最後の期限の後に終わった単位は捨てる", () => {
    // 時刻は始める前の確かめと終わりの記録で 1 ずつ進む。単位 k は時刻 2k に始め、2k + 1 に終わる。単位 2 は最後の
    // 期限 4.5 より前に始め、後に終わる
    const outcome = recordTrialIndices({
      cutoffsEpochMilliseconds: [1.5, 4.5],
      firstTrialIndex: 0,
      maxUnits: Number.POSITIVE_INFINITY,
      measureNowEpochMilliseconds: createTickingClock(),
      trialIndexStride: 1,
    });
    expect(outcome.talliesAtCutoffs).toEqual([[0], [0, 1]]);
    expect(outcome.discardedUnits).toBe(1);
  });

  test("単位の数の上限が 5 で 2 プロセスに分けると、番号 0、2、4 と 1、3 だけを回す", () => {
    const run = (firstTrialIndex: number) =>
      recordTrialIndices({
        cutoffsEpochMilliseconds: [Number.POSITIVE_INFINITY],
        firstTrialIndex,
        maxUnits: 5,
        measureNowEpochMilliseconds: createTickingClock(),
        trialIndexStride: 2,
      }).talliesAtCutoffs[0];
    expect(run(0)).toEqual([0, 2, 4]);
    expect(run(1)).toEqual([1, 3]);
  });

  test("番号 0〜5 を 1 プロセスで回した集計と、2 プロセスに分けて回した集計を足したものが同じ", () => {
    const [deck] = RECORDED_DECKS;
    if (deck === undefined) {
      throw new Error("記録済みのデッキが無い");
    }
    const cards = buildDeck(cardRecordTable, deck.decklist);
    // 時間の合計はプロセスで変わるので、時刻を止めて 0 にそろえる
    const run = (firstTrialIndex: number, trialIndexStride: number) =>
      runMeasurementUntilCutoffs<DeckMeasurementTally>({
        createEmptyTally: createEmptyDeckMeasurementTally,
        cutoffsEpochMilliseconds: [1],
        firstTrialIndex,
        maxUnits: 6,
        measureNowEpochMilliseconds: () => 0,
        runUnit: (trialIndex, tally) =>
          runDeckMeasurementUnit(
            {
              baseSeeds: { firstPlayer: 11, secondPlayer: 12 },
              deck: { cards, createPolicy: () => createFirstActionPolicy() },
              measureNowEpochMilliseconds: () => 0,
            },
            trialIndex,
            tally
          ),
        trialIndexStride,
      }).talliesAtCutoffs[0] ?? createEmptyDeckMeasurementTally();
    const whole = run(0, 1);
    expect(mergeDeckMeasurementTallies(run(0, 2), run(1, 2))).toEqual(whole);
    expect(whole.firstPlayer.games).toBe(6);
    expect(whole.secondPlayer.games).toBe(6);
  });
});

describe("カードの入れ替えの計測の単位", () => {
  const garchompDeck = RECORDED_DECKS.find(
    (deck) => deck.deckCode === "RS3MMy-FuGPRu-MypM2X"
  );
  if (garchompDeck === undefined) {
    throw new Error("シロナのガブリアスex のデッキが無い");
  }
  const before = buildDeck(cardRecordTable, garchompDeck.decklist);
  const createPolicy = () => createFirstActionPolicy();
  const runUnits = (
    afterCards: typeof before,
    trialIndices: readonly number[]
  ): CardSwapMeasurementTally =>
    trialIndices.reduce(
      (tally, trialIndex) =>
        runCardSwapMeasurementUnit(
          {
            after: { cards: afterCards, createPolicy },
            baseSeeds: { firstPlayer: 21, secondPlayer: 22 },
            before: { cards: before, createPolicy },
            measureNowEpochMilliseconds: () => 0,
          },
          trialIndex,
          tally
        ),
      createEmptyCardSwapMeasurementTally()
    );

  test("入れ替える前と後が同じデッキなら、前と後は同じ種で回るので、すべての対で結果が同じ", () => {
    const tally = runUnits(before, [0, 1, 2, 3]);
    for (const turnOrder of [tally.firstPlayer, tally.secondPlayer]) {
      expect(turnOrder.before).toEqual(turnOrder.after);
      expect(turnOrder.wins.onlyAfterOccurred).toBe(0);
      expect(turnOrder.wins.onlyBeforeOccurred).toBe(0);
      expect(turnOrder.noOwnPokemonLosses.onlyAfterOccurred).toBe(0);
      expect(turnOrder.noOwnPokemonLosses.onlyBeforeOccurred).toBe(0);
      expect(turnOrder.before.games).toBe(4);
    }
  });

  test("単位を分けて数えて足した集計は、まとめて数えた集計と同じ", () => {
    // Issue 70 の題材: ファイトゴング(048677)を 1 枚増やし、ロケット団のラムダ(048701)を 1 枚減らす
    const after = buildSwappedDeckCards(cardRecordTable, before, {
      addedCardId: "048677",
      count: 1,
      removedCardId: "048701",
    });
    expect(
      mergeCardSwapMeasurementTallies(
        runUnits(after, [0, 2]),
        runUnits(after, [1, 3])
      )
    ).toEqual(runUnits(after, [0, 1, 2, 3]));
  });
});
