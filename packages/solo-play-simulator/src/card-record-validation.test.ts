import { describe, expect, test } from "bun:test";
import type { CardRecord } from "./card-record-schema.ts";
import { cardRecordTable } from "./card-record-table.ts";
import {
  buildCardRecordTable,
  CardRecordValidationError,
  findCardRecordProblems,
  parseCardRecordFile,
} from "./card-record-validation.ts";

function findRecord(cardId: string): CardRecord {
  const record = cardRecordTable.get(cardId);
  if (record === undefined) {
    throw new Error(`カードの記録に ${cardId} が無い`);
  }
  return record;
}

const POFFIN = findRecord("048675");
const DHELMISE = findRecord("050308");
const DRAKLOAK = findRecord("049263");

describe("スキーマの検査", () => {
  test("記法に無い部品は、ファイル名と JSON の中の位置を添えて誤りにする", () => {
    const broken = structuredClone(POFFIN) as unknown as {
      cardEffects: { effect: { steps: { operation: string }[] } }[];
    };
    const [step] = broken.cardEffects[0]?.effect.steps ?? [];
    if (step !== undefined) {
      step.operation = "searchDeckOntoBenchTypo";
    }
    const result = parseCardRecordFile({
      content: broken,
      path: "goods/048675.json",
    });
    expect("problems" in result && result.problems[0]).toStartWith(
      "goods/048675.json: cardEffects.0.effect.steps.0.operation: "
    );
  });

  test("カード ID は 6 桁の数字で、確認日は日付にする", () => {
    const result = parseCardRecordFile({
      content: { ...POFFIN, cardIds: ["48675"], verifiedOn: "9/23" },
      path: "goods/048675.json",
    });
    const problems = "problems" in result ? result.problems : [];
    expect(problems.some((problem) => problem.includes("cardIds.0"))).toBe(
      true
    );
    expect(problems.some((problem) => problem.includes("verifiedOn"))).toBe(
      true
    );
  });

  test("進化前の名前は 1進化と 2進化だけが持ち、進化の系統のたねポケモンの名前は 2進化だけが持つ", () => {
    const { evolvesFrom: _, ...withoutEvolvesFrom } = DRAKLOAK as {
      evolvesFrom?: string;
    };
    const cases = [
      { ...DHELMISE, evolvesFrom: "ダダリン" },
      withoutEvolvesFrom,
      { ...DRAKLOAK, basicPokemonOfEvolutionLine: "ドラメシヤ" },
    ];
    for (const content of cases) {
      expect(
        "problems" in
          parseCardRecordFile({ content, path: "pokemon/000000.json" })
      ).toBe(true);
    }
    expect(
      "record" in
        parseCardRecordFile({ content: DRAKLOAK, path: "pokemon/049263.json" })
    ).toBe(true);
  });
});

describe("記録をまたぐ検査", () => {
  test("同じカード ID が複数の記録にあれば誤りにする", () => {
    const copy = { ...DHELMISE, cardIds: ["050256", "999999"] };
    expect(
      findCardRecordProblems([
        { path: "pokemon/050308.json", record: DHELMISE },
        { path: "pokemon/050256.json", record: copy },
      ])
    ).toContain(
      "カード ID 050256 が複数の記録にある: pokemon/050308.json、pokemon/050256.json"
    );
  });

  test("置き場所は種類のディレクトリと先頭のカード ID で決まる", () => {
    expect(
      findCardRecordProblems([{ path: "goods/000000.json", record: POFFIN }])
    ).toEqual([
      "goods/000000.json: 置き場所は goods/048675.json(種類のディレクトリと先頭のカード ID)にする",
    ]);
  });

  test("翻訳の状態と、翻訳した効果の有無が合わなければ誤りにする", () => {
    const untranslated = {
      ...POFFIN,
      translationStatus: "notTranslatable",
    } as const;
    const empty = { ...POFFIN, cardEffects: [] };
    expect(
      findCardRecordProblems([
        { path: "goods/048675.json", record: untranslated },
      ])
    ).toEqual([
      "goods/048675.json: 翻訳の状態が notTranslatable なのに、翻訳した効果がある",
    ]);
    expect(
      findCardRecordProblems([{ path: "goods/048675.json", record: empty }])
    ).toEqual([
      "goods/048675.json: 翻訳の状態が translated なのに、翻訳した効果が 1 つも無い",
    ]);
  });

  test("ワザの名前の重なりを検査する", () => {
    const [attack] = DRAKLOAK.category === "ポケモン" ? DRAKLOAK.attacks : [];
    const broken =
      DRAKLOAK.category === "ポケモン" && attack !== undefined
        ? { ...DRAKLOAK, attacks: [attack, attack] }
        : DRAKLOAK;
    expect(
      findCardRecordProblems([{ path: "pokemon/049263.json", record: broken }])
    ).toEqual([
      "pokemon/049263.json: ワザの名前 リューズヘッド が重なっている",
    ]);
  });

  test("進化前の名前の記録があるかは検査しない", () => {
    expect(
      findCardRecordProblems([
        { path: "pokemon/049263.json", record: DRAKLOAK },
      ])
    ).toEqual([]);
  });
});

describe("記録の表", () => {
  test("どの印刷のカード ID からも同じ記録を引ける", () => {
    expect(cardRecordTable.get("050256")).toBe(cardRecordTable.get("050308"));
  });

  test("誤りのある記録があれば、誤りを全部添えて表を作らない", () => {
    const build = () =>
      buildCardRecordTable([
        { content: { ...POFFIN, name: "" }, path: "goods/048675.json" },
        { content: DHELMISE, path: "pokemon/000000.json" },
      ]);
    expect(build).toThrow(CardRecordValidationError);
    try {
      build();
    } catch (error) {
      expect((error as CardRecordValidationError).problems).toHaveLength(2);
    }
  });
});
