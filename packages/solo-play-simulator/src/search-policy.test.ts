/**
 * 探索の仕組み(状態を複製して手を試す、効果の中の選択を記録して再生する、見えていないカードを混ぜ直す)と、試しの点数での
 * 比べ方を確かめる。試しの点数を出す関数はテストの中に書いた小さな関数を使う。山札の順だけが違う 2 つの状態で、探索が
 * 試しの点数を出す関数に渡す状態から作った値が、実際の状態に手を加えるまで(または実際に引くまで)すべて同じになるかで、
 * 混ぜ直しが抜けていないことを見る。混ぜ直しが抜けていれば、先を試すときに実際の山札から引くので、値が一致しない。
 */

import { describe, expect, test } from "bun:test";
import { createFirstActionPolicy } from "./action-list-playing-policies.ts";
import { playOpponentTurn } from "./battle-style-solo-play-rules.ts";
import {
  activeOf,
  buildRecordedCard,
  buildState,
  namesOf,
} from "./card-test-support.ts";
import type { Card } from "./cards.ts";
import {
  advanceBattleStyleSoloPlay,
  type BattleStyleSoloPlayResumePoint,
} from "./engine.ts";
import { createSeededRandom } from "./random.ts";
import {
  createSearchPolicy,
  type SearchOptions,
  type SearchPolicy,
  type TrialScore,
  type TrialScorer,
} from "./search-policy.ts";
import { type GameState, PRIZE_COUNT } from "./state.ts";

const MUKU_DREW = /ムク: \d+ 枚引く/;

/** 勝率だけを持つ点数。 */
function scoreOf(winRate: number): TrialScore {
  return { prizeDifference: 0, winRate };
}

/** 手札のカード ID の数値の合計を勝率の欄に入れる。手札に何が来たかで値が変わるため、引いたカードを知っているかが値に出る。 */
const sumHandCardIds: TrialScorer = ({ state }) =>
  scoreOf(state.hand.reduce((total, card) => total + Number(card.cardId), 0));

function createPolicy(
  scoreTrial: TrialScorer,
  overrides: Partial<SearchOptions> = {}
): SearchPolicy {
  return createSearchPolicy({
    samplesPerCandidate: 4,
    scoreTrial,
    searchesEffectChoices: true,
    seed: 20_260_927,
    tieBreak: "none",
    ...overrides,
  });
}

/** 試しの点数を出すたびに値を記録する探索。stopWhen が真を返した後の点数は記録しない。 */
function createRecordingPolicy(
  scoreTrial: TrialScorer,
  stopWhen: () => boolean
): {
  policy: SearchPolicy;
  values: number[];
} {
  const values: number[] = [];
  let stopped = false;
  const recording: TrialScorer = (input) => {
    const score = scoreTrial(input);
    stopped ||= stopWhen();
    if (!stopped) {
      values.push(score.winRate);
    }
    return score;
  };
  return { policy: createPolicy(recording), values };
}

/** 番の中の最初の行動を選ぶまでの点数(実際の状態に履歴が増えたら止める)。 */
function recordFirstTurnDecision(state: GameState): number[] {
  const eventCount = state.events.length;
  const { policy, values } = createRecordingPolicy(
    sumHandCardIds,
    () => state.events.length > eventCount
  );
  policy.playTurn({ choices: policy, state });
  return values;
}

