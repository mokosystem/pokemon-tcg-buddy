import { describe, expect, test } from "bun:test";
import {
  type Card,
  defineBasicEnergyCard,
  defineGoodsCard,
  definePokemonCard,
  defineStadiumCard,
  defineSupporterCard,
  EvolutionStage,
} from "./cards.ts";
import {
  BENCH_LIMIT,
  COLORLESS,
  canPayCost,
  GameState,
  IllegalMove,
  PokemonInPlay,
  type RandomSource,
} from "./state.ts";

const BASIC = definePokemonCard({
  cardId: "1",
  hp: 60,
  name: "たね",
  pokemonType: "psychic",
  retreatCost: 1,
  stage: EvolutionStage.Basic,
});
const STAGE1 = definePokemonCard({
  cardId: "2",
  evolvesFrom: "たね",
  hp: 90,
  name: "1進化",
  pokemonType: "psychic",
  stage: EvolutionStage.Stage1,
});
const STAGE2 = definePokemonCard({
  cardId: "3",
  evolvesFrom: "1進化",
  hasRuleBox: true,
  hp: 300,
  name: "2進化",
  pokemonType: "psychic",
  stage: EvolutionStage.Stage2,
});
const ENERGY = defineBasicEnergyCard("基本超エネルギー", "4", "psychic");
const SUPPORTER = defineSupporterCard("サポート", "5");
const GOODS = defineGoodsCard("グッズ", "6");
const STADIUM = defineStadiumCard("スタジアム", "7");

// 山札を切らないテストなので、乱数の値は使われない。
const neverShuffled: RandomSource = { nextFloat: () => 0 };

function stateWith(
  hand: readonly Card[],
  deck: readonly Card[],
  options: { turn?: number; wentFirst?: boolean } = {}
): GameState {
  const state = new GameState(neverShuffled, [], options.wentFirst ?? false);
  state.hand = [...hand];
  state.deck = [...deck];
  state.turn = options.turn ?? 2;
  state.active = new PokemonInPlay(BASIC, 0);
  return state;
}

function activeOf(state: GameState): PokemonInPlay {
  if (state.active === null) {
    throw new Error("バトル場が空");
  }
  return state.active;
}

describe("番のルール", () => {
  test("先攻の最初の番はサポートを使えない", () => {
    const state = stateWith([SUPPORTER], [], { turn: 1, wentFirst: true });
    expect(state.canUseSupporter()).toBe(false);
    expect(() => state.useSupporter(SUPPORTER)).toThrow(IllegalMove);
  });

  test("後攻の最初の番はサポートを 1 回使える", () => {
    const state = stateWith([SUPPORTER, SUPPORTER], [], {
      turn: 1,
      wentFirst: false,
    });
    state.useSupporter(SUPPORTER);
    expect(state.canUseSupporter()).toBe(false);
  });

  test("先攻の最初の番はワザを使えない", () => {
    const state = stateWith([], [], { turn: 1, wentFirst: true });
    expect(state.canAttack()).toBe(false);
  });

  test("手札からのエネルギーは 1 番に 1 回しかつけられない", () => {
    const state = stateWith([ENERGY, ENERGY], []);
    state.attachEnergyFromHand(ENERGY, activeOf(state));
    expect(() => state.attachEnergyFromHand(ENERGY, activeOf(state))).toThrow(
      IllegalMove
    );
  });

  test("山札からつけるエネルギーは手札からの 1 回の制限に数えない", () => {
    const state = stateWith([ENERGY], [ENERGY]);
    state.attachEnergyFromDeck(ENERGY, activeOf(state));
    state.attachEnergyFromHand(ENERGY, activeOf(state));
    expect(activeOf(state).countEnergy("psychic")).toBe(2);
  });

  test("番の始めに 1 枚引き、1 番に 1 回の印を戻す", () => {
    const state = stateWith([], [ENERGY, ENERGY], { turn: 1 });
    state.hasUsedSupporter = true;
    state.hasAttachedEnergy = true;
    state.beginTurn();
    expect(state.turn).toBe(2);
    expect(state.hand).toHaveLength(1);
    expect(state.hasUsedSupporter).toBe(false);
    expect(state.hasAttachedEnergy).toBe(false);
  });

  test("同じ名前のスタジアムは出せない", () => {
    const state = stateWith([STADIUM, STADIUM], []);
    state.playStadium(STADIUM);
    state.hasPlayedStadium = false;
    expect(() => state.playStadium(STADIUM)).toThrow(IllegalMove);
  });

  test("ベンチに出せるのは 5 匹まで", () => {
    const state = stateWith(
      Array.from({ length: 6 }, () => BASIC),
      []
    );
    for (let index = 0; index < BENCH_LIMIT; index += 1) {
      state.placeOnBench(BASIC, { from: "hand" });
    }
    expect(() => state.placeOnBench(BASIC, { from: "hand" })).toThrow(
      IllegalMove
    );
  });
});

