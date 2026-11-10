import { describe, expect, test } from "bun:test";
import { createFirstActionPolicy } from "./action-list-playing-policies.ts";
import { cardRecordTable } from "./card-record-table.ts";
import { buildDeck } from "./engine.ts";
import { RECORDED_DECKS } from "./recorded-decks.ts";
import { simulateBattleStyleSoloPlay } from "./simulate.ts";

const [deck] = RECORDED_DECKS;
if (deck === undefined) {
  throw new Error("記録済みのデッキが無い");
}
const cards = buildDeck(cardRecordTable, deck.decklist);

describe("対戦風の一人回しの乱数試行", () => {
  test("同じ種なら同じ結果の並びになる", () => {
    const run = () =>
      simulateBattleStyleSoloPlay({
        cards,
        policy: createFirstActionPolicy(),
        seed: 20_261_111,
        trials: 20,
        wentFirst: true,
      });
    expect(run()).toEqual(run());
  });

  test("試行回数の数だけ結果を返す", () => {
    expect(
      simulateBattleStyleSoloPlay({
        cards,
        policy: createFirstActionPolicy(),
        seed: 1,
        trials: 7,
        wentFirst: false,
      })
    ).toHaveLength(7);
  });
});
