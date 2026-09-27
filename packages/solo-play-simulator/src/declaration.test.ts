import { describe, expect, test } from "bun:test";
import { cardRecordTable } from "./card-record-table.ts";
import { buildRecordedCard, buildState } from "./card-test-support.ts";
import {
  type Declaration,
  DeclarationValidationError,
  resolveDeclaration,
} from "./declaration.ts";
import {
  BAKEGAKURE_DECLARATION,
  DRAGAPULT_DECLARATION,
  MEGA_CHARIZARD_DECLARATION,
  MEGA_GARDEVOIR_DECLARATION,
} from "./issue22-decks.ts";
import { PokemonInPlay } from "./state.ts";

const MEGA_GARDEVOIR = buildRecordedCard("048464");
const KIRLIA = buildRecordedCard("049715");
const RALTS = buildRecordedCard("049714");
const MEW = buildRecordedCard("050669");
const PSYCHIC_ENERGY = buildRecordedCard("049463");
const N_ZOROARK = buildRecordedCard("048634");
const N_RESHIRAM = buildRecordedCard("049261");
const DARK_ENERGY = buildRecordedCard("047909");

function problemsOf(content: unknown): readonly string[] {
  try {
    resolveDeclaration(content, cardRecordTable);
  } catch (error) {
    if (error instanceof DeclarationValidationError) {
      return error.problems;
    }
    throw error;
  }
  return [];
}

function withEnergies(card: typeof MEGA_GARDEVOIR, count: number) {
  const pokemon = new PokemonInPlay(card, 0);
  pokemon.energies.push(...Array.from({ length: count }, () => PSYCHIC_ENERGY));
  return pokemon;
}

describe("宣言の検査", () => {
  test("メガサーナイトex の宣言を記録に引き当て、狙いの 3 段を導く", () => {
    const resolved = resolveDeclaration(
      MEGA_GARDEVOIR_DECLARATION,
      cardRecordTable
    );
    expect(resolved.goals.map((goal) => goal.name)).toEqual([
      "メガサーナイトex が場にいる",
      "メガシンフォニア を打てる",
      "メガシンフォニア を 300 以上で打てる",
    ]);
    expect(resolved.paths.map((path) => path.name)).toEqual([
      "偉大な大樹の道",
      "ふしぎなアメの道",
      "素の進化の道",
    ]);
    expect(resolved.deadlines).toEqual([2, 3]);
  });

  test("答え合わせの残り 3 デッキの宣言を記録に引き当て、狙いを導く", () => {
    const goalNamesOf = (declaration: Declaration) =>
      resolveDeclaration(declaration, cardRecordTable).goals.map(
        (goal) => goal.name
      );
    expect(goalNamesOf(MEGA_CHARIZARD_DECLARATION)).toEqual([
      "メガリザードンYex か メガリザードンXex が場にいる",
      "プロージョンY か インフェルノX を打てる",
      "プロージョンY か インフェルノX を 270 以上で打てる",
    ]);
    expect(goalNamesOf(BAKEGAKURE_DECLARATION)).toEqual([
      "ダダリン が場にいる",
      "むねんのイカリ を打てる",
      "むねんのイカリ を 170 以上で打てる",
    ]);
    expect(goalNamesOf(DRAGAPULT_DECLARATION)).toEqual([
      "ドラパルトex が場にいる",
      "ファントムダイブ を打てる",
    ]);
  });

  test("締め切りを省くと 2 と 3、ダメージの下限を省くと狙いは 2 段になる", () => {
    const {
      deadlines: _,
      minimumDamage: __,
      ...rest
    } = MEGA_GARDEVOIR_DECLARATION;
    const resolved = resolveDeclaration(rest, cardRecordTable);
    expect(resolved.deadlines).toEqual([2, 3]);
    expect(resolved.goals).toHaveLength(2);
  });

  test("締め切りは小さい順にそろえ、重なりを除く", () => {
    const resolved = resolveDeclaration(
      { ...MEGA_GARDEVOIR_DECLARATION, deadlines: [3, 2, 3] },
      cardRecordTable
    );
    expect(resolved.deadlines).toEqual([2, 3]);
  });

  test("書式の誤りは、宣言の中の位置を添えて示す", () => {
    const problems = problemsOf({
      ...MEGA_GARDEVOIR_DECLARATION,
      mainAttacks: [],
      pathsToMainAttacker: [
        { name: "道", requiredCards: [{ cardId: "048464", place: "bench" }] },
      ],
    });
    expect(problems.some((problem) => problem.startsWith("mainAttacks"))).toBe(
      true
    );
    expect(
      problems.some((problem) =>
        problem.startsWith("pathsToMainAttacker.0.requiredCards.0.place")
      )
    ).toBe(true);
  });

  test("記録の無いカード ID、ポケモンでない主軸、記録に無いワザの名前をまとめて示す", () => {
    const declaration: Declaration = {
      mainAttacks: [
        { attackName: "メガシンフォニア", cardId: "999999" },
        { attackName: "メガシンフォニア", cardId: "049463" },
        { attackName: "ありえないワザ", cardId: "048464" },
      ],
      pathsToMainAttacker: [
        { name: "道", requiredCards: [{ cardId: "999998", place: "hand" }] },
      ],
    };
    expect(problemsOf(declaration)).toEqual([
      "mainAttacks: カード ID 999999 の記録が無い",
      "mainAttacks: 基本超エネルギー(049463)はポケモンではない",
      "mainAttacks: メガサーナイトex の記録にワザ ありえないワザ が無い",
      "道: カード ID 999998 の記録が無い",
    ]);
  });
});