describe("進化のルール", () => {
  test("自分の最初の番は進化できない", () => {
    const state = stateWith([STAGE1], [], { turn: 1 });
    expect(state.canEvolve(activeOf(state), STAGE1)).toBe(false);
    expect(() =>
      state.evolve(activeOf(state), STAGE1, { from: "hand" })
    ).toThrow(IllegalMove);
  });

  test("この番に出したポケモンは進化できない", () => {
    const state = stateWith([BASIC, STAGE1], []);
    const fresh = state.placeOnBench(BASIC, { from: "hand" });
    expect(state.canEvolve(fresh, STAGE1)).toBe(false);
  });

  test("この番に進化したポケモンは手札から続けて進化できない", () => {
    const state = stateWith([STAGE1, STAGE2], []);
    state.evolve(activeOf(state), STAGE1, { from: "hand" });
    expect(state.canEvolve(activeOf(state), STAGE2)).toBe(false);
  });

  test("効果による進化は、出たばかりの制限を無視して 2 進化まで続けられる", () => {
    const state = stateWith([], [STAGE1, STAGE2]);
    state.evolve(activeOf(state), STAGE1, { from: "deck" });
    state.evolve(activeOf(state), STAGE2, {
      from: "deck",
      ignoreFreshness: true,
    });
    expect(activeOf(state).name).toBe("2進化");
    expect(activeOf(state).underneath.map((card) => card.name)).toEqual([
      "たね",
      "1進化",
    ]);
  });

  test("進化してもついているエネルギーは残る", () => {
    const state = stateWith([ENERGY, STAGE1], []);
    state.attachEnergyFromHand(ENERGY, activeOf(state));
    state.evolve(activeOf(state), STAGE1, { from: "hand" });
    expect(activeOf(state).countEnergy("psychic")).toBe(1);
  });

  test("1 進化を飛ばす進化は、この番より前に出したたねポケモンに限る", () => {
    const state = stateWith([BASIC, STAGE2], []);
    const fresh = state.placeOnBench(BASIC, { from: "hand" });
    expect(() => state.evolveSkippingStage1(fresh, STAGE2, "1進化")).toThrow(
      IllegalMove
    );
    state.evolveSkippingStage1(activeOf(state), STAGE2, "1進化");
    expect(activeOf(state).name).toBe("2進化");
  });
});

describe("にげる", () => {
  test("にげるは必要な数のエネルギーをトラッシュし、1 番に 1 回しかできない", () => {
    const state = stateWith([ENERGY, BASIC], []);
    const bench = state.placeOnBench(BASIC, { from: "hand" });
    state.attachEnergyFromHand(ENERGY, activeOf(state));
    const formerActive = activeOf(state);
    state.retreat(bench, 1);
    expect(state.active).toBe(bench);
    expect(formerActive.energies).toEqual([]);
    expect(state.countInDiscard("基本超エネルギー")).toBe(1);
    expect(() => state.retreat(formerActive, 0)).toThrow(IllegalMove);
  });
});

describe("問い合わせ", () => {
  test("場・手札・山札・サイド・トラッシュにある枚数を名前で数える", () => {
    const state = stateWith([BASIC, ENERGY], [ENERGY, ENERGY]);
    state.prizes.push(ENERGY);
    state.discard.push(BASIC);
    state.placeOnBench(BASIC, { from: "hand" });
    expect(state.countInPlay("たね")).toBe(2);
    expect(state.countInHand("基本超エネルギー")).toBe(1);
    expect(state.countInDeck("基本超エネルギー")).toBe(2);
    expect(state.countInPrizes("基本超エネルギー")).toBe(1);
    expect(state.countInDiscard("たね")).toBe(1);
  });

  test("見えていない枚数は山札とサイドの合計で、どちらにあるかは区別しない", () => {
    const state = stateWith([], [ENERGY, ENERGY]);
    state.prizes.push(ENERGY);
    expect(state.countUnseen("基本超エネルギー")).toBe(3);
  });

  test("手札から名前で最初の 1 枚を探し、無ければ null を返す", () => {
    const state = stateWith([ENERGY, SUPPORTER], []);
    expect(state.findFirstInHand("サポート")).toBe(SUPPORTER);
    expect(state.findFirstInHand("グッズ")).toBeNull();
  });
});

