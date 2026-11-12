import { describe, expect, test } from "bun:test";
import {
  createFirstActionPolicy,
  createRandomActionPolicy,
} from "./action-list-playing-policies.ts";
import { cardRecordTable } from "./card-record-table.ts";
import { buildRecordedCard, buildState } from "./card-test-support.ts";
import { buildDeck, runBattleStyleSoloPlayGame } from "./engine.ts";
import { createSeededRandom } from "./random.ts";
import { RECORDED_DECKS } from "./recorded-decks.ts";
import { createPolicyRecordingUnusedActions } from "./unused-action-recording.ts";

const ADDED_LINE = /番を終えた時点で残っていた行動|使わなかったワザ/;

describe("番を終えた時点で残っていた行動と使わなかったワザを履歴に書く包み", () => {
  test("包んだ判断基準で回した対戦は、包まないときと勝敗と行動の並びが同じで、履歴の行だけが増える", () => {
    const [deck] = RECORDED_DECKS;
    if (deck === undefined) {
      throw new Error("記録済みのデッキが無い");
    }
    const cards = buildDeck(cardRecordTable, deck.decklist);
    const play = (wrapped: boolean) => {
      const policy = createRandomActionPolicy(3);
      return runBattleStyleSoloPlayGame({
        cards,
        policy: wrapped ? createPolicyRecordingUnusedActions(policy) : policy,
        random: createSeededRandom(4),
        wentFirst: true,
      });
    };
    const plain = play(false);
    const recorded = play(true);
    expect(recorded.events.length).toBeGreaterThan(plain.events.length);
    expect(recorded.events.filter((event) => !ADDED_LINE.test(event))).toEqual([
      ...plain.events,
    ]);
    expect({ ...recorded, events: [] }).toEqual({ ...plain, events: [] });
  });

  test("行動が残っているのに番を終えると、残っていた行動を履歴に書く", () => {
    // シロナのフカマル(049092)は手札からベンチに出せるたねポケモン
    const gible = buildRecordedCard("049092");
    const state = buildState({ active: gible, hand: [gible] });
    const policy = createPolicyRecordingUnusedActions({
      ...createFirstActionPolicy(),
      playTurn: () => undefined,
    });
    policy.playTurn({ choices: policy, state });
    expect(state.events).toEqual([
      "[2] 番を終えた時点で残っていた行動: シロナのフカマル をベンチに出す",
    ]);
  });

  test("使えるワザがあるのに使わないと、使わなかったワザを履歴に書く", () => {
    // シロナのフカマルのワザ「いわとばし」は闘エネルギー 1 個(基本闘エネルギー 049464)
    const state = buildState({ active: buildRecordedCard("049092") });
    state.active?.energies.push(buildRecordedCard("049464"));
    const policy = createPolicyRecordingUnusedActions({
      ...createFirstActionPolicy(),
      chooseAttack: () => undefined,
    });
    expect(policy.chooseAttack({ choices: policy, state })).toBeUndefined();
    expect(state.events).toEqual(["[2] 使わなかったワザ: いわとばし"]);
  });
});
