import { describe, expect, test } from "bun:test";
import {
  applyVariant,
  buildDeck,
  type Decklist,
  type Goal,
  type PlayingPolicy,
  runGame,
  setupGame,
} from "./engine.ts";
import { createSeededRandom } from "./random.ts";
import {
  BASIC,
  ENERGY,
  SAMPLE_CARD_TABLE,
  STAGE1,
  STAGE2,
} from "./sample-cards.ts";
import { GameState, IllegalMove } from "./state.ts";

const BASICS_AND_ENERGIES: Decklist = [
  { count: 4, name: "たね" },
  { count: 56, name: "基本超エネルギー" },
];

/** 何もしない。対戦の準備では最初のたねをバトル場に出し、残りをベンチに並べる。 */
const idlePolicy: PlayingPolicy = {
  chooseActiveAtSetup: ([first]) => first ?? BASIC,
  chooseAttack: () => null,
  chooseBenchAtSetup: (basics) => basics,
  playTurn: () => undefined,
};

/** 手札のエネルギーをバトル場につけ、進化できれば進化し、ワザを使う。 */
const evolvingPolicy: PlayingPolicy = {
  ...idlePolicy,
  chooseAttack: () => "ワザ",
  playTurn: (state) => {
    const { active } = state;
    if (active === null) {
      return;
    }
    const energy = state.findFirstInHand("基本超エネルギー");
    if (energy !== null) {
      state.attachEnergyFromHand(energy, active);
    }
    for (const card of [STAGE1, STAGE2]) {
      if (state.countInHand(card.name) > 0 && state.canEvolve(active, card)) {
        state.evolve(active, card, { from: "hand" });
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
      buildDeck(SAMPLE_CARD_TABLE, BASICS_AND_ENERGIES),
      true
    );
    setupGame(state, idlePolicy);
    expect(state.hand.length + state.listPokemonInPlay().length).toBe(7);
    expect(state.prizes).toHaveLength(6);
    expect(state.deck).toHaveLength(60 - 7 - 6);
  });

  test("たねポケモンが手札に来るまで引き直し、回数を数える", () => {
    const random = createSeededRandom(2);
    const cards = buildDeck(SAMPLE_CARD_TABLE, [
      { count: 1, name: "たね" },
      { count: 59, name: "基本超エネルギー" },
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
  test("カード表と枚数から 60 枚を組み立てる", () => {
    expect(buildDeck(SAMPLE_CARD_TABLE, BASICS_AND_ENERGIES)).toHaveLength(60);
  });

  test("カード表に無い名前があれば組み立てない", () => {
    expect(() =>
      buildDeck(SAMPLE_CARD_TABLE, [{ count: 60, name: "無いカード" }])
    ).toThrow("カード表に 無いカード が無い");
  });
});

describe("枚数の変更", () => {
  test("合計を保った変更を適用し、負の枚数と合計の変化は退ける", () => {
    const changed = applyVariant(BASICS_AND_ENERGIES, {
      changes: { たね: -1, 基本超エネルギー: 1 },
      label: "x",
    });
    expect(changed).toEqual([
      { count: 3, name: "たね" },
      { count: 57, name: "基本超エネルギー" },
    ]);
    expect(() =>
      applyVariant(BASICS_AND_ENERGIES, { changes: { たね: -1 }, label: "y" })
    ).toThrow("y: 枚数の合計が元のデッキと違う");
    expect(() =>
      applyVariant(BASICS_AND_ENERGIES, {
        changes: { たね: -5, 基本超エネルギー: 5 },
        label: "z",
      })
    ).toThrow("z: たね の枚数が負になる");
  });

  test("枚数が 0 になったカードは 60 枚の内容から消える", () => {
    const changed = applyVariant(BASICS_AND_ENERGIES, {
      changes: { "1進化": 4, たね: -4 },
      label: "w",
    });
    expect(changed).toEqual([
      { count: 56, name: "基本超エネルギー" },
      { count: 4, name: "1進化" },
    ]);
  });
});

describe("対戦の進行", () => {
  test("狙いが最初に成立した番と、成立しなかった番の要因を記録する", () => {
    const outcome = runGame({
      cards: buildDeck(SAMPLE_CARD_TABLE, BASICS_AND_ENERGIES),
      goals: [
        {
          explainFailure: () => "まだ",
          isAchieved: (state) =>
            (state.active?.countEnergy("psychic") ?? 0) >= 2,
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
    const cards = buildDeck(SAMPLE_CARD_TABLE, BASICS_AND_ENERGIES);
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
    const cards = buildDeck(SAMPLE_CARD_TABLE, [
      { count: 4, name: "たね" },
      { count: 4, name: "1進化" },
      { count: 52, name: "基本超エネルギー" },
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
    const cards = buildDeck(SAMPLE_CARD_TABLE, [
      { count: 4, name: "たね" },
      { count: 3, name: "1進化" },
      { count: 2, name: "2進化" },
      { count: 51, name: "基本超エネルギー" },
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

  test("番の終わりの効果は、ワザを選んだ後に毎番呼ばれる", () => {
    const turnsEnded: number[] = [];
    runGame({
      cards: buildDeck(SAMPLE_CARD_TABLE, BASICS_AND_ENERGIES),
      goals: [],
      maxTurn: 3,
      policy: {
        ...idlePolicy,
        resolveTurnEndEffects: (state) => {
          turnsEnded.push(state.turn);
        },
      },
      random: createSeededRandom(4),
      wentFirst: false,
    });
    expect(turnsEnded).toEqual([1, 2, 3]);
  });

  test("プレイングの判断基準が基本ルールに反する操作をすると、対戦は例外で止まる", () => {
    expect(() =>
      runGame({
        cards: buildDeck(SAMPLE_CARD_TABLE, BASICS_AND_ENERGIES),
        goals: [],
        maxTurn: 1,
        policy: {
          ...idlePolicy,
          playTurn: (state) => {
            const { active } = state;
            if (active !== null) {
              state.attachEnergyFromHand(ENERGY, active);
              state.attachEnergyFromHand(ENERGY, active);
            }
          },
        },
        random: createSeededRandom(5),
        wentFirst: false,
      })
    ).toThrow(IllegalMove);
  });
});
