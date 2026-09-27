import { describe, expect, test } from "bun:test";
import type { Card } from "./cards.ts";
import { createSeededRandom } from "./random.ts";
import {
  BASIC,
  ENERGY,
  GOODS,
  neverShuffled,
  STADIUM,
  STAGE1,
  STAGE2,
  SUPPORTER,
} from "./sample-cards.ts";
import {
  BENCH_LIMIT,
  COLORLESS,
  canPayCost,
  GameState,
  IllegalMove,
  PokemonInPlay,
} from "./state.ts";

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

  test("効果でつけるエネルギーは手札からの 1 回の制限に数えない", () => {
    const state = stateWith([ENERGY, ENERGY], [ENERGY]);
    state.attachEnergyByEffect(ENERGY, activeOf(state), "deck");
    state.attachEnergyByEffect(ENERGY, activeOf(state), "hand");
    state.attachEnergyFromHand(ENERGY, activeOf(state));
    expect(activeOf(state).energies).toHaveLength(3);
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
      state.placeOnBench(BASIC, { benchLimit: BENCH_LIMIT, from: "hand" });
    }
    expect(() =>
      state.placeOnBench(BASIC, { benchLimit: BENCH_LIMIT, from: "hand" })
    ).toThrow(IllegalMove);
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
    const fresh = state.placeOnBench(BASIC, {
      benchLimit: BENCH_LIMIT,
      from: "hand",
    });
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
    expect(activeOf(state).energies).toEqual([ENERGY]);
  });

  test("1 進化を飛ばす進化は、この番より前に出したたねポケモンに限る", () => {
    const state = stateWith([BASIC, STAGE2], []);
    const fresh = state.placeOnBench(BASIC, {
      benchLimit: BENCH_LIMIT,
      from: "hand",
    });
    expect(() => state.evolveSkippingStage1(fresh, STAGE2)).toThrow(
      IllegalMove
    );
    state.evolveSkippingStage1(activeOf(state), STAGE2);
    expect(activeOf(state).name).toBe("2進化");
  });

  test("1 進化を飛ばす進化は、2進化ポケモンの進化の系統のたねポケモンにだけできる", () => {
    const state = stateWith([STAGE2], []);
    state.active = new PokemonInPlay(STAGE1, 0);
    expect(() => state.evolveSkippingStage1(activeOf(state), STAGE2)).toThrow(
      IllegalMove
    );
  });
});

describe("にげる", () => {
  test("にげるは選んだエネルギーをトラッシュしてベンチと入れ替え、1 番に 1 回しかできない", () => {
    const state = stateWith([ENERGY, BASIC], []);
    const bench = state.placeOnBench(BASIC, {
      benchLimit: BENCH_LIMIT,
      from: "hand",
    });
    state.attachEnergyFromHand(ENERGY, activeOf(state));
    const formerActive = activeOf(state);
    state.retreat(bench, [ENERGY]);
    expect(state.active).toBe(bench);
    expect(formerActive.energies).toEqual([]);
    expect(state.countInDiscard("基本超エネルギー")).toBe(1);
    expect(() => state.retreat(formerActive, [])).toThrow(IllegalMove);
  });
});

