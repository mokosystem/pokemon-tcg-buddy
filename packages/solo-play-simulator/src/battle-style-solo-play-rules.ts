/**
 * 対戦風の一人回しのルール(相手の攻撃、ダメージときぜつ、相手の場のダメージとサイド、勝敗)。ルールの数値と条件は
 * ここにだけ置き、番の進行(engine.ts)と効果の実行(effect-operations.ts、card-effects.ts)はここの関数を呼ぶ。
 * 決まりの出典は docs/solo-play-simulator-design.md「対戦風の一人回し」。
 */

import { trimBenchToLimit } from "./bench-limit.ts";
import type { Card } from "./cards.ts";
import { calculateMaxHp } from "./continuous-effects.ts";
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
/** 相手の場のダメージ 100 ごとにサイドを 1 枚取り、1 回の判定で取るのは 3 枚まで。 */
const OPPONENT_FIELD_DAMAGE_PER_PRIZE = 100;
const MAX_PRIZES_PER_FIELD_DAMAGE_CHECK = 3;

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
 * 自分のポケモンをきぜつさせる。ついているカードごとトラッシュし、相手がサイドを取る。相手がサイドを取り切ったら、
 * 場のポケモンがいなくなる負けより先に判定する(同時に成り立つときの理由は「相手がサイドを取り切った」。
 * docs/pokemon-tcg/basic-rules.md「きぜつと勝敗」の並びの順)。ベンチの上限が下がっていれば、バトル場に出す前に
 * ベンチを減らす(公式 Q&A「ゼロの大空洞」の順。効果で場を離れたとき(effect-operations.ts の returnToZone)と同じ)。
 */
export function knockOutOwnPokemon(
  context: EffectContext,
  pokemon: PokemonInPlay
): void {
  const { state } = context;
  state.discardKnockedOutPokemon(pokemon);
  state.opponentRemainingPrizeCount -= Math.min(
    countPrizesForKnockOut(pokemon.card),
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
 * 出すベンチポケモンの候補に、同時にきぜつするポケモンを入れないため。
 */
export function knockOutOwnPokemonAtOrAboveMaxHp(context: EffectContext): void {
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
    knockOutOwnPokemon(context, target);
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
    knockOutOwnPokemonAtOrAboveMaxHp(context);
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

/** 相手の場のダメージに amount を足す。相手のどのポケモンに与えるかは区別しない。 */
export function addDamageToOpponentField(
  state: GameState,
  amount: number,
  label: string
): void {
  state.opponentFieldDamage += amount;
  state.record(
    `${label}: 相手の場のダメージ +${amount}(合計 ${state.opponentFieldDamage})`
  );
}

/**
 * 自分の番の終わりに 1 回だけ、相手の場のダメージでサイドを取るかを判定する。100 未満なら取らずに持ち越し、
 * 取ったら余りを持ち越さず 0 に戻す。取る枚数がサイドの残りより多いときは残りをすべて取る。
 */
export function takePrizesForOpponentFieldDamage(state: GameState): void {
  const count = Math.min(
    Math.floor(state.opponentFieldDamage / OPPONENT_FIELD_DAMAGE_PER_PRIZE),
    MAX_PRIZES_PER_FIELD_DAMAGE_CHECK
  );
  if (count === 0) {
    return;
  }
  const taken = Math.min(count, state.prizes.length);
  for (let index = 0; index < taken; index += 1) {
    state.takePrizeIntoHand();
  }
  state.opponentFieldDamage = 0;
  if (state.prizes.length === 0) {
    decide(state, "ownPrizesTaken");
  }
}
