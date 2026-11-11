/**
 * 履歴を出すときに、番を終えた時点で残っていた行動と、使わなかったワザを履歴に書く包み。開発責任者が履歴から不自然に
 * 見える手を探すための材料で、手を選ぶ基準そのものは変えない。
 */

import { listUsableAttacksOfActive } from "./card-effects.ts";
import type { PlayingPolicy } from "./engine.ts";
import { describeAction, listAvailableActions } from "./player-actions.ts";

/** policy の選び方はそのままに、番を終えた時点で残っていた行動と、使わなかったワザを履歴に書く判断基準を返す。 */
export function createPolicyRecordingUnusedActions(
  policy: PlayingPolicy
): PlayingPolicy {
  return {
    ...policy,
    chooseAttack: (context) => {
      const chosen = policy.chooseAttack(context);
      if (chosen === undefined) {
        const unused = listUsableAttacksOfActive(context);
        if (unused.length > 0) {
          context.state.record(
            `使わなかったワザ: ${unused.map(({ attack }) => attack.name).join("、")}`
          );
        }
      }
      return chosen;
    },
    playTurn: (context) => {
      policy.playTurn(context);
      const { state } = context;
      const remaining = listAvailableActions(context).filter(
        (action) => action.kind !== "endTurn"
      );
      if (remaining.length > 0) {
        state.record(
          `番を終えた時点で残っていた行動: ${remaining
            .map((action) => describeAction(state, action))
            .join("、")}`
        );
      }
    },
  };
}
