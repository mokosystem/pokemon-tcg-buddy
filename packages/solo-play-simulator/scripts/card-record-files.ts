/**
 * カードの記録から作るファイル(入口の src/card-record-table.ts と JSON Schema)の中身を組み立てる。
 * ファイルへの書き込みは generate-card-record-files.ts が行い、ここは記録の一覧と中身を返すだけにする。
 * 最新かの検査(src/card-record-files.test.ts)が同じ関数で一覧と中身を作って比べられるようにするため。
 */

import { readdirSync } from "node:fs";
import { join } from "node:path";
import { toJsonSchema } from "@valibot/to-json-schema";
import {
  CARD_RECORD_SCHEMA_DEFINITIONS,
  CardRecordSchema,
} from "../src/card-record-schema.ts";

/** src/card-records/ を置く場所と、入口・JSON Schema の場所(パッケージのディレクトリからの相対パス)。 */
export const CARD_RECORDS_DIRECTORY = "src/card-records";
export const CARD_RECORD_TABLE_PATH = "src/card-record-table.ts";
export const CARD_RECORD_JSON_SCHEMA_PATH =
  "src/card-records/card-record.schema.json";

/** src/card-records/ にある記録のファイルの、そのディレクトリからの相対パス(例: goods/048675.json)。 */
export function listCardRecordPaths(recordsDirectory: string): string[] {
  return readdirSync(recordsDirectory, { recursive: true, withFileTypes: true })
    .filter(
      (entry) =>
        entry.isFile() &&
        entry.name.endsWith(".json") &&
        entry.name !== "card-record.schema.json"
    )
    .map((entry) =>
      join(entry.parentPath, entry.name).slice(recordsDirectory.length + 1)
    )
    .sort();
}

/** 記録のファイルの相対パス(例: pokemon-tools/050464.json)から、入口で import に付ける名前を作る。 */
function toImportName(recordPath: string): string {
  const [directory = "", fileName = ""] = recordPath.split("/");
  const camelDirectory = directory.replace(/-([a-z])/g, (_, letter: string) =>
    letter.toUpperCase()
  );
  return `${camelDirectory}${fileName.replace(".json", "")}`;
}

/** 入口のソース。全記録を import し、読み込み時に検査してカード ID から記録を引く表を作る。 */
export function renderCardRecordTableSource(
  recordPaths: readonly string[]
): string {
  const sorted = [...recordPaths].sort();
  const imports = sorted.map(
    (path) => `import ${toImportName(path)} from "./card-records/${path}";`
  );
  const entries = sorted.map(
    (path) => `  { content: ${toImportName(path)}, path: "${path}" },`
  );
  return [
    "// scripts/generate-card-record-files.ts が生成する。手で書き換えず、記録を足したら生成し直す。",
    "// 生成し直したかは src/card-record-files.test.ts が検査する。",
    "",
    'import { buildCardRecordTable } from "./card-record-validation.ts";',
    ...imports,
    "",
    "/** カード ID(どの印刷の ID からも)→ カードの記録。読み込み時に全記録を検査し、誤りがあれば止める。 */",
    "export const cardRecordTable = buildCardRecordTable([",
    ...entries,
    "]);",
    "",
  ].join("\n");
}

/** 記録の $schema から参照する JSON Schema。編集中の検証と、エージェントが PR を出す前の検査に使う。 */
export function renderCardRecordJsonSchema(): unknown {
  return toJsonSchema(CardRecordSchema, {
    definitions: CARD_RECORD_SCHEMA_DEFINITIONS,
  });
}
