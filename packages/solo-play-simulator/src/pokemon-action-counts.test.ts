import { describe, expect, test } from "bun:test";
import {
  activeOf,
  benchAt,
  buildContext,
  buildRecordedCard,
  buildState,
  useAttackNamed,
} from "./card-test-support.ts";
import {
  countPokemonActionsInGame,
  mergePokemonActions,
} from "./pokemon-action-counts.ts";
import { createSeededRandom } from "./random.ts";
import { BASIC, ENERGY, STAGE1, STURDY_BASIC } from "./sample-cards.ts";

describe("勝率と同じ対戦で数える攻撃役とエネルギーのつけ先", () => {
  test("手札・山札・トラッシュ・つけ替えを1枚ずつ数え、進化の前後を区別する", () => {
    const state = buildState({
      active: BASIC,
      bench: [STURDY_BASIC],
      deck: [ENERGY, ENERGY, ENERGY],
      discard: [ENERGY],
      hand: [ENERGY, STAGE1],
    });
    const counts = countPokemonActionsInGame();
    state.observePokemonAction = counts.observe;
    const active = activeOf(state);
    const bench = benchAt(state, 0);
    state.attachEnergyFromHand(ENERGY, active);
    state.attachFromDeckTop(2, [ENERGY, ENERGY], bench, "shuffleIntoDeck");
    state.attachFromDeckTopToEach(
      1,
      [{ energy: ENERGY, target: active }],
      "shuffleIntoDeck"
    );
    state.evolve(active, STAGE1, { from: "hand" });
    state.attachEnergyByEffect(ENERGY, active, "discard");
    state.moveAttachedEnergy(bench, active, ENERGY);
    const trial = state.clone(createSeededRandom(19));
    useAttackNamed(buildContext(trial), "ワザ");
    trial.moveAttachedEnergy(activeOf(trial), benchAt(trial, 0), ENERGY);
    useAttackNamed(buildContext(state), "ワザ");
    expect(counts.byOutcome("win")).toEqual({
      win: {
        attacks: { [STAGE1.cardId]: { games: 1, times: 1 } },
        energyReceived: {
          [BASIC.cardId]: { games: 1, times: 2 },
          [STAGE1.cardId]: { games: 1, times: 2 },
          [STURDY_BASIC.cardId]: { games: 1, times: 2 },
        },
        games: 1,
      },
    });
  });

  test("同じ対戦の複数回と別対戦を分け、勝った組と負けた組を独立に足す", () => {
    const a = countPokemonActionsInGame();
    a.observe("attacks", BASIC);
    a.observe("attacks", BASIC);
    const b = countPokemonActionsInGame();
    b.observe("attacks", BASIC);
    const won = mergePokemonActions(a.byOutcome("win"), b.byOutcome("win"));
    const total = mergePokemonActions(won.pokemonActions, b.byOutcome("loss"));
    expect(total.pokemonActions?.win?.attacks[BASIC.cardId]).toEqual({
      games: 2,
      times: 3,
    });
    expect(total.pokemonActions?.loss?.attacks[BASIC.cardId]).toEqual({
      games: 1,
      times: 1,
    });
    expect(mergePokemonActions()).toEqual({});
  });
  test("同じ記録に属する複数のカードIDが攻撃しても1対戦と数える", () => {
    const one = countPokemonActionsInGame();
    one.observe("attacks", buildRecordedCard("047388"));
    one.observe("attacks", buildRecordedCard("047392"));
    const two = countPokemonActionsInGame();
    two.observe("attacks", buildRecordedCard("047381"));
    const merged = mergePokemonActions(
      one.byOutcome("win"),
      two.byOutcome("win")
    );
    expect(merged.pokemonActions?.win?.attacks).toEqual({
      "047381": { games: 2, times: 3 },
    });
  });
});
