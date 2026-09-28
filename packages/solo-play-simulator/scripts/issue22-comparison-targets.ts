/**
 * 順 8 の答え合わせの相手。#22 の 4 デッキごとに、宣言、宣言に入れない #22 の狙い(測るだけの狙い)、#22 の規則ファイルの
 * 成立率、#22 の枚数の変更案(4 デッキで 38 案)とその成立率を持つ。#22 の成立率は 2026-09-27 に
 * `uv run python -m setup_rate <規則モジュール名> --trials 20000 --seed 20260917` で出し直した値
 * (docs/solo-play-simulator-design.md「試作(Issue 22)の記録」の「検証の記録(試作)」と同じ値)。変更案の成立率は 2026-09-28 に同じ種と回数で
 * `--compare` を付けて出した値で、締め切りの狙いだけを持つ(Python の道具は締め切りの狙いしか比べない)。Python の骨組みと
 * 規則ファイル(`setup_rate/`)は順 9 で削除したため、これらの数字はここにしか無い。変更案の比較は、評価の抜けを直した後に
 * Issue 51 の確かめの 1 つとして行う(Issue 27 の決定事項「順 9 の 1 セッション目」)。
 */

import { listUsableAttacksOfActive } from "../src/card-effects.ts";
import { CardCategory, type CardRecord } from "../src/card-record-schema.ts";
import { cardRecordTable } from "../src/card-record-table.ts";
import type { Declaration } from "../src/declaration.ts";
import { firstCandidateChoices } from "../src/effect-choices.ts";
import type { DeckVariant, Goal } from "../src/engine.ts";
import {
  BAKEGAKURE_DECLARATION,
  DRAGAPULT_DECLARATION,
  MEGA_CHARIZARD_DECLARATION,
  MEGA_GARDEVOIR_DECLARATION,
} from "../src/issue22-decks.ts";
import type { GameState } from "../src/state.ts";

/** #22 の成立率の 1 つ。先攻・後攻の割合(%)。 */
export interface Issue22Rate {
  readonly firstPercent: number;
  /** 探索の側の狙いの名前(宣言から導いた狙いか、測るだけの狙い)。 */
  readonly goal: string;
  /** #22 の締め切り(規則ファイルの DEADLINES)にあたるか。 */
  readonly isDeadline: boolean;
  readonly secondPercent: number;
  readonly turn: number;
}

/** #22 の枚数の変更案 1 つと、その変更案での #22 の成立率(締め切りの狙いだけ)。 */
export interface Issue22VariantRates {
  readonly rates: readonly Issue22Rate[];
  readonly variant: DeckVariant;
}

export interface Issue22ComparisonTarget {
  readonly deckCode: string;
  readonly declaration: Declaration;
  /** 宣言に入れない #22 の狙い。探索は目指さず、runGame が成否を測るだけ。 */
  readonly measuredGoals: readonly Goal[];
  readonly rates: readonly Issue22Rate[];
  /** #22 の規則ファイルの VARIANTS と、その成立率。抜いた枚数は基本エネルギー 1 枚で埋めたものが多い。 */
  readonly variants: readonly Issue22VariantRates[];
}

function findRecord(cardId: string): CardRecord {
  const record = cardRecordTable.get(cardId);
  if (record === undefined) {
    throw new Error(`カード ID ${cardId} の記録が無い`);
  }
  return record;
}

/** 番ごとの #22 の割合を、先攻・後攻の組の並びから作る。添字 0 が 1 番目の番。 */
function ratesOf(
  goal: string,
  percents: readonly (readonly [number, number])[],
  deadlines: readonly number[]
): Issue22Rate[] {
  return percents.map(([firstPercent, secondPercent], index) => ({
    firstPercent,
    goal,
    isDeadline: deadlines.includes(index + 1),
    secondPercent,
    turn: index + 1,
  }));
}

/** 変更案の成立率の 1 行: 狙いの名前、番、先攻、後攻(%)。 */
type VariantRateRow = readonly [string, number, number, number];

