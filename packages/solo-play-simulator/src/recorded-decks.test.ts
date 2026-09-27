/**
 * 記録をそろえたデッキ(Issue 22 の 4 デッキと、規則ファイルの無い開発責任者の 2 デッキ)を、カードの記録だけで
 * 組み立てて回す。今できる行動の一覧(player-actions.ts)から行動を選ぶ 2 つの手順で、翻訳した効果と一覧の行動が
 * 基本ルールに反さずに最後まで動くかを確かめる(効果の中の選択は候補の先頭から選ぶ)。
 */

import { describe, expect, test } from "bun:test";
import { listUsableAttacksOfActive } from "./card-effects.ts";
import { cardRecordTable } from "./card-record-table.ts";
import { DECKS_WITHOUT_RULE_FILES } from "./decks-without-rule-files.ts";
import { type EffectContext, firstCandidateChoices } from "./effect-choices.ts";
import { buildDeck, type PlayingPolicy, runGame } from "./engine.ts";
import { ISSUE22_DECKS } from "./issue22-decks.ts";
import {
  listAvailableActions,
  type PlayerAction,
  performAction,
} from "./player-actions.ts";
import { createSeededRandom } from "./random.ts";

const MAX_ACTIONS_PER_TURN = 200;

/** 番の中で、pickAction が選んだ行動を「番を終える」が選ばれるまで行う判断基準。 */
function createListDrivenPolicy(
  pickAction: (actions: readonly PlayerAction[]) => PlayerAction
): PlayingPolicy {
  return {
    ...firstCandidateChoices,
    chooseActiveAtSetup: (_, [first]) => {
      if (first === undefined) {
        throw new Error("たねポケモンが無い");
      }
      return first;
    },
    chooseAttack: (context) => listUsableAttacksOfActive(context)[0] ?? null,
    chooseBenchAtSetup: (_, basics) => basics,
    playTurn: (context: EffectContext) => {
      for (let count = 0; count < MAX_ACTIONS_PER_TURN; count += 1) {
        const action = pickAction(listAvailableActions(context));
        if (action.kind === "endTurn") {
          return;
        }
        performAction(context, action);
      }
      throw new Error("1 つの番の行動が多すぎる(同じ行動を繰り返している)");
    },
  };
}

/** 一覧の先頭の行動を片端から行う(番を終えるのは、ほかにできる行動が無いとき)。 */
const firstActionPolicy = createListDrivenPolicy(([first]) => {
  if (first === undefined) {
    throw new Error("今できる行動の一覧が空");
  }
  return first;
});

/** 一覧から乱数で 1 つ選ぶ(番を終えるも候補に含む)。一覧のどの行動も基本ルールに反さず行えるかを広く試す。 */
function createRandomActionPolicy(seed: number): PlayingPolicy {
  const random = createSeededRandom(seed);
  return createListDrivenPolicy((actions) => {
    const action = actions[Math.floor(random.nextFloat() * actions.length)];
    if (action === undefined) {
      throw new Error("今できる行動の一覧が空");
    }
    return action;
  });
}

describe("記録をそろえたデッキ", () => {
  for (const deck of [...ISSUE22_DECKS, ...DECKS_WITHOUT_RULE_FILES]) {
    test(`${deck.name}: 60 枚すべてをカードの記録から組み立てられる`, () => {
      expect(buildDeck(cardRecordTable, deck.decklist)).toHaveLength(60);
    });

    for (const [label, policy] of [
      ["一覧の先頭の行動を片端から行う手順", firstActionPolicy],
      ["一覧から乱数で行動を選ぶ手順", createRandomActionPolicy(20_260_926)],
    ] as const) {
      test(`${deck.name}: ${label}で、先攻・後攻とも 100 回ずつ 3 番目の番まで回せる`, () => {
        const cards = buildDeck(cardRecordTable, deck.decklist);
        const random = createSeededRandom(20_260_923);
        for (const wentFirst of [true, false]) {
          for (let game = 0; game < 100; game += 1) {
            const result = runGame({
              cards,
              goals: [],
              maxTurn: 3,
              policy,
              random,
              wentFirst,
            });
            expect(result.events.at(-1)).toStartWith("[3] ");
          }
        }
      });
    }
  }
});
