// scripts/generate-card-record-files.ts が生成する。手で書き換えず、記録を足したら生成し直す。
// 生成し直したかは src/card-record-files.test.ts が検査する。

import { buildCardRecordTable } from "./card-record-validation.ts";
import energies047905 from "./card-records/energies/047905.json";
import energies047906 from "./card-records/energies/047906.json";
import energies047908 from "./card-records/energies/047908.json";
import energies047909 from "./card-records/energies/047909.json";
import energies049452 from "./card-records/energies/049452.json";
import energies049457 from "./card-records/energies/049457.json";
import energies049463 from "./card-records/energies/049463.json";
import energies049712 from "./card-records/energies/049712.json";
import energies049713 from "./card-records/energies/049713.json";
import energies050746 from "./card-records/energies/050746.json";
import goods047791 from "./card-records/goods/047791.json";
import goods047792 from "./card-records/goods/047792.json";
import goods048671 from "./card-records/goods/048671.json";
import goods048675 from "./card-records/goods/048675.json";
import goods048681 from "./card-records/goods/048681.json";
import goods049349 from "./card-records/goods/049349.json";
import goods049352 from "./card-records/goods/049352.json";
import goods049354 from "./card-records/goods/049354.json";
import goods049376 from "./card-records/goods/049376.json";
import goods049380 from "./card-records/goods/049380.json";
import goods049602 from "./card-records/goods/049602.json";
import goods050156 from "./card-records/goods/050156.json";
import goods050402 from "./card-records/goods/050402.json";
import goods050424 from "./card-records/goods/050424.json";
import goods050461 from "./card-records/goods/050461.json";
import goods050462 from "./card-records/goods/050462.json";
import pokemon045203 from "./card-records/pokemon/045203.json";
import pokemon046248 from "./card-records/pokemon/046248.json";
import pokemon046372 from "./card-records/pokemon/046372.json";
import pokemon046518 from "./card-records/pokemon/046518.json";
import pokemon047041 from "./card-records/pokemon/047041.json";
import pokemon047086 from "./card-records/pokemon/047086.json";
import pokemon047087 from "./card-records/pokemon/047087.json";
import pokemon047366 from "./card-records/pokemon/047366.json";
import pokemon047381 from "./card-records/pokemon/047381.json";
import pokemon047663 from "./card-records/pokemon/047663.json";
import pokemon047759 from "./card-records/pokemon/047759.json";
import pokemon047760 from "./card-records/pokemon/047760.json";
import pokemon047761 from "./card-records/pokemon/047761.json";
import pokemon047762 from "./card-records/pokemon/047762.json";
import pokemon047847 from "./card-records/pokemon/047847.json";
import pokemon048351 from "./card-records/pokemon/048351.json";
import pokemon048353 from "./card-records/pokemon/048353.json";
import pokemon048358 from "./card-records/pokemon/048358.json";
import pokemon048464 from "./card-records/pokemon/048464.json";
import pokemon048533 from "./card-records/pokemon/048533.json";
import pokemon048543 from "./card-records/pokemon/048543.json";
import pokemon048748 from "./card-records/pokemon/048748.json";
import pokemon048810 from "./card-records/pokemon/048810.json";
import pokemon049024 from "./card-records/pokemon/049024.json";
import pokemon049025 from "./card-records/pokemon/049025.json";
import pokemon049026 from "./card-records/pokemon/049026.json";
import pokemon049074 from "./card-records/pokemon/049074.json";
import pokemon049092 from "./card-records/pokemon/049092.json";
import pokemon049093 from "./card-records/pokemon/049093.json";
import pokemon049205 from "./card-records/pokemon/049205.json";
import pokemon049262 from "./card-records/pokemon/049262.json";
import pokemon049263 from "./card-records/pokemon/049263.json";
import pokemon049264 from "./card-records/pokemon/049264.json";
import pokemon049282 from "./card-records/pokemon/049282.json";
import pokemon049341 from "./card-records/pokemon/049341.json";
import pokemon049481 from "./card-records/pokemon/049481.json";
import pokemon049482 from "./card-records/pokemon/049482.json";
import pokemon049694 from "./card-records/pokemon/049694.json";
import pokemon049714 from "./card-records/pokemon/049714.json";
import pokemon049715 from "./card-records/pokemon/049715.json";
import pokemon049968 from "./card-records/pokemon/049968.json";
import pokemon050224 from "./card-records/pokemon/050224.json";
import pokemon050225 from "./card-records/pokemon/050225.json";
import pokemon050250 from "./card-records/pokemon/050250.json";
import pokemon050251 from "./card-records/pokemon/050251.json";
import pokemon050308 from "./card-records/pokemon/050308.json";
import pokemon050392 from "./card-records/pokemon/050392.json";
import pokemon050396 from "./card-records/pokemon/050396.json";
import pokemon050400 from "./card-records/pokemon/050400.json";
import pokemon050669 from "./card-records/pokemon/050669.json";
import pokemonTools045281 from "./card-records/pokemon-tools/045281.json";
import pokemonTools049398 from "./card-records/pokemon-tools/049398.json";
import pokemonTools050464 from "./card-records/pokemon-tools/050464.json";
import stadiums046040 from "./card-records/stadiums/046040.json";
import stadiums046446 from "./card-records/stadiums/046446.json";
import stadiums047214 from "./card-records/stadiums/047214.json";
import stadiums048419 from "./card-records/stadiums/048419.json";
import stadiums048706 from "./card-records/stadiums/048706.json";
import stadiums048711 from "./card-records/stadiums/048711.json";
import stadiums050164 from "./card-records/stadiums/050164.json";
import supporters045284 from "./card-records/supporters/045284.json";
import supporters045934 from "./card-records/supporters/045934.json";
import supporters046442 from "./card-records/supporters/046442.json";
import supporters047357 from "./card-records/supporters/047357.json";
import supporters047856 from "./card-records/supporters/047856.json";
import supporters047894 from "./card-records/supporters/047894.json";
import supporters048418 from "./card-records/supporters/048418.json";
import supporters048694 from "./card-records/supporters/048694.json";
import supporters049412 from "./card-records/supporters/049412.json";
import supporters049445 from "./card-records/supporters/049445.json";
import supporters049708 from "./card-records/supporters/049708.json";
import supporters050083 from "./card-records/supporters/050083.json";
import supporters050297 from "./card-records/supporters/050297.json";
import supporters050428 from "./card-records/supporters/050428.json";
import supporters050467 from "./card-records/supporters/050467.json";

