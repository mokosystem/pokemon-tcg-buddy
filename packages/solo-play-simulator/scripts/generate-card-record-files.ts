/**
 * src/card-records/ の記録から、入口(src/card-record-table.ts)と JSON Schema を生成し、Biome で整形する。
 * 記録を足したり記法のスキーマを変えたりしたら、パッケージのディレクトリで次を実行する。
 *
 *   bun run generate:card-record-files
 */

import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  CARD_RECORD_JSON_SCHEMA_PATH,
  CARD_RECORD_TABLE_PATH,
  CARD_RECORDS_DIRECTORY,
  listCardRecordPaths,
  renderCardRecordJsonSchema,
  renderCardRecordTableSource,
} from "./card-record-files.ts";

const packageDirectory = join(import.meta.dirname, "..");

const tablePath = join(packageDirectory, CARD_RECORD_TABLE_PATH);
const schemaPath = join(packageDirectory, CARD_RECORD_JSON_SCHEMA_PATH);
writeFileSync(
  tablePath,
  renderCardRecordTableSource(
    listCardRecordPaths(join(packageDirectory, CARD_RECORDS_DIRECTORY))
  )
);
writeFileSync(
  schemaPath,
  `${JSON.stringify(renderCardRecordJsonSchema(), null, 2)}\n`
);
const formatted = spawnSync(
  "bun",
  ["x", "biome", "check", "--write", tablePath, schemaPath],
  { cwd: packageDirectory, stdio: "inherit" }
);
if (formatted.status !== 0) {
  throw new Error("生成したファイルを Biome で整形できなかった");
}
