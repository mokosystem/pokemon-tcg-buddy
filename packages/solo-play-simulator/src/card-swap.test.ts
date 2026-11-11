import { describe, expect, test } from "bun:test";
import { cardRecordTable } from "./card-record-table.ts";
import { buildSwappedDeckCards, type CardSwap } from "./card-swap.ts";
import { buildDeck, MissingCardRecordsError } from "./engine.ts";
import { RECORDED_DECKS } from "./recorded-decks.ts";

const GARCHOMP_DECK = RECORDED_DECKS.find(
  (deck) => deck.deckCode === "RS3MMy-FuGPRu-MypM2X"
);
if (GARCHOMP_DECK === undefined) {
  throw new Error("シロナのガブリアスex のデッキが無い");
}
const BEFORE = buildDeck(cardRecordTable, GARCHOMP_DECK.decklist);

// Issue 70 の題材: ファイトゴング(048677)を 3 枚から 4 枚に、ロケット団のラムダ(048701)を 2 枚から 1 枚にする
const FIGHT_GONG = "048677";
const PROTON = "048701";
const SUBJECT_SWAP: CardSwap = {
  addedCardId: FIGHT_GONG,
  count: 1,
  removedCardId: PROTON,
};

function countCardId(cards: readonly { cardId: string }[], cardId: string) {
  return cards.filter((card) => card.cardId === cardId).length;
}

describe("カードの入れ替え", () => {
  test("題材の入れ替えで、ファイトゴングが 4 枚、ロケット団のラムダが 1 枚になり、合計は 60 枚のまま", () => {
    const after = buildSwappedDeckCards(cardRecordTable, BEFORE, SUBJECT_SWAP);
    expect(countCardId(BEFORE, FIGHT_GONG)).toBe(3);
    expect(countCardId(BEFORE, PROTON)).toBe(2);
    expect(countCardId(after, FIGHT_GONG)).toBe(4);
    expect(countCardId(after, PROTON)).toBe(1);
    expect(after).toHaveLength(60);
  });

  test("ロケット団のラムダがあった位置のうち最後の 1 か所だけが変わり、ほかの位置のカードは同じ参照", () => {
    const after = buildSwappedDeckCards(cardRecordTable, BEFORE, SUBJECT_SWAP);
    const lastProton = BEFORE.findLastIndex((card) => card.cardId === PROTON);
    const changed = after.flatMap((card, index) =>
      card === BEFORE[index] ? [] : [index]
    );
    expect(changed).toEqual([lastProton]);
  });

  test("入れたファイトゴングは、元からあるファイトゴングと同じ参照", () => {
    const after = buildSwappedDeckCards(cardRecordTable, BEFORE, SUBJECT_SWAP);
    const fightGongs = new Set(
      after.filter((card) => card.cardId === FIGHT_GONG)
    );
    expect(fightGongs.size).toBe(1);
  });

  test("抜くカードが足りなければ例外にする", () => {
    expect(() =>
      buildSwappedDeckCards(cardRecordTable, BEFORE, {
        ...SUBJECT_SWAP,
        count: 3,
      })
    ).toThrow("足りない");
  });

  test("入れるカードの記録が無ければ、記録の無いカード ID を示して止める", () => {
    expect(() =>
      buildSwappedDeckCards(cardRecordTable, BEFORE, {
        ...SUBJECT_SWAP,
        addedCardId: "999999",
      })
    ).toThrow(MissingCardRecordsError);
  });
});
