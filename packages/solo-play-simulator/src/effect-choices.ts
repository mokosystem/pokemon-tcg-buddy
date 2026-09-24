/**
 * 効果の中の選択(どれを、いくつ、誰に、使うかどうか)の問い合わせ口。CONTEXT.md「プレイングの判断基準」の一部で、
 * 記法では決めない。選ばれた結果は候補と枚数の範囲に収まっているかを検査し、外れていれば IllegalMove を投げる。
 */

import type { Card } from "./cards.ts";
import { type GameState, IllegalMove, type PokemonInPlay } from "./state.ts";

export interface CardChoiceRequest {
  readonly candidates: readonly Card[];
  readonly maxCount: number;
  readonly minCount: number;
  /** 選んだエネルギーのタイプがすべて違う必要がある(アカマツ)。 */
  readonly mustHaveDistinctTypes?: boolean;
  /** 何のための選択か。人が履歴を読むためのもので、判定には使わない。 */
  readonly purpose: string;
}

export interface PokemonChoiceRequest {
  readonly candidates: readonly PokemonInPlay[];
  readonly maxCount: number;
  readonly minCount: number;
  readonly purpose: string;
}

/** 効果の中の選択。順 7 の探索が実装する。テストは固定の手順を書く。 */
export interface EffectChoices {
  chooseCards: (
    state: GameState,
    request: CardChoiceRequest
  ) => readonly Card[];
  choosePokemon: (
    state: GameState,
    request: PokemonChoiceRequest
  ) => readonly PokemonInPlay[];
  /** 「のぞむなら」の効果や、使うかを選べるきっかけの効果を起こすか。 */
  choosesToApplyOptionalEffect: (state: GameState, purpose: string) => boolean;
}

export interface EffectContext {
  readonly choices: EffectChoices;
  readonly state: GameState;
}

function countByReference<T>(items: readonly T[]): Map<T, number> {
  const counts = new Map<T, number>();
  for (const item of items) {
    counts.set(item, (counts.get(item) ?? 0) + 1);
  }
  return counts;
}

/** 選ばれたものが候補の中にあり(同じ参照は候補にある数まで)、枚数が範囲に収まっているか。 */
function validateChosen<T>(
  request: {
    readonly candidates: readonly T[];
    readonly maxCount: number;
    readonly minCount: number;
    readonly purpose: string;
  },
  chosen: readonly T[]
): void {
  if (chosen.length < request.minCount || chosen.length > request.maxCount) {
    throw new IllegalMove(
      `${request.purpose}: ${request.minCount}〜${request.maxCount} 個を選ぶところ ${chosen.length} 個を選んだ`
    );
  }
  const available = countByReference(request.candidates);
  for (const [item, count] of countByReference(chosen)) {
    if ((available.get(item) ?? 0) < count) {
      throw new IllegalMove(`${request.purpose}: 候補に無いものを選んだ`);
    }
  }
}

function listProvidedTypeOrName(card: Card): string {
  return card.provision?.kind === "type" ? card.provision.type : card.name;
}

export function chooseCards(
  context: EffectContext,
  request: CardChoiceRequest
): readonly Card[] {
  if (request.maxCount === 0) {
    return [];
  }
  const chosen = context.choices.chooseCards(context.state, request);
  validateChosen(request, chosen);
  if (request.mustHaveDistinctTypes) {
    const types = chosen.map(listProvidedTypeOrName);
    if (new Set(types).size !== types.length) {
      throw new IllegalMove(`${request.purpose}: 同じタイプを 2 枚選んだ`);
    }
  }
  return chosen;
}

/** 候補から min〜max 枚を選ぶ。候補が足りないときは、ある分までに範囲を縮める。 */
export function chooseCardsWithin(
  context: EffectContext,
  candidates: readonly Card[],
  counts: { readonly maxCount: number; readonly minCount: number },
  purpose: string
): readonly Card[] {
  return chooseCards(context, {
    candidates,
    maxCount: Math.min(counts.maxCount, candidates.length),
    minCount: Math.min(counts.minCount, candidates.length),
    purpose,
  });
}

/** 候補から 0〜maxCount 匹を選ぶ。候補が足りないときは、ある分までに範囲を縮める。 */
export function choosePokemonUpTo(
  context: EffectContext,
  candidates: readonly PokemonInPlay[],
  maxCount: number,
  purpose: string
): readonly PokemonInPlay[] {
  if (candidates.length === 0) {
    return [];
  }
  const request = {
    candidates,
    maxCount: Math.min(maxCount, candidates.length),
    minCount: 0,
    purpose,
  };
  const chosen = context.choices.choosePokemon(context.state, request);
  validateChosen(request, chosen);
  return chosen;
}

/** 候補が 1 つでもあれば必ず 1 匹を選ぶ。候補が無ければ null。 */
export function chooseOnePokemon(
  context: EffectContext,
  candidates: readonly PokemonInPlay[],
  purpose: string
): PokemonInPlay | null {
  if (candidates.length === 0) {
    return null;
  }
  const request = { candidates, maxCount: 1, minCount: 1, purpose };
  const chosen = context.choices.choosePokemon(context.state, request);
  validateChosen(request, chosen);
  return chosen[0] ?? null;
}
