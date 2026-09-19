"""乱数試行を繰り返し、締め切りごとの成立率と失敗要因を集計する。"""

from __future__ import annotations

import random
from collections import Counter
from dataclasses import dataclass, field

from setup_rate.engine import DeckRules, Variant, apply_variant, run_game


@dataclass
class Summary:
    trials: int
    went_first: bool
    max_turn: int
    achieved_by_turn: dict[str, list[int]] = field(default_factory=dict)
    failure_tally: dict[str, dict[int, Counter[str]]] = field(default_factory=dict)
    attack_tally: dict[int, Counter[str]] = field(default_factory=dict)
    mulligan_games: int = 0

    def rate(self, goal: str, deadline: int) -> float:
        return self.achieved_by_turn[goal][deadline - 1] / self.trials


def simulate(
    rules: DeckRules,
    trials: int,
    seed: int,
    went_first: bool,
    max_turn: int,
    decklist: list[tuple[str, int]] | None = None,
) -> Summary:
    rng = random.Random(seed)
    summary = Summary(trials=trials, went_first=went_first, max_turn=max_turn)
    for goal in rules.goals:
        summary.achieved_by_turn[goal] = [0] * max_turn
        summary.failure_tally[goal] = {turn: Counter() for turn in range(1, max_turn + 1)}
    summary.attack_tally = {turn: Counter() for turn in range(1, max_turn + 1)}
    for _ in range(trials):
        outcome = run_game(rules, rng, went_first, max_turn, decklist)
        if outcome.mulligans:
            summary.mulligan_games += 1
        for goal, first_turn in outcome.goal_first_turn.items():
            if first_turn is not None:
                for turn in range(first_turn, max_turn + 1):
                    summary.achieved_by_turn[goal][turn - 1] += 1
            for turn, label in outcome.failure_labels[goal].items():
                summary.failure_tally[goal][turn][label] += 1
        for turn, attack in outcome.attacks.items():
            summary.attack_tally[turn][attack] += 1
    return summary


def percent(value: float) -> str:
    return f"{value * 100:.1f} %"


def format_summary(rules: DeckRules, summary: Summary) -> str:
    side = "先攻" if summary.went_first else "後攻"
    lines = [f"### {side}(試行 {summary.trials} 回)", ""]
    header = "| 狙い | " + " | ".join(f"{turn} 番目の番まで" for turn in range(1, summary.max_turn + 1)) + " |"
    lines.append(header)
    lines.append("| --- |" + " --- |" * summary.max_turn)
    for goal in rules.goals:
        cells = " | ".join(percent(summary.rate(goal, turn)) for turn in range(1, summary.max_turn + 1))
        lines.append(f"| {goal} | {cells} |")
    lines.append("")
    lines.append(f"引き直し(たねポケモンが無い初手)が起きた対戦: {percent(summary.mulligan_games / summary.trials)}")
    lines.append("")
    for turn in range(1, summary.max_turn + 1):
        used = summary.attack_tally[turn]
        if used:
            parts = ", ".join(f"{name} {percent(count / summary.trials)}" for name, count in used.most_common())
            lines.append(f"- {turn} 番目の番に使ったワザ: {parts}")
    lines.append("")
    for goal, deadline in rules.deadlines:
        tally = summary.failure_tally[goal][deadline]
        failed = sum(tally.values())
        if failed == 0:
            continue
        lines.append(f"**{goal}({deadline} 番目の番まで)が成立しなかった {percent(failed / summary.trials)} の内訳**")
        lines.append("")
        for label, count in tally.most_common():
            lines.append(f"- {label}: {percent(count / summary.trials)}")
        lines.append("")
    return "\n".join(lines)


def compare_variants(rules: DeckRules, trials: int, seed: int, max_turn: int) -> str:
    """変更なしと各変更案を、同じ乱数の種で比較する。"""
    lines: list[str] = []
    variants = [Variant(label="変更なし", changes={})] + list(rules.variants)
    for went_first in (True, False):
        side = "先攻" if went_first else "後攻"
        lines.append(f"### 枚数を変えたときの比較({side}、試行 {trials} 回)")
        lines.append("")
        lines.append("| 変更 | " + " | ".join(f"{goal}({turn} 番目まで)" for goal, turn in rules.deadlines) + " |")
        lines.append("| --- |" + " --- |" * len(rules.deadlines))
        base: Summary | None = None
        for variant in variants:
            decklist = apply_variant(rules.decklist, variant)
            summary = simulate(rules, trials, seed, went_first, max_turn, decklist)
            if base is None:
                base = summary
            cells = []
            for goal, turn in rules.deadlines:
                rate = summary.rate(goal, turn)
                diff = rate - base.rate(goal, turn)
                cell = percent(rate)
                if variant.changes:
                    cell += f" ({diff * 100:+.1f})"
                cells.append(cell)
            lines.append(f"| {variant.label} | " + " | ".join(cells) + " |")
        lines.append("")
    return "\n".join(lines)


def format_assumptions(rules: DeckRules) -> str:
    lines = [f"## {rules.title}", "", f"デッキコード: {rules.deck_code}", "", "### 計算の前提", ""]
    lines.extend(f"- {assumption}" for assumption in rules.assumptions)
    lines.append("")
    return "\n".join(lines)