/** カード ID(どの印刷の ID からも)→ カードの記録。読み込み時に全記録を検査し、誤りがあれば止める。 */
export const cardRecordTable = buildCardRecordTable([
  { content: energies047905, path: "energies/047905.json" },
  { content: energies047906, path: "energies/047906.json" },
  { content: energies047908, path: "energies/047908.json" },
  { content: energies047909, path: "energies/047909.json" },
  { content: energies049452, path: "energies/049452.json" },
  { content: energies049457, path: "energies/049457.json" },
  { content: energies049463, path: "energies/049463.json" },
  { content: energies049712, path: "energies/049712.json" },
  { content: energies049713, path: "energies/049713.json" },
  { content: energies050746, path: "energies/050746.json" },
  { content: goods047791, path: "goods/047791.json" },
  { content: goods047792, path: "goods/047792.json" },
  { content: goods048671, path: "goods/048671.json" },
  { content: goods048675, path: "goods/048675.json" },
  { content: goods048681, path: "goods/048681.json" },
  { content: goods049349, path: "goods/049349.json" },
  { content: goods049352, path: "goods/049352.json" },
  { content: goods049354, path: "goods/049354.json" },
  { content: goods049376, path: "goods/049376.json" },
  { content: goods049380, path: "goods/049380.json" },
  { content: goods049602, path: "goods/049602.json" },
  { content: goods050156, path: "goods/050156.json" },
  { content: goods050402, path: "goods/050402.json" },
  { content: goods050424, path: "goods/050424.json" },
  { content: goods050461, path: "goods/050461.json" },
  { content: goods050462, path: "goods/050462.json" },
  { content: pokemonTools045281, path: "pokemon-tools/045281.json" },
  { content: pokemonTools049398, path: "pokemon-tools/049398.json" },
  { content: pokemonTools050464, path: "pokemon-tools/050464.json" },
  { content: pokemon045203, path: "pokemon/045203.json" },
  { content: pokemon046248, path: "pokemon/046248.json" },
  { content: pokemon046372, path: "pokemon/046372.json" },
  { content: pokemon046518, path: "pokemon/046518.json" },
  { content: pokemon047041, path: "pokemon/047041.json" },
  { content: pokemon047086, path: "pokemon/047086.json" },
  { content: pokemon047087, path: "pokemon/047087.json" },
  { content: pokemon047366, path: "pokemon/047366.json" },
  { content: pokemon047381, path: "pokemon/047381.json" },
  { content: pokemon047663, path: "pokemon/047663.json" },
  { content: pokemon047759, path: "pokemon/047759.json" },
  { content: pokemon047760, path: "pokemon/047760.json" },
  { content: pokemon047761, path: "pokemon/047761.json" },
  { content: pokemon047762, path: "pokemon/047762.json" },
  { content: pokemon047847, path: "pokemon/047847.json" },
  { content: pokemon048351, path: "pokemon/048351.json" },
  { content: pokemon048353, path: "pokemon/048353.json" },
  { content: pokemon048358, path: "pokemon/048358.json" },
  { content: pokemon048464, path: "pokemon/048464.json" },
  { content: pokemon048533, path: "pokemon/048533.json" },
  { content: pokemon048543, path: "pokemon/048543.json" },
  { content: pokemon048748, path: "pokemon/048748.json" },
  { content: pokemon048810, path: "pokemon/048810.json" },
  { content: pokemon049024, path: "pokemon/049024.json" },
  { content: pokemon049025, path: "pokemon/049025.json" },
  { content: pokemon049026, path: "pokemon/049026.json" },
  { content: pokemon049074, path: "pokemon/049074.json" },
  { content: pokemon049092, path: "pokemon/049092.json" },
  { content: pokemon049093, path: "pokemon/049093.json" },
  { content: pokemon049205, path: "pokemon/049205.json" },
  { content: pokemon049262, path: "pokemon/049262.json" },
  { content: pokemon049263, path: "pokemon/049263.json" },
  { content: pokemon049264, path: "pokemon/049264.json" },
  { content: pokemon049282, path: "pokemon/049282.json" },
  { content: pokemon049341, path: "pokemon/049341.json" },
  { content: pokemon049481, path: "pokemon/049481.json" },
  { content: pokemon049482, path: "pokemon/049482.json" },
  { content: pokemon049694, path: "pokemon/049694.json" },
  { content: pokemon049714, path: "pokemon/049714.json" },
  { content: pokemon049715, path: "pokemon/049715.json" },
  { content: pokemon049968, path: "pokemon/049968.json" },
  { content: pokemon050224, path: "pokemon/050224.json" },
  { content: pokemon050225, path: "pokemon/050225.json" },
  { content: pokemon050250, path: "pokemon/050250.json" },
  { content: pokemon050251, path: "pokemon/050251.json" },
  { content: pokemon050308, path: "pokemon/050308.json" },
  { content: pokemon050392, path: "pokemon/050392.json" },
  { content: pokemon050396, path: "pokemon/050396.json" },
  { content: pokemon050400, path: "pokemon/050400.json" },
  { content: pokemon050669, path: "pokemon/050669.json" },
  { content: stadiums046040, path: "stadiums/046040.json" },
  { content: stadiums046446, path: "stadiums/046446.json" },
  { content: stadiums047214, path: "stadiums/047214.json" },
  { content: stadiums048419, path: "stadiums/048419.json" },
  { content: stadiums048706, path: "stadiums/048706.json" },
  { content: stadiums048711, path: "stadiums/048711.json" },
  { content: stadiums050164, path: "stadiums/050164.json" },
  { content: supporters045284, path: "supporters/045284.json" },
  { content: supporters045934, path: "supporters/045934.json" },
  { content: supporters046442, path: "supporters/046442.json" },
  { content: supporters047357, path: "supporters/047357.json" },
  { content: supporters047856, path: "supporters/047856.json" },
  { content: supporters047894, path: "supporters/047894.json" },
  { content: supporters048418, path: "supporters/048418.json" },
  { content: supporters048694, path: "supporters/048694.json" },
  { content: supporters049412, path: "supporters/049412.json" },
  { content: supporters049445, path: "supporters/049445.json" },
  { content: supporters049708, path: "supporters/049708.json" },
  { content: supporters050083, path: "supporters/050083.json" },
  { content: supporters050297, path: "supporters/050297.json" },
  { content: supporters050428, path: "supporters/050428.json" },
  { content: supporters050467, path: "supporters/050467.json" },
]);
