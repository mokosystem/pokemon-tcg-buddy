import { describe, expect, test } from "bun:test";
import { createFirstActionPolicy } from "./action-list-playing-policies.ts";
import { buildRecordedCard, buildState } from "./card-test-support.ts";
import { createPlayoutTrialScorer } from "./playout-trial-scorers.ts";
import { createSeededRandom } from "./random.ts";

describe("試し回しの点数", () => {
  test("続ける場所から勝敗まで進め、勝てば勝率 1 と取ったサイドの差を返す", () => {
    // 相手の場のダメージが 100 以上でサイドが残り 1 枚なら、自分の番の終わりの判定で取り切って勝つ
    // (docs/solo-play-simulator-design.md「相手の場のダメージとサイド」「勝敗」)
    const state = buildState({
      active: buildRecordedCard("049092"),
      random: createSeededRandom(1),
    });
    state.prizes.splice(1);
    state.opponentFieldDamage = 100;
    state.opponentRemainingPrizeCount = 4;
    const score = createPlayoutTrialScorer(() => createFirstActionPolicy())({
      resumePoint: "ownTurnAttack",
      seed: 1,
      state,
    });
    expect(score).toEqual({ prizeDifference: 6 - 2, winRate: 1 });
  });

  test("勝敗が決まった複製では、進めずに点数を返す(負けなら勝率 0)", () => {
    const state = buildState({
      active: buildRecordedCard("049092"),
      random: createSeededRandom(1),
    });
    state.opponentRemainingPrizeCount = 0;
    state.decision = {
      decidedTurn: { ordinal: 1, owner: "opponent" },
      reason: "opponentPrizesTaken",
    };
    expect(
      createPlayoutTrialScorer(() => createFirstActionPolicy())({
        resumePoint: "ownTurnStart",
        seed: 1,
        state,
      })
    ).toEqual({ prizeDifference: 0 - 6, winRate: 0 });
  });
});
