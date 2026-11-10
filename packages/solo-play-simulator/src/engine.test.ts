import { describe, expect, test } from "bun:test";
import {
  attachEnergyFromHandToPokemon,
  evolvePokemonFromHand,
  listUsableAttacksOfActive,
} from "./card-effects.ts";
import { firstCandidateChoices } from "./effect-choices.ts";
import {
  applyVariant,
  buildDeck,
  type Decklist,
  MissingCardRecordsError,
  type PlayingPolicy,
  runBattleStyleSoloPlayGame,
  setupGame,
} from "./engine.ts";
import { createSeededRandom } from "./random.ts";
import {
  BASIC,
  ENERGY,
  FRAGILE_MEGA_BASIC,
  SAMPLE_RECORD_TABLE,
  STAGE1,
  STAGE2,
  STURDY_BASIC,
} from "./sample-cards.ts";
import { GameState, IllegalMove } from "./state.ts";

const BASICS_AND_ENERGIES: Decklist = [
  { cardId: BASIC.cardId, count: 4 },
  { cardId: ENERGY.cardId, count: 56 },
];

const STURDY_AND_ENERGIES: Decklist = [
  { cardId: STURDY_BASIC.cardId, count: 4 },
  { cardId: ENERGY.cardId, count: 56 },
];

/** 何もしない。対戦の準備では最初のたねをバトル場に出し、残りをベンチに並べる。 */
const idlePolicy: PlayingPolicy = {
  ...firstCandidateChoices,
  chooseActiveAtSetup: (_, [first]) => first ?? BASIC,
  chooseAttack: () => undefined,
  chooseBenchAtSetup: (_, basics) => basics,
  playTurn: () => undefined,
};

/** 何もせず、使えるワザがあれば一覧の先頭を使う。 */
const attackingPolicy: PlayingPolicy = {
  ...idlePolicy,
  chooseAttack: (context) => listUsableAttacksOfActive(context)[0],
};

/** 手札のエネルギーをバトル場につけ、進化できれば進化し、使えるワザを使う。 */
const evolvingPolicy: PlayingPolicy = {
  ...idlePolicy,
  chooseAttack: (context) => listUsableAttacksOfActive(context)[0],
  playTurn: (context) => {
    const { state } = context;
    const { active } = state;
    if (active === undefined) {
      return;
    }
    const energy = state.findFirstInHand(ENERGY.name);
    if (energy !== undefined) {
      attachEnergyFromHandToPokemon(context, energy, active);
    }
    for (const name of [STAGE1.name, STAGE2.name]) {
      const card = state.findFirstInHand(name);
      if (card !== undefined && state.canEvolve(active, card)) {
        evolvePokemonFromHand(context, active, card);
      }
    }
  },
};

describe("対戦の準備", () => {
  test("7 枚配ってサイドを 6 枚置き、残りが山札に残る", () => {
    const state = new GameState(
      createSeededRandom(1),
      buildDeck(SAMPLE_RECORD_TABLE, BASICS_AND_ENERGIES),
      true
    );
    setupGame(state, idlePolicy);
    expect(state.hand.length + state.listPokemonInPlay().length).toBe(7);
    expect(state.prizes).toHaveLength(6);
    expect(state.deck).toHaveLength(60 - 7 - 6);
  });

  test("たねポケモンが手札に来るまで引き直し、回数を数える", () => {
    const random = createSeededRandom(2);
    const cards = buildDeck(SAMPLE_RECORD_TABLE, [
      { cardId: BASIC.cardId, count: 1 },
      { cardId: ENERGY.cardId, count: 59 },
    ]);
    for (let game = 0; game < 50; game += 1) {
      const state = new GameState(random, cards, true);
      setupGame(state, idlePolicy);
      expect(state.active).not.toBeUndefined();
      if (state.mulligans > 0) {
        return;
      }
    }
    throw new Error(
      "たね 1 枚のデッキで 50 回とも引き直しが起きないのは不自然"
    );
  });
});

describe("60 枚の内容", () => {
  test("カードの記録とカード ID ごとの枚数から 60 枚を組み立て、同じカード ID は同じ参照を並べる", () => {
    const cards = buildDeck(SAMPLE_RECORD_TABLE, BASICS_AND_ENERGIES);
    expect(cards).toHaveLength(60);
    expect(cards[0]).toBe(cards[3]);
    expect(cards[0]?.cardId).toBe(BASIC.cardId);
  });

  test("記録の無いカード ID があれば、無いカード ID を全部示して組み立てない", () => {
    const build = () =>
      buildDeck(SAMPLE_RECORD_TABLE, [
        { cardId: "000001", count: 30 },
        { cardId: BASIC.cardId, count: 20 },
        { cardId: "000002", count: 10 },
      ]);
    expect(build).toThrow(MissingCardRecordsError);
    expect(build).toThrow("000001、000002");
  });
});

