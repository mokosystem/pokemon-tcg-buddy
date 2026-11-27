/**
 * 対戦風の一人回しのルール(相手の攻撃、ダメージときぜつ、相手の場のダメージとサイド、勝敗)。ルールの数値と条件は
 * ここにだけ置き、番の進行(engine.ts)と効果の実行(effect-operations.ts、card-effects.ts)はここの関数を呼ぶ。
 * 決まりの出典は docs/solo-play-simulator-design.md「対戦風の一人回し」。
 */

import { trimBenchToLimit } from "./bench-limit.ts";
import {
  type FieldPosition,
  FieldPositionSchema,
} from "./card-record-schema.ts";
import type { Card } from "./cards.ts";
import {
  calculateMaxHp,
  listUnusedPrizeReductionsForKnockOutByOpponentAttack,
  type PrizeReductionForKnockOut,
} from "./continuous-effects.ts";
import {
  chooseOnePokemonToPromote,
  type EffectContext,
} from "./effect-choices.ts";
import type {
  BattleStyleSoloPlayDecisionReason,
  GameState,
  PokemonInPlay,
} from "./state.ts";

/** 相手の n 回目の番に、自分のバトルポケモンが受けるダメージ。4 回目以降は 300。 */
const OPPONENT_ATTACK_DAMAGES = [0, 100, 200] as const;
const OPPONENT_ATTACK_DAMAGE_FROM_FOURTH_TURN = 300;
/** ポケモンの数を使うカードの計算では、相手のベンチをこの数で数える。ダメージの置き場はベンチに 1 つ。 */
export const OPPONENT_BENCH_POKEMON_COUNT = 2;
/**
 * 相手のバトル場のダメージと相手のベンチのダメージを、それぞれ 100 ごとにサイド 1 枚とし、1 つの置き場の 1 回の判定で
 * 取るのは 3 枚まで(docs/solo-play-simulator-design.md「相手の場のダメージとサイド」)。
 */
const OPPONENT_FIELD_DAMAGE_PER_PRIZE = 100;
const MAX_PRIZES_PER_OPPONENT_FIELD_POSITION = 3;

const OPPONENT_FIELD_DAMAGE_LABELS: Readonly<Record<FieldPosition, string>> = {
  active: "相手のバトル場のダメージ",
  bench: "相手のベンチのダメージ",
};

export function calculateOpponentAttackDamage(
  opponentTurnOrdinal: number
): number {
  return (
    OPPONENT_ATTACK_DAMAGES[opponentTurnOrdinal - 1] ??
    OPPONENT_ATTACK_DAMAGE_FROM_FOURTH_TURN
  );
}

/** きぜつしたときに相手が取るサイドの枚数。ルールを持たないポケモンは 1、ポケモンex は 2、メガシンカex は 3。 */
function countPrizesForKnockOut(card: Card): number {
  switch (card.exRule) {
    case "megaEvolutionEx":
      return 3;
    case "pokemonEx":
      return 2;
    default:
      return 1;
  }
}

const DECISION_REASON_LABELS: Readonly<
  Record<BattleStyleSoloPlayDecisionReason, string>
> = {
  cannotDrawAtTurnStart: "番の最初に山札を引けず負け",
  noOwnPokemonInPlay: "場に自分のポケモンがいなくなり負け",
  opponentPrizesTaken: "相手がサイドを取り切り負け",
  ownPrizesTaken: "自分がサイドを取り切り勝ち",
};

/** 勝敗を決める。決まった後に呼ばれても変えない。勝敗が決まった番は、いま進めている番にする。 */
function decide(
  state: GameState,
  reason: BattleStyleSoloPlayDecisionReason
): void {
  if (state.decision !== undefined) {
    return;
  }
  const ordinal =
    state.turnOwner === "self" ? state.turn : state.opponentTurnCount;
  state.decision = {
    decidedTurn: { ordinal, owner: state.turnOwner },
    reason,
  };
  state.record(DECISION_REASON_LABELS[reason]);
}

/** 場に自分のポケモンが 1 匹もいなければ負けにする(docs/pokemon-tcg/basic-rules.md「きぜつと勝敗」2)。 */
export function decideLossIfNoOwnPokemonInPlay(state: GameState): void {
  if (state.listPokemonInPlay().length === 0) {
    decide(state, "noOwnPokemonInPlay");
  }
}

