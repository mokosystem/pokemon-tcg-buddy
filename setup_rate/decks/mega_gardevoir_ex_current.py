"""メガサーナイトex デッキの現在の構築(デッキコード vFkFVV-JqbSlh-w5kbbd、2026-09-17 に読み取り)。

Issue 6 で計算した構築(mega_gardevoir_ex.py)との違いは、リーリエのピッピex 2→1 と
ミュウex 1→2 だけなので、カード表と規則をそのまま使い、デッキの枚数だけ差し替える。
"""

from __future__ import annotations

from dataclasses import replace

from setup_rate.decks import mega_gardevoir_ex as base
from setup_rate.engine import Variant, apply_variant

RULES = replace(
    base.RULES,
    title="メガサーナイトex デッキ(現在の構築。3 番目の番にメガシンフォニア)",
    deck_code="vFkFVV-JqbSlh-w5kbbd",
    decklist=apply_variant(base.DECKLIST, Variant("現在の構築", {base.CLEFAIRY: -1, base.MEW: +1})),
)
