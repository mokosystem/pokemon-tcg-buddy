/**
 * 締め切りの番が、評価する番(fromTurn)と同じか後か。道の揃い具合を見る評価は、置き場所「前の番から場」の数え方を
 * これで変える(goal-prospects.ts)。
 */
export type DeadlineTiming = "thisTurn" | "laterTurn";

export function toDeadlineTiming(
  deadline: number,
  fromTurn: number
): DeadlineTiming {
  return deadline === fromTurn ? "thisTurn" : "laterTurn";
}
