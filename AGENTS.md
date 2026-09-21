# AGENTS.md

## このリポジトリについて

ポケモンカードのデッキ構築とデッキ診断を支援する AI エージェントを作るプロジェクト。目的、対象ユーザー、情報源の方針は [README.md](README.md) にある。

## ドキュメントの役割分担

- **AGENTS.md** — エージェント向けの指示。指示を追加・修正するときはこのファイルを編集する。
- **CLAUDE.md** — `@AGENTS.md` を読み込むだけのファイルとして維持し、内容を書かない。
- **README.md** — 人間が読むためのドキュメント。プロジェクトの目的と情報源の方針はここが正。
- **CONTEXT.md** — 文書で使う用語の定義(ユビキタス言語)。用語の正はここ。手順と知識は docs/pokemon-tcg/ に置き、CONTEXT.md には書かない。
- **docs/** — 手順書などの作業文書。ポケモンカードのドメイン文書は `docs/pokemon-tcg/` に置き、開発に関する文書と区別する。
- **setup_rate/** — 主軸の成立率を計算する骨組み(Python、依存パッケージ無し、環境管理は uv)。デッキごとの規則ファイルは `setup_rate/decks/`、テストは `tests/`。実行方法は `pokemon-tcg-estimate-setup-rate` スキルにある。Issue 22 で作った試作で、Issue 27 で TypeScript の `packages/` に置き換える(README「提供形態」)。
- **packages/** — 複数の場所から使う TypeScript の共有ライブラリ(Bun の workspaces)。`packages/solo-play-simulator` は成立率の計算の骨組み(一人回しの乱数試行)の移植先(Issue 27)。Bun の版は `mise.toml` で固定する。テストは最上位で `bun run test`、整形と lint の検査は `bun run lint`(修正は `bun run lint:fix`)、未使用のコードなどの解析は `bun run analyze`。Pull Request では GitHub Actions(`.github/workflows/ci.yml`)で同じ検査が `packages/` を対象に走り、合格しないとマージできない。ファイル名、ジョブ名、scripts の名前は「何をするか」と「どの範囲か」が読めるように付け、`check` のような何をするか曖昧な名前は使わない。環境の詳しい内容は [docs/setup-rate-design.md](docs/setup-rate-design.md)「TypeScript の環境」にある。

## 文書の用語

文書を書く・直すときは [CONTEXT.md](CONTEXT.md) の用語を使い、各用語の _Avoid_ に挙げた表記を使わない。公式用語は公式サイトで確認した名称、プロジェクト定義用語はこのプロジェクトが付けた名前で、CONTEXT.md がその区別を示す。新しい概念に名前を付けるときや、用語の揺れに気づいたときは、CONTEXT.md を先に直してから文書を直す。プレイヤーの俗語(逃げエネ、手張りなど)の意味は [docs/pokemon-tcg/glossary.md](docs/pokemon-tcg/glossary.md) で確認し、CONTEXT.md の用語へ対応付けて扱う。ユーザーとの会話でどの俗語を使ってよいかも、同じ文書の「エージェントの使い方」に従う。

## ポケモンカードの情報の扱い

カード、ルール、レギュレーションについて書くときは、README の「情報源の方針」に従う。具体的な確認手順は docs/pokemon-tcg/ の手順書にある。公式サイトを参照する前に [docs/pokemon-tcg/site-usage-notes.md](docs/pokemon-tcg/site-usage-notes.md) を読み、カードの確認は [docs/pokemon-tcg/card-lookup.md](docs/pokemon-tcg/card-lookup.md)、対戦の基本ルールは [docs/pokemon-tcg/basic-rules.md](docs/pokemon-tcg/basic-rules.md)、公式 Q&A の検索は [docs/pokemon-tcg/faq-lookup.md](docs/pokemon-tcg/faq-lookup.md)、デッキコードの読み取りとデッキ登録は [docs/pokemon-tcg/deck-tool.md](docs/pokemon-tcg/deck-tool.md)、環境(どの環境デッキが使われているか)の確認と通称の解決は [docs/pokemon-tcg/metagame-lookup.md](docs/pokemon-tcg/metagame-lookup.md) に従い、既存デッキの診断で避ける誤りの類型は [docs/pokemon-tcg/deck-diagnosis-pitfalls.md](docs/pokemon-tcg/deck-diagnosis-pitfalls.md) にある。エージェントとしての要点は次の通り。

- カードの効果、数値、使用可否を記憶で断定しない。公式カード検索の詳細ページを開いて確認してから書く
- 同じ名前のカードが複数並んでいても、詳細ページを見比べる前に「印刷違い」と書かない。見比べていなければ「印刷違いか別のカードかは未確認」と書く。人気のポケモンは同じ名前でワザや特性の違うカードが多い(card-lookup.md 手順 8)
- 現行レギュレーションの内容(使用できるレギュレーションマークなど)をドキュメントやコードに固定値として書かない。公式レギュレーションページを都度参照する
- 公式サイトのページ内容やカード画像をリポジトリに転載しない
- 環境に関する言及は、[docs/pokemon-tcg/metagame-snapshot.md](docs/pokemon-tcg/metagame-snapshot.md) と環境情報サイトで確認できる範囲に限る。Tier 表や順位表の内容を転載せず、デッキの内容はデッキコード経由で都度読む
- 確認した事実には、確認日と参照 URL を残す

## 作業を終える条件

検証できることは実行してから完了とする。実行していない検証を実行済みとして報告しない。カードやレギュレーションに触れる記述は、公式サイトでの確認をもって検証とみなす。

## エージェントスキルの置き場所

このリポジトリは Claude Code と Cursor で作業することを想定する(他のコーディングエージェントも妨げない)。スキルは次の構成で置く。

- 実体を `.claude/skills/<スキル名>/SKILL.md` に置く
- `.agents/skills` を `.claude/skills` へのシンボリックリンクとして作り、Cursor などのリンクを辿れるエージェントには `.agents/skills` を読ませる

```bash
mkdir -p .agents
ln -s ../.claude/skills .agents/skills
```

実体を `.claude/skills/` 側に置くのは、Claude Code にシンボリックリンクされたスキルを一覧に出せない不具合があるため([anthropics/claude-code#14836](https://github.com/anthropics/claude-code/issues/14836)。2026-08-21 時点で未解決)。リンクを辿る側を Cursor などに寄せ、Claude Code には実ファイルを読ませる。この不具合が解決したら構成を見直してよい。

スキルの名前には規約がある。ポケモンカードのドメイン知識を扱うスキルには接頭辞 `pokemon-tcg-` を必ず付け、開発作業の規約スキル(`create-git-commit` など)と名前だけで区別できるようにする。文書がディレクトリ(`docs/pokemon-tcg/`)で区別するのと方式が違うのは、スキルが名前だけの一覧に並ぶフラットな名前空間で、名前以外に区別の手段が無いためである。

Git コミット、GitHub Issue、Pull Request の規約は、`.claude/skills/` の `create-git-commit`、`create-github-issue`、`create-github-pull-request` に、ルールや裁定の質問に答える手順は `pokemon-tcg-answer-rules-question`、デッキを新しく組む相談は `pokemon-tcg-build-deck`、既存デッキの診断と改良の相談は `pokemon-tcg-diagnose-deck`(設計の理由は [docs/deck-diagnosis-design.md](docs/deck-diagnosis-design.md))、主軸の成立率を数字で示す計算は `pokemon-tcg-estimate-setup-rate`(設計の理由は [docs/setup-rate-design.md](docs/setup-rate-design.md)。計算の骨組みは `setup_rate/`、デッキごとの規則ファイルは `setup_rate/decks/`)にある。該当する作業ではそのスキルに従う。

## 文章の言語

README、コミットメッセージ、Issue、ドキュメントは日本語で書く。標準的な技術文書の文体とする。
