/**
 * 候補 5 の判断基準を、決まった答えを返す偽の Jev で確かめる。bun run test は Jev を呼ばない(Issue 70 の決定事項
 * 「候補 5 の条件」の 2 つ目)。
 */

import { describe, expect, test } from "bun:test";
import { calculateOpponentAttackDamage } from "./battle-style-solo-play-rules.ts";
import { cardRecordTable } from "./card-record-table.ts";
import {
  activeOf,
  buildRecordedCard,
  buildState,
} from "./card-test-support.ts";
import { buildDeck, runBattleStyleSoloPlayGame } from "./engine.ts";
import {
  createJevPlayingPolicy,
  JEV_MODEL,
  type JevChoiceRequest,
  type JevChoiceResponse,
} from "./jev-playing-policy.ts";
import { listAvailableActions } from "./player-actions.ts";
import { createSeededRandom } from "./random.ts";
import { RECORDED_DECKS } from "./recorded-decks.ts";

// シロナのフカマル(049092)はたねポケモンで、ワザ「いわとばし」は闘エネルギー 1 個(基本闘エネルギー 049464)
const GIBLE = buildRecordedCard("049092");
const FIGHTING_ENERGY = buildRecordedCard("049464");
// ロック闘エネルギー(049713)は特殊エネルギーで、闘エネルギー 1 個ぶんになる
const ROCK_FIGHTING_ENERGY = buildRecordedCard("049713");

/** 毎回、選択肢の optionIndex 番目を選ぶ偽の Jev。受け取った問い合わせを記録する。 */
function createFakeJev(pickIndex: (request: JevChoiceRequest) => number) {
  const requests: JevChoiceRequest[] = [];
  const requestJevChoice = (request: JevChoiceRequest): JevChoiceResponse => {
    requests.push(request);
    return {
      answers: {
        next: { choice: `option${pickIndex(request)}`, confidence: 1 },
      },
      model: JEV_MODEL,
      usage: { input_tokens: 100 },
    };
  };
  return { requestJevChoice, requests };
}

function criteriaOf(
  request: JevChoiceRequest | undefined
): Record<string, string> {
  return { ...request?.questions.next?.criteria };
}

