import { expect, test } from "bun:test";
import {
  pickBestCandidate,
  scoreCandidateAcrossSeeds,
  type TrialScore,
} from "./search-policy.ts";

test("満点を足しても先の候補に届かないときだけ残りを省き、サイドの差で逆転できる同点を残す", () => {
  const seeds = [0, 1, 2, 3];
  const leader: TrialScore = { prizeDifference: 0, winRate: 1 };
  let tried = 0;
  expect(
    scoreCandidateAcrossSeeds(
      seeds,
      () => {
        tried += 1;
        return { prizeDifference: 5, winRate: 0 };
      },
      leader
    )
  ).toBeUndefined();
  expect(tried).toBe(1);
  const near = { prizeDifference: 1, winRate: 1 - 0.5e-9 };
  expect(scoreCandidateAcrossSeeds(seeds, () => near, leader)).toEqual(near);
  expect(
    pickBestCandidate([leader, near], (score) => score, "prizeDifference")
  ).toBe(near);
});

test("3候補・4通りの種の勝敗をすべて変えても、全て採点したときと同じ候補が選ばれる", () => {
  const candidates = [0, 1, 2];
  const seeds = [0, 1, 2, 3];
  let skipped = 0;
  for (let configuration = 0; configuration < 2 ** 12; configuration += 1) {
    const outcome = (candidate: number, seed: number) => ({
      prizeDifference: seed - candidate,
      winRate: Math.floor(configuration / 2 ** (candidate * 4 + seed)) % 2,
    });
    for (const tieBreak of ["none", "prizeDifference"] as const) {
      const full = pickBestCandidate(
        candidates,
        (candidate) => {
          const scores = seeds.map((seed) => outcome(candidate, seed));
          return {
            prizeDifference:
              scores.reduce((n, x) => n + x.prizeDifference, 0) / seeds.length,
            winRate: scores.reduce((n, x) => n + x.winRate, 0) / seeds.length,
          };
        },
        tieBreak
      );
      let count = 0;
      const bounded = pickBestCandidate(
        candidates,
        (candidate, best) =>
          scoreCandidateAcrossSeeds(
            seeds,
            (seed) => {
              count += 1;
              return outcome(candidate, seed);
            },
            best
          ),
        tieBreak
      );
      expect(bounded).toBe(full);
      skipped += candidates.length * seeds.length - count;
    }
  }
  expect(skipped).toBeGreaterThan(0);
});
