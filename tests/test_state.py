"""骨組みが基本ルール(docs/pokemon-tcg/basic-rules.md)を守ることを、小さなカード表で確かめる。"""

import random
import unittest

from setup_rate.cards import Stage, basic_energy, goods, pokemon, stadium, supporter
from setup_rate.engine import Action, DeckRules, Variant, apply_variant, run_game, setup_game
from setup_rate.state import BENCH_LIMIT, GameState, IllegalMove, PokemonInPlay

BASIC = pokemon("たね", "1", Stage.BASIC, 60, "psychic", retreat_cost=1)
STAGE1 = pokemon("1進化", "2", Stage.STAGE1, 90, "psychic", evolves_from="たね")
STAGE2 = pokemon("2進化", "3", Stage.STAGE2, 300, "psychic", evolves_from="1進化", has_rule_box=True)
ENERGY = basic_energy("基本超エネルギー", "4", "psychic")
SUPPORTER = supporter("サポート", "5")
GOODS = goods("グッズ", "6")
STADIUM = stadium("スタジアム", "7")
CARD_TABLE = {card.name: card for card in (BASIC, STAGE1, STAGE2, ENERGY, SUPPORTER, GOODS, STADIUM)}


def state_with(hand: list, deck: list, turn: int = 2, went_first: bool = False) -> GameState:
    state = GameState(random.Random(0), [], went_first)
    state.hand = list(hand)
    state.deck = list(deck)
    state.turn = turn
    state.active = PokemonInPlay(card=BASIC, turn_entered=0)
    return state


class SetupTest(unittest.TestCase):
    def rules(self) -> DeckRules:
        return DeckRules(
            title="test",
            deck_code="",
            card_table=CARD_TABLE,
            decklist=[("たね", 4), ("基本超エネルギー", 56)],
            choose_active=lambda basics: basics[0],
            choose_bench_at_setup=lambda basics: basics,
            actions=[],
            choose_attack=lambda state: None,
            goals={},
            deadlines=[],
            explain_failure=lambda state, goal: "",
        )

    def test_setup_draws_seven_places_six_prizes_and_leaves_the_rest_in_deck(self):
        state = GameState(random.Random(1), [BASIC] * 4 + [ENERGY] * 56, went_first=True)
        setup_game(state, self.rules())
        in_play = len(state.pokemon_in_play())
        self.assertEqual(len(state.hand) + in_play, 7)
        self.assertEqual(len(state.prizes), 6)
        self.assertEqual(len(state.deck), 60 - 7 - 6)

    def test_setup_redraws_until_hand_has_a_basic_pokemon_and_counts_mulligans(self):
        rng = random.Random(2)
        for _ in range(50):
            state = GameState(rng, [BASIC] * 1 + [ENERGY] * 59, went_first=True)
            setup_game(state, self.rules())
            self.assertIsNotNone(state.active)
            if state.mulligans:
                return
        self.fail("たね 1 枚のデッキで 50 回とも引き直しが起きないのは不自然")


class TurnRuleTest(unittest.TestCase):
    def test_first_turn_going_first_cannot_use_supporter(self):
        state = state_with([SUPPORTER], [], turn=1, went_first=True)
        self.assertFalse(state.can_use_supporter())
        with self.assertRaises(IllegalMove):
            state.use_supporter(SUPPORTER)

    def test_first_turn_going_second_can_use_supporter_once(self):
        state = state_with([SUPPORTER, SUPPORTER], [], turn=1, went_first=False)
        state.use_supporter(SUPPORTER)
        self.assertFalse(state.can_use_supporter())

    def test_first_turn_going_first_cannot_attack(self):
        state = state_with([], [], turn=1, went_first=True)
        self.assertFalse(state.can_attack())

    def test_energy_from_hand_attaches_once_per_turn(self):
        state = state_with([ENERGY, ENERGY], [])
        state.attach_energy_from_hand(ENERGY, state.active)
        with self.assertRaises(IllegalMove):
            state.attach_energy_from_hand(ENERGY, state.active)

    def test_energy_from_deck_does_not_count_toward_the_once_per_turn_limit(self):
        state = state_with([ENERGY], [ENERGY])
        state.attach_energy_from_deck(ENERGY, state.active)
        state.attach_energy_from_hand(ENERGY, state.active)
        self.assertEqual(state.active.count_energy("psychic"), 2)

    def test_begin_turn_draws_one_card_and_resets_once_per_turn_flags(self):
        state = state_with([], [ENERGY, ENERGY], turn=1)
        state.supporter_used = True
        state.energy_attached = True
        state.begin_turn()
        self.assertEqual(state.turn, 2)
        self.assertEqual(len(state.hand), 1)
        self.assertFalse(state.supporter_used)
        self.assertFalse(state.energy_attached)

    def test_same_named_stadium_cannot_replace_itself(self):
        state = state_with([STADIUM, STADIUM], [])
        state.play_stadium(STADIUM)
        state.stadium_played = False
        with self.assertRaises(IllegalMove):
            state.play_stadium(STADIUM)

    def test_bench_holds_at_most_five_pokemon(self):
        state = state_with([BASIC] * 6, [])
        for _ in range(BENCH_LIMIT):
            state.place_on_bench(BASIC, from_hand=True)
        with self.assertRaises(IllegalMove):
            state.place_on_bench(BASIC, from_hand=True)


