import { describe, expect, test } from "bun:test";
import { buildRecordedCard, buildState } from "./card-test-support.ts";
import { createNextTurnTrialEvaluator } from "./search-evaluators.ts";
import { RESOLVED_MEGA_GARDEVOIR_DECLARATION } from "./search-positions.ts";

const MEGA_GARDEVOIR = buildRecordedCard("048464");
const RALTS = buildRecordedCard("049714");
const RARE_CANDY = buildRecordedCard("050462");
const SEAKING = buildRecordedCard("046690");
const FESTIVAL_GROUNDS = buildRecordedCard("046841");
const GRASS_ENERGY = buildRecordedCard("047903");

describe("次の番を試す評価", () => {
  test("試しの番の終わりに、2 回目を使える効果があればワザを 2 回使う", () => {
    // 見えていないカードは山札の 5 枚だけ。クイックドローを 2 回使えば 4 枚、次の番の最初に 1 枚引いて全部が手札に来るので、
    // 次の番にふしぎなアメでメガサーナイトex に進化でき、どの試しでも 3 番目の番に立つ。1 回だけなら 3 枚しか引かない
    const state = buildState({
      active: SEAKING,
      bench: [RALTS],
      deck: [MEGA_GARDEVOIR, ...Array.from({ length: 4 }, () => GRASS_ENERGY)],
      hand: [RARE_CANDY],
    });
    state.prizes.length = 0;
    state.stadium = FESTIVAL_GROUNDS;
    state.active?.energies.push(GRASS_ENERGY);
    const evaluate = createNextTurnTrialEvaluator(
      RESOLVED_MEGA_GARDEVOIR_DECLARATION,
      { trials: 20 }
    );
    expect(
      evaluate({
        fromTurn: 2,
        seed: 1,
        stage: "actionsDone",
        state,
        statistics: { clones: 0, evaluations: 0 },
      })
    ).toBe(1);
  });
});
