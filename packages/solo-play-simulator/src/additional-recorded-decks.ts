/**
 * 記録だけで組み立てて回すデッキのうち、Issue 22 の 4 デッキ(issue22-decks.ts)以外のもの。開発責任者の残り 2 デッキ
 * (シロナのガブリアスex、メガレックウザex)の 60 枚の内容(カード ID と枚数)。
 * デッキコードから公式のデッキ表示ページで読んだ(2026-09-23)。開発責任者の許可を得てリポジトリに置く
 * (docs/solo-play-simulator-design.md「公式サイトの内容を転載しない方針との整理」)。Issue 27 の決定事項「翻訳の範囲」で、
 * Issue 22 の 4 デッキと並んで記録をそろえる対象になっている。記録だけで 60 枚を最後まで回せるかのテストに使う。
 */

import type { Declaration } from "./declaration.ts";
import type { RecordedDeck } from "./issue22-decks.ts";

export const ADDITIONAL_RECORDED_DECKS: readonly RecordedDeck[] = [
  {
    deckCode: "6nNQgQ-y6q3om-9HnnLL",
    decklist: [
      { cardId: "047381", count: 3 }, // シロナのガブリアスex
      { cardId: "049093", count: 4 }, // シロナのガバイト
      { cardId: "049968", count: 1 }, // シロナのミカルゲ
      { cardId: "047366", count: 3 }, // シロナのロズレイド
      { cardId: "048748", count: 4 }, // シロナのロゼリア
      { cardId: "049092", count: 4 }, // シロナのフカマル
      { cardId: "050392", count: 1 }, // ルリリ
      { cardId: "049364", count: 4 }, // なかよしポフィン
      { cardId: "050463", count: 4 }, // ポケパッド
      { cardId: "048677", count: 3 }, // ファイトゴング
      { cardId: "049386", count: 1 }, // 夜のタンカ
      { cardId: "049368", count: 2 }, // パワープロテイン
      { cardId: "045640", count: 1 }, // アンフェアスタンプ
      { cardId: "050744", count: 2 }, // ポケモンいれかえ
      { cardId: "047355", count: 4 }, // シロナのパワーウエイト
      { cardId: "050468", count: 4 }, // リーリエの決心
      { cardId: "047288", count: 2 }, // ボスの指令
      { cardId: "048694", count: 1 }, // トウコ
      { cardId: "050448", count: 2 }, // ジャッジマン
      { cardId: "050164", count: 1 }, // プリズムタワー
      { cardId: "047489", count: 1 }, // ロケット団の監視塔
      { cardId: "049464", count: 4 }, // 基本闘エネルギー
      { cardId: "049713", count: 4 }, // ロック闘エネルギー
    ],
    name: "シロナのガブリアスex(開発責任者)",
  },
  {
    deckCode: "xcGKc8-NGuFdn-D8c88x",
    decklist: [
      { cardId: "049282", count: 2 }, // イーブイex
      { cardId: "048810", count: 2 }, // ブースターex
      { cardId: "046372", count: 1 }, // パオジアン
      { cardId: "047847", count: 2 }, // メガガルーラex
      { cardId: "050400", count: 2 }, // ファイアローex
      { cardId: "050396", count: 2 }, // メガレックウザex
      { cardId: "049694", count: 3 }, // ニャースex
      { cardId: "049028", count: 2 }, // ラティアスex
      { cardId: "048636", count: 1 }, // キチキギスex
      { cardId: "048543", count: 1 }, // ヒビキのホウオウex
      { cardId: "049602", count: 1 }, // ポケモンいれかえ
      { cardId: "050461", count: 4 }, // ハイパーボール
      { cardId: "049354", count: 4 }, // エネルギーつけかえ
      { cardId: "048671", count: 2 }, // ガラスのラッパ
      { cardId: "050402", count: 1 }, // ぼうけんのランタン
      { cardId: "049403", count: 1 }, // ヒーローマント
      { cardId: "050448", count: 2 }, // ジャッジマン
      { cardId: "050467", count: 2 }, // ボスの指令
      { cardId: "049412", count: 2 }, // アカマツ
      { cardId: "046442", count: 2 }, // シアノ
      { cardId: "050468", count: 4 }, // リーリエの決心
      { cardId: "048706", count: 3 }, // ゼロの大空洞
      { cardId: "050478", count: 9 }, // 基本炎エネルギー
      { cardId: "050480", count: 4 }, // 基本雷エネルギー
      { cardId: "050479", count: 1 }, // 基本水エネルギー
    ],
    name: "メガレックウザex(開発責任者)",
  },
];

/**
 * シロナのガブリアスex デッキ(6nNQgQ-y6q3om-9HnnLL)の宣言。Issue 51 の追試に使う。主軸はシロナのガブリアスex(047381)の
 * 「リューノバスター」(闘 2 個、260)。ダメージの下限 320 は、シロナのロズレイド(047366)の特性「グローリーエール」が
 * 2 匹ぶん働いたとき(1 匹ごとに +30、2 匹で +60 は記録 047366 の裁定のデータ)。デッキにふしぎなアメが無いため、道は
 * 素の進化の道だけで、2 番目の番は進化のルール上 0 % になる(docs/pokemon-tcg/basic-rules.md 77 行)。開発責任者の本来の
 * 狙い(3 番目の番の終わりの場の形)は今の宣言で書けず、Issue 56 で扱う。締め切りは既定(2 番目と 3 番目の番)。
 */
export const CYNTHIAS_GARCHOMP_DECLARATION: Declaration = {
  mainAttacks: [{ attackName: "リューノバスター", cardId: "047381" }],
  minimumDamage: 320,
  pathsToMainAttacker: [
    {
      name: "素の進化の道",
      requiredCards: [
        { cardId: "049093", place: "inPlaySincePreviousTurn" },
        { cardId: "047381", place: "hand" },
      ],
    },
  ],
};

/**
 * メガレックウザex デッキ(xcGKc8-NGuFdn-D8c88x)の宣言。Issue 51 の追試に使う。主軸はたねポケモンのメガレックウザex(050396)の
 * 「ストームエメラルダ」(炎・雷・無色。自分の場の炎と雷のエネルギー 1 個につき 50)で、350 は 7 個ぶん。後攻 1 番目の番の
 * ファイアローex(050400)の「かぎづめハント」は主軸ではないため宣言に入れず、追試の道具が測るだけの狙いとして数える。
 * 締め切りは既定(2 番目と 3 番目の番)。
 */
export const MEGA_RAYQUAZA_DECLARATION: Declaration = {
  mainAttacks: [{ attackName: "ストームエメラルダ", cardId: "050396" }],
  minimumDamage: 350,
  pathsToMainAttacker: [
    {
      name: "メガレックウザex の道",
      requiredCards: [{ cardId: "050396", place: "inPlay" }],
    },
  ],
};