describe("探索は山札の順とサイドの中身を知らない", () => {
  test("山札の順が違っても、リーリエの決心で引くカードを知らずに最初の行動を選ぶ", () => {
    // リーリエの決心(049445)は手札を山札に戻して切り、引く。ラルトス(049714)、基本超エネルギー(049463)
    const ralts = buildRecordedCard("049714");
    const lillie = buildRecordedCard("049445");
    const psychicEnergy = buildRecordedCard("049463");
    const unseen = [
      "050462",
      "048464",
      "049715",
      "050461",
      "045934",
      "049712",
      "046040",
      "050467",
    ].map(buildRecordedCard);
    const build = (deck: readonly Card[]) =>
      buildState({
        active: ralts,
        deck,
        hand: [lillie, psychicEnergy, ralts],
        random: createSeededRandom(1),
        turn: 2,
      });
    const left = build(unseen);
    const right = build([...unseen].reverse());
    expect(namesOf(right.deck)).not.toEqual(namesOf(left.deck));
    const values = recordFirstTurnDecision(left);
    expect(values.length).toBeGreaterThan(1);
    expect(recordFirstTurnDecision(right)).toEqual(values);
  });

  test("効果の中の選択を試すとき、選んだ後に引くカードは混ぜ直した山札から引く(ムクで捨てる枚数を選ぶ)", () => {
    const muku = buildRecordedCard("050297");
    const frillish = buildRecordedCard("047663");
    const ralts = buildRecordedCard("049714");
    const unseen = [
      "050462",
      "048464",
      "048464",
      "049445",
      "046040",
      "049463",
      "049463",
      "049463",
      "050461",
      "045934",
      "049715",
      "049712",
    ].map(buildRecordedCard);
    const build = (order: readonly number[]) => {
      const arranged = order.map((index) => unseen[index] as Card);
      const state = buildState({
        active: ralts,
        bench: [ralts, ralts, ralts, ralts, ralts],
        deck: arranged.slice(3),
        hand: [muku, frillish, frillish],
        random: createSeededRandom(1),
        turn: 2,
      });
      state.prizes.splice(0, state.prizes.length, ...arranged.slice(0, 3));
      return state;
    };
    const left = build([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    const right = build([11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0]);
    const record = (state: GameState) => {
      const { policy, values } = createRecordingPolicy(sumHandCardIds, () =>
        state.events.some((event) => MUKU_DREW.test(event))
      );
      policy.playTurn({ choices: policy, state });
      expect(
        state.events.some((event) => event.includes("サポート ムク"))
      ).toBe(true);
      return values;
    };
    const values = record(left);
    expect(record(right)).toEqual(values);
  });

  test("探索は実際の対戦の乱数を進めない(ワザを試して選ぶとき)", () => {
    // ドラパルトex(049264)のファントムダイブは炎と超、ジェットヘッドは無色 1 個。基本炎エネルギー(050746)と
    // 基本超エネルギー(049463)をつけて、両方を使える状態にする
    const state = buildState({
      active: buildRecordedCard("049264"),
      deck: ["050461", "049445", "049463", "050467"].map(buildRecordedCard),
      random: createSeededRandom(1001),
      turn: 2,
    });
    activeOf(state).energies.push(
      buildRecordedCard("050746"),
      buildRecordedCard("049463")
    );
    const usedPhantomDive: TrialScorer = ({ state: tried }) =>
      scoreOf([...tried.attacks.values()].includes("ファントムダイブ") ? 1 : 0);
    const policy = createPolicy(usedPhantomDive);
    const chosen = policy.chooseAttack({ choices: policy, state });
    expect(chosen?.attack.name).toBe("ファントムダイブ");
    expect(state.random.nextFloat()).toBe(createSeededRandom(1001).nextFloat());
  });
});

describe("試しの点数での比べ方", () => {
  // シロナのフカマル(049092)をバトル場に、手札にラルトス(049714)。ベンチに出す行動と番を終えることを比べる
  const buildBenchChoice = () =>
    buildState({
      active: buildRecordedCard("049092"),
      hand: [buildRecordedCard("049714")],
      random: createSeededRandom(1),
    });
  /** 勝率はいつも 0 で、ベンチポケモンの数を取ったサイドの差の欄に入れる。 */
  const benchCountAsPrizeDifference: TrialScorer = ({ state }) => ({
    prizeDifference: state.bench.length,
    winRate: 0,
  });

  test("勝率が並んだとき、取ったサイドの差で比べる設定なら、差の大きい行動を選ぶ", () => {
    const state = buildBenchChoice();
    const policy = createPolicy(benchCountAsPrizeDifference, {
      tieBreak: "prizeDifference",
    });
    policy.playTurn({ choices: policy, state });
    expect(state.bench).toHaveLength(1);
  });

  test("勝率が並んだとき、取ったサイドの差で比べない設定なら、先に並んだ「番を終える」を選ぶ", () => {
    const state = buildBenchChoice();
    const policy = createPolicy(benchCountAsPrizeDifference);
    policy.playTurn({ choices: policy, state });
    expect(state.bench).toHaveLength(0);
  });

  test("勝率が高い行動は、取ったサイドの差より優先する", () => {
    const state = buildBenchChoice();
    const policy = createPolicy(
      ({ state: tried }) => ({
        prizeDifference: -tried.bench.length,
        winRate: tried.bench.length,
      }),
      { tieBreak: "prizeDifference" }
    );
    policy.playTurn({ choices: policy, state });
    expect(state.bench).toHaveLength(1);
  });
});

describe("ワザを試すときの先の進め方", () => {
  test("ワザを試した先は、サイドの判定と相手の番まで進めてから点数を出し、使わないときはサイドの判定の後の相手の番から続ける", () => {
    // ドラパルトex(049264)のファントムダイブは 200 ダメージ(相手の場のダメージ 200 で、番の終わりにサイドを 2 枚取る。
    // docs/solo-play-simulator-design.md「相手の場のダメージとサイド」)
    const state = buildState({
      active: buildRecordedCard("049264"),
      deck: ["050461", "049445", "049463", "050467"].map(buildRecordedCard),
      random: createSeededRandom(7),
    });
    activeOf(state).energies.push(
      buildRecordedCard("050746"),
      buildRecordedCard("049463")
    );
    const observed: {
      prizesAfterOpponentTurn: number;
      resumePoint: BattleStyleSoloPlayResumePoint;
      usedAttack: boolean;
    }[] = [];
    const advanceThroughOpponentTurn: TrialScorer = ({
      resumePoint,
      state: tried,
    }) => {
      const usedAttack = tried.attacks.has(tried.turn);
      const policy = createFirstActionPolicy();
      advanceBattleStyleSoloPlay(
        { choices: policy, state: tried },
        { ...policy, chooseAttack: () => undefined },
        resumePoint,
        "ownTurnStart"
      );
      observed.push({
        prizesAfterOpponentTurn: tried.prizes.length,
        resumePoint,
        usedAttack,
      });
      return {
        prizeDifference: PRIZE_COUNT - tried.prizes.length,
        winRate: 0,
      };
    };
    const policy = createPolicy(advanceThroughOpponentTurn, {
      samplesPerCandidate: 1,
      tieBreak: "prizeDifference",
    });
    const chosen = policy.chooseAttack({ choices: policy, state });
    expect(chosen?.attack.name).toBe("ファントムダイブ");
    const phantomDive = observed.find(
      (entry) => entry.usedAttack && entry.prizesAfterOpponentTurn < PRIZE_COUNT
    );
    expect(phantomDive).toEqual({
      prizesAfterOpponentTurn: PRIZE_COUNT - 2,
      resumePoint: "ownTurnAttack",
      usedAttack: true,
    });
    expect(observed.at(-1)).toEqual({
      prizesAfterOpponentTurn: PRIZE_COUNT,
      resumePoint: "opponentTurn",
      usedAttack: false,
    });
  });
});

describe("探索の判断基準の、相手の番の選択", () => {
  test("相手の番にバトルポケモンがきぜつした後に出すベンチポケモンを、候補ごとに試して選ぶ", () => {
    // シロナのフカマル(049092、HP 70)が相手の 2 回目の番(100)できぜつする(docs/solo-play-simulator-design.md「相手の番」
    // 「ダメージときぜつ」)。ベンチはシロナのフカマル、ラルトス(049714)、シロナのロゼリア(048748)
    const budew = buildRecordedCard("048748");
    const gible = buildRecordedCard("049092");
    const state = buildState({
      active: gible,
      bench: [gible, buildRecordedCard("049714"), budew],
      deck: ["050461", "049445", "049463"].map(buildRecordedCard),
      random: createSeededRandom(1),
    });
    state.opponentTurnCount = 1;
    const resumePoints: BattleStyleSoloPlayResumePoint[] = [];
    const policy = createPolicy(({ resumePoint, state: tried }) => {
      resumePoints.push(resumePoint);
      return scoreOf(tried.active?.card === budew ? 1 : 0);
    });
    playOpponentTurn({ choices: policy, state });
    expect(activeOf(state).card).toBe(budew);
    expect(new Set(resumePoints)).toEqual(new Set(["ownTurnStart"]));
  });

  test("相手の番にきぜつしてベンチの上限が下がると、ベンチを減らすポケモンは候補の先頭から選ぶ", () => {
    // ゼロの大空洞(048706)は場に「テラスタル」のポケモンがいればベンチの上限 8。イーブイex(049282、「テラスタル」、
    // HP 200)が相手の 3 回目の番(200。docs/solo-play-simulator-design.md「相手の番」)できぜつすると、上限が 5 に戻る
    const gible = buildRecordedCard("049092");
    const state = buildState({
      active: buildRecordedCard("049282"),
      bench: [gible, gible, gible, gible, gible, gible],
      random: createSeededRandom(1),
    });
    state.stadium = buildRecordedCard("048706");
    activeOf(state).damage = 100;
    state.opponentTurnCount = 2;
    const [first] = state.bench;
    const policy = createPolicy(() => scoreOf(0));
    playOpponentTurn({ choices: policy, state });
    expect(state.bench).toHaveLength(4);
    expect(state.bench).not.toContain(first);
    expect(activeOf(state).card.name).toBe("シロナのフカマル");
  });
});

describe("探索は場のポケモンをダメカンで見分ける", () => {
  test("ダメカンの量だけが違う 2 匹から、アドレナブレインでダメカンを取り除くポケモンを選ぶとき、両方を試して相手の場のダメージが大きくなるほうを選ぶ", () => {
    // マシマシラ(049074)のアドレナブレインは、悪エネルギー(047909)がついていれば自分のポケモン 1 匹のダメカンを 3 個まで
    // 相手の場のダメージに移す。ラルトス(049714)の 2 匹は、のっているダメカン(1 個と 5 個)だけが違う
    const ralts = buildRecordedCard("049714");
    const state = buildState({
      active: buildRecordedCard("049074"),
      bench: [ralts, ralts],
      random: createSeededRandom(1),
    });
    activeOf(state).energies.push(buildRecordedCard("047909"));
    const [fewer, more] = state.bench;
    if (fewer === undefined || more === undefined) {
      throw new Error("ベンチのラルトスがいない");
    }
    fewer.damage = 10;
    more.damage = 50;
    const policy = createPolicy(
      ({ state: tried }) => scoreOf(tried.opponentFieldDamage / 1000),
      { samplesPerCandidate: 1 }
    );
    policy.playTurn({ choices: policy, state });
    expect(state.opponentFieldDamage).toBe(30);
    expect(more.damage).toBe(20);
    expect(fewer.damage).toBe(10);
  });
});
