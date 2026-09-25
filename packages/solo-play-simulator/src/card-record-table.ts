// scripts/generate-card-record-files.ts が生成する。手で書き換えず、記録を足したら生成し直す。
// 生成し直したかは src/card-record-files.test.ts が検査する。

import { buildCardRecordTable } from "./card-record-validation.ts";
import energies030578 from "./card-records/energies/030578.json";
import energies045217 from "./card-records/energies/045217.json";
import energies046293 from "./card-records/energies/046293.json";
import energies047903 from "./card-records/energies/047903.json";
import energies047905 from "./card-records/energies/047905.json";
import energies047906 from "./card-records/energies/047906.json";
import energies047908 from "./card-records/energies/047908.json";
import energies047909 from "./card-records/energies/047909.json";
import energies049452 from "./card-records/energies/049452.json";
import energies049454 from "./card-records/energies/049454.json";
import energies049455 from "./card-records/energies/049455.json";
import energies049457 from "./card-records/energies/049457.json";
import energies049463 from "./card-records/energies/049463.json";
import energies049712 from "./card-records/energies/049712.json";
import energies049713 from "./card-records/energies/049713.json";
import energies050746 from "./card-records/energies/050746.json";
import goods042243 from "./card-records/goods/042243.json";
import goods045783 from "./card-records/goods/045783.json";
import goods046220 from "./card-records/goods/046220.json";
import goods047791 from "./card-records/goods/047791.json";
import goods047792 from "./card-records/goods/047792.json";
import goods048299 from "./card-records/goods/048299.json";
import goods048670 from "./card-records/goods/048670.json";
import goods048671 from "./card-records/goods/048671.json";
import goods048672 from "./card-records/goods/048672.json";
import goods048675 from "./card-records/goods/048675.json";
import goods048681 from "./card-records/goods/048681.json";
import goods049349 from "./card-records/goods/049349.json";
import goods049351 from "./card-records/goods/049351.json";
import goods049352 from "./card-records/goods/049352.json";
import goods049354 from "./card-records/goods/049354.json";
import goods049372 from "./card-records/goods/049372.json";
import goods049376 from "./card-records/goods/049376.json";
import goods049380 from "./card-records/goods/049380.json";
import goods049383 from "./card-records/goods/049383.json";
import goods049602 from "./card-records/goods/049602.json";
import goods049977 from "./card-records/goods/049977.json";
import goods050068 from "./card-records/goods/050068.json";
import goods050156 from "./card-records/goods/050156.json";
import goods050206 from "./card-records/goods/050206.json";
import goods050402 from "./card-records/goods/050402.json";
import goods050424 from "./card-records/goods/050424.json";
import goods050461 from "./card-records/goods/050461.json";
import goods050462 from "./card-records/goods/050462.json";
import goods050595 from "./card-records/goods/050595.json";
import goods050596 from "./card-records/goods/050596.json";
import goods050600 from "./card-records/goods/050600.json";
import pokemon045203 from "./card-records/pokemon/045203.json";
import pokemon045519 from "./card-records/pokemon/045519.json";
import pokemon045594 from "./card-records/pokemon/045594.json";
import pokemon045621 from "./card-records/pokemon/045621.json";
import pokemon045702 from "./card-records/pokemon/045702.json";
import pokemon045724 from "./card-records/pokemon/045724.json";
import pokemon045881 from "./card-records/pokemon/045881.json";
import pokemon045915 from "./card-records/pokemon/045915.json";
import pokemon045922 from "./card-records/pokemon/045922.json";
import pokemon045977 from "./card-records/pokemon/045977.json";
import pokemon045978 from "./card-records/pokemon/045978.json";
import pokemon046247 from "./card-records/pokemon/046247.json";
import pokemon046248 from "./card-records/pokemon/046248.json";
import pokemon046372 from "./card-records/pokemon/046372.json";
import pokemon046415 from "./card-records/pokemon/046415.json";
import pokemon046470 from "./card-records/pokemon/046470.json";
import pokemon046500 from "./card-records/pokemon/046500.json";
import pokemon046518 from "./card-records/pokemon/046518.json";
import pokemon046667 from "./card-records/pokemon/046667.json";
import pokemon046668 from "./card-records/pokemon/046668.json";
import pokemon046670 from "./card-records/pokemon/046670.json";
import pokemon046689 from "./card-records/pokemon/046689.json";
import pokemon046690 from "./card-records/pokemon/046690.json";
import pokemon046926 from "./card-records/pokemon/046926.json";
import pokemon047041 from "./card-records/pokemon/047041.json";
import pokemon047086 from "./card-records/pokemon/047086.json";
import pokemon047087 from "./card-records/pokemon/047087.json";
import pokemon047257 from "./card-records/pokemon/047257.json";
import pokemon047258 from "./card-records/pokemon/047258.json";
import pokemon047259 from "./card-records/pokemon/047259.json";
import pokemon047366 from "./card-records/pokemon/047366.json";
import pokemon047381 from "./card-records/pokemon/047381.json";
import pokemon047411 from "./card-records/pokemon/047411.json";
import pokemon047412 from "./card-records/pokemon/047412.json";
import pokemon047663 from "./card-records/pokemon/047663.json";
import pokemon047739 from "./card-records/pokemon/047739.json";
import pokemon047759 from "./card-records/pokemon/047759.json";
import pokemon047760 from "./card-records/pokemon/047760.json";
import pokemon047761 from "./card-records/pokemon/047761.json";
import pokemon047762 from "./card-records/pokemon/047762.json";
import pokemon047800 from "./card-records/pokemon/047800.json";
import pokemon047801 from "./card-records/pokemon/047801.json";
import pokemon047832 from "./card-records/pokemon/047832.json";
import pokemon047833 from "./card-records/pokemon/047833.json";
import pokemon047834 from "./card-records/pokemon/047834.json";
import pokemon047847 from "./card-records/pokemon/047847.json";
import pokemon047988 from "./card-records/pokemon/047988.json";
import pokemon048351 from "./card-records/pokemon/048351.json";
import pokemon048353 from "./card-records/pokemon/048353.json";
import pokemon048358 from "./card-records/pokemon/048358.json";
import pokemon048446 from "./card-records/pokemon/048446.json";
import pokemon048464 from "./card-records/pokemon/048464.json";
import pokemon048482 from "./card-records/pokemon/048482.json";
import pokemon048495 from "./card-records/pokemon/048495.json";
import pokemon048533 from "./card-records/pokemon/048533.json";
import pokemon048534 from "./card-records/pokemon/048534.json";
import pokemon048543 from "./card-records/pokemon/048543.json";
import pokemon048554 from "./card-records/pokemon/048554.json";
import pokemon048557 from "./card-records/pokemon/048557.json";
import pokemon048634 from "./card-records/pokemon/048634.json";
import pokemon048646 from "./card-records/pokemon/048646.json";
import pokemon048647 from "./card-records/pokemon/048647.json";
import pokemon048648 from "./card-records/pokemon/048648.json";
import pokemon048651 from "./card-records/pokemon/048651.json";
import pokemon048657 from "./card-records/pokemon/048657.json";
import pokemon048732 from "./card-records/pokemon/048732.json";
import pokemon048733 from "./card-records/pokemon/048733.json";
import pokemon048748 from "./card-records/pokemon/048748.json";
import pokemon048778 from "./card-records/pokemon/048778.json";
import pokemon048780 from "./card-records/pokemon/048780.json";
import pokemon048798 from "./card-records/pokemon/048798.json";
import pokemon048810 from "./card-records/pokemon/048810.json";
import pokemon048834 from "./card-records/pokemon/048834.json";
import pokemon048835 from "./card-records/pokemon/048835.json";
import pokemon048940 from "./card-records/pokemon/048940.json";
import pokemon049024 from "./card-records/pokemon/049024.json";
import pokemon049025 from "./card-records/pokemon/049025.json";
import pokemon049026 from "./card-records/pokemon/049026.json";
import pokemon049074 from "./card-records/pokemon/049074.json";
import pokemon049092 from "./card-records/pokemon/049092.json";
import pokemon049093 from "./card-records/pokemon/049093.json";
import pokemon049123 from "./card-records/pokemon/049123.json";
import pokemon049185 from "./card-records/pokemon/049185.json";
import pokemon049197 from "./card-records/pokemon/049197.json";
import pokemon049203 from "./card-records/pokemon/049203.json";
import pokemon049205 from "./card-records/pokemon/049205.json";
import pokemon049207 from "./card-records/pokemon/049207.json";
import pokemon049212 from "./card-records/pokemon/049212.json";
import pokemon049261 from "./card-records/pokemon/049261.json";
import pokemon049262 from "./card-records/pokemon/049262.json";
import pokemon049263 from "./card-records/pokemon/049263.json";
import pokemon049264 from "./card-records/pokemon/049264.json";
import pokemon049270 from "./card-records/pokemon/049270.json";
import pokemon049282 from "./card-records/pokemon/049282.json";
import pokemon049341 from "./card-records/pokemon/049341.json";
import pokemon049346 from "./card-records/pokemon/049346.json";
import pokemon049478 from "./card-records/pokemon/049478.json";
import pokemon049481 from "./card-records/pokemon/049481.json";
import pokemon049482 from "./card-records/pokemon/049482.json";
import pokemon049684 from "./card-records/pokemon/049684.json";
import pokemon049694 from "./card-records/pokemon/049694.json";
import pokemon049714 from "./card-records/pokemon/049714.json";
import pokemon049715 from "./card-records/pokemon/049715.json";
import pokemon049968 from "./card-records/pokemon/049968.json";
import pokemon050104 from "./card-records/pokemon/050104.json";
import pokemon050105 from "./card-records/pokemon/050105.json";
import pokemon050106 from "./card-records/pokemon/050106.json";
import pokemon050143 from "./card-records/pokemon/050143.json";
import pokemon050152 from "./card-records/pokemon/050152.json";
import pokemon050224 from "./card-records/pokemon/050224.json";
import pokemon050225 from "./card-records/pokemon/050225.json";
import pokemon050250 from "./card-records/pokemon/050250.json";
import pokemon050251 from "./card-records/pokemon/050251.json";
import pokemon050258 from "./card-records/pokemon/050258.json";
import pokemon050263 from "./card-records/pokemon/050263.json";
import pokemon050283 from "./card-records/pokemon/050283.json";
import pokemon050284 from "./card-records/pokemon/050284.json";
import pokemon050285 from "./card-records/pokemon/050285.json";
import pokemon050308 from "./card-records/pokemon/050308.json";
import pokemon050321 from "./card-records/pokemon/050321.json";
import pokemon050364 from "./card-records/pokemon/050364.json";
import pokemon050388 from "./card-records/pokemon/050388.json";
import pokemon050389 from "./card-records/pokemon/050389.json";
import pokemon050390 from "./card-records/pokemon/050390.json";
import pokemon050392 from "./card-records/pokemon/050392.json";
import pokemon050396 from "./card-records/pokemon/050396.json";
import pokemon050400 from "./card-records/pokemon/050400.json";
import pokemon050564 from "./card-records/pokemon/050564.json";
import pokemon050565 from "./card-records/pokemon/050565.json";
import pokemon050566 from "./card-records/pokemon/050566.json";
import pokemon050567 from "./card-records/pokemon/050567.json";
import pokemon050568 from "./card-records/pokemon/050568.json";
import pokemon050569 from "./card-records/pokemon/050569.json";
import pokemon050570 from "./card-records/pokemon/050570.json";
import pokemon050571 from "./card-records/pokemon/050571.json";
import pokemon050572 from "./card-records/pokemon/050572.json";
import pokemon050573 from "./card-records/pokemon/050573.json";
import pokemon050574 from "./card-records/pokemon/050574.json";
import pokemon050575 from "./card-records/pokemon/050575.json";
import pokemon050576 from "./card-records/pokemon/050576.json";
import pokemon050577 from "./card-records/pokemon/050577.json";
import pokemon050578 from "./card-records/pokemon/050578.json";
import pokemon050579 from "./card-records/pokemon/050579.json";
import pokemon050580 from "./card-records/pokemon/050580.json";
import pokemon050581 from "./card-records/pokemon/050581.json";
import pokemon050582 from "./card-records/pokemon/050582.json";
import pokemon050583 from "./card-records/pokemon/050583.json";
import pokemon050584 from "./card-records/pokemon/050584.json";
import pokemon050585 from "./card-records/pokemon/050585.json";
import pokemon050586 from "./card-records/pokemon/050586.json";
import pokemon050587 from "./card-records/pokemon/050587.json";
import pokemon050588 from "./card-records/pokemon/050588.json";
import pokemon050590 from "./card-records/pokemon/050590.json";
import pokemon050629 from "./card-records/pokemon/050629.json";
import pokemon050630 from "./card-records/pokemon/050630.json";
import pokemon050631 from "./card-records/pokemon/050631.json";
import pokemon050632 from "./card-records/pokemon/050632.json";
import pokemon050633 from "./card-records/pokemon/050633.json";
import pokemon050634 from "./card-records/pokemon/050634.json";
import pokemon050635 from "./card-records/pokemon/050635.json";
import pokemon050636 from "./card-records/pokemon/050636.json";
import pokemon050637 from "./card-records/pokemon/050637.json";
import pokemon050638 from "./card-records/pokemon/050638.json";
import pokemon050639 from "./card-records/pokemon/050639.json";
import pokemon050640 from "./card-records/pokemon/050640.json";
import pokemon050641 from "./card-records/pokemon/050641.json";
import pokemon050642 from "./card-records/pokemon/050642.json";
import pokemon050643 from "./card-records/pokemon/050643.json";
import pokemon050644 from "./card-records/pokemon/050644.json";
import pokemon050645 from "./card-records/pokemon/050645.json";
import pokemon050646 from "./card-records/pokemon/050646.json";
import pokemon050647 from "./card-records/pokemon/050647.json";
import pokemon050648 from "./card-records/pokemon/050648.json";
import pokemon050649 from "./card-records/pokemon/050649.json";
import pokemon050650 from "./card-records/pokemon/050650.json";
import pokemon050651 from "./card-records/pokemon/050651.json";
import pokemon050652 from "./card-records/pokemon/050652.json";
import pokemon050653 from "./card-records/pokemon/050653.json";
import pokemon050654 from "./card-records/pokemon/050654.json";
import pokemon050655 from "./card-records/pokemon/050655.json";
import pokemon050656 from "./card-records/pokemon/050656.json";
import pokemon050657 from "./card-records/pokemon/050657.json";
import pokemon050658 from "./card-records/pokemon/050658.json";
import pokemon050659 from "./card-records/pokemon/050659.json";
import pokemon050660 from "./card-records/pokemon/050660.json";
import pokemon050669 from "./card-records/pokemon/050669.json";
import pokemonTools045281 from "./card-records/pokemon-tools/045281.json";
import pokemonTools045633 from "./card-records/pokemon-tools/045633.json";
import pokemonTools045786 from "./card-records/pokemon-tools/045786.json";
import pokemonTools049397 from "./card-records/pokemon-tools/049397.json";
import pokemonTools049398 from "./card-records/pokemon-tools/049398.json";
import pokemonTools049405 from "./card-records/pokemon-tools/049405.json";
import pokemonTools050464 from "./card-records/pokemon-tools/050464.json";
import stadiums045939 from "./card-records/stadiums/045939.json";
import stadiums046040 from "./card-records/stadiums/046040.json";
import stadiums046446 from "./card-records/stadiums/046446.json";
import stadiums046841 from "./card-records/stadiums/046841.json";
import stadiums047214 from "./card-records/stadiums/047214.json";
import stadiums047271 from "./card-records/stadiums/047271.json";
import stadiums048419 from "./card-records/stadiums/048419.json";
import stadiums048703 from "./card-records/stadiums/048703.json";
import stadiums048706 from "./card-records/stadiums/048706.json";
import stadiums048710 from "./card-records/stadiums/048710.json";
import stadiums048711 from "./card-records/stadiums/048711.json";
import stadiums048712 from "./card-records/stadiums/048712.json";
import stadiums050076 from "./card-records/stadiums/050076.json";
import stadiums050164 from "./card-records/stadiums/050164.json";
import supporters045284 from "./card-records/supporters/045284.json";
import supporters045637 from "./card-records/supporters/045637.json";
import supporters045934 from "./card-records/supporters/045934.json";
import supporters046442 from "./card-records/supporters/046442.json";
import supporters047357 from "./card-records/supporters/047357.json";
import supporters047526 from "./card-records/supporters/047526.json";
import supporters047856 from "./card-records/supporters/047856.json";
import supporters047894 from "./card-records/supporters/047894.json";
import supporters048418 from "./card-records/supporters/048418.json";
import supporters048694 from "./card-records/supporters/048694.json";
import supporters049412 from "./card-records/supporters/049412.json";
import supporters049417 from "./card-records/supporters/049417.json";
import supporters049420 from "./card-records/supporters/049420.json";
import supporters049431 from "./card-records/supporters/049431.json";
import supporters049445 from "./card-records/supporters/049445.json";
import supporters049708 from "./card-records/supporters/049708.json";
import supporters050009 from "./card-records/supporters/050009.json";
import supporters050083 from "./card-records/supporters/050083.json";
import supporters050159 from "./card-records/supporters/050159.json";
import supporters050295 from "./card-records/supporters/050295.json";
import supporters050297 from "./card-records/supporters/050297.json";
import supporters050407 from "./card-records/supporters/050407.json";
import supporters050428 from "./card-records/supporters/050428.json";
import supporters050467 from "./card-records/supporters/050467.json";
import supporters050601 from "./card-records/supporters/050601.json";
import supporters050602 from "./card-records/supporters/050602.json";
import supporters050603 from "./card-records/supporters/050603.json";
import supporters050605 from "./card-records/supporters/050605.json";

