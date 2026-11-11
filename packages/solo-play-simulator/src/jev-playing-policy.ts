/**
 * Issue 70 の候補 5: TypeSafe AI の Jev(状態と定義済みの質問を渡すと、選択肢ごとの確率を返すモデル)に、番の中の行動と
 * 使うワザを 1 手ずつ選ばせるプレイングの判断基準。効果の中の選択、対戦の準備、きぜつした後に出すベンチポケモンは候補の
 * 先頭から選ぶ(試作の範囲を Issue 70 の決定事項「候補」の「1 手ずつ選ばせる」に絞るため)。
 *
 * 骨組みの番の進行は同期で動くため、Jev を呼ぶ関数は同期で答えを返す関数として外から受け取る(HTTP の呼び出しと API
 * キーの読み取りは scripts/ が行う。骨組みのライブラリは実行環境に依存しない。docs/solo-play-simulator-design.md
 * 「README『提供形態』との関係」)。カードの説明は、カードの記録の欄(公式の内容を読んで計算用に翻訳したもの)から組み立て、
 * 公式サイトのカードテキストは渡さない(Issue 70 の決定事項「候補 5 の条件」)。
 */

import { calculateOpponentAttackDamage } from "./battle-style-solo-play-rules.ts";
import { listUsableAttacksOfActive } from "./card-effects.ts";
import type { CardRecord } from "./card-record-schema.ts";
import type { Card } from "./cards.ts";
import { calculateMaxHp } from "./continuous-effects.ts";
import { type EffectContext, firstCandidateChoices } from "./effect-choices.ts";
import type { PlayingPolicy } from "./engine.ts";
import { listDeckCardNames } from "./learned-win-rate-evaluation.ts";
import {
  describeAction,
  listAvailableActions,
  performAction,
} from "./player-actions.ts";
import type { GameState, PokemonInPlay } from "./state.ts";

/** 計測で使うモデル。別名(jev-latest)ではなく版の名前を書く(https://docs.typesafe.ai/models 、2026-11-12 確認)。 */
export const JEV_MODEL = "jev-1.14.0";

/** Choice の質問の選択肢の上限(https://docs.typesafe.ai/api の ChoiceQuestion、2026-11-12 確認)。 */
const MAX_CHOICE_CRITERIA = 255;

/** 番の中で同じことを繰り返していないかの歯止め。search-policy.ts と同じ考え方。 */
const MAX_ACTIONS_PER_TURN = 100;

const QUESTION_ID = "next";

/** Jev への 1 回の問い合わせ(https://docs.typesafe.ai/api の SystemOneRequest のうち使う欄)。 */
export interface JevChoiceRequest {
  readonly model: string;
  readonly questions: Readonly<
    Record<
      string,
      {
        readonly criteria: Readonly<Record<string, string>>;
        readonly instructions: string;
        readonly type: "choice";
      }
    >
  >;
  readonly state: unknown;
}

/** Jev の答え(https://docs.typesafe.ai/api の SystemOneResponse のうち使う欄)。 */
export interface JevChoiceResponse {
  readonly answers: Readonly<
    Record<string, { readonly choice: string; readonly confidence: number }>
  >;
  readonly model: string;
  readonly usage: { readonly input_tokens: number };
}

/** 問い合わせの回数と、入力のトークン数の合計。 */
export interface JevUsage {
  inputTokens: number;
  requests: number;
}

export interface JevPlayingPolicy extends PlayingPolicy {
  readonly jevUsage: JevUsage;
  /**
   * 計測の集計(battle-style-solo-play-measurement.ts)が探索の仕事の量として読む欄。Jev への問い合わせの回数を、試しの
   * 回数の欄に数える(状態の複製はしないので 0)。
   */
  readonly statistics: { readonly clones: number; trialScores: number };
}

/** 決まりの要約に書く、相手の番の回数(4 回目以降は同じダメージ)。 */
const SUMMARIZED_OPPONENT_TURNS = [1, 2, 3, 4] as const;

/**
 * 対戦風の一人回しの決まりの要約(docs/solo-play-simulator-design.md「対戦風の一人回し(Issue 69)」の「相手の番」
 * 「相手の場のダメージとサイド」「ダメージときぜつ」「勝敗」)。Jev が何を最大にする選択かを読めるように、状態に添える。
 * 相手の攻撃のダメージは battle-style-solo-play-rules.ts の関数から借りる。
 */
const BATTLE_STYLE_RULES_SUMMARY = [
  `相手のカードは無い。相手の番には、自分のバトルポケモンが決まったダメージを受ける(${SUMMARIZED_OPPONENT_TURNS.map(
    (ordinal) =>
      `相手の ${ordinal} 回目${ordinal === 4 ? "以降" : ""}の番 ${calculateOpponentAttackDamage(ordinal)}`
  ).join("、")})`,
  "自分のワザのダメージは相手の場のダメージに足す。自分の番の終わりに相手の場のダメージが 100 以上なら、100 ごとにサイドを 1 枚(1 回に 3 枚まで)取り、0 に戻す",
  "自分のポケモンがきぜつすると、相手がサイドを取る(ポケモンex は 2 枚、メガシンカex は 3 枚、ほかは 1 枚)",
  "自分のサイドを取り切ったら勝ち。相手がサイドを取り切る、場に自分のポケモンがいなくなる、番の最初に山札を引けない、のどれかで負け",
].join("。");

