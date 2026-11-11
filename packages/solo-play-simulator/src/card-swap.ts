/**
 * カードの入れ替え(GLOSSARY.md)をしたデッキを作る。入れ替える前と後を同じ乱数の種で回して比べる(種をそろえた対)
 * 計測に使う。利用者から入れ替えの案を受け取る入口と、同じ名前のカードの枚数の上限の検査は Issue 71 で作る。
 */

import { buildCardFromRecord, type Card } from "./cards.ts";
import { type CardRecordTable, MissingCardRecordsError } from "./engine.ts";

/** カードの入れ替え。抜くカードと入れるカードを印刷のカード ID で指す。 */
export interface CardSwap {
  readonly addedCardId: string;
  readonly count: number;
  readonly removedCardId: string;
}

/**
 * 入れ替えた後の 60 枚を、入れ替える前のカードの並びの同じ位置で作る。抜くカードは並びの後ろから count 枚を選び、
 * その位置に入れるカードを置く。入れるカードがすでに並びにあれば、同じ参照を使う(今できる行動の一覧は手札の
 * 同じ参照のカードを 1 つにまとめるため)。
 * 位置をそろえるのは、山札を切る処理(state.ts の shuffleCards、Fisher-Yates)が並びの位置で入れ替え先を決めるため。
 * 位置がずれると、同じ種で切っても大半のカードの行き先が変わり、種をそろえた対にした効き目が薄れる。
 */
export function buildSwappedDeckCards(
  recordTable: CardRecordTable,
  cards: readonly Card[],
  swap: CardSwap
): Card[] {
  const removedPositions = cards.flatMap((card, index) =>
    card.cardId === swap.removedCardId ? [index] : []
  );
  if (removedPositions.length < swap.count) {
    throw new Error(
      `抜くカード ${swap.removedCardId} が ${swap.count} 枚に足りない(${removedPositions.length} 枚)`
    );
  }
  const added =
    cards.find((card) => card.cardId === swap.addedCardId) ??
    buildAddedCard(recordTable, swap.addedCardId);
  const swapped = [...cards];
  for (const position of removedPositions.slice(
    removedPositions.length - swap.count
  )) {
    swapped[position] = added;
  }
  return swapped;
}

function buildAddedCard(recordTable: CardRecordTable, cardId: string): Card {
  const record = recordTable.get(cardId);
  if (record === undefined) {
    throw new MissingCardRecordsError([cardId]);
  }
  return buildCardFromRecord(record, cardId);
}
