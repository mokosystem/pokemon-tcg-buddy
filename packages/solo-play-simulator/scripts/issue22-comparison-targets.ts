/**
 * 順 8 の答え合わせの相手。#22 の 4 デッキごとに、宣言、宣言に入れない #22 の狙い(測るだけの狙い)、#22 の規則ファイルの
 * 成立率を持つ。#22 の成立率は 2026-09-27 に `uv run python -m setup_rate <規則モジュール名> --trials 20000 --seed 20260917`
 * で出し直した値(docs/setup-rate-design.md「検証の記録」と同じ値)。
 */

import { listUsableAttacksOfActive } from "../src/card-effects.ts";
import { CardCategory, type CardRecord } from "../src/card-record-schema.ts";
import { cardRecordTable } from "../src/card-record-table.ts";
import type { Declaration } from "../src/declaration.ts";
import { firstCandidateChoices } from "../src/effect-choices.ts";
import type { Goal } from "../src/engine.ts";
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

export interface Issue22ComparisonTarget {
  readonly deckCode: string;
  readonly declaration: Declaration;
  /** 宣言に入れない #22 の狙い。探索は目指さず、runGame が成否を測るだけ。 */
  readonly measuredGoals: readonly Goal[];
  readonly rates: readonly Issue22Rate[];
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
        "むねんのイカリ を打てる",
        [
          [0, 49.5],
          [70.9, 76.1],
          [81.0, 82.0],
        ],
        [2]
      ),
      ...ratesOf(
        "むねんのイカリ を 170 以上で打てる",
        [
          [0, 3.5],
          [16.4, 35.7],
          [52.2, 61.0],
        ],
        [2, 3]
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
        "ドラパルトex が場にいる",
        [
          [0, 0],
          [20.8, 28.2],
          [86.7, 91.8],
        ],
        [2, 3]
      ),
      ...ratesOf(
        "ファントムダイブ を打てる",
        [
          [0, 0],
          [4.3, 9.6],
          [52.8, 62.7],
        ],
        [3]
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
        "メガリザードンYex か メガリザードンXex が場にいる",
        [
          [0, 0],
          [12.8, 26.7],
          [51.1, 64.6],
        ],
        [2, 3]
      ),
      ...ratesOf(
        "プロージョンY か インフェルノX を打てる",
        [
          [0, 0],
          [3.8, 13.1],
          [29.3, 42.4],
        ],
        [3]
      ),
      ...ratesOf(
        "プロージョンY か インフェルノX を 270 以上で打てる",
        [
          [0, 0],
          [0.6, 7.8],
          [18.9, 28.2],
        ],
        [3]
      ),
    ],
  },
  "mega-gardevoir": {
    deckCode: "xG8Kax-DHob4e-84xcca",
    declaration: MEGA_GARDEVOIR_DECLARATION,
    measuredGoals: [],
    rates: [
      ...ratesOf(
        "メガサーナイトex が場にいる",
        [
          [0, 0],
          [59.0, 72.3],
          [84.4, 88.3],
        ],
        [2, 3]
      ),
      ...ratesOf(
        "メガシンフォニア を打てる",
        [
          [0, 0],
          [54.7, 68.7],
          [79.8, 84.7],
        ],
        [3]
      ),
      ...ratesOf(
        "メガシンフォニア を 300 以上で打てる",
        [
          [0, 0],
          [0, 0],
          [47.8, 64.2],
        ],
        [3]
      ),
    ],
  },
};
