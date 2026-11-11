import { describe, expect, test } from "bun:test";
import {
  createFirstActionPolicy,
  createRandomActionPolicy,
} from "./action-list-playing-policies.ts";
import { cardRecordTable } from "./card-record-table.ts";
import { buildDeck } from "./engine.ts";
import { deriveTrialSeed } from "./random.ts";
import { RECORDED_DECKS } from "./recorded-decks.ts";
import {
  runBattleStyleSoloPlayTrial,
  simulateBattleStyleSoloPlay,
} from "./simulate.ts";

const [deck] = RECORDED_DECKS;
if (deck === undefined) {
  throw new Error("記録済みのデッキが無い");
}
const cards = buildDeck(cardRecordTable, deck.decklist);

describe("対戦風の一人回しの乱数試行", () => {
  test("同じ種なら同じ結果の並びになる", () => {
    const run = () =>
      simulateBattleStyleSoloPlay({
        baseSeed: 20_261_111,
        cards,
        createPolicy: () => createFirstActionPolicy(),
        trials: 20,
        wentFirst: true,
      });
    expect(run()).toEqual(run());
  });

  test("試行回数の数だけ結果を返す", () => {
    expect(
      simulateBattleStyleSoloPlay({
        baseSeed: 1,
        cards,
        createPolicy: () => createFirstActionPolicy(),
        trials: 7,
        wentFirst: false,
      })
    ).toHaveLength(7);
  });

  test("試行 i の結果は、試行 0〜i - 1 を回さずに試行 i の種だけで回した結果と同じ", () => {
    const baseSeed = 20_261_112;
    const createPolicy = (policySeed: number) =>
      createRandomActionPolicy(policySeed);
    const results = simulateBattleStyleSoloPlay({
      baseSeed,
      cards,
      createPolicy,
      trials: 6,
      wentFirst: true,
    });
    for (const trialIndex of [3, 5]) {
      expect(results[trialIndex]).toEqual(
        runBattleStyleSoloPlayTrial({
          cards,
          createPolicy,
          trialSeed: deriveTrialSeed(baseSeed, trialIndex),
          wentFirst: true,
        })
      );
    }
  });
});