class EvolutionRuleTest(unittest.TestCase):
    def test_cannot_evolve_on_my_first_turn(self):
        state = state_with([STAGE1], [], turn=1)
        self.assertFalse(state.can_evolve(state.active, STAGE1))
        with self.assertRaises(IllegalMove):
            state.evolve(state.active, STAGE1, from_hand=True)

    def test_pokemon_placed_this_turn_cannot_evolve(self):
        state = state_with([BASIC, STAGE1], [])
        fresh = state.place_on_bench(BASIC, from_hand=True)
        self.assertFalse(state.can_evolve(fresh, STAGE1))

    def test_pokemon_evolved_this_turn_cannot_evolve_again_from_hand(self):
        state = state_with([STAGE1, STAGE2], [])
        state.evolve(state.active, STAGE1, from_hand=True)
        self.assertFalse(state.can_evolve(state.active, STAGE2))

    def test_evolution_effect_may_continue_to_stage2_when_freshness_is_ignored(self):
        state = state_with([], [STAGE1, STAGE2])
        state.evolve(state.active, STAGE1, from_hand=False)
        state.evolve(state.active, STAGE2, from_hand=False, ignore_freshness=True)
        self.assertEqual(state.active.name, "2進化")
        self.assertEqual([card.name for card in state.active.underneath], ["たね", "1進化"])

    def test_evolving_keeps_attached_energy(self):
        state = state_with([ENERGY, STAGE1], [])
        state.attach_energy_from_hand(ENERGY, state.active)
        state.evolve(state.active, STAGE1, from_hand=True)
        self.assertEqual(state.active.count_energy("psychic"), 1)

    def test_skipping_stage1_requires_basic_placed_before_this_turn(self):
        state = state_with([BASIC, STAGE2], [])
        fresh = state.place_on_bench(BASIC, from_hand=True)
        with self.assertRaises(IllegalMove):
            state.evolve_skipping_stage1(fresh, STAGE2, "1進化")
        state.evolve_skipping_stage1(state.active, STAGE2, "1進化")
        self.assertEqual(state.active.name, "2進化")


class RetreatTest(unittest.TestCase):
    def test_retreat_discards_energy_for_the_cost_and_happens_once_per_turn(self):
        state = state_with([ENERGY, BASIC], [])
        bench = state.place_on_bench(BASIC, from_hand=True)
        state.attach_energy_from_hand(ENERGY, state.active)
        former_active = state.active
        state.retreat(bench, cost=1)
        self.assertIs(state.active, bench)
        self.assertEqual(former_active.energies, [])
        self.assertEqual(state.count_in_discard("基本超エネルギー"), 1)
        with self.assertRaises(IllegalMove):
            state.retreat(former_active, cost=0)


class VariantTest(unittest.TestCase):
    def test_apply_variant_keeps_total_and_rejects_negative_counts(self):
        decklist = [("たね", 4), ("基本超エネルギー", 56)]
        changed = dict(apply_variant(decklist, Variant("x", {"たね": -1, "基本超エネルギー": +1})))
        self.assertEqual(changed, {"たね": 3, "基本超エネルギー": 57})
        with self.assertRaises(ValueError):
            apply_variant(decklist, Variant("y", {"たね": -1}))
        with self.assertRaises(ValueError):
            apply_variant(decklist, Variant("z", {"たね": -5, "基本超エネルギー": +5}))


class RunGameTest(unittest.TestCase):
    def test_goal_first_turn_records_the_turn_the_goal_was_first_met(self):
        rules = DeckRules(
            title="test",
            deck_code="",
            card_table=CARD_TABLE,
            decklist=[("たね", 4), ("基本超エネルギー", 56)],
            choose_active=lambda basics: basics[0],
            choose_bench_at_setup=lambda basics: [],
            actions=[
                Action(
                    "エネルギーをつける",
                    lambda state: not state.energy_attached and state.count_in_hand("基本超エネルギー") > 0,
                    lambda state: state.attach_energy_from_hand(state.first_in_hand("基本超エネルギー"), state.active),
                )
            ],
            choose_attack=lambda state: None,
            goals={"エネルギー 2 個": lambda state: state.active.count_energy("psychic") >= 2},
            deadlines=[("エネルギー 2 個", 2)],
            explain_failure=lambda state, goal: "まだ",
        )
        outcome = run_game(rules, random.Random(3), went_first=True, max_turn=3)
        self.assertEqual(outcome.goal_first_turn["エネルギー 2 個"], 2)
        self.assertEqual(outcome.failure_labels["エネルギー 2 個"], {1: "まだ"})


if __name__ == "__main__":
    unittest.main()
