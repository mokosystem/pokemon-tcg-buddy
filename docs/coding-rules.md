# コーディングルール

このリポジトリのコードを書くときの規約。AGENTS.md の `packages/` の段落から参照する。

## 値が無いことを null で表さない

### ルール

「値が無い」を表すのに null を使わない。データの欄は省略し、状態の空きと関数の戻り値は undefined で表す。null を使ってよいのは、外部の仕様が null を要求する、または null を返す場合だけ。

### 理由

たねポケモンは進化を経ずに場に出せるポケモンで、進化前のポケモンが無い(用語の定義は [CONTEXT.md](../CONTEXT.md)「たねポケモン」「進化ポケモン」。出典はあそびかたページ「カードの種類と見かた」 https://www.pokemon-card.com/howtoplay/ 、2026-09-03 確認)。それを `evolvesFrom: null` と書くと、「進化前の名前」という欄があって値が空であるように読める。欄そのものを持たない(`evolvesFrom?: string`)ほうが概念に合う。null と undefined(省略)が混在すると、「値が無い」の表し方が箇所ごとに違い、判定の書き方もそろわない。

方針が書かれていないと、コードを書く人やエージェントごとに判断が分かれ、同じ指摘を繰り返すことになる([#44](https://github.com/mokosystem/pokemon-tcg-buddy/issues/44))。

### 場面ごとの表し方

| 場面 | 例 | 表し方 |
| --- | --- | --- |
| データの欄(概念として欄が無い) | `evolvesFrom`、ワザの `effect` | 欄を省略する(`evolvesFrom?: string`)。最上位の `tsconfig.json` の `exactOptionalPropertyTypes: true` が、`undefined` を明示的に入れること(`{ evolvesFrom: undefined }`)も型で禁じる。値があるときだけ欄を足すには `...(value === undefined ? {} : { value })` と書く |
| 状態の空き(欄はあるが今は空) | バトル場 `active`、スタジアム `stadium`、ポケモンのどうぐ `tool`、`EffectSource.pokemon`、`holder` | `active: PokemonInPlay \| undefined` と明示する。空にするときは `undefined` を代入する。欄の省略(`active?:`)にしない。`exactOptionalPropertyTypes` の下では `this.active = undefined` が型エラーになり、`delete` が要るため |
| 関数が「無い」を返す | `calculateAttackDamage`、`chooseAttack`、`findFirstInHand`、場のポケモンを 1 匹選ぶ関数(`chooseOnePokemon`) | 戻り値の型を `T \| undefined` と書き、`return undefined;` と書く。戻り値の型を書かない関数(オブジェクトの欄に置いた矢印関数を含む)で `return undefined;` と書くと、Ultracite の `noUselessUndefined` が落とす |

### 判定の書き方

判定は `=== undefined`、`!== undefined`、`??` で書く。0 や空文字が正しい値になりうる所では真偽値の判定(`if (x)`)を使わない。

### null を使ってよい理由と、使ってはいけない例

使ってよい理由は 1 つだけ: **外部の仕様が null を要求する、または null を返す場合。** 外部のライブラリや API の引数の型が null しか受け付けない、外部から受け取る JSON やレスポンスに null が入っていて自分で形を決められない、など。undefined で代用できるなら null を使わない(`JSON.stringify(x, undefined, 2)` のように、第 2 引数は undefined を受け付ける)。

使ってはいけない例: 「キーが無い」と「値が無い」を区別したいから null を使う。たとえば狙いごとの最初に成立した番を `ReadonlyMap<string, number | null>` にして、成立しなかった狙いを null にする形。成立しなかった狙いを Map に入れない、または `has()` で分ける、のように形を変えて解決する(`engine.ts` の `GameResult.goalFirstTurn` は成立した狙いだけを入れる)。

### 残すときの書き方

null を残す行の直前に、理由を添えた抑止コメントを書く。

```ts
// biome-ignore lint/plugin: <理由>
```

理由はこの 1 行に書き、別の文書に書かない。検査がこのコメントの有無で合否を出すため、理由の置き場所を 1 つに決める。

### 検査の仕組み

- null のリテラルは、Biome の GritQL プラグイン [verifiers/verify-no-null-literal.grit](../verifiers/verify-no-null-literal.grit) が型の位置と値の位置の両方で見つける。最上位の `biome.jsonc` の `plugins` に登録してあり、`bun run lint` と CI の lint のジョブで落ちる。プラグインのテストは [verifiers/verify-no-null-literal.test.ts](../verifiers/verify-no-null-literal.test.ts)
- データの欄に undefined を明示的に入れることは、最上位の `tsconfig.json` の `exactOptionalPropertyTypes: true` が `bun run typecheck` で落とす
