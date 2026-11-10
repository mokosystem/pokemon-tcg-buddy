/**
 * 今できる行動の一覧(player-actions.ts)から手を選ばずに行動するプレイングの判断基準。勝率を最大にする基準ではなく、
 * 翻訳した効果と一覧の行動が基本ルールに反さずに勝敗まで動くかを確かめるテストと、Issue 70 の調査で比べる下限に使う。
 * 効果の中の選択は候補の先頭から選ぶ。
 */

import { listUsableAttacksOfActive } from "./card-effects.ts";
import { type EffectContext, firstCandidateChoices } from "./effect-choices.ts";
import type { PlayingPolicy } from "./engine.ts";
import {
  listAvailableActions,
  type PlayerAction,
  performAction,
} from "./player-actions.ts";
import { createSeededRandom } from "./random.ts";
import type { PokemonInPlay } from "./state.ts";

/** 番の中で同じ行動を繰り返していないかの歯止め。1 つの番の行動はカードの枚数と番に 1 回の制限で有限になる。 */
const MAX_ACTIONS_PER_TURN = 200;

type PickOne<T> = (items: readonly T[]) => T | undefined;

/**
 * 番の中で、pickAction が選んだ行動を「番を終える」が選ばれるまで行い、きぜつした後は pickPokemonToPromote が選んだ
 * ベンチポケモンを出す判断基準。対戦の準備では手札の最初のたねポケモンをバトル場に出し、残りをベンチに並べる。
 */
function createActionListPolicy(
  pickAction: PickOne<PlayerAction>,
  pickPokemonToPromote: PickOne<PokemonInPlay>
): PlayingPolicy {
  return {
    ...firstCandidateChoices,
    chooseActiveAtSetup: (_, [first]) => {
      if (first === undefined) {
        throw new Error("たねポケモンが無い");
      }
      return first;
    },
    chooseAttack: (context) => listUsableAttacksOfActive(context)[0],
    chooseBenchAtSetup: (_, basics) => basics,
    choosePokemonToPromoteAfterKnockOut: (_, candidates) => {
      const chosen = pickPokemonToPromote(candidates);
      if (chosen === undefined) {
        throw new Error(
          "きぜつした後にバトル場に出すベンチポケモンの候補が無い"
        );
      }
      return chosen;
    },
    playTurn: (context: EffectContext) => {
      for (let count = 0; count < MAX_ACTIONS_PER_TURN; count += 1) {
        const action = pickAction(listAvailableActions(context));
        if (action === undefined) {
          throw new Error("今できる行動の一覧が空");
        }
        if (action.kind === "endTurn") {
          return;
        }
        performAction(context, action);
      }
      throw new Error("1 つの番の行動が多すぎる(同じ行動を繰り返している)");
    },
  };
}

/** 一覧の先頭の行動を片端から行い(番を終えるのは、ほかにできる行動が無いとき)、きぜつした後はベンチの先頭を出す。 */
export function createFirstActionPolicy(): PlayingPolicy {
  return createActionListPolicy(
    ([first]) => first,
    ([first]) => first
  );
}

/** 一覧から乱数で行動を 1 つ選び(番を終えるも候補)、きぜつした後に出すベンチポケモンも乱数で選ぶ。 */
export function createRandomActionPolicy(seed: number): PlayingPolicy {
  const random = createSeededRandom(seed);
  const pickAtRandom = <T>(items: readonly T[]): T | undefined =>
    items[Math.floor(random.nextFloat() * items.length)];
  return createActionListPolicy(pickAtRandom, pickAtRandom);
}
