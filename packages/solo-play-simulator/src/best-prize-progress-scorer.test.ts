import { describe, expect, test } from "bun:test";
import { createBestPrizeProgressScorer } from "./best-prize-progress-scorer.ts";
import { createSeededRandom, derivePolicySeed } from "./random.ts";
import { GameState } from "./state.ts";

describe("サイドの進みを比べる試し回しの本数", () => {
  test("未確定の場では上位2本が決まるまで試し、同点は先の種を優先する", () => {
    const values = [0, 0.25, 0.5, 1];
    const seeds = [123];
    for (let index = 1; index < 4; index += 1) {
      seeds.push(derivePolicySeed(seeds[index - 1] ?? 0));
    }
    for (let sequence = 0; sequence < values.length ** 4; sequence += 1) {
      const scores = seeds.map((_, index) => ({
        prizeDifference: index,
        winRate: values[Math.floor(sequence / 4 ** index) % 4] ?? 0,
      }));
      const top = scores.toSorted((a, b) => b.winRate - a.winRate).slice(0, 2);
      const state = new GameState(createSeededRandom(19), [], true);
      const used: number[] = [];
      const score = createBestPrizeProgressScorer((trial) => {
        expect(trial.state.turn).toBe(0);
        trial.state.turn += 1;
        used.push(trial.seed);
        const result = scores[used.length - 1];
        if (result === undefined) {
          throw new Error("試しが4本を超えた");
        }
        return result;
      })({ resumePoint: "ownTurnStart", seed: 123, state });
      expect(score).toEqual({
        prizeDifference: top.reduce((n, v) => n + v.prizeDifference, 0) / 2,
        winRate: top.reduce((n, v) => n + v.winRate, 0) / 2,
      });
      const fullMarks = scores.flatMap((v, i) =>
        v.winRate === 1 ? [i + 1] : []
      );
      expect(used).toEqual(seeds.slice(0, fullMarks[1] ?? 4));
    }
  });

  test("勝敗がすでに決まった場では1本の点数をそのまま使う", () => {
    const state = new GameState(createSeededRandom(1), [], false);
    state.decision = {
      decidedTurn: { ordinal: 2, owner: "opponent" },
      reason: "opponentPrizesTaken",
    };
    let count = 0;
    const result = createBestPrizeProgressScorer(() => {
      count += 1;
      return { prizeDifference: -3, winRate: 0.25 };
    })({ resumePoint: "ownTurnStart", seed: 123, state });
    expect(count).toBe(1);
    expect(result).toEqual({ prizeDifference: -3, winRate: 0.25 });
  });
});