function variantRatesOf(
  label: string,
  changes: Readonly<Record<string, number>>,
  rows: readonly VariantRateRow[]
): Issue22VariantRates {
  return {
    rates: rows.map(([goal, turn, firstPercent, secondPercent]) => ({
      firstPercent,
      goal,
      isDeadline: true,
      secondPercent,
      turn,
    })),
    variant: { changes, label },
  };
}

const GARDEVOIR_IN_PLAY = "メガサーナイトex が場にいる";
const GARDEVOIR_ATTACK = "メガシンフォニア を打てる";
const GARDEVOIR_ATTACK_300 = "メガシンフォニア を 300 以上で打てる";
const CHARIZARD_IN_PLAY = "メガリザードンYex か メガリザードンXex が場にいる";
const CHARIZARD_ATTACK = "プロージョンY か インフェルノX を打てる";
const CHARIZARD_ATTACK_270 =
  "プロージョンY か インフェルノX を 270 以上で打てる";
const BAKEGAKURE_ATTACK = "むねんのイカリ を打てる";
const BAKEGAKURE_ATTACK_170 = "むねんのイカリ を 170 以上で打てる";
const DRAGAPULT_IN_PLAY = "ドラパルトex が場にいる";
const DRAGAPULT_ATTACK = "ファントムダイブ を打てる";

const TALONFLAME = findRecord("050400");

/** #22 の is_active_talonflame_ready と同じく、バトル場のファイアローex が今「かぎづめハント」を使えるか。 */
const TALON_HUNT_GOAL: Goal = {
  explainFailure: (state) =>
    state
      .listPokemonInPlay()
      .some((pokemon) => pokemon.card.record === TALONFLAME)
      ? "ファイアローex はいるが、バトル場から かぎづめハント を使えない"
      : "ファイアローex が場にいない",
  isAchieved: (state) =>
    listUsableAttacksOfActive({ choices: firstCandidateChoices, state }).some(
      (candidate) =>
        candidate.owner.card.record === TALONFLAME &&
        candidate.attack.name === "かぎづめハント"
    ),
  name: "ファイアローex でかぎづめハントを打てる",
};

const BAKEGAKURE_FOR_170 = 4;

function countBakegakureInDiscard(state: GameState): number {
  return state.discard.filter(
    (card) =>
      card.record.category === CardCategory.Pokemon &&
      card.record.abilities.some((ability) => ability.name === "ばけがくれ")
  ).length;
}

const BAKEGAKURE_TRASH_GOAL: Goal = {
  explainFailure: (state) =>
    `トラッシュの「ばけがくれ」が ${countBakegakureInDiscard(state)} 枚で 4 枚に届かない`,
  isAchieved: (state) => countBakegakureInDiscard(state) >= BAKEGAKURE_FOR_170,
  name: "トラッシュに「ばけがくれ」のポケモンが 4 枚以上ある",
};

const DRAKLOAK = findRecord("049263");
const DRAGAPULT = findRecord("049264");

/** #22 と同じく、ドロンチかドラパルトex が場にいれば成り立つ。 */
const DRAKLOAK_GOAL: Goal = {
  explainFailure: () => "ドロンチもドラパルトex も場にいない",
  isAchieved: (state) =>
    state
      .listPokemonInPlay()
      .some(
        (pokemon) =>
          pokemon.card.record === DRAKLOAK || pokemon.card.record === DRAGAPULT
      ),
  name: "ドロンチが場にいる(ていさつしれいを使える)",
};

export const ISSUE22_COMPARISON_TARGETS: Readonly<
  Record<string, Issue22ComparisonTarget>
