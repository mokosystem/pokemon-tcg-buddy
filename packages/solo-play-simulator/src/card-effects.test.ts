import { describe, expect, test } from "bun:test";
import {
  canPlayTrainerFromHand,
  canPlayTrainerIfInHand,
  canUseStadiumEffect,
  listUsableAttacksOfActive,
  playTrainerFromHand,
  useAttack,
  useStadiumEffect,
} from "./card-effects.ts";
import { CardCategory, type PokemonRecord } from "./card-record-schema.ts";
import {
  buildContext,
  buildRecordedCard,
  buildState,
  useAttackNamed,
} from "./card-test-support.ts";
import { buildCardFromRecord } from "./cards.ts";
import { BASIC, SAMPLE_RECORD_TABLE } from "./sample-cards.ts";
import { IllegalMove } from "./state.ts";

function buildPokemonWithConditionalAttack() {
  const basicRecord = SAMPLE_RECORD_TABLE.get(BASIC.cardId);
  if (basicRecord?.category !== CardCategory.Pokemon) {
    throw new Error("テスト用のたねポケモンの記録が無い");
  }
  const record: PokemonRecord = {
    ...basicRecord,
    attacks: [
      {
        cost: [],
        damage: { kind: "none" },
        effect: {
          isOptional: false,
          steps: [
            { count: { kind: "fixed", value: 1 }, operation: "drawCards" },
          ],
          useConditions: [{ condition: "deckHasCards", minCount: 3 }],
        },
        name: "条件つきのワザ",
      },
    ],
    translationStatus: "translated",
  };
  return buildCardFromRecord(record, BASIC.cardId);
}

describe("ワザ", () => {
  test("効果の使える条件を満たさないワザは、使えるワザの一覧に入らず、使えない", () => {
    const pokemon = buildPokemonWithConditionalAttack();
    const state = buildState({ active: pokemon, deck: [BASIC, BASIC] });
    const context = buildContext(state);
    expect(listUsableAttacksOfActive(context)).toEqual([]);
    const [attack] =
      pokemon.record.category === CardCategory.Pokemon
        ? pokemon.record.attacks
        : [];
    const { active } = state;
    if (attack === undefined || active === undefined) {
      throw new Error("ワザを持つバトルポケモンが無い");
    }
    // 一覧に無い候補を渡しても使えない
    expect(() => useAttack(context, { attack, owner: active })).toThrow(
      IllegalMove
    );
    expect(state.hand).toEqual([]);
  });

  test("効果の使える条件を満たすワザは使え、効果が起きる", () => {
    const pokemon = buildPokemonWithConditionalAttack();
    const state = buildState({ active: pokemon, deck: [BASIC, BASIC, BASIC] });
    const context = buildContext(state);
    expect(
      listUsableAttacksOfActive(context).map((usable) => usable.attack.name)
    ).toEqual(["条件つきのワザ"]);
    useAttackNamed(context, "条件つきのワザ");
    expect(state.hand).toHaveLength(1);
  });
});

describe("スタジアム", () => {
  test("場のスタジアムの効果を使った番でも、手札から出した別のスタジアムの効果は使える", () => {
    const greatTree = buildRecordedCard("046040");
    const prismTower = buildRecordedCard("050164");
    const lillie = buildRecordedCard("049445");
    const psychicEnergy = buildRecordedCard("049463");
    const state = buildState({
      active: buildRecordedCard("049714"),
      deck: [
        buildRecordedCard("049715"),
        buildRecordedCard("048464"),
        psychicEnergy,
      ],
      hand: [prismTower, lillie, psychicEnergy],
    });
    state.stadium = greatTree;
    const context = buildContext(state);
    useStadiumEffect(context);
    expect(canUseStadiumEffect(context)).toBe(false);
    playTrainerFromHand(context, prismTower);
    expect(canUseStadiumEffect(context)).toBe(true);
  });
});

describe("トレーナーズを使えるか", () => {
  // サポートは 1 回の番に 1 枚(docs/pokemon-tcg/basic-rules.md 75 行)。アクロマの執念は山札からスタジアムとエネルギーを
  // 手札に加える(記録 045934)
  test("canPlayTrainerIfInHand は手札に無いサポートでも、この番にサポートを使っていなければ真、使った後は偽", () => {
    const achroma = buildRecordedCard("045934");
    const state = buildState({
      deck: [achroma, buildRecordedCard("049463")],
    });
    const context = buildContext(state);
    expect(canPlayTrainerIfInHand(context, achroma)).toBe(true);
    state.hasUsedSupporter = true;
    expect(canPlayTrainerIfInHand(context, achroma)).toBe(false);
  });

  test("canPlayTrainerFromHand は手札に無いカードには偽", () => {
    const achroma = buildRecordedCard("045934");
    const state = buildState({
      deck: [achroma, buildRecordedCard("049463")],
    });
    expect(canPlayTrainerFromHand(buildContext(state), achroma)).toBe(false);
  });
});
