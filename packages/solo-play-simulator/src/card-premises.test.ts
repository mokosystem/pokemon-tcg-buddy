import { describe, expect, test } from "bun:test";
import {
  buildCardPremises,
  DECK_INDEPENDENT_PREMISES,
  formatCardPremises,
} from "./card-premises.ts";
import { buildRecordedCard } from "./card-test-support.ts";

const deck = [
  buildRecordedCard("050461"),
  buildRecordedCard("050461"),
  buildRecordedCard("050251"),
  buildRecordedCard("050224"),
  buildRecordedCard("050308"),
  buildRecordedCard("050256"),
  buildRecordedCard("045203"),
];

describe("カードごとの前提", () => {
  test("翻訳していないカード、一部を含めなかったカード、計算に関係ないカードに分け、同じ記録の印刷はまとめる", () => {
    const premises = buildCardPremises(deck);
    expect(premises.untranslatedCards).toEqual([
      {
        cardIds: ["050224"],
        name: "チャデス",
        reasons: [
          "特性「ばけがくれ」(相手のワザや特性の効果を受けない)",
          "ワザ「ひっそりのせる」(相手のバトルポケモンにダメカンをのせる)",
        ],
      },
    ]);
    expect(premises.partiallyTranslatedCards.map((card) => card.name)).toEqual([
      "ジュペッタ",
    ]);
    expect(premises.irrelevantCards).toEqual([
      { cardIds: ["050308", "050256"], name: "ダダリン" },
    ]);
  });

  test("出典が「該当なし」の裁定は、プロジェクトの解釈として出す", () => {
    const premises = buildCardPremises(deck);
    expect(premises.projectInterpretations.map((entry) => entry.name)).toEqual([
      "ノココッチ",
    ]);
  });

  test("前提の文は、翻訳していないカード、一部を含めなかったカード、プロジェクトの解釈、計算に関係ないカードの順に出す", () => {
    const lines = formatCardPremises(buildCardPremises(deck));
    expect(lines[0]).toStartWith(
      "効果を計算に含めていない: チャデス(050224)。"
    );
    expect(lines[1]).toStartWith(
      "効果の一部を計算に含めていない: ジュペッタ(050251)。"
    );
    expect(lines[2]).toStartWith(
      "公式 Q&A に該当が無く、プロジェクトの解釈で計算した: ノココッチ(045203)。"
    );
    expect(lines.at(-1)).toBe(
      "計算に関係ないと判断したカード: ダダリン(050308、050256)"
    );
  });

  test("デッキによらない前提に、相手の行動、特殊状態、コインの扱いを含める", () => {
    expect(DECK_INDEPENDENT_PREMISES.join("\n")).toContain(
      "相手の行動を含めない"
    );
    expect(DECK_INDEPENDENT_PREMISES.join("\n")).toContain(
      "特殊状態を含めない"
    );
    expect(DECK_INDEPENDENT_PREMISES.join("\n")).toContain("1/2");
  });
});