/**
 * 自分のポケモンがきぜつした原因。相手の攻撃(相手のバトルポケモンが使うワザのダメージとして扱う。
 * docs/solo-play-simulator-design.md「相手の番」)か、自分のカードの効果か。
 */
export type OwnKnockOutCause = "opponentAttack" | "ownCardEffect";

/**
 * 取られるサイドを減らす効果(レガシーエネルギー。カードの記録 049457)を、きぜつしたときに相手が取るサイドの枚数
 * prizeCount に当てる。当てた効果を対戦中に使ったものとして記録し、履歴に書いて、減らした後の枚数を返す。0 枚を
 * 下回らない(ほかの効果と合わせて 0 枚になったときも、効果は働いたことになる。同じ記録の裁定のデータ)。
 */
function applyPrizeReductionsForKnockOut(
  state: GameState,
  prizeCount: number,
  reductions: readonly PrizeReductionForKnockOut[]
): number {
  let reducedCount = prizeCount;
  for (const { amount, cardName } of reductions) {
    reducedCount = Math.max(0, reducedCount - amount);
    state.usedOncePerGameEffectCardNames.push(cardName);
    state.record(`${cardName}: 相手が取るサイド -${amount}`);
  }
  return reducedCount;
}

/**
 * 自分のポケモンをきぜつさせる。ついているカードごとトラッシュし、相手がサイドを取る。cause はきぜつの原因で、
 * 取られるサイドを減らす効果が働くかを決める。相手がサイドを取り切ったら、
 * 場のポケモンがいなくなる負けより先に判定する(同時に成り立つときの理由は「相手がサイドを取り切った」。
 * docs/pokemon-tcg/basic-rules.md「きぜつと勝敗」の並びの順)。ベンチの上限が下がっていれば、バトル場に出す前に
 * ベンチを減らす(公式 Q&A「ゼロの大空洞」の順。効果で場を離れたとき(effect-operations.ts の returnToZone)と同じ)。
 */
export function knockOutOwnPokemon(
  context: EffectContext,
  pokemon: PokemonInPlay,
  cause: OwnKnockOutCause
): void {
  const { state } = context;
  // 取られるサイドを減らす効果は、相手の攻撃によるきぜつにだけ働く。ついているカードの効果は場にある間しか集められない
  // ので、きぜつしたポケモンをトラッシュする前に集める
  const prizeReductions =
    cause === "opponentAttack"
      ? listUnusedPrizeReductionsForKnockOutByOpponentAttack(state, pokemon)
      : [];
  state.discardKnockedOutPokemon(pokemon);
  const prizeCount = applyPrizeReductionsForKnockOut(
    state,
    countPrizesForKnockOut(pokemon.card),
    prizeReductions
  );
  state.opponentRemainingPrizeCount -= Math.min(
    prizeCount,
    state.opponentRemainingPrizeCount
  );
  if (state.turnOwner === "opponent") {
    state.latestOpponentTurnWithOwnKnockOut = state.opponentTurnCount;
  }
  if (state.opponentRemainingPrizeCount === 0) {
    decide(state, "opponentPrizesTaken");
    return;
  }
  trimBenchToLimit(context);
  decideLossIfNoOwnPokemonInPlay(state);
  if (state.decision !== undefined) {
    return;
  }
  if (state.active === undefined) {
    // 候補は写して渡す。ベンチの配列はバトル場に出すと変わるため
    state.promoteToActive(chooseOnePokemonToPromote(context, [...state.bench]));
  }
}

/**
 * のっているダメージが最大 HP 以上になった自分の場のポケモンを、すべてきぜつさせる(docs/pokemon-tcg/basic-rules.md
 * 90 行)。最大 HP は HP を増やす効果を足した値(continuous-effects.ts の calculateMaxHp)。ダメージと HP を比べて
 * きぜつさせる処理はここだけに置き、相手の攻撃の後と、スタジアムを出した後(ポケモンのどうぐの効果が無くなって最大 HP が下がる)に
 * 呼ぶ。最大 HP を下げる部品をほかに足したら、その処理の後にもこの関数を呼ぶ。バトルポケモンを最後にするのは、バトル場に
 * 出すベンチポケモンの候補に、同時にきぜつするポケモンを入れないため。cause は、呼び出す側が場面に合わせて渡す
 * (相手の攻撃の後は opponentAttack、スタジアムを出した後は ownCardEffect)。
 */
