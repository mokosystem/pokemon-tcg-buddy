/**
 * 開発責任者の残り 2 デッキ(シロナのガブリアスex、メガレックウザex)を探索(道の揃い具合を見る評価)で回し、狙いごとの
 * 成立率と、求められていれば成立しなかった対戦の履歴を出す(Issue 51 の追試)。#22 の成立率が無いため比べる相手は無く、
 * 合否も判定しない。乱数の種と探索の設定は答え合わせ(compare-with-issue22.ts)と同じ。パッケージのディレクトリで次のように
 * 実行する(デッキの名前、先攻・後攻それぞれの試行回数、履歴を出す狙いの名前の一部・番・件数)。
 *
 *   bun run estimate:additional-deck-rates cynthias-garchomp 20000
 *   bun run estimate:additional-deck-rates mega-rayquaza 2000 ストームエメラルダ 3 3
 */

import {
  ADDITIONAL_RECORDED_DECKS,
  CYNTHIAS_GARCHOMP_DECLARATION,
  MEGA_RAYQUAZA_DECLARATION,
} from "../src/additional-recorded-decks.ts";
import { cardRecordTable } from "../src/card-record-table.ts";
import { type Declaration, resolveDeclaration } from "../src/declaration.ts";
import { buildDeck, type Goal } from "../src/engine.ts";
import { TALON_HUNT_GOAL } from "./issue22-comparison-targets.ts";
import {
  parseTraceRequest,
  runSearchTrialsOfSide,
  SEED,
} from "./run-search-trials.ts";

interface AdditionalDeckTarget {
  readonly deckCode: string;
  readonly declaration: Declaration;
  /** 宣言に入れない狙い。探索は目指さず、成立率だけを数える。 */
  readonly measuredGoals: readonly Goal[];
}

/**
 * 測るだけの狙いを集計の表に出す番。かぎづめハントは後攻 1 番目の番の狙いで、#22 の答え合わせでも 1・2 番目の番を
 * 締め切りにしている(issue22-comparison-targets.ts の rates)。
 */
const MEASURED_GOAL_TURNS: readonly number[] = [1, 2];

const ADDITIONAL_DECK_TARGETS: Readonly<Record<string, AdditionalDeckTarget>> =
  {
    "cynthias-garchomp": {
      deckCode: "6nNQgQ-y6q3om-9HnnLL",
      declaration: CYNTHIAS_GARCHOMP_DECLARATION,
      measuredGoals: [],
    },
    "mega-rayquaza": {
      deckCode: "xcGKc8-NGuFdn-D8c88x",
      declaration: MEGA_RAYQUAZA_DECLARATION,
      measuredGoals: [TALON_HUNT_GOAL],
    },
  };

function findAdditionalDeckTarget(deckName: string): AdditionalDeckTarget {
  const target = ADDITIONAL_DECK_TARGETS[deckName];
  if (target === undefined) {
    throw new Error(
      `デッキの名前を渡す(${Object.keys(ADDITIONAL_DECK_TARGETS).join("、")})`
    );
  }
  return target;
}

function main(argv: readonly string[]): void {
  const target = findAdditionalDeckTarget(argv[0] ?? "");
  const deck = ADDITIONAL_RECORDED_DECKS.find(
    (entry) => entry.deckCode === target.deckCode
  );
  if (deck === undefined) {
    throw new Error(`デッキ ${target.deckCode} が無い`);
  }
  const trials = Number(argv[1] ?? "20000");
  const resolved = resolveDeclaration(target.declaration, cardRecordTable);
  const sideOptions = {
    deckCards: buildDeck(cardRecordTable, deck.decklist),
    goals: [...target.measuredGoals, ...resolved.goals],
    resolved,
    summaryDeadlines: [
      ...target.measuredGoals.flatMap((goal) =>
        MEASURED_GOAL_TURNS.map((turn) => ({ goal: goal.name, turn }))
      ),
      ...resolved.goals.flatMap((goal) =>
        resolved.deadlines.map((turn) => ({ goal: goal.name, turn }))
      ),
    ],
    traceRequest: parseTraceRequest(argv.slice(2)),
    trials,
  };
  console.log(
    `## ${deck.name}(${deck.deckCode})、道の揃い具合を見る評価、先攻・後攻 ${trials} 回ずつ(乱数の種 ${SEED})\n`
  );
  runSearchTrialsOfSide({ ...sideOptions, wentFirst: true });
  runSearchTrialsOfSide({ ...sideOptions, wentFirst: false });
}

main(process.argv.slice(2));
