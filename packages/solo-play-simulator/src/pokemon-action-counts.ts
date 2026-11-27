import type { Card } from "./cards.ts";

/** 改善用の勝率を測った対戦で、ワザを使った回数とエネルギーがついた回数を、行動時のカードの記録で数える。 */
export type PokemonAction = "attacks" | "energyReceived";

export type ObservePokemonAction = (kind: PokemonAction, card: Card) => void;

export interface PokemonActionFrequency {
  readonly games: number;
  readonly times: number;
}

export type PokemonActionsByOutcome = Partial<
  Record<
    "win" | "loss",
    { readonly games: number } & Record<
      PokemonAction,
      Readonly<Record<string, PokemonActionFrequency>>
    >
  >
>;

type ByCard = Readonly<Record<string, PokemonActionFrequency>>;

export function countPokemonActionsInGame() {
  const counts: Record<
    PokemonAction,
    Record<string, PokemonActionFrequency>
  > = {
    attacks: {},
    energyReceived: {},
  };
  const observe: ObservePokemonAction = (kind, card) => {
    // 同じ記録のカードが1対戦に複数のIDで入っていても対戦数は1と数える。
    const cardId = card.record.cardIds[0] ?? card.cardId;
    const times = counts[kind][cardId]?.times ?? 0;
    counts[kind][cardId] = { games: 1, times: times + 1 };
  };
  return {
    byOutcome(outcome: "win" | "loss"): PokemonActionsByOutcome {
      return { [outcome]: { ...counts, games: 1 } };
    },
    observe,
  };
}

function mergeByCard(left: ByCard, right: ByCard): ByCard {
  const combined = { ...left };
  for (const [id, added] of Object.entries(right)) {
    const existing = combined[id];
    combined[id] = {
      games: (existing?.games ?? 0) + added.games,
      times: (existing?.times ?? 0) + added.times,
    };
  }
  return combined;
}

/** 対戦を回した工程が違っても、同じカードID・勝敗の件数を足せる。計測していない場合は欄を作らない。 */
export function mergePokemonActions(
  left?: PokemonActionsByOutcome,
  right?: PokemonActionsByOutcome
): { readonly pokemonActions?: PokemonActionsByOutcome } {
  if (right === undefined) {
    return left === undefined ? {} : { pokemonActions: left };
  }
  const merged = { ...left };
  for (const outcome of ["win", "loss"] as const) {
    const added = right[outcome];
    if (added === undefined) {
      continue;
    }
    const original = merged[outcome];
    merged[outcome] =
      original === undefined
        ? added
        : {
            attacks: mergeByCard(original.attacks, added.attacks),
            energyReceived: mergeByCard(
              original.energyReceived,
              added.energyReceived
            ),
            games: original.games + added.games,
          };
  }
  return { pokemonActions: merged };
}
