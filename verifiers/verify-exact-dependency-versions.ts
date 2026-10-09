/**
 * 最上位と workspaces の各パッケージの package.json について、依存の版がパッチまで書いた版で固定されているかを検証する。
 * 違反があれば一覧(ファイル、欄、パッケージ名、値)を出して終了コード 1 で終わる。最上位で次のように実行する。
 *
 *   bun run verify:exact-dependency-versions
 *
 * CI のジョブはこのスクリプトの前に bun install を走らせないため、Bun の組み込みだけで書く(Issue 43)。
 */

import { join, relative } from "node:path";
// Bun の機能は名前空間の Bun ではなく "bun" から取り込む。Biome(Ultracite)の noUndeclaredVariables が
// 名前空間の Bun を宣言の無い変数として落とすため(Biome 2.5.12 で確認)。
import { file, Glob } from "bun";

const DEPENDENCY_SECTIONS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
] as const;

type DependencySection = (typeof DEPENDENCY_SECTIONS)[number];

type PackageManifest = Partial<
  Record<DependencySection, Record<string, string>>
> & {
  workspaces?: string[];
};

interface DependencyVersionViolation {
  manifestPath: string;
  packageName: string;
  section: DependencySection;
  versionSpecifier: string;
}

// https://semver.org/ の推奨の正規表現から、ビルドメタデータ(+ 以降)を除き、捕獲しない括弧にしたもの。
// ビルドメタデータ付きの値を通さないのは、Issue 43 の決定事項が通す値を、パッチまで書いた版(プレリリースの印を含む)と
// workspace: で始まる値の 2 つに限っているため。
const EXACT_VERSION_PATTERN =
  /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*)?$/;

export function isExactVersionSpecifier(versionSpecifier: string): boolean {
  return (
    versionSpecifier.startsWith("workspace:") ||
    EXACT_VERSION_PATTERN.test(versionSpecifier)
  );
}

async function loadPackageManifest(path: string): Promise<PackageManifest> {
  return (await file(path).json()) as PackageManifest;
}

// **/package.json で探さないのは、node_modules の中の依存パッケージの package.json まで拾うため。
// 検証する package.json は、最上位の workspaces が指すパッケージに限る。
function listWorkspaceManifestPaths(
  rootDirectory: string,
  workspacePatterns: string[]
): string[] {
  return workspacePatterns
    .flatMap((pattern) =>
      Array.from(
        new Glob(`${pattern}/package.json`).scanSync({
          absolute: true,
          cwd: rootDirectory,
        })
      )
    )
    .sort();
}

function listViolationsInManifest(
  manifestPath: string,
  manifest: PackageManifest
): DependencyVersionViolation[] {
  return DEPENDENCY_SECTIONS.flatMap((section) =>
    Object.entries(manifest[section] ?? {})
      .filter(
        ([, versionSpecifier]) => !isExactVersionSpecifier(versionSpecifier)
      )
      .map(([packageName, versionSpecifier]) => ({
        manifestPath,
        packageName,
        section,
        versionSpecifier,
      }))
  );
}

async function listDependencyVersionViolations(
  rootDirectory: string
): Promise<DependencyVersionViolation[]> {
  const rootManifestPath = join(rootDirectory, "package.json");
  const rootManifest = await loadPackageManifest(rootManifestPath);
  const manifestPaths = [
    rootManifestPath,
    ...listWorkspaceManifestPaths(rootDirectory, rootManifest.workspaces ?? []),
  ];
  const violationsPerManifest = await Promise.all(
    manifestPaths.map(async (manifestPath) =>
      listViolationsInManifest(
        relative(rootDirectory, manifestPath),
        await loadPackageManifest(manifestPath)
      )
    )
  );
  return violationsPerManifest.flat();
}

if (import.meta.main) {
  const violations = await listDependencyVersionViolations(
    join(import.meta.dir, "..")
  );
  if (violations.length > 0) {
    console.error(
      `依存の版がパッチまで固定されていない箇所が ${violations.length} 件ある。通る値は 1.5.0 のような版そのものと workspace: で始まる値だけ`
    );
    for (const violation of violations) {
      console.error(
        `${violation.manifestPath}  ${violation.section}  ${violation.packageName}  ${violation.versionSpecifier}`
      );
    }
    process.exitCode = 1;
  }
}
