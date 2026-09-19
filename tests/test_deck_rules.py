"""各デッキの規則ファイルが、骨組みの上で最後まで走ることを確かめる。"""

import importlib
import random
import unittest

from setup_rate.engine import apply_variant, build_deck, run_game

DECK_MODULES = [
    "mega_gardevoir_ex",
    "mega_gardevoir_ex_current",
    "mega_charizard_ex",
    "bakegakure",
    "dragapult_ex",
]


def load(name: str):
    return importlib.import_module(f"setup_rate.decks.{name}").RULES


class DecklistTest(unittest.TestCase):
    def test_every_deck_has_sixty_cards_and_every_name_is_in_the_card_table(self):
        for name in DECK_MODULES:
            rules = load(name)
            with self.subTest(deck=name):
                self.assertEqual(sum(count for _, count in rules.decklist), 60)
                self.assertEqual(len(build_deck(rules.card_table, rules.decklist)), 60)

    def test_every_variant_keeps_sixty_cards(self):
        for name in DECK_MODULES:
            rules = load(name)
            for variant in rules.variants:
                with self.subTest(deck=name, variant=variant.label):
                    self.assertEqual(sum(count for _, count in apply_variant(rules.decklist, variant)), 60)

    def test_every_deadline_refers_to_a_defined_goal(self):
        for name in DECK_MODULES:
            rules = load(name)
            for goal, _ in rules.deadlines:
                with self.subTest(deck=name, goal=goal):
                    self.assertIn(goal, rules.goals)


class RunTest(unittest.TestCase):
    def test_two_hundred_games_each_side_finish_without_illegal_moves(self):
        for name in DECK_MODULES:
            rules = load(name)
            rng = random.Random(7)
            for went_first in (True, False):
                for _ in range(200):
                    outcome = run_game(rules, rng, went_first, max_turn=3)
                    self.assertEqual(set(outcome.goal_first_turn), set(rules.goals))

    def test_going_first_never_attacks_on_the_first_turn(self):
        for name in DECK_MODULES:
            rules = load(name)
            rng = random.Random(8)
            for _ in range(200):
                outcome = run_game(rules, rng, went_first=True, max_turn=3)
                with self.subTest(deck=name):
                    self.assertNotIn(1, outcome.attacks)

    def test_no_goal_is_met_on_the_first_turn_when_it_needs_evolution(self):
        evolution_goals = {
            "mega_gardevoir_ex": "メガサーナイトex が場にいる",
            "mega_charizard_ex": "メガリザードン(X か Y)が場にいる",
            "dragapult_ex": "ドラパルトex が場にいる",
        }
        for name, goal in evolution_goals.items():
            rules = load(name)
            rng = random.Random(9)
            for went_first in (True, False):
                for _ in range(200):
                    outcome = run_game(rules, rng, went_first, max_turn=3)
                    with self.subTest(deck=name):
                        self.assertNotEqual(outcome.goal_first_turn[goal], 1)


if __name__ == "__main__":
    unittest.main()
