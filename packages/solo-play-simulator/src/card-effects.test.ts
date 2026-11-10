import { describe, expect, test } from "bun:test";
import {
  knockOutOwnPokemon,
  playOpponentTurn,
} from "./battle-style-solo-play-rules.ts";
import {
  canPlayTrainerFromHand,
  canPlayTrainerIfInHand,
  canUseAbility,
  canUseStadiumEffect,
  listUsableAttacksOfActive,
  playTrainerFromHand,
  useAttack,
  useStadiumEffect,
} from "./card-effects.ts";
import {
  CardCategory,
  type Effect,
  type PokemonRecord,
} from "./card-record-schema.ts";
import {
  activeOf,
  benchAt,
  buildContext,
  buildRecordedCard,
  buildState,
  useAttackNamed,
} from "./card-test-support.ts";
import { buildCardFromRecord } from "./cards.ts";
import { areConditionsMet } from "./conditions.ts";
import {
  BASIC,
  ENERGY,
  SAMPLE_RECORD_TABLE,
  STURDY_BASIC,
} from "./sample-cards.ts";
import { IllegalMove } from "./state.ts";

/** テスト用のたねポケモン(BASIC)の記録の欄を差し替えたカード。部品ごとのテストで、部品を 1 つだけ持つ記録を作る。 */
function buildBasicWith(
  overrides: Pick<Partial<PokemonRecord>, "abilities" | "attacks">
) {
  const basicRecord = SAMPLE_RECORD_TABLE.get(BASIC.cardId);
  if (basicRecord?.category !== CardCategory.Pokemon) {
    throw new Error("テスト用のたねポケモンの記録が無い");
  }
  const record: PokemonRecord = {
    ...basicRecord,
    ...overrides,
    translationStatus: "translated",
  };
  return buildCardFromRecord(record, BASIC.cardId);
}

/** 必要なエネルギーもダメージも無く、効果だけを持つワザ「部品のワザ」を持つたねポケモン。 */
function buildBasicWithAttackEffect(effect: Effect) {
  return buildBasicWith({
    attacks: [
      { cost: [], damage: { kind: "none" }, effect, name: "部品のワザ" },
    ],
  });
}

function buildPokemonWithConditionalAttack() {
  return buildBasicWith({
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
  });
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

describe("Issue 69 で足した記法の部品", () => {
  test("discardEnergyAttachedToSelf の fixed は、決まった数のエネルギーを選んでトラッシュし、all はすべてトラッシュする", () => {
    for (const [count, remaining] of [
      [{ kind: "fixed", value: 2 }, 1],
      [{ kind: "all" }, 0],
    ] as const) {
      const state = buildState({
        active: buildBasicWithAttackEffect({
          isOptional: false,
          steps: [{ count, operation: "discardEnergyAttachedToSelf" }],
          useConditions: [],
        }),
      });
      activeOf(state).energies.push(ENERGY, ENERGY, ENERGY);
      useAttackNamed(buildContext(state), "部品のワザ");
      expect(activeOf(state).energies).toHaveLength(remaining);
      expect(state.discard).toHaveLength(3 - remaining);
    }
  });

  test("selfHasEnergyAttached に energyFilter を書くと、条件に合うエネルギーがついているときだけ満たす", () => {
    const pokemon = buildBasicWith({
      abilities: [
        {
          name: "部品の特性",
          translation: {
            effect: {
              isOptional: false,
              steps: [
                { count: { kind: "fixed", value: 1 }, operation: "drawCards" },
              ],
              useConditions: [
                {
                  condition: "selfHasEnergyAttached",
                  energyFilter: { providedEnergyTypes: ["dark"] },
                },
              ],
            },
            kind: "activatedInPlay",
            usageLimit: "oncePerTurnPerPokemon",
          },
        },
      ],
    });
    const state = buildState({ active: pokemon, deck: [BASIC] });
    const context = buildContext(state);
    // 基本超エネルギー(テスト用の記録 900004)は超を供給する
    activeOf(state).energies.push(ENERGY);
    expect(canUseAbility(context, activeOf(state), "部品の特性")).toBe(false);
    // 基本悪エネルギー(記録 047909)は悪を供給する
    activeOf(state).energies.push(buildRecordedCard("047909"));
    expect(canUseAbility(context, activeOf(state), "部品の特性")).toBe(true);
  });

  test("ownPokemonKnockedOutDuringPreviousOpponentTurn は、最後に行った相手の番に自分のポケモンがきぜつしたときだけ満たし、自分の番のきぜつは数えない", () => {
    // 相手の 2 回目の番は 100、3 回目は 200 のダメージ(docs/solo-play-simulator-design.md「対戦風の一人回し」)。
    // BASIC は HP 60、STURDY_BASIC は HP 20000(テスト用の記録)
    const state = buildState({
      active: BASIC,
      bench: [STURDY_BASIC, BASIC],
    });
    const context = buildContext(state);
    const isMet = () =>
      areConditionsMet(
        state,
        [{ condition: "ownPokemonKnockedOutDuringPreviousOpponentTurn" }],
        { card: BASIC, pokemon: undefined }
      );
    expect(isMet()).toBe(false);
    state.opponentTurnCount = 1;
    playOpponentTurn(context);
    expect(activeOf(state).name).toBe("HPの高いたね");
    expect(isMet()).toBe(true);
    playOpponentTurn(context);
    expect(isMet()).toBe(false);
    state.turnOwner = "self";
    knockOutOwnPokemon(context, benchAt(state, 0));
    expect(state.bench).toEqual([]);
    expect(isMet()).toBe(false);
  });

  test("ownRemainingPrizesExceedOpponents は、自分のサイドの残りが相手より多いときだけ満たす", () => {
    const state = buildState({ active: BASIC });
    const isMet = () =>
      areConditionsMet(
        state,
        [{ condition: "ownRemainingPrizesExceedOpponents" }],
        {
          card: BASIC,
          pokemon: undefined,
        }
      );
    expect(isMet()).toBe(false);
    state.opponentRemainingPrizeCount = 5;
    expect(isMet()).toBe(true);
    state.prizes.pop();
    expect(isMet()).toBe(false);
  });

  test("attachEnergyFromDiscardToOnePokemon に minCount を書くと、それより少ない枚数の選択は IllegalMove になり、minCount を省略すると 0 枚を選べる(ミュウツー 050573 の「ちからをあたえる」と同じ)", () => {
    const choosesNothing = { chooseCards: () => [] };
    const buildWithMinCount = (minCount: 1 | undefined) =>
      buildState({
        active: buildBasicWithAttackEffect({
          isOptional: false,
          steps: [
            {
              energyFilter: { categories: [CardCategory.BasicEnergy] },
              maxCount: 2,
              ...(minCount === undefined ? {} : { minCount }),
              operation: "attachEnergyFromDiscardToOnePokemon",
              targetFilter: {},
            },
          ],
          useConditions: [],
        }),
        discard: [ENERGY, ENERGY],
      });
    const withMinCount = buildWithMinCount(1);
    expect(() =>
      useAttackNamed(buildContext(withMinCount, choosesNothing), "部品のワザ")
    ).toThrow(IllegalMove);
    const withoutMinCount = buildWithMinCount(undefined);
    useAttackNamed(buildContext(withoutMinCount, choosesNothing), "部品のワザ");
    expect(activeOf(withoutMinCount).energies).toEqual([]);
    expect(withoutMinCount.discard).toHaveLength(2);
  });
});
