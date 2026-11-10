/**
 * 記録済みのデッキを、カードの記録だけで組み立てて回す。今できる行動の一覧(player-actions.ts)から手を選ばない
 * 2 つの手順で、翻訳した効果と一覧の行動が基本ルールに反さずに勝敗まで動くかを確かめる(効果の中の選択は候補の
 * 先頭から選ぶ)。
 */

import { describe, expect, test } from "bun:test";
import {
  createFirstActionPolicy,
  createRandomActionPolicy,
} from "./action-list-playing-policies.ts";
import { cardRecordTable } from "./card-record-table.ts";
import { buildDeck } from "./engine.ts";
import { RECORDED_DECKS } from "./recorded-decks.ts";
import { simulateBattleStyleSoloPlay } from "./simulate.ts";

const GAMES_PER_TURN_ORDER = 1000;
const DECISION_REASONS = [
  "ownPrizesTaken",
  "opponentPrizesTaken",
  "noOwnPokemonInPlay",
  "cannotDrawAtTurnStart",
];

/** Issue 69 で対戦風の一人回しのルールに照らして記録を見直した 2 デッキ(シロナのガブリアスex の今のデッキと、ドラパルトex)。 */
const BATTLE_STYLE_REVIEWED_DECK_CODES = [
  "RS3MMy-FuGPRu-MypM2X",
  "9gngnQ-zAMw9G-96H9nn",
];

describe("記録済みのデッキ", () => {
  for (const deck of RECORDED_DECKS) {
    test(`${deck.name}: 60 枚すべてをカードの記録から組み立てられる`, () => {
      expect(buildDeck(cardRecordTable, deck.decklist)).toHaveLength(60);
    });

    for (const [label, createPolicy] of [
      ["手を選ばず順に使う手順", createFirstActionPolicy],
      ["乱数で選ぶ手順", () => createRandomActionPolicy(20_260_926)],
    ] as const) {
      test(`${deck.name}: ${label}で、先攻・後攻それぞれ 1,000 回、すべての対戦が例外なく勝敗まで進む`, () => {
        const cards = buildDeck(cardRecordTable, deck.decklist);
        for (const wentFirst of [true, false]) {
          const results = simulateBattleStyleSoloPlay({
            cards,
            policy: createPolicy(),
            seed: 20_260_923,
            trials: GAMES_PER_TURN_ORDER,
            wentFirst,
          });
          expect(results).toHaveLength(GAMES_PER_TURN_ORDER);
          for (const result of results) {
            expect(DECISION_REASONS).toContain(result.reason);
            expect(result.decidedTurn.ordinal).toBeGreaterThanOrEqual(1);
          }
        }
      });
    }
  }
});

describe("記録を見直した 2 デッキ", () => {
  test("カード ID 047388 と 047392 からシロナのガブリアスex の記録を、048468 からふしぎなアメの記録を引ける", () => {
    expect(cardRecordTable.get("047388")?.name).toBe("シロナのガブリアスex");
    expect(cardRecordTable.get("047392")?.name).toBe("シロナのガブリアスex");
    expect(cardRecordTable.get("048468")?.name).toBe("ふしぎなアメ");
  });

  test("2 デッキのカード ID から引ける記録にだけ、対戦風の一人回しのルールで見直した日が入っている", () => {
    const reviewedRecords = new Set(
      RECORDED_DECKS.filter((deck) =>
        BATTLE_STYLE_REVIEWED_DECK_CODES.includes(deck.deckCode)
      ).flatMap((deck) =>
        deck.decklist.map((entry) => cardRecordTable.get(entry.cardId))
      )
    );
    const records = [...new Set(cardRecordTable.values())];
    const namesWithReviewedDate = (expected: boolean) =>
      records
        .filter((record) => reviewedRecords.has(record) === expected)
        .filter(
          (record) =>
            (record.battleStyleSoloPlayReviewedOn !== undefined) !== expected
        )
        .map((record) => record.name);
    expect(reviewedRecords.size).toBe(44);
    expect(namesWithReviewedDate(true)).toEqual([]);
    expect(namesWithReviewedDate(false)).toEqual([]);
  });
});
