import { describe, expect, test } from "bun:test";
import {
  buildDeck,
  type Decklist,
  type Goal,
  type PlayingPolicy,
} from "./engine.ts";
import { SAMPLE_CARD_TABLE } from "./sample-cards.ts";
import {
  compareVariants,
  formatAssumptions,
  formatSummary,
  formatVariantComparison,
  type SimulationOptions,
  simulate,
} from "./simulate.ts";

const MULLIGAN_LINE =
  /^引き直し\(たねポケモンが無い初手\)が起きた対戦: \d+\.\d %$/m;

const BASICS_AND_ENERGIES: Decklist = [
  { count: 4, name: "たね" },
  { count: 56, name: "基本超エネルギー" },
];

/** 手札のエネルギーをバトル場に 1 枚つけ、ワザを使う。 */
const attachingPolicy: PlayingPolicy = {
  chooseActiveAtSetup: (basics) => {
    const [first] = basics;
    if (first === undefined) {
      throw new Error("たねが無い");
    }
    return first;
  },
  chooseAttack: () => "ワザ",
  chooseBenchAtSetup: () => [],
  playTurn: (state) => {
    const energy = state.findFirstInHand("基本超エネルギー");
    if (energy !== null && state.active !== null) {
      state.attachEnergyFromHand(energy, state.active);
    }
  },
};

const twoEnergies: Goal = {
  explainFailure: (state) =>
    `エネルギー ${state.active?.countEnergy("psychic") ?? 0} 個`,
  isAchieved: (state) => (state.active?.countEnergy("psychic") ?? 0) >= 2,
  name: "エネルギー 2 個",
};

const neverAchieved: Goal = {
  explainFailure: () => "2進化 が無い",
  isAchieved: (state) => state.countInPlay("2進化") > 0,
  name: "2進化 が場にいる",
};

const baseOptions: SimulationOptions = {
  cards: buildDeck(SAMPLE_CARD_TABLE, BASICS_AND_ENERGIES),
  goals: [twoEnergies, neverAchieved],
  maxTurn: 3,
  policy: attachingPolicy,
  seed: 20_260_917,
  trials: 100,
  wentFirst: true,
};

describe("乱数試行の集計", () => {
  test("締め切りごとの成立率は、その番までに成立した対戦の累計で数える", () => {
    const summary = simulate(baseOptions);
    expect(summary.rate("エネルギー 2 個", 1)).toBe(0);
    expect(summary.rate("エネルギー 2 個", 2)).toBe(1);
    expect(summary.rate("エネルギー 2 個", 3)).toBe(1);
    expect(summary.rate("2進化 が場にいる", 3)).toBe(0);
  });

  test("成立しなかった番の要因を、狙いごと・番ごとに数える", () => {
    const summary = simulate(baseOptions);
    expect(summary.failureTally.get("エネルギー 2 個")?.get(1)).toEqual(
      new Map([["エネルギー 1 個", 100]])
    );
    expect(summary.failureTally.get("エネルギー 2 個")?.get(2)?.size).toBe(0);
    expect(summary.failureTally.get("2進化 が場にいる")?.get(3)).toEqual(
      new Map([["2進化 が無い", 100]])
    );
  });

  test("使ったワザを番ごとに数え、先攻の最初の番には無い", () => {
    const summary = simulate(baseOptions);
    expect(summary.attackTally.get(1)?.size).toBe(0);
    expect(summary.attackTally.get(2)).toEqual(new Map([["ワザ", 100]]));
  });

  test("引き直しが起きた対戦の数を数える", () => {
    const summary = simulate({
      ...baseOptions,
      cards: buildDeck(SAMPLE_CARD_TABLE, [
        { count: 1, name: "たね" },
        { count: 59, name: "基本超エネルギー" },
      ]),
    });
    expect(summary.mulliganGames).toBeGreaterThan(0);
    expect(summary.mulliganGames).toBeLessThanOrEqual(100);
  });

  test("同じ種なら同じ集計になる", () => {
    const first = simulate({ ...baseOptions, trials: 30 });
    const second = simulate({ ...baseOptions, trials: 30 });
    expect(second.achievedByTurn).toEqual(first.achievedByTurn);
    expect(second.mulliganGames).toBe(first.mulliganGames);
  });

  test("集計に無い狙いや、進めた番を超える締め切りの成立率は求められない", () => {
    const summary = simulate(baseOptions);
    expect(() => summary.rate("無い狙い", 2)).toThrow(
      "狙い 無い狙い は集計に無い"
    );
    expect(() => summary.rate("エネルギー 2 個", 4)).toThrow(
      "締め切り 4 は進めた番の数 3 を超えている"
    );
  });
});

