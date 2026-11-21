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

/**
 * 対戦風の一人回しのルールに照らして記録を見直したデッキ。Issue 69 で見直した 2 デッキ(シロナのガブリアスex の
 * 2026-11-10 のデッキと、ドラパルトex)と、Issue 77 で見直した 6 デッキ。記録済みのデッキすべてにあたる。
 */
const BATTLE_STYLE_REVIEWED_DECK_CODES = [
  "RS3MMy-FuGPRu-MypM2X",
  "9gngnQ-zAMw9G-96H9nn",
  "nLNnLL-5exJV9-g9QLnQ",
  "6nNQgQ-y6q3om-9HnnLL",
  "xG8Kax-DHob4e-84xcca",
  "DxKGxx-6pqCKy-xxJ8Yc",
  "9nnnLP-Wejgk5-gn6gn9",
  "xcGKc8-NGuFdn-D8c88x",
];

/**
 * 相手を置かない前の計算の理由。対戦風の一人回しでは勝率に関わるので、見直した記録では含めなかった理由にせず、
 * 効果を翻訳に入れる(Issue 77 の決定事項「記録の見直しで翻訳に入れる効果」)。
 */
const EXCLUSION_REASONS_NOT_USED_IN_REVIEWED_RECORDS = [
  "ownNextTurnRestriction",
  "damageOrDamageCounters",
  "noReasonToUseInSoloPlay",
];

describe("記録済みのデッキ", () => {
  for (const deck of RECORDED_DECKS) {
    test(`${deck.name}: 60 枚すべてをカードの記録から組み立てられる`, () => {
      expect(buildDeck(cardRecordTable, deck.decklist)).toHaveLength(60);
    });

    for (const [label, createPolicy] of [
      ["手を選ばず順に使う手順", () => createFirstActionPolicy()],
      [
        "乱数で選ぶ手順",
        (policySeed: number) => createRandomActionPolicy(policySeed),
      ],
    ] as const) {
      test(`${deck.name}: ${label}で、先攻・後攻それぞれ 1,000 回、すべての対戦が例外なく勝敗まで進む`, () => {
        const cards = buildDeck(cardRecordTable, deck.decklist);
        for (const wentFirst of [true, false]) {
          const results = simulateBattleStyleSoloPlay({
            baseSeed: 20_260_923,
            cards,
            createPolicy,
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

describe("記録を見直した 8 デッキ(Issue 69 と Issue 77 で見直した、記録済みのデッキすべて)", () => {
  test("カード ID 047388 と 047392 からシロナのガブリアスex の記録を、048468 からふしぎなアメの記録を引ける", () => {
    expect(cardRecordTable.get("047388")?.name).toBe("シロナのガブリアスex");
    expect(cardRecordTable.get("047392")?.name).toBe("シロナのガブリアスex");
    expect(cardRecordTable.get("048468")?.name).toBe("ふしぎなアメ");
  });

  // 次の「見直した日が入っている」のテストは、記録済みのデッキを一覧で絞ってから日付を見る。一覧からデッキコードが抜けても、
  // 一覧のデッキコードを誤っても、そのデッキが検査から外れるだけで通ってしまうので、一覧そのものを先に確かめる
  test("見直し済みのデッキの一覧は、記録済みのデッキすべてのデッキコードと、重なりなく一致する", () => {
    expect([...BATTLE_STYLE_REVIEWED_DECK_CODES].sort()).toEqual(
      RECORDED_DECKS.map((deck) => deck.deckCode).sort()
    );
  });

  test("8 デッキのカード ID から引ける記録には、すべて対戦風の一人回しのルールで見直した日が入っている", () => {
    const reviewedRecords = new Set(
      RECORDED_DECKS.filter((deck) =>
        BATTLE_STYLE_REVIEWED_DECK_CODES.includes(deck.deckCode)
      ).flatMap((deck) =>
        deck.decklist.map((entry) => cardRecordTable.get(entry.cardId))
      )
    );
    expect(reviewedRecords.has(undefined)).toBe(false);
    expect(
      [...reviewedRecords]
        .filter((record) => record?.battleStyleSoloPlayReviewedOn === undefined)
        .map((record) => record?.name)
    ).toEqual([]);
  });

  test("見直した日を持つ記録は、含めなかった効果の理由に、相手を置かない前の計算の理由を使っていない", () => {
    expect(
      [...new Set(cardRecordTable.values())]
        .filter(
          (record) =>
            record.battleStyleSoloPlayReviewedOn !== undefined &&
            record.excludedEffects.some((excluded) =>
              EXCLUSION_REASONS_NOT_USED_IN_REVIEWED_RECORDS.includes(
                excluded.reason
              )
            )
        )
        .map((record) => record.name)
    ).toEqual([]);
  });

  // 8 デッキの外の記録が見直した日を持たないことは確かめない。新しく書く記録も対戦風の一人回しのルールで書くので
  // 見直した日を入れ(pokemon-tcg-translate-card-effects スキルの手順 5)、60 枚をリポジトリに置かないデッキの記録もあるため
  test("見直した日を持つ記録は、確認日(詳細ページを読み直した日)も同じ日", () => {
    expect(
      [...new Set(cardRecordTable.values())]
        .filter(
          (record) =>
            record.battleStyleSoloPlayReviewedOn !== undefined &&
            record.battleStyleSoloPlayReviewedOn !== record.verifiedOn
        )
        .map((record) => record.name)
    ).toEqual([]);
  });
});
