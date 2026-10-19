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
import { GoalProspects, PROGRESS_WEIGHTS } from "./goal-prospects.ts";
import {
  BAKEGAKURE_DECLARATION,
  DRAGAPULT_DECLARATION,
  MEGA_CHARIZARD_DECLARATION,
  MEGA_GARDEVOIR_DECLARATION,
} from "./issue22-decks.ts";
import type { TurnStage } from "./search-policy.ts";
import { type GameState, PokemonInPlay } from "./state.ts";

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
    expect(actionsDone.scoreGoals(2)).toEqual([0, 0, 0]);
    for (const score of actionsRemain.scoreGoals(2)) {
      expect(score).toBeGreaterThan(0);
    }
    expect(actionsDone.scoreGoals(3)).toEqual(actionsRemain.scoreGoals(3));
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
    deadline: number,
    stage: TurnStage = "actionsRemain"
  ): number {
    const { active } = state;
    if (active === undefined) {
      throw new Error("バトル場にポケモンがいない");
    }
    return createProspects(
      declaration,
      state,
      stage
    ).calculateAttackEnergyProspect(
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

  test("番を終えるときは、この番に手札からつける 1 回を数えず、次の番の締め切りで手札のエネルギーを 1 枚まで数える", () => {
    const state = buildState({
      active: MEGA_CHARIZARD_Y,
      deck: [BOSS_ORDERS],
      hand: [FIRE_ENERGY, FIRE_ENERGY, FIRE_ENERGY],
    });
    // サイドの基本超エネルギー 6 枚を除く。無色の要求を引くしかないで埋めないようにするため
    state.prizes.length = 0;
    expect(
      calculateActiveEnergyProspect(
        MEGA_CHARIZARD,
        "プロージョンY",
        state,
        3,
        "actionsDone"
      )
    ).toBeCloseTo(PROGRESS_WEIGHTS.energyInHand / 3, 9);
    expect(
      calculateActiveEnergyProspect(
        MEGA_CHARIZARD,
        "プロージョンY",
        state,
        3,
        "actionsRemain"
      )
    ).toBeCloseTo((2 * PROGRESS_WEIGHTS.energyInHand) / 3, 9);
  });

  test("この番に手札からつけた後は、この番の締め切りで、ひふきやろうで山札の基本炎エネルギーを持ってこられる見込みを数えず、手札に加えた後と同じ見込みになる", () => {
    const beforeFetching = buildState({
      active: MEGA_CHARIZARD_Y,
      deck: [FIRE_ENERGY, BOSS_ORDERS],
      hand: [FIRE_SPITTER],
    });
    const afterFetching = buildState({
      active: MEGA_CHARIZARD_Y,
      deck: [BOSS_ORDERS],
      hand: [FIRE_ENERGY],
    });
    afterFetching.hasUsedSupporter = true;
    for (const state of [beforeFetching, afterFetching]) {
      // サイドの基本超エネルギー 6 枚を除く。無色の要求を引くしかないで埋めないようにするため
      state.prizes.length = 0;
      state.active?.energies.push(FIRE_ENERGY);
      state.hasAttachedEnergy = true;
      expect(
        calculateActiveEnergyProspect(MEGA_CHARIZARD, "プロージョンY", state, 2)
      ).toBeCloseTo(1 / 3, 9);
    }
  });

  test("次の番の締め切りで手札からつけられる 2 回のうち 1 回を手札の基本炎エネルギーに使うと、山札から持ってこられる要求は残りの 1 回分だけ数える", () => {
    const state = buildState({
      active: MEGA_CHARIZARD_Y,
      deck: [FIRE_ENERGY, FIRE_ENERGY, BOSS_ORDERS],
      hand: [FIRE_ENERGY, FIRE_SPITTER],
    });
    // サイドの基本超エネルギー 6 枚を除く。無色の要求に合うエネルギーが増え、確かめたい形にならないため
    state.prizes.length = 0;
    // 要求は炎 2 個と無色 1 個。炎 1 個を手札の基本炎エネルギーで埋め、残りの炎と無色のうち、ひふきやろうで 1 段で
    // 持ってこられる 1 つだけを数え、引くしかない 1 つは手札からつける回数が残らないので数えない
    expect(
      calculateActiveEnergyProspect(MEGA_CHARIZARD, "プロージョンY", state, 3)
    ).toBeCloseTo(
      (PROGRESS_WEIGHTS.energyInHand + PROGRESS_WEIGHTS.searchableFromDeck) / 3,
      9
    );
  });

  // 手札からつけるのは 1 回の番に 1 枚(docs/pokemon-tcg/basic-rules.md 72 行)。アカマツ(記録 049412)は山札から違う
  // タイプの基本エネルギーを 2 枚まで選び、1 枚を手札に加え、残りを自分のポケモン(つける先の条件なし)につける。効果で
  // つけるのは手札からつける 1 回の制限に数えない(state.ts の attachEnergyByEffect)。ポケギア3.0(記録 049376)は
  // 山札の上 7 枚からサポートを手札に加える
  describe("効果でつけるアカマツ", () => {
    const AKAMATSU = buildRecordedCard("049412");
    const POKEGEAR = buildRecordedCard("049376");

    /** 3 番目の番、ドラパルトex に基本超エネルギー 1 個がついていて、この番に手札からつけ済みの場。 */
    function buildAfterAttachingOnThirdTurn(
      hand: readonly Card[],
      deck: readonly Card[]
    ): GameState {
      const state = buildState({ active: DRAGAPULT_EX, deck, hand, turn: 3 });
      // サイドの基本超エネルギー 6 枚(buildState が置く)を除き、見えていないカードを山札だけにする
      state.prizes.length = 0;
      state.active?.energies.push(PSYCHIC_ENERGY);
      state.hasAttachedEnergy = true;
      return state;
    }

    test("この番に手札からつけた後でも、この番の締め切りで、手札のアカマツで山札の基本炎エネルギーをつけられる要求は 1 段の重みで数え、ひふきやろうで手札に加える要求は数えない", () => {
      const withAkamatsu = buildAfterAttachingOnThirdTurn(
        [AKAMATSU],
        [PSYCHIC_ENERGY, FIRE_ENERGY, BOSS_ORDERS]
      );
      expect(
        calculateActiveEnergyProspect(
          DRAGAPULT,
          "ファントムダイブ",
          withAkamatsu,
          3
        )
      ).toBeCloseTo((1 + PROGRESS_WEIGHTS.searchableFromDeck) / 2, 9);
      const withFireSpitter = buildAfterAttachingOnThirdTurn(
        [FIRE_SPITTER],
        [PSYCHIC_ENERGY, FIRE_ENERGY, BOSS_ORDERS]
      );
      expect(
        calculateActiveEnergyProspect(
          DRAGAPULT,
          "ファントムダイブ",
          withFireSpitter,
          3
        )
      ).toBeCloseTo(1 / 2, 9);
    });

    test("この番に手札からつけた後でも、この番の締め切りで、手札のポケギア3.0で山札のアカマツを手札に加えて基本炎エネルギーをつけられる要求は 2 段の重みで数える", () => {
      const state = buildAfterAttachingOnThirdTurn(
        [POKEGEAR],
        [AKAMATSU, PSYCHIC_ENERGY, FIRE_ENERGY, BOSS_ORDERS]
      );
      expect(
        calculateActiveEnergyProspect(DRAGAPULT, "ファントムダイブ", state, 3)
      ).toBeCloseTo((1 + PROGRESS_WEIGHTS.searchableInTwoSteps) / 2, 9);
    });

    // 山札の基本炎エネルギーは 1 枚で、手札に加える 1 段(効果でつけない)とアカマツでつける 2 段が取り合う。この番に
    // 手札からつけ済みなので、手札に加えても手札からはつけられない(basic-rules.md 72 行)
    test("この番に手札からつけた後は、手札のひふきやろうで山札の基本炎エネルギーを手札に加えられても、手札のポケギア3.0で山札のアカマツを手札に加えて基本炎エネルギーをつけられる要求を 2 段の重みで数える", () => {
      const state = buildAfterAttachingOnThirdTurn(
        [POKEGEAR, FIRE_SPITTER],
        [AKAMATSU, PSYCHIC_ENERGY, FIRE_ENERGY, BOSS_ORDERS]
      );
      expect(
        calculateActiveEnergyProspect(DRAGAPULT, "ファントムダイブ", state, 3)
      ).toBeCloseTo((1 + PROGRESS_WEIGHTS.searchableInTwoSteps) / 2, 9);
    });

    describe("ベンチのドロンチ", () => {
      // ニャースex(手札からベンチに出したとき、特性「おくのてキャッチ」で山札のサポートを手札に加える)、ドロンチ(場で使う
      // 特性「ていさつしれい」で山札の上 2 枚から 1 枚を手札に加える。条件が無く、どのカードも持ってこられる)。記録
      // 049694、049263
      const MEOWTH_EX = buildRecordedCard("049694");
      const DRAKLOAK = buildRecordedCard("049263");

      function buildWithBenchedDrakloak(hand: readonly Card[]): GameState {
        const state = buildAfterAttachingOnThirdTurn(hand, [
          AKAMATSU,
          PSYCHIC_ENERGY,
          FIRE_ENERGY,
          BOSS_ORDERS,
        ]);
        state.bench.push(new PokemonInPlay(DRAKLOAK, 0));
        return state;
      }

      test("この番に手札からつけた後は、ていさつしれいで山札の基本炎エネルギーを手札に加えられても、手札のニャースexで山札のアカマツを手札に加えて基本炎エネルギーをつけられる要求を 2 段の重みで数える", () => {
        expect(
          calculateActiveEnergyProspect(
            DRAGAPULT,
            "ファントムダイブ",
            buildWithBenchedDrakloak([MEOWTH_EX]),
            3
          )
        ).toBeCloseTo((1 + PROGRESS_WEIGHTS.searchableInTwoSteps) / 2, 9);
      });

      test("この番に手札からつけた後は、手札に探す手段が無くても、ていさつしれいで山札のアカマツを手札に加えて基本炎エネルギーをつけられる要求を 2 段の重みで数える", () => {
        expect(
          calculateActiveEnergyProspect(
            DRAGAPULT,
            "ファントムダイブ",
            buildWithBenchedDrakloak([]),
            3
          )
        ).toBeCloseTo((1 + PROGRESS_WEIGHTS.searchableInTwoSteps) / 2, 9);
      });
    });
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

describe("バトル場に出せる見込み", () => {
  // ニャースex(たね、にげる 1)、ポケモンいれかえ(バトルポケモンをベンチポケモンと入れ替える)、スグリ(サポート。効果の中で
  // バトルポケモンをベンチポケモンと入れ替える)、ポケギア3.0(山札の上から 7 枚を見て、サポートを 1 枚まで手札に加える)、
  // 基本超エネルギー、ボスの指令(効果の翻訳が無い)。記録 049694、049602、047894、049376、049463、050467
  const MEOWTH_EX = buildRecordedCard("049694");
  const SWITCH = buildRecordedCard("049602");
  const KIERAN = buildRecordedCard("047894");
  const POKEGEAR = buildRecordedCard("049376");
  const PSYCHIC_ENERGY = buildRecordedCard("049463");
  const BOSS_ORDERS = buildRecordedCard("050467");
  const MEGA_GARDEVOIR_DECK = resolveDeclaration(
    MEGA_GARDEVOIR_DECLARATION,
    cardRecordTable
  );

  /** バトル場にエネルギー 0 個のニャースex(にげるエネルギーを払えない)、ベンチにメガサーナイトex がいる場。 */
  function buildBenchedMegaGardevoir(
    hand: readonly Card[],
    deck: readonly Card[]
  ): GameState {
    return buildState({
      active: MEOWTH_EX,
      bench: [MEGA_GARDEVOIR],
      deck,
      hand,
    });
  }

  function calculateBenchProspect(state: GameState): number {
    const [benched] = state.bench;
    if (benched === undefined) {
      throw new Error("ベンチにポケモンがいない");
    }
    return createProspects(
      MEGA_GARDEVOIR_DECK,
      state
    ).calculateActiveSpotProspect(benched);
  }

  test("ベンチの主軸は、手札にポケモンいれかえがあれば、この番にバトル場に出す手段がある重みになる", () => {
    const state = buildBenchedMegaGardevoir([SWITCH], [BOSS_ORDERS]);
    expect(calculateBenchProspect(state)).toBe(
      PROGRESS_WEIGHTS.benchedWithWayToActiveThisTurn
    );
  });

  // サポートは 1 回の番に 1 枚だけ(docs/pokemon-tcg/basic-rules.md 75 行)。Issue 51 の数え漏れ 4 は「手札に入れ替える
  // カードがある」で数えると決めている
  test("この番にサポートを使った後でも、手札にスグリがあれば、この番にバトル場に出す手段がある重みになる", () => {
    const state = buildBenchedMegaGardevoir([KIERAN], [BOSS_ORDERS]);
    state.hasUsedSupporter = true;
    expect(calculateBenchProspect(state)).toBe(
      PROGRESS_WEIGHTS.benchedWithWayToActiveThisTurn
    );
  });

  test("この番にサポートを使った後の手札のスグリは、山札のスグリを手札のポケギア3.0で持ってこられるときより低い重みにならない", () => {
    const bakegakure = resolveDeclaration(
      BAKEGAKURE_DECLARATION,
      cardRecordTable
    );
    // バトル場にエネルギー 0 個のニャースex(にげるエネルギーを払えない)、ベンチにダダリン(主軸。記録 050308)
    const buildBenchedDhelmise = (
      hand: readonly Card[],
      deck: readonly Card[]
    ) => {
      const state = buildState({
        active: MEOWTH_EX,
        bench: [buildRecordedCard("050308")],
        deck,
        hand,
      });
      state.hasUsedSupporter = true;
      return state;
    };
    const calculateDhelmiseProspect = (state: GameState) => {
      const [benched] = state.bench;
      if (benched === undefined) {
        throw new Error("ベンチにポケモンがいない");
      }
      return createProspects(bakegakure, state).calculateActiveSpotProspect(
        benched
      );
    };
    const inHand = calculateDhelmiseProspect(
      buildBenchedDhelmise([KIERAN], [BOSS_ORDERS])
    );
    const inDeck = calculateDhelmiseProspect(
      buildBenchedDhelmise([POKEGEAR], [KIERAN, BOSS_ORDERS])
    );
    expect(inHand).toBe(PROGRESS_WEIGHTS.benchedWithWayToActiveThisTurn);
    expect(inDeck).toBe(PROGRESS_WEIGHTS.switchCardSearchable);
  });

  // にげるエネルギーの分のエネルギーをトラッシュして、ベンチポケモンと交代する(docs/pokemon-tcg/basic-rules.md 79 行)
  test("ベンチの主軸は、バトルポケモンのニャースex がにげるエネルギーを払えれば、この番にバトル場に出す手段がある重みになる", () => {
    const state = buildBenchedMegaGardevoir([BOSS_ORDERS], [BOSS_ORDERS]);
    state.active?.energies.push(PSYCHIC_ENERGY);
    expect(calculateBenchProspect(state)).toBe(
      PROGRESS_WEIGHTS.benchedWithWayToActiveThisTurn
    );
  });

  test("手札に入れ替えるカードが無く、山札のスグリを手札のポケギア3.0で持ってこられるとき、探して持ってこられる重みになる", () => {
    const state = buildBenchedMegaGardevoir([POKEGEAR], [KIERAN, BOSS_ORDERS]);
    expect(calculateBenchProspect(state)).toBe(
      PROGRESS_WEIGHTS.switchCardSearchable
    );
  });

  test("手札にも探して持ってこられる入れ替えるカードも無く、バトルポケモンがにげられないとき、手段が見当たらない重みになる", () => {
    const state = buildBenchedMegaGardevoir(
      [BOSS_ORDERS],
      [KIERAN, BOSS_ORDERS]
    );
    expect(calculateBenchProspect(state)).toBe(PROGRESS_WEIGHTS.noWayToActive);
  });

  // 対戦の準備: 手札のたねポケモン 1 枚をバトル場に、残りをベンチに出せる(docs/pokemon-tcg/basic-rules.md 43〜44 行)。
  // ダダリン(たね、にげる 3)、カゲボウズ(たね、にげる 1)。記録 050308、050250
  test("対戦の準備でバトル場に置いたダダリンは 1 で、ベンチに置いたダダリンはにげられないカゲボウズの後ろで手段が見当たらない", () => {
    const dhelmise = buildRecordedCard("050308");
    const shuppet = buildRecordedCard("050250");
    const bakegakure = resolveDeclaration(
      BAKEGAKURE_DECLARATION,
      cardRecordTable
    );
    const createSetupProspects = (state: GameState) =>
      new GoalProspects(bakegakure, {
        fromTurn: 1,
        seed: 0,
        stage: "actionsRemain",
        state,
        statistics: { clones: 0, evaluations: 0 },
      });
    const dhelmiseActive = buildState({
      active: dhelmise,
      bench: [shuppet],
      deck: [BOSS_ORDERS],
      turn: 0,
    });
    const shuppetActive = buildState({
      active: shuppet,
      bench: [dhelmise],
      deck: [BOSS_ORDERS],
      turn: 0,
    });
    const [benchedDhelmise] = shuppetActive.bench;
    if (dhelmiseActive.active === undefined || benchedDhelmise === undefined) {
      throw new Error("場が作れていない");
    }
    expect(
      createSetupProspects(dhelmiseActive).calculateActiveSpotProspect(
        dhelmiseActive.active
      )
    ).toBe(1);
    expect(
      createSetupProspects(shuppetActive).calculateActiveSpotProspect(
        benchedDhelmise
      )
    ).toBe(PROGRESS_WEIGHTS.noWayToActive);
  });

  test("打てるの見込みは、立つ見込み・エネルギーの見込み・バトル場に出せる見込みの平均になる", () => {
    // メガサーナイトex は立っていて、メガシンフォニア(超 1 個。記録 048464)のエネルギーはついている。ベンチにいて、手札の
    // ポケモンいれかえでバトル場に出せる
    const state = buildBenchedMegaGardevoir([SWITCH], [BOSS_ORDERS]);
    state.bench[0]?.energies.push(PSYCHIC_ENERGY);
    const prospects = createProspects(MEGA_GARDEVOIR_DECK, state);
    expect(prospects.isGoalAchieved(0)).toBe(true);
    expect(prospects.isGoalAchieved(1)).toBe(false);
    expect(prospects.calculateAttackProspect(3)).toBeCloseTo(
      (1 + 1 + PROGRESS_WEIGHTS.benchedWithWayToActiveThisTurn) / 3,
      9
    );
  });
});

describe("主軸の系統のほかのワザを試した後の見込み", () => {
  // メガサーナイトex のワザ「あふれるねがい」(超 1 個。山札の基本超エネルギーを、ベンチのポケモンそれぞれに 1 枚ずつ
  // つける)と「メガシンフォニア」(超 1 個。自分の場の超エネルギー 1 個につき 50)、基本超エネルギー。記録 048464、049463
  const PSYCHIC_ENERGY = buildRecordedCard("049463");
  const MEGA_GARDEVOIR_DECK = resolveDeclaration(
    MEGA_GARDEVOIR_DECLARATION,
    cardRecordTable
  );

  /**
   * 2 番目の番。バトル場に基本超エネルギー 1 個のメガサーナイトex、ベンチにラルトス 3 匹。buildState はサイドに基本超
   * エネルギー 6 枚を置くので、見えていないカードはすべて基本超エネルギーで、混ぜ直しの仕方によらず 3 匹すべてにつく。
   */
  function buildMegaGardevoirWithThreeBenched(): GameState {
    const state = buildState({
      active: MEGA_GARDEVOIR,
      bench: [RALTS, RALTS, RALTS],
      deck: Array.from({ length: 6 }, () => PSYCHIC_ENERGY),
      turn: 2,
    });
    state.active?.energies.push(PSYCHIC_ENERGY);
    return state;
  }

  test("ベンチ 3 匹のとき、次の番の締め切りの 3 段目は、あふれるねがいを試した後の場(場の超エネルギー 4 個で 200)で数える", () => {
    const prospects = createProspects(
      MEGA_GARDEVOIR_DECK,
      buildMegaGardevoirWithThreeBenched()
    );
    expect(prospects.isGoalAchieved(1)).toBe(true);
    expect(prospects.isGoalAchieved(2)).toBe(false);
    // 試す前の場ではメガシンフォニアが 50(超エネルギー 1 個)で、下限 300 に対して 50 ÷ 300
    expect(prospects.calculateDamageRatio()).toBeCloseTo(50 / 300, 9);
    const [afterWish] = prospects.listProspectsAfterNonMainAttacks();
    expect(afterWish?.calculateDamageRatio()).toBeCloseTo(200 / 300, 9);
    expect(prospects.scoreGoals(3)[2]).toBeCloseTo(
      (PROGRESS_WEIGHTS.unachievedGoal * (1 + 200 / 300)) / 2,
      9
    );
  });

  test("この番の締め切りの 3 段目は、あふれるねがいを試した後の場を使わず、今の場(50)で数える", () => {
    const prospects = createProspects(
      MEGA_GARDEVOIR_DECK,
      buildMegaGardevoirWithThreeBenched()
    );
    expect(prospects.scoreGoals(2)[2]).toBeCloseTo(
      (PROGRESS_WEIGHTS.unachievedGoal * (1 + 50 / 300)) / 2,
      9
    );
  });
});