describe("Jev に選ばせる判断基準", () => {
  test("番の中の行動は、今できる行動の一覧を選択肢にして問い合わせ、選ばれた行動を行う", () => {
    const state = buildState({ active: GIBLE, hand: [GIBLE, FIGHTING_ENERGY] });
    const actionCount = listAvailableActions({
      choices: createJevPlayingPolicy({
        cards: [],
        requestJevChoice: createFakeJev(() => 0).requestJevChoice,
      }),
      state,
    }).length;
    // 1 回目はシロナのフカマルをベンチに出す(一覧の先頭)、2 回目は番を終える(一覧の最後)を選ぶ
    const jev = createFakeJev((request) =>
      jev.requests.length === 1
        ? 0
        : Object.keys(criteriaOf(request)).length - 1
    );
    const policy = createJevPlayingPolicy({
      cards: [GIBLE, FIGHTING_ENERGY],
      requestJevChoice: jev.requestJevChoice,
    });
    policy.playTurn({ choices: policy, state });
    expect(state.bench).toHaveLength(1);
    expect(jev.requests).toHaveLength(2);
    expect(Object.keys(criteriaOf(jev.requests[0]))).toHaveLength(actionCount);
    expect(criteriaOf(jev.requests[0]).option0).toBe(
      "シロナのフカマル をベンチに出す"
    );
    expect(policy.jevUsage).toEqual({ inputTokens: 200, requests: 2 });
  });

  test("状態には、自分の場、手札、トラッシュ、山札の枚数、サイドの残り枚数、相手のサイドの残り枚数、相手の場のダメージ、番の回数、次の相手の番に受けるダメージと、デッキのカードの説明を入れる", () => {
    const state = buildState({ active: GIBLE, hand: [FIGHTING_ENERGY] });
    const jev = createFakeJev(() => 0);
    const policy = createJevPlayingPolicy({
      cards: [GIBLE, FIGHTING_ENERGY],
      requestJevChoice: jev.requestJevChoice,
    });
    policy.chooseAttack({ choices: policy, state });
    const sent = jev.requests[0]?.state as {
      deckCards: { name: string }[];
      situation: Record<string, unknown>;
    };
    expect(Object.keys(sent.situation).sort()).toEqual(
      [
        "active",
        "bench",
        "deckCount",
        "discard",
        "hand",
        "nextOpponentAttackDamage",
        "opponentFieldDamage",
        "opponentRemainingPrizes",
        "ownRemainingPrizes",
        "ownTurn",
        "stadium",
      ].sort()
    );
    expect(sent.deckCards.map((card) => card.name)).toEqual([
      "シロナのフカマル",
      "基本闘エネルギー",
    ]);
    expect(jev.requests[0]?.model).toBe(JEV_MODEL);
  });

  test("次の相手の番に受けるダメージは、相手の番の回数から骨組みの関数で求める(先攻と後攻で同じ自分の番でも違う)", () => {
    const sentDamage = (opponentTurnCount: number) => {
      const state = buildState({ active: GIBLE });
      state.opponentTurnCount = opponentTurnCount;
      const jev = createFakeJev(() => 0);
      const policy = createJevPlayingPolicy({
        cards: [GIBLE],
        requestJevChoice: jev.requestJevChoice,
      });
      policy.chooseAttack({ choices: policy, state });
      const sent = jev.requests[0]?.state as {
        situation: { nextOpponentAttackDamage: number };
      };
      return sent.situation.nextOpponentAttackDamage;
    };
    expect(sentDamage(0)).toBe(calculateOpponentAttackDamage(1));
    expect(sentDamage(1)).toBe(calculateOpponentAttackDamage(2));
  });

  test("場のポケモンには場所の名前を付け、同じ名前のポケモンへの行動を場所で見分けられる説明にする", () => {
    const state = buildState({
      active: GIBLE,
      bench: [GIBLE],
      hand: [FIGHTING_ENERGY],
    });
    activeOf(state).energies.push(FIGHTING_ENERGY);
    const jev = createFakeJev(
      (request) => Object.keys(criteriaOf(request)).length - 1
    );
    const policy = createJevPlayingPolicy({
      cards: [GIBLE, FIGHTING_ENERGY],
      requestJevChoice: jev.requestJevChoice,
    });
    policy.playTurn({ choices: policy, state });
    const options = Object.values(criteriaOf(jev.requests[0]));
    expect(options).toContain(
      "基本闘エネルギー を バトル場 の シロナのフカマル につける"
    );
    expect(options).toContain(
      "基本闘エネルギー を ベンチ 1 の シロナのフカマル につける"
    );
    // シロナのフカマルのにげるためのエネルギーは 1 個(049092)
    expect(options).toContain(
      "ベンチ 1 の シロナのフカマル ににげる(トラッシュするエネルギー: 基本闘エネルギー)"
    );
    const sent = jev.requests[0]?.state as {
      situation: { active: { place: string }; bench: { place: string }[] };
    };
    expect(sent.situation.active.place).toBe("バトル場");
    expect(sent.situation.bench.map((pokemon) => pokemon.place)).toEqual([
      "ベンチ 1",
    ]);
  });

  test("特殊エネルギーの説明には、効果に加えて、何エネルギー何個ぶんになるかを入れる", () => {
    const jev = createFakeJev(() => 0);
    const policy = createJevPlayingPolicy({
      cards: [GIBLE, ROCK_FIGHTING_ENERGY],
      requestJevChoice: jev.requestJevChoice,
    });
    policy.chooseAttack({
      choices: policy,
      state: buildState({ active: GIBLE }),
    });
    const sent = jev.requests[0]?.state as {
      deckCards: ({ name: string } & Record<string, unknown>)[];
    };
    expect(
      sent.deckCards.find((card) => card.name === "ロック闘エネルギー")
    ).toEqual({
      category: "特殊エネルギー",
      effects: [],
      name: "ロック闘エネルギー",
      provision: { kind: "type", type: "fighting", units: 1 },
    });
  });

  test("ワザは、使えるワザの一覧と「使わない」を選択肢にし、選ばれたワザを返す", () => {
    const state = buildState({ active: GIBLE });
    activeOf(state).energies.push(FIGHTING_ENERGY);
    const jev = createFakeJev(() => 0);
    const policy = createJevPlayingPolicy({
      cards: [GIBLE],
      requestJevChoice: jev.requestJevChoice,
    });
    expect(policy.chooseAttack({ choices: policy, state })?.attack.name).toBe(
      "いわとばし"
    );
    expect(Object.values(criteriaOf(jev.requests[0]))).toEqual([
      "ワザ いわとばし を使う",
      "ワザを使わずに番を終える",
    ]);
  });

  test("偽の Jev で、記録済みのデッキの対戦が勝敗まで進む", () => {
    const [deck] = RECORDED_DECKS;
    if (deck === undefined) {
      throw new Error("記録済みのデッキが無い");
    }
    const cards = buildDeck(cardRecordTable, deck.decklist);
    const random = createSeededRandom(3);
    const jev = createFakeJev((request) =>
      Math.floor(random.nextFloat() * Object.keys(criteriaOf(request)).length)
    );
    const result = runBattleStyleSoloPlayGame({
      cards,
      policy: createJevPlayingPolicy({
        cards,
        requestJevChoice: jev.requestJevChoice,
      }),
      random: createSeededRandom(4),
      wentFirst: true,
    });
    expect(result.decidedTurn.ordinal).toBeGreaterThanOrEqual(1);
    expect(jev.requests.length).toBeGreaterThan(0);
  });
});
