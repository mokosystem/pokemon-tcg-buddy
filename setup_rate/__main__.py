"""使い方: uv run python -m setup_rate <規則モジュール名> [--trials N] [--seed S] [--turns T] [--compare] [--trace]

規則モジュール名は setup_rate/decks/ のファイル名(拡張子なし)。
"""

from __future__ import annotations

import argparse
import importlib
import random

from setup_rate.engine import DeckRules, run_game
from setup_rate.simulate import compare_variants, format_assumptions, format_summary, simulate


def load_rules(module_name: str) -> DeckRules:
    module = importlib.import_module(f"setup_rate.decks.{module_name}")
    return module.RULES


def main() -> None:
    parser = argparse.ArgumentParser(description="デッキの主軸の成立率を乱数試行で求める")
    parser.add_argument("deck", help="setup_rate/decks/ の規則モジュール名")
    parser.add_argument("--trials", type=int, default=10000)
    parser.add_argument("--seed", type=int, default=20260917)
    parser.add_argument("--turns", type=int, default=3, help="何番目の自分の番まで進めるか")
    parser.add_argument("--compare", action="store_true", help="規則ファイルの変更案を比較する")
    parser.add_argument("--trace", action="store_true", help="1 回の対戦の行動の履歴を先攻・後攻それぞれ表示する")
    args = parser.parse_args()
    rules = load_rules(args.deck)

    if args.trace:
        for went_first in (True, False):
            outcome = run_game(rules, random.Random(args.seed), went_first, args.turns)
            print("### " + ("先攻" if went_first else "後攻") + " の 1 回の対戦")
            print("\n".join(outcome.events))
            print(f"狙いの成立した番: {outcome.goal_first_turn}")
            print()
        return

    print(format_assumptions(rules))
    for went_first in (True, False):
        summary = simulate(rules, args.trials, args.seed, went_first, args.turns)
        print(format_summary(rules, summary))
    if args.compare:
        print(compare_variants(rules, args.trials, args.seed, args.turns))


if __name__ == "__main__":
    main()
