/**
 * Jev(https://docs.typesafe.ai/ )を同期で呼ぶ。骨組みの番の進行は同期で動くため、curl を子のプロセスとして同期で起こす。
 * API キーは curl の設定を標準入力(-K -)から渡し、プロセスの引数に出さない。本文は一時ファイルに書いて渡す。
 * 429(回数の上限)と 529(混雑)は、即座に再試行せず、待つ時間を倍にしながら再試行する(https://docs.typesafe.ai/api/errors 、
 * 2026-11-12 確認)。
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sleepSync } from "bun";
import type {
  JevChoiceRequest,
  JevChoiceResponse,
} from "../src/jev-playing-policy.ts";

/** 呼び出し先(https://docs.typesafe.ai/introduction/quickstart 、2026-11-12 確認)。 */
const JEV_ENDPOINT = "https://api.typesafe.ai/v1/systemone";
/** 再試行する応答。 */
const RETRYABLE_STATUSES = new Set([429, 529]);
const MAX_ATTEMPTS = 8;
const FIRST_RETRY_DELAY_MILLISECONDS = 1000;

/** Jev を 1 回呼び、HTTP の応答コードと本文を返す。 */
function postJevRequest(bodyPath: string, curlConfig: string) {
  const output = execFileSync(
    "curl",
    [
      "--silent",
      "--show-error",
      "--config",
      "-",
      "--header",
      "Content-Type: application/json",
      "--data-binary",
      `@${bodyPath}`,
      "--write-out",
      "\n%{http_code}",
      JEV_ENDPOINT,
    ],
    { encoding: "utf8", input: curlConfig, maxBuffer: 64 * 1024 * 1024 }
  );
  const separator = output.lastIndexOf("\n");
  return {
    body: output.slice(0, separator),
    status: Number(output.slice(separator + 1)),
  };
}

/** 再試行してよい応答で、まだ回数が残っているか。 */
function canRetry(status: number, attempt: number): boolean {
  return RETRYABLE_STATUSES.has(status) && attempt < MAX_ATTEMPTS;
}

/** api キーで Jev を呼ぶ関数を返す。終わったら dispose で一時ディレクトリを消す。 */
export function createJevChoiceRequester(apiKey: string): {
  readonly dispose: () => void;
  readonly requestJevChoice: (request: JevChoiceRequest) => JevChoiceResponse;
} {
  const directory = mkdtempSync(join(tmpdir(), "jev-request-"));
  const bodyPath = join(directory, "body.json");
  const curlConfig = `header = "Authorization: Bearer ${apiKey}"\n`;
  const requestJevChoice = (request: JevChoiceRequest): JevChoiceResponse => {
    writeFileSync(bodyPath, JSON.stringify(request));
    let delay = FIRST_RETRY_DELAY_MILLISECONDS;
    for (let attempt = 1; ; attempt += 1) {
      const { body, status } = postJevRequest(bodyPath, curlConfig);
      if (status === 200) {
        return JSON.parse(body) as JevChoiceResponse;
      }
      if (!canRetry(status, attempt)) {
        throw new Error(`Jev の応答が ${status}: ${body}`);
      }
      console.error(`Jev の応答が ${status}。${delay} ms 待って再試行する`);
      sleepSync(delay);
      delay *= 2;
    }
  };
  return {
    dispose: () => rmSync(directory, { force: true, recursive: true }),
    requestJevChoice,
  };
}