describe("枚数の変更", () => {
  test("合計を保った変更を適用し、負の枚数と合計の変化は退ける", () => {
    const changed = applyVariant(BASICS_AND_ENERGIES, {
      changes: { [BASIC.cardId]: -1, [ENERGY.cardId]: 1 },
      label: "x",
    });
    expect(changed).toEqual([
      { cardId: BASIC.cardId, count: 3 },
      { cardId: ENERGY.cardId, count: 57 },
    ]);
    expect(() =>
      applyVariant(BASICS_AND_ENERGIES, {
        changes: { [BASIC.cardId]: -1 },
        label: "y",
      })
    ).toThrow("y: 枚数の合計が元のデッキと違う");
    expect(() =>
      applyVariant(BASICS_AND_ENERGIES, {
        changes: { [BASIC.cardId]: -5, [ENERGY.cardId]: 5 },
        label: "z",
      })
    ).toThrow(`z: ${BASIC.cardId} の枚数が負になる`);
  });

  test("枚数が 0 になったカードは 60 枚の内容から消える", () => {
    const changed = applyVariant(BASICS_AND_ENERGIES, {
      changes: { [BASIC.cardId]: -4, [STAGE1.cardId]: 4 },
      label: "w",
    });
    expect(changed).toEqual([
      { cardId: ENERGY.cardId, count: 56 },
      { cardId: STAGE1.cardId, count: 4 },
    ]);
  });
});