> = {
  bakegakure: {
    deckCode: "9nnnLP-Wejgk5-gn6gn9",
    declaration: BAKEGAKURE_DECLARATION,
    measuredGoals: [BAKEGAKURE_TRASH_GOAL],
    rates: [
      ...ratesOf(
        BAKEGAKURE_TRASH_GOAL.name,
        [
          [0.2, 6.9],
          [21.3, 43.2],
          [61.4, 71.2],
        ],
        [2, 3]
      ),
      ...ratesOf(
        BAKEGAKURE_ATTACK,
        [
          [0, 49.5],
          [70.9, 76.1],
          [81.0, 82.0],
        ],
        [2]
      ),
      ...ratesOf(
        BAKEGAKURE_ATTACK_170,
        [
          [0, 3.5],
          [16.4, 35.7],
          [52.2, 61.0],
        ],
        [2, 3]
      ),
    ],
    variants: [
      variantRatesOf(
        "ムク 4→3(基本超エネルギー +1)",
        { "049463": 1, "050297": -1 },
        [
          [BAKEGAKURE_TRASH_GOAL.name, 2, 20, 40.3],
          [BAKEGAKURE_TRASH_GOAL.name, 3, 58.4, 67.2],
          [BAKEGAKURE_ATTACK, 2, 72.5, 77.3],
          [BAKEGAKURE_ATTACK_170, 2, 15.9, 33.7],
          [BAKEGAKURE_ATTACK_170, 3, 50, 57.9],
        ]
      ),
      variantRatesOf(
        "プリズムタワー 3→2(基本超エネルギー +1)",
        { "049463": 1, "050164": -1 },
        [
          [BAKEGAKURE_TRASH_GOAL.name, 2, 18.1, 39],
          [BAKEGAKURE_TRASH_GOAL.name, 3, 56.1, 66.9],
          [BAKEGAKURE_ATTACK, 2, 73, 77.9],
          [BAKEGAKURE_ATTACK_170, 2, 14.5, 32.7],
          [BAKEGAKURE_ATTACK_170, 3, 48.4, 57.9],
        ]
      ),
      variantRatesOf(
        "ポケパッド 4→3(基本超エネルギー +1)",
        { "049463": 1, "050424": -1 },
        [
          [BAKEGAKURE_TRASH_GOAL.name, 2, 18.9, 40.3],
          [BAKEGAKURE_TRASH_GOAL.name, 3, 56.8, 67],
          [BAKEGAKURE_ATTACK, 2, 71.3, 76.1],
          [BAKEGAKURE_ATTACK_170, 2, 14.9, 33.4],
          [BAKEGAKURE_ATTACK_170, 3, 48.7, 58],
        ]
      ),
      variantRatesOf(
        "ハイパーボール 4→3(基本超エネルギー +1)",
        { "049463": 1, "050461": -1 },
        [
          [BAKEGAKURE_TRASH_GOAL.name, 2, 17.9, 39.5],
          [BAKEGAKURE_TRASH_GOAL.name, 3, 56.3, 68],
          [BAKEGAKURE_ATTACK, 2, 72.1, 77.3],
          [BAKEGAKURE_ATTACK_170, 2, 14.1, 33],
          [BAKEGAKURE_ATTACK_170, 3, 48.2, 58.7],
        ]
      ),
      variantRatesOf(
        "ノココッチ 2→1(基本超エネルギー +1)",
        { "045203": -1, "049463": 1 },
        [
          [BAKEGAKURE_TRASH_GOAL.name, 2, 19, 39.1],
          [BAKEGAKURE_TRASH_GOAL.name, 3, 55.3, 64.9],
          [BAKEGAKURE_ATTACK, 2, 70.5, 75.5],
          [BAKEGAKURE_ATTACK_170, 2, 15.1, 32.2],
          [BAKEGAKURE_ATTACK_170, 3, 46.6, 55.4],
        ]
      ),
      variantRatesOf(
        "ジュペッタ 3→2(カゲボウズは 4 のまま、基本超エネルギー +1)",
        { "049463": 1, "050251": -1 },
        [
          [BAKEGAKURE_TRASH_GOAL.name, 2, 16.6, 37.1],
          [BAKEGAKURE_TRASH_GOAL.name, 3, 53.3, 65.4],
          [BAKEGAKURE_ATTACK, 2, 72.7, 77.5],
          [BAKEGAKURE_ATTACK_170, 2, 13.3, 31.1],
          [BAKEGAKURE_ATTACK_170, 3, 46.1, 56.7],
        ]
      ),
      variantRatesOf(
        "ダダリン 4→3(基本超エネルギー +1)",
        { "049463": 1, "050308": -1 },
        [
          [BAKEGAKURE_TRASH_GOAL.name, 2, 19.5, 41.4],
          [BAKEGAKURE_TRASH_GOAL.name, 3, 58.7, 69],
          [BAKEGAKURE_ATTACK, 2, 68.6, 74.4],
          [BAKEGAKURE_ATTACK_170, 2, 15.2, 33.8],
          [BAKEGAKURE_ATTACK_170, 3, 49.2, 58],
        ]
      ),
      variantRatesOf(
        "ポケギア3.0 2→3(ボスの指令 -1)",
        { "049376": 1, "050467": -1 },
        [
          [BAKEGAKURE_TRASH_GOAL.name, 2, 21.5, 44.3],
          [BAKEGAKURE_TRASH_GOAL.name, 3, 62.4, 72.8],
          [BAKEGAKURE_ATTACK, 2, 71.3, 77.1],
          [BAKEGAKURE_ATTACK_170, 2, 16.7, 36.6],
          [BAKEGAKURE_ATTACK_170, 3, 53, 62.5],
        ]
      ),
      variantRatesOf(
        "テレパス超エネルギー 4→3(基本超エネルギー +1)",
        { "049463": 1, "049712": -1 },
        [
          [BAKEGAKURE_TRASH_GOAL.name, 2, 20.8, 42.3],
          [BAKEGAKURE_TRASH_GOAL.name, 3, 60.9, 70],
          [BAKEGAKURE_ATTACK, 2, 70, 76.3],
          [BAKEGAKURE_ATTACK_170, 2, 16, 34.8],
          [BAKEGAKURE_ATTACK_170, 3, 51.7, 60.6],
        ]
      ),
    ],
  },
  dragapult: {
    deckCode: "9gngnQ-zAMw9G-96H9nn",
    declaration: DRAGAPULT_DECLARATION,
    measuredGoals: [DRAKLOAK_GOAL],
    rates: [
      ...ratesOf(
        DRAKLOAK_GOAL.name,
        [
          [0, 0],
          [87.5, 93.9],
          [97.0, 96.7],
        ],
        [2]
      ),
      ...ratesOf(
        DRAGAPULT_IN_PLAY,
        [
          [0, 0],
          [20.8, 28.2],
          [86.7, 91.8],
        ],
        [2, 3]
      ),
      ...ratesOf(
        DRAGAPULT_ATTACK,
        [
          [0, 0],
          [4.3, 9.6],
          [52.8, 62.7],
        ],
        [3]
      ),
    ],
    variants: [
      variantRatesOf(
        "ふしぎなアメ 2→3(ジャミングタワー -1)",
        { "047214": -1, "049371": 1 },
        [
          [DRAKLOAK_GOAL.name, 2, 87.2, 94.1],
          [DRAGAPULT_IN_PLAY, 2, 29.1, 38.3],
          [DRAGAPULT_IN_PLAY, 3, 87.7, 92],
          [DRAGAPULT_ATTACK, 3, 51, 61.2],
        ]
      ),
      variantRatesOf(
        "ふしぎなアメ 2→1(基本超エネルギー +1)",
        { "048307": 1, "049371": -1 },
        [
          [DRAKLOAK_GOAL.name, 2, 86.7, 93.4],
          [DRAGAPULT_IN_PLAY, 2, 11.5, 15.8],
          [DRAGAPULT_IN_PLAY, 3, 84.4, 90.7],
          [DRAGAPULT_ATTACK, 3, 57.8, 68.8],
        ]
      ),
      variantRatesOf(
        "アカマツ 2→3(ロケット団の監視塔 -1)",
        { "048711": -1, "049412": 1 },
        [
          [DRAKLOAK_GOAL.name, 2, 86.2, 93.9],
          [DRAGAPULT_IN_PLAY, 2, 20.4, 28.2],
          [DRAGAPULT_IN_PLAY, 3, 85.5, 91.4],
          [DRAGAPULT_ATTACK, 3, 57.4, 68.5],
        ]
      ),
      variantRatesOf(
        "アカマツ 2→1(基本超エネルギー +1)",
        { "048307": 1, "049412": -1 },
        [
          [DRAKLOAK_GOAL.name, 2, 87.9, 94.2],
          [DRAGAPULT_IN_PLAY, 2, 21.2, 29.1],
          [DRAGAPULT_IN_PLAY, 3, 87.2, 91.8],
          [DRAGAPULT_ATTACK, 3, 48.1, 58.9],
        ]
      ),
      variantRatesOf(
        "ヒカリ 2→1(基本超エネルギー +1)",
        { "048307": 1, "048417": -1 },
        [
          [DRAKLOAK_GOAL.name, 2, 85.8, 92.2],
          [DRAGAPULT_IN_PLAY, 2, 20.4, 27],
          [DRAGAPULT_IN_PLAY, 3, 83.4, 88.1],
          [DRAGAPULT_ATTACK, 3, 54.4, 63.6],
        ]
      ),
      variantRatesOf(
        "ドロンチ 4→3(基本超エネルギー +1)",
        { "048307": 1, "049263": -1 },
        [
          [DRAKLOAK_GOAL.name, 2, 85.6, 92.8],
          [DRAGAPULT_IN_PLAY, 2, 20.7, 28.1],
          [DRAGAPULT_IN_PLAY, 3, 85.2, 90.4],
          [DRAGAPULT_ATTACK, 3, 54.4, 63.9],
        ]
      ),
      variantRatesOf(
        "ドラメシヤ 4→3(基本超エネルギー +1)",
        { "048307": 1, "049262": -1 },
        [
          [DRAKLOAK_GOAL.name, 2, 85.2, 93.3],
          [DRAGAPULT_IN_PLAY, 2, 19.3, 26.8],
          [DRAGAPULT_IN_PLAY, 3, 84.3, 90.1],
          [DRAGAPULT_ATTACK, 3, 52.4, 63.7],
        ]
      ),
      variantRatesOf(
        "なかよしポフィン 4→3(基本超エネルギー +1)",
        { "048307": 1, "049364": -1 },
        [
          [DRAKLOAK_GOAL.name, 2, 85.7, 93.1],
          [DRAGAPULT_IN_PLAY, 2, 19.7, 26.7],
          [DRAGAPULT_IN_PLAY, 3, 85, 90.5],
          [DRAGAPULT_ATTACK, 3, 54.5, 65.3],
        ]
      ),
      variantRatesOf(
        "基本炎エネルギー 3→4(基本悪エネルギー -1)",
        { "047904": 1, "047909": -1 },
        [
          [DRAKLOAK_GOAL.name, 2, 87.1, 93.8],
          [DRAGAPULT_IN_PLAY, 2, 20.9, 28.3],
          [DRAGAPULT_IN_PLAY, 3, 86.4, 91.9],
          [DRAGAPULT_ATTACK, 3, 54.6, 65.3],
        ]
      ),
      variantRatesOf(
        "ニャースex 1→0(基本超エネルギー +1)",
        { "048307": 1, "049694": -1 },
        [
          [DRAKLOAK_GOAL.name, 2, 87.2, 93.1],
          [DRAGAPULT_IN_PLAY, 2, 21.2, 27.7],
          [DRAGAPULT_IN_PLAY, 3, 85.6, 89.9],
          [DRAGAPULT_ATTACK, 3, 51.7, 60.3],
        ]
      ),
    ],
  },
  "mega-charizard": {
    deckCode: "DxKGxx-6pqCKy-xxJ8Yc",
    declaration: MEGA_CHARIZARD_DECLARATION,
    measuredGoals: [TALON_HUNT_GOAL],
    rates: [
      ...ratesOf(
        TALON_HUNT_GOAL.name,
        [
          [0, 17.6],
          [22.1, 31.1],
          [34.4, 37.8],
        ],
        [1, 2]
      ),
      ...ratesOf(
        CHARIZARD_IN_PLAY,
        [
          [0, 0],
          [12.8, 26.7],
          [51.1, 64.6],
        ],
        [2, 3]
      ),
      ...ratesOf(
        CHARIZARD_ATTACK,
        [
          [0, 0],
          [3.8, 13.1],
          [29.3, 42.4],
        ],
        [3]
      ),
      ...ratesOf(
        CHARIZARD_ATTACK_270,
        [
          [0, 0],
          [0.6, 7.8],
          [18.9, 28.2],
        ],
        [3]
      ),
    ],
    variants: [
      variantRatesOf(
        "イグニッションエネルギー 3→2(基本炎エネルギー +1)",
        { "049452": -1, "050746": 1 },
        [
          [TALON_HUNT_GOAL.name, 1, 0, 14.7],
          [TALON_HUNT_GOAL.name, 2, 18.8, 27.4],
          [CHARIZARD_IN_PLAY, 2, 12.7, 24.6],
          [CHARIZARD_IN_PLAY, 3, 49.3, 62.8],
          [CHARIZARD_ATTACK, 3, 29.2, 42.2],
          [CHARIZARD_ATTACK_270, 3, 18.4, 28.5],
        ]
      ),
      variantRatesOf(
        "イグニッションエネルギー 3→4(基本炎エネルギー -1)",
        { "049452": 1, "050746": -1 },
        [
          [TALON_HUNT_GOAL.name, 1, 0, 20.6],
          [TALON_HUNT_GOAL.name, 2, 24.9, 34.7],
          [CHARIZARD_IN_PLAY, 2, 13, 28.6],
          [CHARIZARD_IN_PLAY, 3, 52, 65.8],
          [CHARIZARD_ATTACK, 3, 28.5, 42],
          [CHARIZARD_ATTACK_270, 3, 18.5, 28.5],
        ]
      ),
      variantRatesOf(
        "メガガルーラex 3→2(基本炎エネルギー +1)",
        { "047847": -1, "050746": 1 },
        [
          [TALON_HUNT_GOAL.name, 1, 0, 15.5],
          [TALON_HUNT_GOAL.name, 2, 19.5, 27.9],
          [CHARIZARD_IN_PLAY, 2, 12.6, 25.1],
          [CHARIZARD_IN_PLAY, 3, 49.1, 62.6],
          [CHARIZARD_ATTACK, 3, 29.6, 42.5],
          [CHARIZARD_ATTACK_270, 3, 18.5, 28.6],
        ]
      ),
      variantRatesOf(
        "ファイアローex 2→1(基本炎エネルギー +1)",
        { "050400": -1, "050746": 1 },
        [
          [TALON_HUNT_GOAL.name, 1, 0, 15.7],
          [TALON_HUNT_GOAL.name, 2, 19.7, 28.1],
          [CHARIZARD_IN_PLAY, 2, 12, 25.1],
          [CHARIZARD_IN_PLAY, 3, 48.3, 61.7],
          [CHARIZARD_ATTACK, 3, 28.8, 41.4],
          [CHARIZARD_ATTACK_270, 3, 18.3, 27.5],
        ]
      ),
      variantRatesOf(
        "ラティアスex 2→1(基本炎エネルギー +1)",
        { "049524": -1, "050746": 1 },
        [
          [TALON_HUNT_GOAL.name, 1, 0, 16.4],
          [TALON_HUNT_GOAL.name, 2, 19.7, 28.9],
          [CHARIZARD_IN_PLAY, 2, 13.7, 27.4],
          [CHARIZARD_IN_PLAY, 3, 52.4, 65.3],
          [CHARIZARD_ATTACK, 3, 30, 42.9],
          [CHARIZARD_ATTACK_270, 3, 19.4, 29.1],
        ]
      ),
      variantRatesOf(
        "オドリドリex 2→1(基本炎エネルギー +1)",
        { "048358": -1, "050746": 1 },
        [
          [TALON_HUNT_GOAL.name, 1, 0, 18],
          [TALON_HUNT_GOAL.name, 2, 23.1, 32],
          [CHARIZARD_IN_PLAY, 2, 12.8, 27.6],
          [CHARIZARD_IN_PLAY, 3, 51.9, 65.4],
          [CHARIZARD_ATTACK, 3, 29.6, 43.2],
          [CHARIZARD_ATTACK_270, 3, 17.8, 27.2],
        ]
      ),
      variantRatesOf(
        "ヒカリ 2→1(基本炎エネルギー +1)",
        { "050428": -1, "050746": 1 },
        [
          [TALON_HUNT_GOAL.name, 1, 0, 17.7],
          [TALON_HUNT_GOAL.name, 2, 22.2, 31.3],
          [CHARIZARD_IN_PLAY, 2, 12.6, 25.2],
          [CHARIZARD_IN_PLAY, 3, 47.9, 59.2],
          [CHARIZARD_ATTACK, 3, 28.9, 40.3],
          [CHARIZARD_ATTACK_270, 3, 18.9, 27.1],
        ]
      ),
      variantRatesOf(
        "シアノ 2→3(ジャミングタワー -1)",
        { "046442": 1, "047214": -1 },
        [
          [TALON_HUNT_GOAL.name, 1, 0, 18.5],
          [TALON_HUNT_GOAL.name, 2, 23.3, 32.8],
          [CHARIZARD_IN_PLAY, 2, 13.2, 27.7],
          [CHARIZARD_IN_PLAY, 3, 51.6, 66],
          [CHARIZARD_ATTACK, 3, 30.1, 44.8],
          [CHARIZARD_ATTACK_270, 3, 19.7, 31.1],
        ]
      ),
      variantRatesOf(
        "トウコ 2→3(バトルコロシアム -1)",
        { "048419": -1, "048694": 1 },
        [
          [TALON_HUNT_GOAL.name, 1, 0, 19.8],
          [TALON_HUNT_GOAL.name, 2, 24.2, 33.5],
          [CHARIZARD_IN_PLAY, 2, 12.9, 27.7],
          [CHARIZARD_IN_PLAY, 3, 52.5, 66.4],
          [CHARIZARD_ATTACK, 3, 30.1, 43.7],
          [CHARIZARD_ATTACK_270, 3, 18.9, 28.9],
        ]
      ),
      variantRatesOf(
        "ふしぎなアメ 2→3(ジャミングタワー -1)",
        { "047214": -1, "050423": 1 },
        [
          [TALON_HUNT_GOAL.name, 1, 0, 17.6],
          [TALON_HUNT_GOAL.name, 2, 21.2, 30.3],
          [CHARIZARD_IN_PLAY, 2, 17.9, 33],
          [CHARIZARD_IN_PLAY, 3, 54.8, 67.9],
          [CHARIZARD_ATTACK, 3, 30.9, 44.7],
          [CHARIZARD_ATTACK_270, 3, 19.2, 29.4],
        ]
      ),
    ],
  },
  "mega-gardevoir": {
    deckCode: "xG8Kax-DHob4e-84xcca",
    declaration: MEGA_GARDEVOIR_DECLARATION,
    measuredGoals: [],
    rates: [
      ...ratesOf(
        GARDEVOIR_IN_PLAY,
        [
          [0, 0],
          [59.0, 72.3],
          [84.4, 88.3],
        ],
        [2, 3]
      ),
      ...ratesOf(
        GARDEVOIR_ATTACK,
        [
          [0, 0],
          [54.7, 68.7],
          [79.8, 84.7],
        ],
        [3]
      ),
      ...ratesOf(
        GARDEVOIR_ATTACK_300,
        [
          [0, 0],
          [0, 0],
          [47.8, 64.2],
        ],
        [3]
      ),
    ],
    variants: [
      variantRatesOf(
        "キルリア 3→2(基本超エネルギー +1)",
        { "049463": 1, "049715": -1 },
        [
          [GARDEVOIR_IN_PLAY, 2, 55.9, 69],
          [GARDEVOIR_IN_PLAY, 3, 81, 85.3],
          [GARDEVOIR_ATTACK, 3, 76.9, 82.3],
          [GARDEVOIR_ATTACK_300, 3, 46.1, 62],
        ]
      ),
      variantRatesOf(
        "ラルトス 4→3(基本超エネルギー +1)",
        { "049463": 1, "049714": -1 },
        [
          [GARDEVOIR_IN_PLAY, 2, 57.1, 72],
          [GARDEVOIR_IN_PLAY, 3, 83.7, 87.6],
          [GARDEVOIR_ATTACK, 3, 80.2, 84.7],
          [GARDEVOIR_ATTACK_300, 3, 46.7, 63.4],
        ]
      ),
      variantRatesOf(
        "ふしぎなアメ 2→1(基本超エネルギー +1)",
        { "049463": 1, "050462": -1 },
        [
          [GARDEVOIR_IN_PLAY, 2, 54.6, 68.2],
          [GARDEVOIR_IN_PLAY, 3, 82.2, 86.4],
          [GARDEVOIR_ATTACK, 3, 78, 83.2],
          [GARDEVOIR_ATTACK_300, 3, 45.6, 61.7],
        ]
      ),
      variantRatesOf(
        "アクロマの執念 4→3(基本超エネルギー +1)",
        { "045934": -1, "049463": 1 },
        [
          [GARDEVOIR_IN_PLAY, 2, 55.1, 68.4],
          [GARDEVOIR_IN_PLAY, 3, 82.3, 86.3],
          [GARDEVOIR_ATTACK, 3, 77.7, 82.9],
          [GARDEVOIR_ATTACK_300, 3, 44.6, 61.2],
        ]
      ),
      variantRatesOf(
        "なかよしポフィン 3→2(基本超エネルギー +1)",
        { "048675": -1, "049463": 1 },
        [
          [GARDEVOIR_IN_PLAY, 2, 57.3, 71.7],
          [GARDEVOIR_IN_PLAY, 3, 83.7, 87.7],
          [GARDEVOIR_ATTACK, 3, 78.9, 84.1],
          [GARDEVOIR_ATTACK_300, 3, 45.9, 63.8],
        ]
      ),
      variantRatesOf(
        "ニャースex 2→1(基本超エネルギー +1)",
        { "049463": 1, "049694": -1 },
        [
          [GARDEVOIR_IN_PLAY, 2, 58.1, 71.2],
          [GARDEVOIR_IN_PLAY, 3, 83.8, 87.7],
          [GARDEVOIR_ATTACK, 3, 79.7, 84.7],
          [GARDEVOIR_ATTACK_300, 3, 46.7, 63.3],
        ]
      ),
      variantRatesOf(
        "ミュウex 1→0(基本超エネルギー +1)",
        { "049463": 1, "050669": -1 },
        [
          [GARDEVOIR_IN_PLAY, 2, 59.4, 72.1],
          [GARDEVOIR_IN_PLAY, 3, 84.7, 88.1],
          [GARDEVOIR_ATTACK, 3, 79.5, 84.4],
          [GARDEVOIR_ATTACK_300, 3, 47.9, 63.9],
        ]
      ),
      variantRatesOf(
        "テレパス超エネルギー 4→3(基本超エネルギー +1)",
        { "049463": 1, "049712": -1 },
        [
          [GARDEVOIR_IN_PLAY, 2, 58, 72.1],
          [GARDEVOIR_IN_PLAY, 3, 84, 87.9],
          [GARDEVOIR_ATTACK, 3, 78.9, 84.1],
          [GARDEVOIR_ATTACK_300, 3, 46.3, 63.5],
        ]
      ),
      variantRatesOf("トウコ 2→3(ユカリ -1)", { "048694": 1, "050083": -1 }, [
        [GARDEVOIR_IN_PLAY, 2, 57.7, 71.3],
        [GARDEVOIR_IN_PLAY, 3, 84.7, 88.8],
        [GARDEVOIR_ATTACK, 3, 80.1, 85.5],
        [GARDEVOIR_ATTACK_300, 3, 46.8, 63.3],
      ]),
    ],
  },
};