describe("山札の操作", () => {
  test("条件ごとに山札から 1 枚ずつ手札に加え、見つからない条件は飛ばす", () => {
    const state = stateWith([], [ENERGY, STAGE1, ENERGY]);
    const found = state.searchDeckToHand([
      (card) => card.name === "1進化",
      (card) => card.name === "グッズ",
      (card) => card.name === "基本超エネルギー",
    ]);
    expect(found).toEqual([STAGE1, ENERGY]);
    expect(state.hand).toEqual([STAGE1, ENERGY]);
    expect(state.deck).toEqual([ENERGY]);
  });

  test("山札の上から見た中に条件に合う 1 枚があれば手札に加え、無ければ何も加えない", () => {
    const state = stateWith([], [ENERGY, ENERGY, STAGE1]);
    const isStage1 = (card: Card) => card.name === "1進化";
    expect(state.revealTopAndTake(2, isStage1)).toBeNull();
    expect(state.hand).toEqual([]);
    expect(state.revealTopAndTake(3, isStage1)).toBe(STAGE1);
    expect(state.hand).toEqual([STAGE1]);
    expect(state.deck).toHaveLength(2);
  });

  test("山札の上から見て順位が最も小さい 1 枚を手札に加え、残りを山札の下に戻す", () => {
    const state = stateWith([], [ENERGY, STAGE1, SUPPORTER, STADIUM]);
    const taken = state.lookAtTopAndTakeOne(3, (card) =>
      card.name === "1進化" ? 0 : 1
    );
    expect(taken).toBe(STAGE1);
    expect(state.hand).toEqual([STAGE1]);
    expect(state.deck).toEqual([STADIUM, ENERGY, SUPPORTER]);
  });

  test("山札の上から見て加えるとき、同じカードが複数枚あっても選んだ 1 枚だけが手札に移る", () => {
    const state = stateWith([], [STAGE1, STAGE1, ENERGY]);
    const taken = state.lookAtTopAndTakeOne(2, (card) =>
      card.name === "1進化" ? 0 : 1
    );
    expect(taken).toBe(STAGE1);
    expect(state.hand).toEqual([STAGE1]);
    expect(state.deck).toEqual([ENERGY, STAGE1]);
  });

  test("バトル場のポケモンを山札に戻すと、ついているカードごと戻りバトル場が空になる", () => {
    const state = stateWith([ENERGY, STAGE1], []);
    const active = activeOf(state);
    state.attachEnergyFromHand(ENERGY, active);
    state.evolve(active, STAGE1, { from: "hand" });
    state.returnPokemonToDeck(active);
    expect(state.active).toBeNull();
    expect(state.deck).toHaveLength(3);
    expect(state.countInDeck("1進化")).toBe(1);
    expect(state.countInDeck("たね")).toBe(1);
    expect(state.countInDeck("基本超エネルギー")).toBe(1);
  });

  test("ベンチのポケモンを山札に戻すとベンチから消える", () => {
    const state = stateWith([BASIC], []);
    const bench = state.placeOnBench(BASIC, { from: "hand" });
    state.returnPokemonToDeck(bench);
    expect(state.bench).toEqual([]);
    expect(state.deck).toEqual([BASIC]);
  });

  test("手札を全部山札に戻す", () => {
    const state = stateWith([ENERGY, SUPPORTER], [BASIC]);
    state.returnHandToDeck();
    expect(state.hand).toEqual([]);
    expect(state.deck).toHaveLength(3);
  });
});

describe("グッズ", () => {
  test("グッズを使うと手札からトラッシュに移り、グッズ以外は使えない", () => {
    const state = stateWith([GOODS, SUPPORTER], []);
    state.useGoods(GOODS);
    expect(state.hand).toEqual([SUPPORTER]);
    expect(state.countInDiscard("グッズ")).toBe(1);
    expect(() => state.useGoods(SUPPORTER)).toThrow(IllegalMove);
  });
});

describe("ワザのエネルギー", () => {
  test("タイプ指定の分を先に埋め、残りを無色に充てる", () => {
    expect(canPayCost(["fire", COLORLESS], ["fire", "psychic"])).toBe(true);
    expect(canPayCost(["fire", COLORLESS], ["psychic", "psychic"])).toBe(false);
    expect(canPayCost(["fire", COLORLESS], ["fire"])).toBe(false);
  });
});
