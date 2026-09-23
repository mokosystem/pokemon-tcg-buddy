/**
 * 生成するファイル(入口と JSON Schema)が、記録とスキーマに対して最新かを確かめる。
 * 落ちたら、パッケージのディレクトリで `bun run generate:card-record-files` を実行して生成し直す。
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CARD_RECORD_JSON_SCHEMA_PATH,
  CARD_RECORD_TABLE_PATH,
  CARD_RECORDS_DIRECTORY,
  listCardRecordPaths,
  renderCardRecordJsonSchema,
} from "../scripts/card-record-files.ts";

const packageDirectory = join(import.meta.dirname, "..");
const recordsDirectory = join(packageDirectory, CARD_RECORDS_DIRECTORY);

describe("生成するファイル", () => {
  test("入口は src/card-records/ の記録をすべて、過不足なく import して表に入れている", () => {
    const source = readFileSync(
      join(packageDirectory, CARD_RECORD_TABLE_PATH),
      "utf8"
    );
    const imported = [...source.matchAll(/from "\.\/card-records\/(.+?)"/g)]
      .map((match) => match[1])
      .sort();
    const tabled = [...source.matchAll(/path: "(.+?)"/g)]
      .map((match) => match[1])
      .sort();
    const onDisk = listCardRecordPaths(recordsDirectory);
    expect(imported).toEqual(onDisk);
    expect(tabled).toEqual(onDisk);
  });

  test("JSON Schema は記法のスキーマから生成したものと同じ", () => {
    const onDisk: unknown = JSON.parse(
      readFileSync(join(packageDirectory, CARD_RECORD_JSON_SCHEMA_PATH), "utf8")
    );
    expect(onDisk).toEqual(renderCardRecordJsonSchema());
  });
});
