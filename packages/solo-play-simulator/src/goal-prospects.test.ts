import { describe, expect, test } from "bun:test";
import { cardRecordTable } from "./card-record-table.ts";
import { buildRecordedCard, buildState } from "./card-test-support.ts";
import type { Card } from "./cards.ts";
import {
  type Declaration,
  type MainAttack,
  type ResolvedDeclaration,
  resolveDeclaration,
} from "./declaration.ts";
import {
  GoalProspects,
  PROGRESS_WEIGHTS,
  scoreGoalsByPathProgress,
} from "./goal-prospects.ts";
import {
  DRAGAPULT_DECLARATION,
  MEGA_CHARIZARD_DECLARATION,
} from "./issue22-decks.ts";
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
  declaration: ResolvedDeclaration,
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

describe("探す手段 1 枚は 1 枚分", () => {
  // ドロンチ(1進化)、ドラパルトex(2進化、ワザ「ファントムダイブ」)、ハイパーボール(手札を 2 枚トラッシュし、山札から
  // ポケモン 1 枚を手札に加える)、ボスの指令(効果の翻訳が無い)。記録 049263、049264、050461、050467
  const DRAKLOAK = buildRecordedCard("049263");
  const DRAGAPULT_EX = buildRecordedCard("049264");
  const HYPER_BALL = buildRecordedCard("050461");
  const BOSS_ORDERS = buildRecordedCard("050467");
  // ドラパルトex の宣言(issue22-decks.ts の DRAGAPULT_DECLARATION)の素の進化の道だけ
  const DRAGAPULT_PLAIN_EVOLUTION = resolveDeclaration(
    {
      deadlines: [2, 3],
      mainAttacks: [{ attackName: "ファントムダイブ", cardId: "049264" }],
      pathsToMainAttacker: [
        {
          name: "素の進化の道",
          requiredCards: [
            { cardId: "049263", place: "inPlaySincePreviousTurn" },
            { cardId: "049264", place: "hand" },
          ],
        },
      ],
    } satisfies Declaration,
    cardRecordTable
  );

  test("次の番の締め切りで、ハイパーボールを使ってドラパルトex を手札に加えた後の素の進化の道の見込みは、使う前を下回らない", () => {
    // 使う前: 手札のハイパーボール 1 枚をドロンチとドラパルトex の一方にだけ割り当て、他方は引くしかない
    const before = buildState({
      deck: [DRAKLOAK, DRAGAPULT_EX],
      hand: [HYPER_BALL, BOSS_ORDERS, BOSS_ORDERS],
    });
    // 使った後: 手札の 2 枚をトラッシュし、ドラパルトex が手札に来た。ドロンチは引くしかない
    const after = buildState({
      deck: [DRAKLOAK],
      discard: [HYPER_BALL, BOSS_ORDERS, BOSS_ORDERS],
      hand: [DRAGAPULT_EX],
    });
    const beforeProspect = createProspects(
      DRAGAPULT_PLAIN_EVOLUTION,
      before
    ).calculateStandProspect("laterTurn");
    const afterProspect = createProspects(
      DRAGAPULT_PLAIN_EVOLUTION,
      after
    ).calculateStandProspect("laterTurn");
    expect(beforeProspect).toBeCloseTo(
      PROGRESS_WEIGHTS.searchableFromDeck * PROGRESS_WEIGHTS.drawOnly,
      9
    );
    expect(afterProspect).toBeCloseTo(PROGRESS_WEIGHTS.drawOnly, 9);
    expect(afterProspect).toBeGreaterThanOrEqual(beforeProspect);
  });
});