describe("宣言から導いた狙いの判定", () => {
  const [stand, attack, damage] = resolveDeclaration(
    MEGA_GARDEVOIR_DECLARATION,
    cardRecordTable
  ).goals;
  if (stand === undefined || attack === undefined || damage === undefined) {
    throw new Error("狙いが 3 段に満たない");
  }

  test("主軸がベンチにいれば立つが、バトル場のポケモンが主軸のワザを使えなければ打てない", () => {
    const state = buildState({ active: RALTS, bench: [MEGA_GARDEVOIR] });
    expect(stand.isAchieved(state)).toBe(true);
    expect(attack.isAchieved(state)).toBe(false);
    expect(attack.explainFailure(state)).toBe(
      "メガサーナイトex はいるが、バトル場から メガシンフォニア を使えない"
    );
  });

  test("主軸が場にいなければ、どの段も要因は「場にいない」", () => {
    const state = buildState({ active: KIRLIA });
    expect(stand.isAchieved(state)).toBe(false);
    expect(damage.explainFailure(state)).toBe("メガサーナイトex が場にいない");
  });

  test("バトル場の主軸に超エネルギーが 1 個なら打てるが、場の超エネルギーが 6 個に満たなければ 300 に届かない", () => {
    const state = buildState({});
    state.active = withEnergies(MEGA_GARDEVOIR, 1);
    state.bench.push(withEnergies(RALTS, 4));
    expect(attack.isAchieved(state)).toBe(true);
    expect(damage.isAchieved(state)).toBe(false);
    expect(damage.explainFailure(state)).toBe(
      "ダメージが 250 で 300 に届かない"
    );
    state.bench.push(withEnergies(RALTS, 1));
    expect(damage.isAchieved(state)).toBe(true);
  });

  test("ミュウex の「きおくのらせん」でベンチの主軸のワザを使えるときも打てる", () => {
    const state = buildState({ bench: [MEGA_GARDEVOIR] });
    state.active = withEnergies(MEW, 1);
    expect(attack.isAchieved(state)).toBe(true);
  });
});

describe("ほかのワザを「このワザとして使う」主軸のワザの判定", () => {
  const [stand, attack, damage] = resolveDeclaration(
    {
      mainAttacks: [{ attackName: "ナイトジョーカー", cardId: "048634" }],
      minimumDamage: 150,
      pathsToMainAttacker: [
        {
          name: "Nのゾロアークex の道",
          requiredCards: [{ cardId: "048634", place: "hand" }],
        },
      ],
    },
    cardRecordTable
  ).goals;
  if (stand === undefined || attack === undefined || damage === undefined) {
    throw new Error("狙いが 3 段に満たない");
  }

  test("ナイトジョーカーでベンチの Nのレシラムの「イノセントフレイム」を使えれば、打てて 150 にも届く", () => {
    const state = buildState({ bench: [N_RESHIRAM] });
    state.active = new PokemonInPlay(N_ZOROARK, 0);
    state.active.energies.push(DARK_ENERGY, DARK_ENERGY);
    expect(stand.isAchieved(state)).toBe(true);
    expect(attack.isAchieved(state)).toBe(true);
    expect(damage.isAchieved(state)).toBe(true);
  });

  test("ベンチに選べるワザが無ければ、ナイトジョーカーは打てない", () => {
    const state = buildState({});
    state.active = new PokemonInPlay(N_ZOROARK, 0);
    state.active.energies.push(DARK_ENERGY, DARK_ENERGY);
    expect(attack.isAchieved(state)).toBe(false);
  });
});