describe("対戦の進行", () => {
  /** 自分の番の最初(引いた後)に、バトルポケモンにのっているダメージを記録する。 */
  function recordActiveDamageAtOwnTurns(wentFirst: boolean): {
    damages: number[];
    events: readonly string[];
  } {
    const damages: number[] = [];
    const result = runBattleStyleSoloPlayGame({
      cards: buildDeck(SAMPLE_RECORD_TABLE, STURDY_AND_ENERGIES),
      policy: {
        ...idlePolicy,
        playTurn: ({ state }) => {
          damages.push(state.active?.damage ?? Number.NaN);
        },
      },
      random: createSeededRandom(11),
      wentFirst,
    });
    return { damages, events: result.events };
  }

  /** 並びの隣り合う差。 */
  function differencesOf(values: readonly number[]): number[] {
    return values.slice(1).map((value, index) => value - (values[index] ?? 0));
  }

  test("先攻では自分の番の後に相手の番が来て、相手の 1〜5 回目の番にバトルポケモンが 0、100、200、300、300 のダメージを受ける", () => {
    const { damages, events } = recordActiveDamageAtOwnTurns(true);
    // 自分の 1 回目の番の最初は相手の番の前。自分の n + 1 回目の番の最初までの増分が、相手の n 回目の番のダメージ
    expect(differencesOf(damages.slice(0, 6))).toEqual([0, 100, 200, 300, 300]);
    const firstOwnTurn = events.findIndex((event) => event.startsWith("[1] "));
    const firstOpponentTurn = events.findIndex((event) =>
      event.startsWith("[相手 1] ")
    );
    expect(firstOwnTurn).toBeGreaterThanOrEqual(0);
    expect(firstOwnTurn).toBeLessThan(firstOpponentTurn);
  });

  test("後攻では相手の番から始まり、相手の 1〜5 回目の番にバトルポケモンが 0、100、200、300、300 のダメージを受ける", () => {
    const { damages, events } = recordActiveDamageAtOwnTurns(false);
    // 相手の n 回目の番は自分の n 回目の番の前。対戦の準備の直後は 0
    expect(differencesOf([0, ...damages.slice(0, 5)])).toEqual([
      0, 100, 200, 300, 300,
    ]);
    const firstOwnTurn = events.findIndex((event) => event.startsWith("[1] "));
    const firstOpponentTurn = events.findIndex((event) =>
      event.startsWith("[相手 1] ")
    );
    expect(firstOpponentTurn).toBeGreaterThanOrEqual(0);
    expect(firstOpponentTurn).toBeLessThan(firstOwnTurn);
  });

  test("先攻の最初の番はワザを選ばせない", () => {
    const random = createSeededRandom(8);
    const cards = buildDeck(SAMPLE_RECORD_TABLE, BASICS_AND_ENERGIES);
    for (let game = 0; game < 200; game += 1) {
      const { events } = runBattleStyleSoloPlayGame({
        cards,
        policy: evolvingPolicy,
        random,
        wentFirst: true,
      });
      expect(events.some((event) => event.startsWith("[1] ワザ "))).toBe(false);
      expect(events).toContain("[2] ワザ ワザ");
    }
  });

  test("自分がサイドを取り切ると勝ち", () => {
    // HPの高いたね(テスト用の記録 900008)の大きなワザは 300。相手の場のダメージ 300 でサイドを 3 枚取る
    const result = runBattleStyleSoloPlayGame({
      cards: buildDeck(SAMPLE_RECORD_TABLE, [
        { cardId: STURDY_BASIC.cardId, count: 60 },
      ]),
      policy: attackingPolicy,
      random: createSeededRandom(12),
      wentFirst: false,
    });
    expect(result.outcome).toBe("win");
    expect(result.reason).toBe("ownPrizesTaken");
  });

  test("相手がサイドを取り切ると負け", () => {
    // メガシンカexのたね(テスト用の記録 900009、HP 60)は相手の 2 回目の番の 100 できぜつし、相手はサイドを 3 枚取る
    const result = runBattleStyleSoloPlayGame({
      cards: buildDeck(SAMPLE_RECORD_TABLE, [
        { cardId: FRAGILE_MEGA_BASIC.cardId, count: 60 },
      ]),
      policy: idlePolicy,
      random: createSeededRandom(13),
      wentFirst: true,
    });
    expect(result.outcome).toBe("loss");
    expect(result.reason).toBe("opponentPrizesTaken");
    expect(result.decidedTurn).toEqual({ ordinal: 3, owner: "opponent" });
    expect(result.opponentTakenPrizeCount).toBe(6);
  });

  test("場に自分のポケモンがいなくなると負け", () => {
    // たね(テスト用の記録 900001、HP 60)が 1 枚だけのデッキでは、対戦の準備でバトル場に出したたねにベンチが無い
    const result = runBattleStyleSoloPlayGame({
      cards: buildDeck(SAMPLE_RECORD_TABLE, [
        { cardId: BASIC.cardId, count: 1 },
        { cardId: ENERGY.cardId, count: 59 },
      ]),
      policy: idlePolicy,
      random: createSeededRandom(14),
      wentFirst: true,
    });
    expect(result.outcome).toBe("loss");
    expect(result.reason).toBe("noOwnPokemonInPlay");
    expect(result.decidedTurn).toEqual({ ordinal: 2, owner: "opponent" });
    expect(result.opponentTakenPrizeCount).toBe(1);
  });

  test("自分の番の最初に山札を引けないと負け", () => {
    // 対戦の準備の後の山札は 60 − 手札 7 − サイド 6 = 47 枚。HPの高いたねは相手の攻撃できぜつしない
    const result = runBattleStyleSoloPlayGame({
      cards: buildDeck(SAMPLE_RECORD_TABLE, STURDY_AND_ENERGIES),
      policy: idlePolicy,
      random: createSeededRandom(15),
      wentFirst: true,
    });
    expect(result.outcome).toBe("loss");
    expect(result.reason).toBe("cannotDrawAtTurnStart");
    expect(result.decidedTurn).toEqual({ ordinal: 48, owner: "self" });
  });

  test("1 回の対戦の結果として、勝敗、勝敗が決まった理由、勝敗が決まった番(誰の何回目の番か)、自分と相手が取ったサイドの枚数を返す", () => {
    // 後攻で、自分の 1・2 回目の番に大きなワザで 300 ずつ与え、2 回目の番の終わりにサイドを取り切る
    const result = runBattleStyleSoloPlayGame({
      cards: buildDeck(SAMPLE_RECORD_TABLE, [
        { cardId: STURDY_BASIC.cardId, count: 60 },
      ]),
      policy: attackingPolicy,
      random: createSeededRandom(12),
      wentFirst: false,
    });
    expect({ ...result, events: [] }).toEqual({
      decidedTurn: { ordinal: 2, owner: "self" },
      events: [],
      opponentTakenPrizeCount: 0,
      outcome: "win",
      reason: "ownPrizesTaken",
      takenPrizeCount: 6,
    });
  });

  test("先攻・後攻とも 200 回の対戦が基本ルールに反さず勝敗まで進む", () => {
    const random = createSeededRandom(7);
    const cards = buildDeck(SAMPLE_RECORD_TABLE, [
      { cardId: BASIC.cardId, count: 4 },
      { cardId: STAGE1.cardId, count: 3 },
      { cardId: STAGE2.cardId, count: 2 },
      { cardId: ENERGY.cardId, count: 51 },
    ]);
    for (const wentFirst of [true, false]) {
      for (let game = 0; game < 200; game += 1) {
        const result = runBattleStyleSoloPlayGame({
          cards,
          policy: evolvingPolicy,
          random,
          wentFirst,
        });
        expect(result.decidedTurn.ordinal).toBeGreaterThanOrEqual(1);
      }
    }
  });

  test("プレイングの判断基準が基本ルールに反する操作をすると、対戦は例外で止まる", () => {
    expect(() =>
      runBattleStyleSoloPlayGame({
        cards: buildDeck(SAMPLE_RECORD_TABLE, BASICS_AND_ENERGIES),
        policy: {
          ...idlePolicy,
          playTurn: ({ state }) => {
            const { active } = state;
            const energy = state.findFirstInHand(ENERGY.name);
            if (active !== undefined && energy !== undefined) {
              state.attachEnergyFromHand(energy, active);
              state.attachEnergyFromHand(energy, active);
            }
          },
        },
        random: createSeededRandom(5),
        wentFirst: false,
      })
    ).toThrow(IllegalMove);
  });
});