describe("ワザのエネルギーの見込み(置き場所とタイプ)", () => {
  // ドラパルトex(2進化、ワザ「ファントムダイブ」は炎 1 個と超 1 個)、基本炎エネルギー、基本超エネルギー、ボスの指令(効果の
  // 翻訳が無い)。記録 049264、050746、049463、050467
  const DRAGAPULT_EX = buildRecordedCard("049264");
  const FIRE_ENERGY = buildRecordedCard("050746");
  const PSYCHIC_ENERGY = buildRecordedCard("049463");
  const BOSS_ORDERS = buildRecordedCard("050467");
  // メガリザードンYex(2進化、ワザ「プロージョンY」は炎 2 個と無色 1 個)、ひふきやろう(サポート。山札の基本炎エネルギーを
  // 手札に加える)、イグニッションエネルギー(進化ポケモンについている間、無色 3 個)。記録 049482、048418、049452
  const MEGA_CHARIZARD_Y = buildRecordedCard("049482");
  const FIRE_SPITTER = buildRecordedCard("048418");
  const IGNITION_ENERGY = buildRecordedCard("049452");
  const DRAGAPULT = resolveDeclaration(DRAGAPULT_DECLARATION, cardRecordTable);
  const MEGA_CHARIZARD = resolveDeclaration(
    MEGA_CHARIZARD_DECLARATION,
    cardRecordTable
  );

  function findMainAttack(
    declaration: ResolvedDeclaration,
    attackName: string
  ): MainAttack {
    const main = declaration.mainAttacks.find(
      ({ attack }) => attack.name === attackName
    );
    if (main === undefined) {
      throw new Error(`宣言に主軸のワザ ${attackName} が無い`);
    }
    return main;
  }

  /** バトルポケモンが main を使うためのエネルギーの見込み。 */
  function calculateActiveEnergyProspect(
    declaration: ResolvedDeclaration,
    attackName: string,
    state: GameState,
    deadline: number
  ): number {
    const { active } = state;
    if (active === undefined) {
      throw new Error("バトル場にポケモンがいない");
    }
    return createProspects(declaration, state).calculateAttackEnergyProspect(
      findMainAttack(declaration, attackName),
      active,
      deadline
    );
  }

  /** ドラパルトex がバトル場にいて、基本超エネルギー 1 個がついている場。 */
  function buildDragapultWithPsychic(
    hand: readonly Card[],
    deck: readonly Card[]
  ): GameState {
    const state = buildState({ active: DRAGAPULT_EX, deck, hand });
    state.active?.energies.push(PSYCHIC_ENERGY);
    return state;
  }

  test("炎と超が要るワザで超 1 個がついているとき、手札の基本炎エネルギーで炎を埋め、手札の基本超エネルギーでは埋めない", () => {
    const withFire = buildDragapultWithPsychic(
      [PSYCHIC_ENERGY, FIRE_ENERGY],
      [BOSS_ORDERS]
    );
    expect(
      calculateActiveEnergyProspect(DRAGAPULT, "ファントムダイブ", withFire, 2)
    ).toBeCloseTo((1 + PROGRESS_WEIGHTS.energyInHand) / 2, 9);
    // 手札は基本超エネルギーだけで、基本炎エネルギーは山札にあり、探す手段が無い
    const withoutFire = buildDragapultWithPsychic(
      [PSYCHIC_ENERGY],
      [FIRE_ENERGY, BOSS_ORDERS]
    );
    expect(
      calculateActiveEnergyProspect(
        DRAGAPULT,
        "ファントムダイブ",
        withoutFire,
        2
      )
    ).toBeCloseTo((1 + PROGRESS_WEIGHTS.drawOnly) / 2, 9);
  });

  // 手札からエネルギーをつけるのは 1 回の番に 1 枚だけ(docs/pokemon-tcg/basic-rules.md 72 行)
  test("この番に手札からつけた後は、この番の締め切りでは手札のエネルギーを数えず、次の番の締め切りでは数える", () => {
    // 山札にもサイドにも基本炎エネルギーが無いので、手札の基本炎エネルギーを数えなければ炎の要求は 0
    const state = buildDragapultWithPsychic([FIRE_ENERGY], [BOSS_ORDERS]);
    state.hasAttachedEnergy = true;
    expect(
      calculateActiveEnergyProspect(DRAGAPULT, "ファントムダイブ", state, 2)
    ).toBeCloseTo(1 / 2, 9);
    expect(
      calculateActiveEnergyProspect(DRAGAPULT, "ファントムダイブ", state, 3)
    ).toBeCloseTo((1 + PROGRESS_WEIGHTS.energyInHand) / 2, 9);
  });

  test("次の番の締め切りでは手札のエネルギーを 2 枚まで数え、この番の締め切りでは 1 枚まで数える", () => {
    const state = buildState({
      active: MEGA_CHARIZARD_Y,
      deck: [BOSS_ORDERS],
      hand: [FIRE_ENERGY, FIRE_ENERGY, FIRE_ENERGY],
    });
    // サイドの基本超エネルギー 6 枚(buildState が置く)を除き、無色の要求を引くしかないで埋めないようにする
    state.prizes.length = 0;
    expect(
      calculateActiveEnergyProspect(MEGA_CHARIZARD, "プロージョンY", state, 3)
    ).toBeCloseTo((2 * PROGRESS_WEIGHTS.energyInHand) / 3, 9);
    expect(
      calculateActiveEnergyProspect(MEGA_CHARIZARD, "プロージョンY", state, 2)
    ).toBeCloseTo(PROGRESS_WEIGHTS.energyInHand / 3, 9);
  });

  test("見えていない基本炎エネルギーが 1 枚なら、ひふきやろうが 2 枚あっても、山札から持ってこられる要求は 1 つ", () => {
    const state = buildState({
      active: MEGA_CHARIZARD_Y,
      deck: [FIRE_ENERGY, IGNITION_ENERGY, BOSS_ORDERS, BOSS_ORDERS],
      hand: [FIRE_SPITTER, FIRE_SPITTER, BOSS_ORDERS],
    });
    // サイドの基本超エネルギー 6 枚を除く。無色の要求に合うエネルギーが増え、確かめたい形にならないため
    state.prizes.length = 0;
    state.active?.energies.push(FIRE_ENERGY);
    // 残りの要求は炎と無色。炎は基本炎エネルギーを 1 段、無色はイグニッションエネルギーを引くしかない(ひふきやろうは
    // 基本エネルギーだけを持ってくる)。2 つとも同じ基本炎エネルギーを 1 段に数えると、1 段の重みを 2 回足すことになる
    expect(
      calculateActiveEnergyProspect(MEGA_CHARIZARD, "プロージョンY", state, 3)
    ).toBeCloseTo(
      (1 + PROGRESS_WEIGHTS.searchableFromDeck + PROGRESS_WEIGHTS.drawOnly) / 3,
      9
    );
  });
});