export function knockOutOwnPokemonAtOrAboveMaxHp(
  context: EffectContext,
  cause: OwnKnockOutCause
): void {
  const { state } = context;
  // きぜつさせながら探すと、バトル場に出したポケモンを同じ回で調べ直すことになるため、先に対象をすべて集める
  const isAtOrAboveMaxHp = (pokemon: PokemonInPlay) =>
    pokemon.damage >= calculateMaxHp(state, pokemon);
  const targets = [
    ...state.bench.filter(isAtOrAboveMaxHp),
    ...(state.active !== undefined && isAtOrAboveMaxHp(state.active)
      ? [state.active]
      : []),
  ];
  for (const target of targets) {
    if (state.decision !== undefined) {
      return;
    }
    knockOutOwnPokemon(context, target, cause);
  }
}

/**
 * 相手の番を 1 回行う。相手の番に起きるのは相手の攻撃だけで、自分のバトルポケモンが決まったダメージを受ける。
 * 弱点と抵抗力は計算せず、ベンチポケモンはダメージを受けない。
 */
export function playOpponentTurn(context: EffectContext): void {
  const { state } = context;
  state.turnOwner = "opponent";
  state.opponentTurnCount += 1;
  state.record("相手の番");
  const { active } = state;
  if (active === undefined) {
    throw new Error("バトル場が空のまま相手の番になった");
  }
  const damage = calculateOpponentAttackDamage(state.opponentTurnCount);
  if (damage > 0) {
    active.damage += damage;
    state.record(
      `相手の攻撃: ${active.name} に ${damage} ダメージ(合計 ${active.damage})`
    );
    knockOutOwnPokemonAtOrAboveMaxHp(context, "opponentAttack");
  }
}

/** 自分の番を始める。山札が 0 枚なら番を進めてから負けにする(docs/pokemon-tcg/basic-rules.md「きぜつと勝敗」3)。 */
export function beginOwnTurn(state: GameState): void {
  state.turnOwner = "self";
  if (state.deck.length === 0) {
    state.advanceToNextTurn();
    decide(state, "cannotDrawAtTurnStart");
    return;
  }
  state.beginTurn();
}

/** 相手の場のダメージのうち、position の 1 つに amount を足す。相手のベンチポケモンが何匹いるかは区別しない。 */
export function addDamageToOpponentField(
  state: GameState,
  position: FieldPosition,
  amount: number,
  label: string
): void {
  state.opponentFieldDamage[position] += amount;
  state.record(
    `${label}: ${OPPONENT_FIELD_DAMAGE_LABELS[position]} +${amount}(合計 ${state.opponentFieldDamage[position]})`
  );
}

/**
 * 自分の番の終わりに 1 回だけ、相手のバトル場のダメージと相手のベンチのダメージでサイドを取るかを、それぞれ判定する。
 * 100 未満の置き場は取らずに持ち越し、取った置き場は余りを持ち越さず 0 に戻す。2 つで取る枚数は足し、サイドの残りより
 * 多いときは残りをすべて取る。
 */
export function takePrizesForOpponentFieldDamage(state: GameState): void {
  let count = 0;
  for (const position of FieldPositionSchema.options) {
    const countForPosition = Math.min(
      Math.floor(
        state.opponentFieldDamage[position] / OPPONENT_FIELD_DAMAGE_PER_PRIZE
      ),
      MAX_PRIZES_PER_OPPONENT_FIELD_POSITION
    );
    if (countForPosition > 0) {
      count += countForPosition;
      state.opponentFieldDamage[position] = 0;
    }
  }
  if (count === 0) {
    return;
  }
  const taken = Math.min(count, state.prizes.length);
  for (let index = 0; index < taken; index += 1) {
    state.takePrizeIntoHand();
  }
  if (state.prizes.length === 0) {
    decide(state, "ownPrizesTaken");
  }
}