describe("問い合わせ", () => {
  test("場・手札・山札・サイド・トラッシュにある枚数を名前で数える", () => {
    const state = stateWith([BASIC, ENERGY], [ENERGY, ENERGY]);
    state.prizes.push(ENERGY);
    state.discard.push(BASIC);
    state.placeOnBench(BASIC, { benchLimit: BENCH_LIMIT, from: "hand" });
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
  test("山札の上から見たカードのうち選んだものを手札に加え、残りを山札の下に戻す", () => {
    const state = stateWith([], [ENERGY, STAGE1, SUPPORTER, STADIUM]);
    state.takeFromDeckTop(3, [STAGE1], "bottomOfDeck");
    expect(state.hand).toEqual([STAGE1]);
    expect(state.deck).toEqual([STADIUM, ENERGY, SUPPORTER]);
  });

  test("山札の上から見て加えるとき、同じカードが複数枚あっても選んだ 1 枚だけが手札に移る", () => {
    const state = stateWith([], [STAGE1, STAGE1, ENERGY]);
    state.takeFromDeckTop(2, [STAGE1], "bottomOfDeck");
    expect(state.hand).toEqual([STAGE1]);
    expect(state.deck).toEqual([ENERGY, STAGE1]);
  });

  test("山札の上から見た中に無いカードは加えられない", () => {
    const state = stateWith([], [ENERGY, ENERGY, STAGE1]);
    expect(() => state.takeFromDeckTop(2, [STAGE1], "shuffleIntoDeck")).toThrow(
      IllegalMove
    );
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
    const bench = state.placeOnBench(BASIC, {
      benchLimit: BENCH_LIMIT,
      from: "hand",
    });
    state.returnPokemonToDeck(bench);
    expect(state.bench).toEqual([]);
    expect(state.deck).toEqual([BASIC]);
  });

  test("場のポケモンを手札に戻すと、ついているカードもすべて手札に戻る", () => {
    const state = stateWith([ENERGY, STAGE1], []);
    const active = activeOf(state);
    state.attachEnergyFromHand(ENERGY, active);
    state.evolve(active, STAGE1, { from: "hand" });
    state.returnPokemonToHand(active);
    expect(state.active).toBeNull();
    expect(state.hand).toEqual([STAGE1, BASIC, ENERGY]);
  });

  test("バトル場が空のときだけ、ベンチのポケモンをバトル場に出せる", () => {
    const state = stateWith([BASIC], []);
    const bench = state.placeOnBench(BASIC, {
      benchLimit: BENCH_LIMIT,
      from: "hand",
    });
    expect(() => state.promoteToActive(bench)).toThrow(IllegalMove);
    state.returnPokemonToDeck(activeOf(state));
    state.promoteToActive(bench);
    expect(state.active).toBe(bench);
    expect(state.bench).toEqual([]);
  });

  test("手札を全部山札に戻す", () => {
    const state = stateWith([ENERGY, SUPPORTER], [BASIC]);
    state.returnHandToDeck();
    expect(state.hand).toEqual([]);
    expect(state.deck).toHaveLength(3);
  });

  test("自分で山札の上に置いたカードは分かっている扱いになり、上から引くと減り、切ると無くなる", () => {
    const state = stateWith([STAGE1], [BASIC, ENERGY, SUPPORTER]);
    state.placeOnDeckTopAfterShuffle([ENERGY, SUPPORTER]);
    expect(state.knownDeckTopCount).toBe(2);
    state.draw(1);
    expect(state.knownDeckTopCount).toBe(1);
    state.placeHandCardsOnDeckTop([STAGE1]);
    expect(state.knownDeckTopCount).toBe(2);
    state.shuffleDeck();
    expect(state.knownDeckTopCount).toBe(0);
  });

  test("山札から探して取り出したカードが分かっている上のカードなら、分かっている数が減る", () => {
    const state = stateWith([STAGE1], [BASIC]);
    state.placeHandCardsOnDeckTop([STAGE1]);
    state.takeFromDeckToHand(BASIC);
    expect(state.knownDeckTopCount).toBe(1);
    state.takeFromDeckToHand(STAGE1);
    expect(state.knownDeckTopCount).toBe(0);
  });
});

describe("対戦の準備", () => {
  test("手札のたねポケモンをバトル場に出し、バトル場が埋まっていれば出せない", () => {
    const state = new GameState(neverShuffled, [], false);
    state.hand = [BASIC, BASIC, STAGE1];
    const active = state.placeActiveFromHand(BASIC);
    expect(state.active).toBe(active);
    expect(active.turnEntered).toBe(0);
    expect(state.hand).toEqual([BASIC, STAGE1]);
    expect(() => state.placeActiveFromHand(BASIC)).toThrow(IllegalMove);
    state.active = null;
    expect(() => state.placeActiveFromHand(STAGE1)).toThrow(IllegalMove);
  });

  test("山札の上から 6 枚をサイドに置く", () => {
    const state = stateWith(
      [],
      Array.from({ length: 8 }, () => ENERGY)
    );
    state.placePrizesFromDeck();
    expect(state.prizes).toHaveLength(6);
    expect(state.deck).toHaveLength(2);
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

  test("すべてのタイプとして働く 1 個は、同じタイプで埋まらない指定に回す", () => {
    expect(canPayCost(["fire", "psychic"], ["any", "fire"])).toBe(true);
    expect(canPayCost(["fire", "psychic"], ["any", "grass"])).toBe(false);
    expect(canPayCost(["fire", COLORLESS], ["any", "grass"])).toBe(true);
  });
});

describe("複製と混ぜ直し(探索が先を試すため)", () => {
  /** 山札とサイドの中身を区別できるように、4 種のカードを並べた場。 */
  function stateWithUnseen(deck: readonly Card[], prizes: readonly Card[]) {
    const state = stateWith([GOODS], deck);
    state.prizes.push(...prizes);
    state.bench.push(new PokemonInPlay(BASIC, 0));
    activeOf(state).energies.push(ENERGY);
    return state;
  }

  function countNames(cards: readonly Card[]): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const card of cards) {
      counts[card.name] = (counts[card.name] ?? 0) + 1;
    }
    return counts;
  }

  test("複製を変えても元の状態は変わらない", () => {
    const state = stateWithUnseen([STAGE1, STAGE2], [SUPPORTER]);
    state.hand.push(ENERGY);
    const copied = state.clone(createSeededRandom(1));
    copied.draw(1);
    copied.attachEnergyFromHand(ENERGY, activeOf(copied));
    copied.bench.length = 0;
    expect(state.hand).toEqual([GOODS, ENERGY]);
    expect(state.deck).toEqual([STAGE1, STAGE2]);
    expect(activeOf(state).energies).toEqual([ENERGY]);
    expect(state.bench).toHaveLength(1);
    expect(state.hasAttachedEnergy).toBe(false);
  });

  test("複製は場のポケモンを別のものとして写し、この番に 1 回目のワザを使ったポケモンも写しの側を指す", () => {
    const state = stateWithUnseen([], []);
    state.firstAttackerThisTurn = state.active;
    const copied = state.clone(createSeededRandom(1));
    expect(copied.active).not.toBe(state.active);
    expect(copied.active?.energies).toEqual([ENERGY]);
    expect(copied.firstAttackerThisTurn).toBe(copied.active);
  });

  test("見えていないカードの混ぜ直しは、山札とサイドを合わせた中身と枚数を変えない", () => {
    const deck = [STAGE1, STAGE1, STAGE2, ENERGY, ENERGY, ENERGY, SUPPORTER];
    const prizes = [STAGE2, STAGE2];
    const state = stateWithUnseen(deck, prizes);
    state.random = createSeededRandom(3);
    state.remixUnseenCards();
    expect(state.deck).toHaveLength(deck.length);
    expect(state.prizes).toHaveLength(prizes.length);
    expect(countNames([...state.deck, ...state.prizes])).toEqual(
      countNames([...deck, ...prizes])
    );
  });

  test("混ぜ直した結果は、見えていないカードの組み合わせと乱数だけで決まり、元の山札の順とサイドの中身によらない", () => {
    const left = stateWithUnseen([STAGE1, STAGE2, ENERGY, ENERGY], [SUPPORTER]);
    const right = stateWithUnseen(
      [ENERGY, SUPPORTER, ENERGY, STAGE1],
      [STAGE2]
    );
    left.random = createSeededRandom(7);
    right.random = createSeededRandom(7);
    left.remixUnseenCards();
    right.remixUnseenCards();
    expect(right.deck).toEqual(left.deck);
    expect(right.prizes).toEqual(left.prizes);
  });

  test("何か分かっている山札の上のカードは、混ぜ直しても動かない", () => {
    const state = stateWithUnseen([], [SUPPORTER]);
    state.hand = [STAGE2, STAGE1];
    state.deck = [ENERGY, ENERGY, ENERGY];
    state.placeHandCardsOnDeckTop([STAGE2, STAGE1]);
    state.random = createSeededRandom(11);
    state.remixUnseenCards();
    expect(state.deck.slice(0, 2)).toEqual([STAGE2, STAGE1]);
    expect(state.knownDeckTopCount).toBe(2);
  });

  test("山札の順だけの混ぜ直しは、サイドを変えない", () => {
    const state = stateWithUnseen(
      [STAGE1, STAGE2, ENERGY, ENERGY],
      [SUPPORTER]
    );
    state.random = createSeededRandom(5);
    state.shuffleUnknownDeckOrder();
    expect(state.prizes).toEqual([SUPPORTER]);
    expect(countNames(state.deck)).toEqual(
      countNames([STAGE1, STAGE2, ENERGY, ENERGY])
    );
  });

  test("山札の上から見たカードは何か分かっているものとして数え、山札の枚数を超えない", () => {
    const state = stateWithUnseen([STAGE1, STAGE2], []);
    state.markDeckTopKnown(5);
    expect(state.knownDeckTopCount).toBe(2);
  });

  test("見えていないカードから引く・探すと、見えていないカードで結果が決まったこととして数える", () => {
    const state = stateWithUnseen([STAGE1, STAGE2, ENERGY], []);
    const before = state.uncertainOutcomeCount;
    state.draw(1);
    expect(state.uncertainOutcomeCount).toBe(before + 1);
    state.takeFromDeckToHand(ENERGY);
    expect(state.uncertainOutcomeCount).toBe(before + 2);
  });

  test("自分で山札の上に置いて分かっているカードを引いても、見えていないカードで決まったことにはしない", () => {
    const state = stateWithUnseen([ENERGY], []);
    state.hand = [STAGE1];
    state.placeHandCardsOnDeckTop([STAGE1]);
    const before = state.uncertainOutcomeCount;
    state.draw(1);
    expect(state.uncertainOutcomeCount).toBe(before);
  });

  test("次の番に進めると番ごとの制限と使ったワザの記録が戻り、引く 1 枚は引かない", () => {
    const state = stateWithUnseen([STAGE1], []);
    state.hasAttachedEnergy = true;
    state.hasUsedSupporter = true;
    state.attacks.set(state.turn, "ワザ");
    state.firstAttackerThisTurn = state.active;
    const handSize = state.hand.length;
    state.advanceToNextTurn();
    expect(state.turn).toBe(3);
    expect(state.hasAttachedEnergy).toBe(false);
    expect(state.hasUsedSupporter).toBe(false);
    expect(state.firstAttackerThisTurn).toBeNull();
    expect(state.attacks.has(state.turn)).toBe(false);
    expect(state.hand).toHaveLength(handSize);
  });
});
