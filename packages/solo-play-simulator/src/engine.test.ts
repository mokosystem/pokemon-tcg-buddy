import { describe, expect, test } from "bun:test";
import {
  attachEnergyFromHandToPokemon,
  evolvePokemonFromHand,
  listUsableAttacksOfActive,
} from "./card-effects.ts";
import { countEnergyUnitsOfType } from "./continuous-effects.ts";
import {
  applyVariant,
  buildDeck,
  type Decklist,
  type Goal,
  MissingCardRecordsError,
  type PlayingPolicy,
  runGame,
  setupGame,
} from "./engine.ts";
import { createSeededRandom } from "./random.ts";
import {
  BASIC,
  ENERGY,
  firstCandidateChoices,
  SAMPLE_RECORD_TABLE,
  STAGE1,
  STAGE2,
} from "./sample-cards.ts";
import { GameState, IllegalMove } from "./state.ts";

const BASICS_AND_ENERGIES: Decklist = [
  { cardId: BASIC.cardId, count: 4 },
  { cardId: ENERGY.cardId, count: 56 },
];

/** 何もしない。対戦の準備では最初のたねをバトル場に出し、残りをベンチに並べる。 */
const idlePolicy: PlayingPolicy = {
  ...firstCandidateChoices,
  chooseActiveAtSetup: ([first]) => first ?? BASIC,
  chooseAttack: () => null,
  chooseBenchAtSetup: (basics) => basics,
  playTurn: () => undefined,
};

/** 手札のエネルギーをバトル場につけ、進化できれば進化し、使えるワザを使う。 */
const evolvingPolicy: PlayingPolicy = {
  ...idlePolicy,
  chooseAttack: (context) =>
    listUsableAttacksOfActive(context)[0]?.attack.name ?? null,
  playTurn: (context) => {
    const { state } = context;
    const { active } = state;
    if (active === null) {
      return;
    }
    const energy = state.findFirstInHand(ENERGY.name);
    if (energy !== null) {
      attachEnergyFromHandToPokemon(context, energy, active);
    }
    for (const name of [STAGE1.name, STAGE2.name]) {
      const card = state.findFirstInHand(name);
      if (card !== null && state.canEvolve(active, card)) {
        evolvePokemonFromHand(context, active, card);
      }
    }
  },
};

const stage1InPlay: Goal = {
  explainFailure: () => "1進化 が無い",
  isAchieved: (state) => state.countInPlay("1進化") > 0,
  name: "1進化 が場にいる",
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
      expect(state.active).not.toBeNull();
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
  test("狙いが最初に成立した番と、成立しなかった番の要因を記録する", () => {
    const outcome = runGame({
      cards: buildDeck(SAMPLE_RECORD_TABLE, BASICS_AND_ENERGIES),
      goals: [
        {
          explainFailure: () => "まだ",
          isAchieved: (state) =>
            state.active !== null &&
            countEnergyUnitsOfType(state, state.active, "psychic") >= 2,
          name: "エネルギー 2 個",
        },
      ],
      maxTurn: 3,
      policy: { ...evolvingPolicy, chooseBenchAtSetup: () => [] },
      random: createSeededRandom(3),
      wentFirst: true,
    });
    expect(outcome.goalFirstTurn.get("エネルギー 2 個")).toBe(2);
    expect(outcome.failureLabels.get("エネルギー 2 個")).toEqual(
      new Map([[1, "まだ"]])
    );
  });

  test("先攻の最初の番はワザを選ばせない", () => {
    const random = createSeededRandom(8);
    const cards = buildDeck(SAMPLE_RECORD_TABLE, BASICS_AND_ENERGIES);
    for (let game = 0; game < 200; game += 1) {
      const outcome = runGame({
        cards,
        goals: [],
        maxTurn: 3,
        policy: evolvingPolicy,
        random,
        wentFirst: true,
      });
      expect(outcome.attacks.has(1)).toBe(false);
      expect(outcome.attacks.get(2)).toBe("ワザ");
    }
  });

  test("進化が要る狙いは最初の番には成立しない", () => {
    const random = createSeededRandom(9);
    const cards = buildDeck(SAMPLE_RECORD_TABLE, [
      { cardId: BASIC.cardId, count: 4 },
      { cardId: STAGE1.cardId, count: 4 },
      { cardId: ENERGY.cardId, count: 52 },
    ]);
    for (const wentFirst of [true, false]) {
      for (let game = 0; game < 200; game += 1) {
        const outcome = runGame({
          cards,
          goals: [stage1InPlay],
          maxTurn: 3,
          policy: evolvingPolicy,
          random,
          wentFirst,
        });
        expect(outcome.goalFirstTurn.get(stage1InPlay.name)).not.toBe(1);
      }
    }
  });

  test("先攻・後攻とも 200 回の対戦が基本ルールに反さず最後まで進み、すべての狙いに結果が付く", () => {
    const random = createSeededRandom(7);
    const cards = buildDeck(SAMPLE_RECORD_TABLE, [
      { cardId: BASIC.cardId, count: 4 },
      { cardId: STAGE1.cardId, count: 3 },
      { cardId: STAGE2.cardId, count: 2 },
      { cardId: ENERGY.cardId, count: 51 },
    ]);
    const goals = [
      stage1InPlay,
      {
        explainFailure: () => "2進化 が無い",
        isAchieved: (state: GameState) => state.countInPlay("2進化") > 0,
        name: "2進化 が場にいる",
      },
    ];
    for (const wentFirst of [true, false]) {
      for (let game = 0; game < 200; game += 1) {
        const outcome = runGame({
          cards,
          goals,
          maxTurn: 3,
          policy: evolvingPolicy,
          random,
          wentFirst,
        });
        expect([...outcome.goalFirstTurn.keys()]).toEqual(
          goals.map((goal) => goal.name)
        );
        expect(outcome.events.at(-1)).toStartWith("[3] ");
      }
    }
  });

  test("プレイングの判断基準が基本ルールに反する操作をすると、対戦は例外で止まる", () => {
    expect(() =>
      runGame({
        cards: buildDeck(SAMPLE_RECORD_TABLE, BASICS_AND_ENERGIES),
        goals: [],
        maxTurn: 1,
        policy: {
          ...idlePolicy,
          playTurn: ({ state }) => {
            const { active } = state;
            const energy = state.findFirstInHand(ENERGY.name);
            if (active !== null && energy !== null) {
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
