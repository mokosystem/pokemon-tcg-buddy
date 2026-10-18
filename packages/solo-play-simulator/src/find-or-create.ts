/**
 * 覚えておく表(Map と WeakMap)から値を引き、無ければ作って入れる。探索は同じ場面を何度も評価するため、評価の中で
 * 求めた値を表に覚えて使い回す所が多く、その引き方をここにまとめる。
 */

/** 値を引く・入れるだけを使う表。Map と WeakMap の両方が当てはまる。 */
export interface KeyedTable<K, V> {
  get: (key: K) => V | undefined;
  set: (key: K, value: V) => unknown;
}

/**
 * table の key の値を返す。無ければ create で作って入れてから返す。Map.prototype.getOrInsertComputed を使わないのは、
 * 新しい API で、このパッケージは実行環境に依存しない方針のため(docs/solo-play-simulator-design.md「順 2 で決めたこと
 * (2 セッション目)」)。値に undefined は入れない(無いことと区別できないため)。
 */
export function findOrCreate<K, V>(
  table: KeyedTable<K, V>,
  key: K,
  create: () => V
): V {
  const found = table.get(key);
  if (found !== undefined) {
    return found;
  }
  const created = create();
  table.set(key, created);
  return created;
}
