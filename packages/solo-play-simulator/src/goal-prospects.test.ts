import { describe, expect, test } from "bun:test";
import { cardRecordTable } from "./card-record-table.ts";
import { buildRecordedCard, buildState } from "./card-test-support.ts";
import { type Declaration, resolveDeclaration } from "./declaration.ts";
import { GoalProspects, scoreGoalsByPathProgress } from "./goal-prospects.ts";
import type { TurnStage } from "./search-policy.ts";
import type { GameState } from "./state.ts";

// ラルトス(たね)、キルリア(1進化)、メガサーナイトex(2進化、ワザ「メガシンフォニア」)、ふしぎなアメ。記録 049714、
// 049715、048464、050462
const RALTS = buildRecordedCard("049714");
const KIRLIA = buildRecordedCard("049715");
const MEGA_GARDEVOIR = buildRecordedCard("048464");
const RARE_CANDY = buildRecordedCard("050462");

/** メガサーナイトex の宣言のうち、道を 1 本だけにしたもの。道ごとの見込みをほかの道に混ぜずに見るため。 */
function resolveDeclarationWithPath(
  requiredCards: Declaration["pathsToMainAttacker"][number]["requiredCards"]
) {
  return resolveDeclaration(
    {
      deadlines: [2, 3],
      mainAttacks: [{ attackName: "メガシンフォニア", cardId: "048464" }],
      minimumDamage: 300,
      pathsToMainAttacker: [{ name: "調べる道", requiredCards }],
    } satisfies Declaration,
    cardRecordTable
  );
}

const PLAIN_EVOLUTION = resolveDeclarationWithPath([
  { cardId: "049715", place: "inPlaySincePreviousTurn" },
  { cardId: "048464", place: "hand" },
]);

const RARE_CANDY_PATH = resolveDeclarationWithPath([
  { cardId: "050462", place: "hand" },
  { cardId: "048464", place: "hand" },
  { cardId: "049714", place: "inPlaySincePreviousTurn" },
]);

function createProspects(
  declaration: ReturnType<typeof resolveDeclarationWithPath>,
  state: GameState,
  stage: TurnStage = "actionsRemain"
): GoalProspects {
  return new GoalProspects(declaration, {
    fromTurn: state.turn,
    seed: 0,
    stage,
    state,
    statistics: { clones: 0, evaluations: 0 },
  });
}

describe("締め切りごとの見込み(前の番から場)", () => {
  // 場に出たばかり・進化したばかりの番は進化できず、両者とも自分の最初の番は進化できない(docs/pokemon-tcg/basic-rules.md 77 行)
  test("この番に手札のキルリアで進化させたキルリアは、この番の締め切りでは前の番から場に数えず、次の番の締め切りでは数える", () => {
    const state = buildState({ active: KIRLIA, hand: [MEGA_GARDEVOIR] });
    const kirlia = state.active;
    kirlia?.underneath.push(RALTS);
    if (kirlia !== undefined) {
      kirlia.turnEvolved = state.turn;
    }
    const prospects = createProspects(PLAIN_EVOLUTION, state);
    expect(prospects.calculateStandProspect("thisTurn")).toBe(0);
    expect(prospects.calculateStandProspect("laterTurn")).toBe(1);
  });

  test("自分の最初の番は、前の番から場にいるたねポケモンでも、この番の締め切りでは進化の元に数えない", () => {
    const firstTurn = buildState({
      active: RALTS,
      hand: [RARE_CANDY, MEGA_GARDEVOIR],
      turn: 1,
    });
    const secondTurn = buildState({
      active: RALTS,
      hand: [RARE_CANDY, MEGA_GARDEVOIR],
      turn: 2,
    });
    expect(
      createProspects(RARE_CANDY_PATH, firstTurn).calculateStandProspect(
        "thisTurn"
      )
    ).toBe(0);
    expect(
      createProspects(RARE_CANDY_PATH, secondTurn).calculateStandProspect(
        "thisTurn"
      )
    ).toBe(1);
  });

  test("次の番の締め切りでは、手札の進化の元を手札にある重み 0.8 に数え、この番の締め切りでは 0 に数える", () => {
    const state = buildState({ active: RALTS, hand: [KIRLIA, MEGA_GARDEVOIR] });
    const prospects = createProspects(PLAIN_EVOLUTION, state);
    expect(prospects.calculateStandProspect("laterTurn")).toBeCloseTo(0.8, 9);
    expect(prospects.calculateStandProspect("thisTurn")).toBe(0);
  });
});

describe("番を終えるときの点", () => {
  // Issue 51 の決定事項 2026-10-18: 「番を終える」を試すときは、この番の締め切りの成り立っていない狙いの見込みを 0 にする
  test("番を終えるときは、この番の締め切りの成り立っていない狙いを 0 に数え、次の番の締め切りはそのまま数える", () => {
    // キルリアは前の番から場にいて、メガサーナイトex は山札にある(引けば、この番のうちに進化させられる)
    const state = buildState({ active: KIRLIA, deck: [MEGA_GARDEVOIR] });
    const actionsDone = createProspects(PLAIN_EVOLUTION, state, "actionsDone");
    const actionsRemain = createProspects(
      PLAIN_EVOLUTION,
      state,
      "actionsRemain"
    );
    expect(scoreGoalsByPathProgress(PLAIN_EVOLUTION, actionsDone, 2)).toEqual([
      0, 0, 0,
    ]);
    for (const score of scoreGoalsByPathProgress(
      PLAIN_EVOLUTION,
      actionsRemain,
      2
    )) {
      expect(score).toBeGreaterThan(0);
    }
    expect(scoreGoalsByPathProgress(PLAIN_EVOLUTION, actionsDone, 3)).toEqual(
      scoreGoalsByPathProgress(PLAIN_EVOLUTION, actionsRemain, 3)
    );
  });
});