/** カード ID(どの印刷の ID からも)→ カードの記録。読み込み時に全記録を検査し、誤りがあれば止める。 */
export const cardRecordTable = buildCardRecordTable([
  { content: energies030578, path: "energies/030578.json" },
  { content: energies045217, path: "energies/045217.json" },
  { content: energies046293, path: "energies/046293.json" },
  { content: energies047903, path: "energies/047903.json" },
  { content: energies047905, path: "energies/047905.json" },
  { content: energies047906, path: "energies/047906.json" },
  { content: energies047908, path: "energies/047908.json" },
  { content: energies047909, path: "energies/047909.json" },
  { content: energies049452, path: "energies/049452.json" },
  { content: energies049454, path: "energies/049454.json" },
  { content: energies049455, path: "energies/049455.json" },
  { content: energies049457, path: "energies/049457.json" },
  { content: energies049463, path: "energies/049463.json" },
  { content: energies049712, path: "energies/049712.json" },
  { content: energies049713, path: "energies/049713.json" },
  { content: energies050746, path: "energies/050746.json" },
  { content: goods042243, path: "goods/042243.json" },
  { content: goods045783, path: "goods/045783.json" },
  { content: goods046220, path: "goods/046220.json" },
  { content: goods047791, path: "goods/047791.json" },
  { content: goods047792, path: "goods/047792.json" },
  { content: goods048299, path: "goods/048299.json" },
  { content: goods048670, path: "goods/048670.json" },
  { content: goods048671, path: "goods/048671.json" },
  { content: goods048672, path: "goods/048672.json" },
  { content: goods048675, path: "goods/048675.json" },
  { content: goods048681, path: "goods/048681.json" },
  { content: goods049349, path: "goods/049349.json" },
  { content: goods049351, path: "goods/049351.json" },
  { content: goods049352, path: "goods/049352.json" },
  { content: goods049354, path: "goods/049354.json" },
  { content: goods049372, path: "goods/049372.json" },
  { content: goods049376, path: "goods/049376.json" },
  { content: goods049380, path: "goods/049380.json" },
  { content: goods049383, path: "goods/049383.json" },
  { content: goods049602, path: "goods/049602.json" },
  { content: goods049977, path: "goods/049977.json" },
  { content: goods050068, path: "goods/050068.json" },
  { content: goods050156, path: "goods/050156.json" },
  { content: goods050206, path: "goods/050206.json" },
  { content: goods050402, path: "goods/050402.json" },
  { content: goods050424, path: "goods/050424.json" },
  { content: goods050461, path: "goods/050461.json" },
  { content: goods050462, path: "goods/050462.json" },
  { content: goods050595, path: "goods/050595.json" },
  { content: goods050596, path: "goods/050596.json" },
  { content: goods050600, path: "goods/050600.json" },
  { content: pokemonTools045281, path: "pokemon-tools/045281.json" },
  { content: pokemonTools045633, path: "pokemon-tools/045633.json" },
  { content: pokemonTools045786, path: "pokemon-tools/045786.json" },
  { content: pokemonTools049397, path: "pokemon-tools/049397.json" },
  { content: pokemonTools049398, path: "pokemon-tools/049398.json" },
  { content: pokemonTools049405, path: "pokemon-tools/049405.json" },
  { content: pokemonTools050464, path: "pokemon-tools/050464.json" },
  { content: pokemon045203, path: "pokemon/045203.json" },
  { content: pokemon045519, path: "pokemon/045519.json" },
  { content: pokemon045594, path: "pokemon/045594.json" },
  { content: pokemon045621, path: "pokemon/045621.json" },
  { content: pokemon045702, path: "pokemon/045702.json" },
  { content: pokemon045724, path: "pokemon/045724.json" },
  { content: pokemon045881, path: "pokemon/045881.json" },
  { content: pokemon045915, path: "pokemon/045915.json" },
  { content: pokemon045922, path: "pokemon/045922.json" },
  { content: pokemon045977, path: "pokemon/045977.json" },
  { content: pokemon045978, path: "pokemon/045978.json" },
  { content: pokemon046247, path: "pokemon/046247.json" },
  { content: pokemon046248, path: "pokemon/046248.json" },
  { content: pokemon046372, path: "pokemon/046372.json" },
  { content: pokemon046415, path: "pokemon/046415.json" },
  { content: pokemon046470, path: "pokemon/046470.json" },
  { content: pokemon046500, path: "pokemon/046500.json" },
  { content: pokemon046518, path: "pokemon/046518.json" },
  { content: pokemon046667, path: "pokemon/046667.json" },
  { content: pokemon046668, path: "pokemon/046668.json" },
  { content: pokemon046670, path: "pokemon/046670.json" },
  { content: pokemon046689, path: "pokemon/046689.json" },
  { content: pokemon046690, path: "pokemon/046690.json" },
  { content: pokemon046926, path: "pokemon/046926.json" },
  { content: pokemon047041, path: "pokemon/047041.json" },
  { content: pokemon047086, path: "pokemon/047086.json" },
  { content: pokemon047087, path: "pokemon/047087.json" },
  { content: pokemon047257, path: "pokemon/047257.json" },
  { content: pokemon047258, path: "pokemon/047258.json" },
  { content: pokemon047259, path: "pokemon/047259.json" },
  { content: pokemon047366, path: "pokemon/047366.json" },
  { content: pokemon047381, path: "pokemon/047381.json" },
  { content: pokemon047411, path: "pokemon/047411.json" },
  { content: pokemon047412, path: "pokemon/047412.json" },
  { content: pokemon047663, path: "pokemon/047663.json" },
  { content: pokemon047739, path: "pokemon/047739.json" },
  { content: pokemon047759, path: "pokemon/047759.json" },
  { content: pokemon047760, path: "pokemon/047760.json" },
  { content: pokemon047761, path: "pokemon/047761.json" },
  { content: pokemon047762, path: "pokemon/047762.json" },
  { content: pokemon047800, path: "pokemon/047800.json" },
  { content: pokemon047801, path: "pokemon/047801.json" },
  { content: pokemon047832, path: "pokemon/047832.json" },
  { content: pokemon047833, path: "pokemon/047833.json" },
  { content: pokemon047834, path: "pokemon/047834.json" },
  { content: pokemon047847, path: "pokemon/047847.json" },
  { content: pokemon047988, path: "pokemon/047988.json" },
  { content: pokemon048351, path: "pokemon/048351.json" },
  { content: pokemon048353, path: "pokemon/048353.json" },
  { content: pokemon048358, path: "pokemon/048358.json" },
  { content: pokemon048446, path: "pokemon/048446.json" },
  { content: pokemon048464, path: "pokemon/048464.json" },
  { content: pokemon048482, path: "pokemon/048482.json" },
  { content: pokemon048495, path: "pokemon/048495.json" },
  { content: pokemon048533, path: "pokemon/048533.json" },
  { content: pokemon048534, path: "pokemon/048534.json" },
  { content: pokemon048543, path: "pokemon/048543.json" },
  { content: pokemon048554, path: "pokemon/048554.json" },
  { content: pokemon048557, path: "pokemon/048557.json" },
  { content: pokemon048634, path: "pokemon/048634.json" },
  { content: pokemon048646, path: "pokemon/048646.json" },
  { content: pokemon048647, path: "pokemon/048647.json" },
  { content: pokemon048648, path: "pokemon/048648.json" },
  { content: pokemon048651, path: "pokemon/048651.json" },
  { content: pokemon048657, path: "pokemon/048657.json" },
  { content: pokemon048732, path: "pokemon/048732.json" },
  { content: pokemon048733, path: "pokemon/048733.json" },
  { content: pokemon048748, path: "pokemon/048748.json" },
  { content: pokemon048778, path: "pokemon/048778.json" },
  { content: pokemon048780, path: "pokemon/048780.json" },
  { content: pokemon048798, path: "pokemon/048798.json" },
  { content: pokemon048810, path: "pokemon/048810.json" },
  { content: pokemon048834, path: "pokemon/048834.json" },
  { content: pokemon048835, path: "pokemon/048835.json" },
  { content: pokemon048940, path: "pokemon/048940.json" },
  { content: pokemon049024, path: "pokemon/049024.json" },
  { content: pokemon049025, path: "pokemon/049025.json" },
  { content: pokemon049026, path: "pokemon/049026.json" },
  { content: pokemon049074, path: "pokemon/049074.json" },
  { content: pokemon049092, path: "pokemon/049092.json" },
  { content: pokemon049093, path: "pokemon/049093.json" },
  { content: pokemon049123, path: "pokemon/049123.json" },
  { content: pokemon049185, path: "pokemon/049185.json" },
  { content: pokemon049197, path: "pokemon/049197.json" },
  { content: pokemon049203, path: "pokemon/049203.json" },
  { content: pokemon049205, path: "pokemon/049205.json" },
  { content: pokemon049207, path: "pokemon/049207.json" },
  { content: pokemon049212, path: "pokemon/049212.json" },
  { content: pokemon049261, path: "pokemon/049261.json" },
  { content: pokemon049262, path: "pokemon/049262.json" },
  { content: pokemon049263, path: "pokemon/049263.json" },
  { content: pokemon049264, path: "pokemon/049264.json" },
  { content: pokemon049270, path: "pokemon/049270.json" },
  { content: pokemon049282, path: "pokemon/049282.json" },
  { content: pokemon049341, path: "pokemon/049341.json" },
  { content: pokemon049346, path: "pokemon/049346.json" },
  { content: pokemon049478, path: "pokemon/049478.json" },
  { content: pokemon049481, path: "pokemon/049481.json" },
  { content: pokemon049482, path: "pokemon/049482.json" },
  { content: pokemon049684, path: "pokemon/049684.json" },
  { content: pokemon049694, path: "pokemon/049694.json" },
  { content: pokemon049714, path: "pokemon/049714.json" },
  { content: pokemon049715, path: "pokemon/049715.json" },
  { content: pokemon049968, path: "pokemon/049968.json" },
  { content: pokemon050104, path: "pokemon/050104.json" },
  { content: pokemon050105, path: "pokemon/050105.json" },
  { content: pokemon050106, path: "pokemon/050106.json" },
  { content: pokemon050143, path: "pokemon/050143.json" },
  { content: pokemon050152, path: "pokemon/050152.json" },
  { content: pokemon050224, path: "pokemon/050224.json" },
  { content: pokemon050225, path: "pokemon/050225.json" },
  { content: pokemon050250, path: "pokemon/050250.json" },
  { content: pokemon050251, path: "pokemon/050251.json" },
  { content: pokemon050258, path: "pokemon/050258.json" },
  { content: pokemon050263, path: "pokemon/050263.json" },
  { content: pokemon050283, path: "pokemon/050283.json" },
  { content: pokemon050284, path: "pokemon/050284.json" },
  { content: pokemon050285, path: "pokemon/050285.json" },
  { content: pokemon050308, path: "pokemon/050308.json" },
  { content: pokemon050321, path: "pokemon/050321.json" },
  { content: pokemon050364, path: "pokemon/050364.json" },
  { content: pokemon050388, path: "pokemon/050388.json" },
  { content: pokemon050389, path: "pokemon/050389.json" },
  { content: pokemon050390, path: "pokemon/050390.json" },
  { content: pokemon050392, path: "pokemon/050392.json" },
  { content: pokemon050396, path: "pokemon/050396.json" },
  { content: pokemon050400, path: "pokemon/050400.json" },
  { content: pokemon050564, path: "pokemon/050564.json" },
  { content: pokemon050565, path: "pokemon/050565.json" },
  { content: pokemon050566, path: "pokemon/050566.json" },
  { content: pokemon050567, path: "pokemon/050567.json" },
  { content: pokemon050568, path: "pokemon/050568.json" },
  { content: pokemon050569, path: "pokemon/050569.json" },
  { content: pokemon050570, path: "pokemon/050570.json" },
  { content: pokemon050571, path: "pokemon/050571.json" },
  { content: pokemon050572, path: "pokemon/050572.json" },
  { content: pokemon050573, path: "pokemon/050573.json" },
  { content: pokemon050574, path: "pokemon/050574.json" },
  { content: pokemon050575, path: "pokemon/050575.json" },
  { content: pokemon050576, path: "pokemon/050576.json" },
  { content: pokemon050577, path: "pokemon/050577.json" },
  { content: pokemon050578, path: "pokemon/050578.json" },
  { content: pokemon050579, path: "pokemon/050579.json" },
  { content: pokemon050580, path: "pokemon/050580.json" },
  { content: pokemon050581, path: "pokemon/050581.json" },
  { content: pokemon050582, path: "pokemon/050582.json" },
  { content: pokemon050583, path: "pokemon/050583.json" },
  { content: pokemon050584, path: "pokemon/050584.json" },
  { content: pokemon050585, path: "pokemon/050585.json" },
  { content: pokemon050586, path: "pokemon/050586.json" },
  { content: pokemon050587, path: "pokemon/050587.json" },
  { content: pokemon050588, path: "pokemon/050588.json" },
  { content: pokemon050590, path: "pokemon/050590.json" },
  { content: pokemon050629, path: "pokemon/050629.json" },
  { content: pokemon050630, path: "pokemon/050630.json" },
  { content: pokemon050631, path: "pokemon/050631.json" },
  { content: pokemon050632, path: "pokemon/050632.json" },
  { content: pokemon050633, path: "pokemon/050633.json" },
  { content: pokemon050634, path: "pokemon/050634.json" },
  { content: pokemon050635, path: "pokemon/050635.json" },
  { content: pokemon050636, path: "pokemon/050636.json" },
  { content: pokemon050637, path: "pokemon/050637.json" },
  { content: pokemon050638, path: "pokemon/050638.json" },
  { content: pokemon050639, path: "pokemon/050639.json" },
  { content: pokemon050640, path: "pokemon/050640.json" },
  { content: pokemon050641, path: "pokemon/050641.json" },
  { content: pokemon050642, path: "pokemon/050642.json" },
  { content: pokemon050643, path: "pokemon/050643.json" },
  { content: pokemon050644, path: "pokemon/050644.json" },
  { content: pokemon050645, path: "pokemon/050645.json" },
  { content: pokemon050646, path: "pokemon/050646.json" },
  { content: pokemon050647, path: "pokemon/050647.json" },
  { content: pokemon050648, path: "pokemon/050648.json" },
  { content: pokemon050649, path: "pokemon/050649.json" },
  { content: pokemon050650, path: "pokemon/050650.json" },
  { content: pokemon050651, path: "pokemon/050651.json" },
  { content: pokemon050652, path: "pokemon/050652.json" },
  { content: pokemon050653, path: "pokemon/050653.json" },
  { content: pokemon050654, path: "pokemon/050654.json" },
  { content: pokemon050655, path: "pokemon/050655.json" },
  { content: pokemon050656, path: "pokemon/050656.json" },
  { content: pokemon050657, path: "pokemon/050657.json" },
  { content: pokemon050658, path: "pokemon/050658.json" },
  { content: pokemon050659, path: "pokemon/050659.json" },
  { content: pokemon050660, path: "pokemon/050660.json" },
  { content: pokemon050669, path: "pokemon/050669.json" },
  { content: stadiums045939, path: "stadiums/045939.json" },
  { content: stadiums046040, path: "stadiums/046040.json" },
  { content: stadiums046446, path: "stadiums/046446.json" },
  { content: stadiums046841, path: "stadiums/046841.json" },
  { content: stadiums047214, path: "stadiums/047214.json" },
  { content: stadiums047271, path: "stadiums/047271.json" },
  { content: stadiums048419, path: "stadiums/048419.json" },
  { content: stadiums048703, path: "stadiums/048703.json" },
  { content: stadiums048706, path: "stadiums/048706.json" },
  { content: stadiums048710, path: "stadiums/048710.json" },
  { content: stadiums048711, path: "stadiums/048711.json" },
  { content: stadiums048712, path: "stadiums/048712.json" },
  { content: stadiums050076, path: "stadiums/050076.json" },
  { content: stadiums050164, path: "stadiums/050164.json" },
  { content: supporters045284, path: "supporters/045284.json" },
  { content: supporters045637, path: "supporters/045637.json" },
  { content: supporters045934, path: "supporters/045934.json" },
  { content: supporters046442, path: "supporters/046442.json" },
  { content: supporters047357, path: "supporters/047357.json" },
  { content: supporters047526, path: "supporters/047526.json" },
  { content: supporters047856, path: "supporters/047856.json" },
  { content: supporters047894, path: "supporters/047894.json" },
  { content: supporters048418, path: "supporters/048418.json" },
  { content: supporters048694, path: "supporters/048694.json" },
  { content: supporters049412, path: "supporters/049412.json" },
  { content: supporters049417, path: "supporters/049417.json" },
  { content: supporters049420, path: "supporters/049420.json" },
  { content: supporters049431, path: "supporters/049431.json" },
  { content: supporters049445, path: "supporters/049445.json" },
  { content: supporters049708, path: "supporters/049708.json" },
  { content: supporters050009, path: "supporters/050009.json" },
  { content: supporters050083, path: "supporters/050083.json" },
  { content: supporters050159, path: "supporters/050159.json" },
  { content: supporters050295, path: "supporters/050295.json" },
  { content: supporters050297, path: "supporters/050297.json" },
  { content: supporters050407, path: "supporters/050407.json" },
  { content: supporters050428, path: "supporters/050428.json" },
  { content: supporters050467, path: "supporters/050467.json" },
  { content: supporters050601, path: "supporters/050601.json" },
  { content: supporters050602, path: "supporters/050602.json" },
  { content: supporters050603, path: "supporters/050603.json" },
  { content: supporters050605, path: "supporters/050605.json" },
]);
