/**
 * 計算の前提(CONTEXT.md「計算の前提」)。デッキによらない固定の文と、デッキのカードの記録から作る
 * カードごとの前提からなる。docs/setup-rate-design.md「翻訳が無いカードと計算の前提」の 3 つの分け方に従う。
 */

import type {
  CardRecord,
  ExcludedEffect,
  Ruling,
} from "./card-record-schema.ts";
import type { Card } from "./cards.ts";

/** デッキによらない前提。成立率の出力の先頭に、カードごとの前提より先に出す。 */
export const DECK_INDEPENDENT_PREMISES: readonly string[] = [
  "相手の行動を含めない。相手の妨害、きぜつ、サイドの進みは起きない(サイドは常に 6 枚)",
  "特殊状態を含めない。ねむりとマヒは自分のワザとにげるを妨げるため、含めないと成立率が実際より高く出うる",
  "コインはオモテとウラを 1/2 ずつとする",
  "回復、ダメージ、ダメカンを含めない",
  "相手の引き直しによる追加の 1 枚は扱わない",
];

/** デッキにある 1 種のカード。同じ記録の印刷が複数入っていれば、カード ID を全部並べる。 */
export interface CardInDeck {
  readonly cardIds: readonly string[];
  readonly name: string;
}

export interface UntranslatedCard extends CardInDeck {
  readonly reasons: readonly string[];
}

export interface PartiallyTranslatedCard extends CardInDeck {
  readonly excludedEffects: readonly ExcludedEffect[];
}

export interface ProjectInterpretation extends CardInDeck {
  readonly ruling: Ruling;
}

export interface CardPremises {
  /** (3) 計算に関係ないと判断したカード。 */
  readonly irrelevantCards: readonly CardInDeck[];
  /** (2) 翻訳したが一部を含めなかったカード。 */
  readonly partiallyTranslatedCards: readonly PartiallyTranslatedCard[];
  /** 出典が「該当なし」の裁定。プロジェクトの解釈であることを示す。 */
  readonly projectInterpretations: readonly ProjectInterpretation[];
  /** (1) 効果を翻訳していないカード(書けない、まだ書いていない)。 */
  readonly untranslatedCards: readonly UntranslatedCard[];
}

function groupCardIdsByRecord(
  cards: readonly Card[]
): Map<CardRecord, string[]> {
  const groups = new Map<CardRecord, string[]>();
  for (const card of cards) {
    const cardIds = groups.get(card.record) ?? [];
    if (!cardIds.includes(card.cardId)) {
      cardIds.push(card.cardId);
    }
    groups.set(card.record, cardIds);
  }
  return groups;
}

function explainUntranslated(record: CardRecord): string[] {
  if (record.translationStatus === "notYetTranslated") {
    return ["まだ翻訳していない"];
  }
  return record.excludedEffects.map((excluded) => excluded.description);
}

/** デッキのカードの記録から、カードごとの前提を作る。並びはデッキに現れた順。 */
export function buildCardPremises(cards: readonly Card[]): CardPremises {
  const untranslatedCards: UntranslatedCard[] = [];
  const partiallyTranslatedCards: PartiallyTranslatedCard[] = [];
  const irrelevantCards: CardInDeck[] = [];
  const projectInterpretations: ProjectInterpretation[] = [];
  for (const [record, cardIds] of groupCardIdsByRecord(cards)) {
    const inDeck = { cardIds, name: record.name };
    switch (record.translationStatus) {
      case "notTranslatable":
      case "notYetTranslated":
        untranslatedCards.push({
          ...inDeck,
          reasons: explainUntranslated(record),
        });
        break;
      case "irrelevantToCalculation":
        irrelevantCards.push(inDeck);
        break;
      default:
        if (record.excludedEffects.length > 0) {
          partiallyTranslatedCards.push({
            ...inDeck,
            excludedEffects: record.excludedEffects,
          });
        }
    }
    for (const ruling of record.rulings) {
      if (ruling.source.kind === "noMatchingQa") {
        projectInterpretations.push({ ...inDeck, ruling });
      }
    }
  }
  return {
    irrelevantCards,
    partiallyTranslatedCards,
    projectInterpretations,
    untranslatedCards,
  };
}

function formatCardInDeck(card: CardInDeck): string {
  return `${card.name}(${card.cardIds.join("、")})`;
}

/** カードごとの前提を、formatAssumptions に渡す箇条書きの文にする。 */
export function formatCardPremises(premises: CardPremises): string[] {
  const lines = [
    ...premises.untranslatedCards.map(
      (card) =>
        `効果を計算に含めていない: ${formatCardInDeck(card)}。${card.reasons.join("。")}`
    ),
    ...premises.partiallyTranslatedCards.map(
      (card) =>
        `効果の一部を計算に含めていない: ${formatCardInDeck(card)}。${card.excludedEffects.map((excluded) => excluded.description).join("。")}`
    ),
    ...premises.projectInterpretations.map(
      (entry) =>
        `公式 Q&A に該当が無く、プロジェクトの解釈で計算した: ${formatCardInDeck(entry)}。${entry.ruling.question} → ${entry.ruling.interpretation}`
    ),
  ];
  if (premises.irrelevantCards.length > 0) {
    lines.push(
      `計算に関係ないと判断したカード: ${premises.irrelevantCards.map(formatCardInDeck).join("、")}`
    );
  }
  return lines;
}