describe("集計の整形", () => {
  test("先攻・後攻と試行回数、狙いごとの表、引き直しの割合、ワザ、締め切りの内訳を Markdown にする", () => {
    const text = formatSummary(simulate(baseOptions), [
      { goal: "2進化 が場にいる", turn: 3 },
    ]);
    expect(text).toContain("### 先攻(試行 100 回)");
    expect(text).toContain(
      "| 狙い | 1 番目の番まで | 2 番目の番まで | 3 番目の番まで |"
    );
    expect(text).toContain("| エネルギー 2 個 | 0.0 % | 100.0 % | 100.0 % |");
    expect(text).toMatch(MULLIGAN_LINE);
    expect(text).toContain("- 2 番目の番に使ったワザ: ワザ 100.0 %");
    expect(text).toContain(
      "**2進化 が場にいる(3 番目の番まで)が成立しなかった 100.0 % の内訳**"
    );
    expect(text).toContain("- 2進化 が無い: 100.0 %");
  });

  test("計算の前提は題名、デッキコード、前提の箇条書きで出す", () => {
    expect(
      formatAssumptions({
        assumptions: ["相手の行動を含めない"],
        deckCode: "xxxxxx-xxxxxx-xxxxxx",
        title: "テスト",
      })
    ).toBe(
      "## テスト\n\nデッキコード: xxxxxx-xxxxxx-xxxxxx\n\n### 計算の前提\n\n- 相手の行動を含めない\n"
    );
  });
});

describe("枚数を変えたときの比較", () => {
  const options = {
    cardTable: SAMPLE_CARD_TABLE,
    deadlines: [{ goal: "エネルギー 2 個", turn: 2 }],
    decklist: BASICS_AND_ENERGIES,
    goals: [twoEnergies],
    maxTurn: 2,
    policy: attachingPolicy,
    seed: 1,
    trials: 50,
    variants: [
      { changes: { たね: -3, 基本超エネルギー: 3 }, label: "たね 4→1" },
    ],
  };

  test("先攻・後攻それぞれに、変更なしの行と変更案の行を並べ、差は変更なしとの差にする", () => {
    const comparisons = compareVariants(options);
    expect(comparisons.map((comparison) => comparison.wentFirst)).toEqual([
      true,
      false,
    ]);
    for (const comparison of comparisons) {
      expect(comparison.rows.map((row) => row.label)).toEqual([
        "変更なし",
        "たね 4→1",
      ]);
      expect(comparison.rows[0]?.isBase).toBe(true);
      expect(comparison.rows[0]?.rates[0]?.diffFromBase).toBe(0);
      expect(comparison.rows[1]?.rates[0]?.diffFromBase).toBe(
        (comparison.rows[1]?.rates[0]?.rate ?? 0) -
          (comparison.rows[0]?.rates[0]?.rate ?? 0)
      );
    }
  });

  test("比較を Markdown の表にし、変更案の行には差をポイントで添える", () => {
    const text = formatVariantComparison(compareVariants(options));
    expect(text).toContain("### 枚数を変えたときの比較(先攻、試行 50 回)");
    expect(text).toContain("### 枚数を変えたときの比較(後攻、試行 50 回)");
    expect(text).toContain("| 変更 | エネルギー 2 個(2 番目まで) |");
    expect(text).toContain("| 変更なし | 100.0 % |");
    expect(text).toContain("| たね 4→1 | 100.0 % (+0.0) |");
  });
});