/** カードの記録から、Jev に渡すカードの説明を作る。 */
function describeCardRecord(record: CardRecord) {
  switch (record.category) {
    case "ポケモン":
      return {
        abilities: record.abilities.map((ability) => ({
          name: ability.name,
          ...(ability.translation === undefined
            ? {}
            : { effect: ability.translation }),
        })),
        attacks: record.attacks.map((attack) => ({
          cost: attack.cost,
          damage: attack.damage,
          name: attack.name,
          ...(attack.effect === undefined ? {} : { effect: attack.effect }),
        })),
        category: record.category,
        hp: record.hp,
        name: record.name,
        stage: record.stage,
        type: record.pokemonType,
        ...(record.stage === "たね" ? {} : { evolvesFrom: record.evolvesFrom }),
      };
    case "基本エネルギー":
      return {
        category: record.category,
        name: record.name,
        provision: record.provision,
      };
    default:
      return {
        category: record.category,
        effects: record.cardEffects,
        name: record.name,
      };
  }
}

function describePokemon(state: GameState, pokemon: PokemonInPlay) {
  return {
    damage: pokemon.damage,
    energies: pokemon.energies.map((card) => card.name),
    maxHp: calculateMaxHp(state, pokemon),
    name: pokemon.name,
    ...(pokemon.tool === undefined ? {} : { tool: pokemon.tool.name }),
  };
}

/** Jev に渡す状態。山札の順とサイドの中身は渡さない(Issue 70 の決定事項「測る条件」の 2 つ目)。 */
function describeState(state: GameState, cardDescriptions: readonly unknown[]) {
  return {
    deckCards: cardDescriptions,
    rules: BATTLE_STYLE_RULES_SUMMARY,
    situation: {
      active:
        state.active === undefined
          ? undefined
          : describePokemon(state, state.active),
      bench: state.bench.map((pokemon) => describePokemon(state, pokemon)),
      deckCount: state.deck.length,
      discard: state.discard.map((card) => card.name),
      hand: state.hand.map((card) => card.name),
      opponentFieldDamage: state.opponentFieldDamage,
      opponentRemainingPrizes: state.opponentRemainingPrizeCount,
      ownRemainingPrizes: state.prizes.length,
      ownTurn: state.turn,
      stadium: state.stadium?.name,
    },
  };
}

/**
 * Jev に番の中の行動と使うワザを選ばせる判断基準を作る。cards はデッキの 60 枚で、カードの説明を作るのに使う。
 * requestJevChoice は Jev を呼んで答えを返す関数(テストでは決まった答えを返す偽の関数)。
 */
export function createJevPlayingPolicy(options: {
  readonly cards: readonly Card[];
  readonly requestJevChoice: (request: JevChoiceRequest) => JevChoiceResponse;
}): JevPlayingPolicy {
  const jevUsage: JevUsage = { inputTokens: 0, requests: 0 };
  const statistics = { clones: 0, trialScores: 0 };
  const recordsByName = new Map(
    options.cards.map((card) => [card.name, card.record])
  );
  const cardDescriptions = listDeckCardNames(options.cards).flatMap((name) => {
    const record = recordsByName.get(name);
    return record === undefined ? [] : [describeCardRecord(record)];
  });

  /** 選択肢の説明の並びから 1 つを Jev に選ばせ、選ばれた何番目かを返す。 */
  const chooseIndex = (
    state: GameState,
    instructions: string,
    descriptions: readonly string[]
  ): number => {
    if (descriptions.length > MAX_CHOICE_CRITERIA) {
      throw new Error(
        `Jev の選択肢は ${MAX_CHOICE_CRITERIA} 個までだが、${descriptions.length} 個ある`
      );
    }
    const keys = descriptions.map((_, index) => `option${index}`);
    const response = options.requestJevChoice({
      model: JEV_MODEL,
      questions: {
        [QUESTION_ID]: {
          criteria: Object.fromEntries(
            keys.map((key, index) => [key, descriptions[index] ?? ""])
          ),
          instructions,
          type: "choice",
        },
      },
      state: describeState(state, cardDescriptions),
    });
    jevUsage.requests += 1;
    statistics.trialScores += 1;
    jevUsage.inputTokens += response.usage.input_tokens;
    const chosen = keys.indexOf(response.answers[QUESTION_ID]?.choice ?? "");
    if (chosen < 0) {
      throw new Error("Jev の答えが選択肢に無い");
    }
    return chosen;
  };

  return {
    ...firstCandidateChoices,
    chooseActiveAtSetup: (_, [first]) => {
      if (first === undefined) {
        throw new Error("たねポケモンが無い");
      }
      return first;
    },
    chooseAttack: (context: EffectContext) => {
      const candidates = listUsableAttacksOfActive(context);
      const index = chooseIndex(
        context.state,
        "対戦風の一人回しで勝率が最も高くなるように、この番の最後に使うワザを選ぶ。使わないこともできる",
        [
          ...candidates.map(({ attack }) => `ワザ ${attack.name} を使う`),
          "ワザを使わずに番を終える",
        ]
      );
      return candidates[index];
    },
    chooseBenchAtSetup: (_, basics) => basics,
    jevUsage,
    playTurn: (context: EffectContext) => {
      const { state } = context;
      for (let count = 0; count < MAX_ACTIONS_PER_TURN; count += 1) {
        const actions = listAvailableActions(context);
        if (actions.length === 1) {
          return;
        }
        const action =
          actions[
            chooseIndex(
              state,
              "対戦風の一人回しで勝率が最も高くなるように、この番に次に行う行動を 1 つ選ぶ。「番を終える」を選ぶと、ワザを選ぶところへ進む",
              actions.map((candidate) => describeAction(state, candidate))
            )
          ];
        if (action === undefined || action.kind === "endTurn") {
          return;
        }
        performAction(context, action);
      }
      throw new Error("1 つの番の行動が多すぎる(同じ行動を繰り返している)");
    },
    statistics,
  };
}
