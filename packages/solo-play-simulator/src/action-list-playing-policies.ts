/**
 * 今できる行動の一覧(player-actions.ts)から手を選ばずに行動するプレイングの判断基準。勝率を最大にする基準ではなく、
 * 翻訳した効果と一覧の行動が基本ルールに反さずに勝敗まで動くかを確かめるテストと、Issue 70 の調査で比べる下限と、
 * 探索の試し回し(GLOSSARY.md)の軽い手順に使う。効果の中の選択は候補の先頭から選ぶ。
 */

import { listUsableAttacksOfActive } from "./card-effects.ts";
import type { UsableAttack } from "./continuous-effects.ts";
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

/** 手順が何をどう選ぶか。 */
interface ActionListPicks {
  /** 今できる行動の一覧から、次に行う行動を選ぶ。「番を終える」を選んだら番の中の行動を終える。 */
  readonly pickAction: PickOne<PlayerAction>;
  /** 使えるワザの一覧から、使うワザを選ぶ。undefined なら使わない。 */
  readonly pickAttack: PickOne<UsableAttack>;
  /** きぜつした後にバトル場に出すベンチポケモンを選ぶ。 */
  readonly pickPokemonToPromote: PickOne<PokemonInPlay>;
}

/**
 * 番の中で、pickAction が選んだ行動を「番を終える」が選ばれるまで行い、ワザは pickAttack が選んだものを使い、きぜつした後は
 * pickPokemonToPromote が選んだベンチポケモンを出す判断基準。対戦の準備では手札の最初のたねポケモンをバトル場に出し、
 * 残りをベンチに並べる。
 */
function createActionListPolicy(picks: ActionListPicks): PlayingPolicy {
  return {
    ...firstCandidateChoices,
    chooseActiveAtSetup: (_, [first]) => {
      if (first === undefined) {
        throw new Error("たねポケモンが無い");
      }
      return first;
    },
    chooseAttack: (context) =>
      picks.pickAttack(listUsableAttacksOfActive(context)),
    chooseBenchAtSetup: (_, basics) => basics,
    choosePokemonToPromoteAfterKnockOut: (_, candidates) => {
      const chosen = picks.pickPokemonToPromote(candidates);
      if (chosen === undefined) {
        throw new Error(
          "きぜつした後にバトル場に出すベンチポケモンの候補が無い"
        );
      }
      return chosen;
    },
    playTurn: (context: EffectContext) => {
      for (let count = 0; count < MAX_ACTIONS_PER_TURN; count += 1) {
        const action = picks.pickAction(listAvailableActions(context));
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

function pickFirst<T>([first]: readonly T[]): T | undefined {
  return first;
}

function createPickAtRandom(
  seed: number
): <T>(items: readonly T[]) => T | undefined {
  const random = createSeededRandom(seed);
  return (items) => items[Math.floor(random.nextFloat() * items.length)];
}

/** 一覧の先頭の行動を片端から行い(番を終えるのは、ほかにできる行動が無いとき)、きぜつした後はベンチの先頭を出す。 */
export function createFirstActionPolicy(): PlayingPolicy {
  return createActionListPolicy({
    pickAction: pickFirst,
    pickAttack: pickFirst,
    pickPokemonToPromote: pickFirst,
  });
}

/** 一覧から乱数で行動を 1 つ選び(番を終えるも候補)、きぜつした後に出すベンチポケモンも乱数で選ぶ。 */
export function createRandomActionPolicy(seed: number): PlayingPolicy {
  const pickAtRandom = createPickAtRandom(seed);
  return createActionListPolicy({
    pickAction: pickAtRandom,
    pickAttack: pickFirst,
    pickPokemonToPromote: pickAtRandom,
  });
}

/** 試し回しの軽い手順が選ばない行動。番を終えるのは選べる行動が無くなったときだけにし、にげるは選ばない。 */
const ACTION_KINDS_SKIPPED_IN_PLAYOUT: ReadonlySet<PlayerAction["kind"]> =
  new Set(["endTurn", "retreat"]);

/**
 * 試し回しの軽い手順。今できる行動の一覧から「番を終える」と「にげる」を除いた行動を乱数で選び、選べる行動が無くなったら
 * 番を終える。ワザは使えるワザの一覧から乱数で選び、使えるワザがあれば必ず使う。きぜつした後に出すベンチポケモンも乱数で選ぶ。
 * 効果の中の選択は候補の先頭から選ぶ。
 * この手順にした理由(にげるを選ばない、ワザを一覧の最後から選ばない)と、その根拠の勝率は
 * docs/solo-play-simulator-design.md「プレイングの判断基準の調査(Issue 70)」の「候補と設定」にある。
 */
export function createPlayoutActionPolicy(seed: number): PlayingPolicy {
  const pickAtRandom = createPickAtRandom(seed);
  return createActionListPolicy({
    pickAction: (actions) =>
      pickAtRandom(
        actions.filter(
          (action) => !ACTION_KINDS_SKIPPED_IN_PLAYOUT.has(action.kind)
        )
      ) ?? actions.find((action) => action.kind === "endTurn"),
    pickAttack: pickAtRandom,
    pickPokemonToPromote: pickAtRandom,
  });
}
