// 最少输入锁定条件提取（供功能安全工程师在不等价结论后发起）。
//
// 需求约束：
//  - 必须从本次比较的共享变量序与异或结果（既有 ROBDD）直接求出，
//    不重建 BDD、不抽样、不随机搜索、不只验证当前反例；
//  - 条件是真正的强制条件：锁定其中每一项后，其余输入的任意组合
//    都令两图输出分歧（即该部分赋值是异或函数的蕴含项）；
//  - 文字数最少；并列最少时按“变量名 ASCII 序 + 0 先于 1”的
//    赋值序列取首个（由 BddManager.minImplicant 的递归结构保证）；
//  - 报告附精确全局复核：异或根在锁定赋值下 restrict 为 1 终端。

import type { AnalysisResult, LockingReport } from './types';

/**
 * 从一次已完成的比较中提取最少锁定条件。
 * 等价（异或根为 0 终端）时无分歧可锁定，返回 null。
 */
export function extractLockingCondition(
  result: AnalysisResult,
): LockingReport | null {
  const { bdd, diffRoot } = result;
  if (result.equivalent || diffRoot === bdd.zero) return null;

  // 最少文字蕴含项：在既有异或根上精确递归求解（含并列次序规则）
  const cube = bdd.minImplicant(diffRoot);
  if (cube === null) return null; // 不可达：非等价即异或根可满足

  const { variables } = bdd;
  const locked = cube.map((lit) => ({
    variable: variables[lit.level],
    value: lit.value,
  }));
  const lockedLevels = new Set(cube.map((lit) => lit.level));
  const unlocked = variables.filter((_, i) => !lockedLevels.has(i));

  // 精确全局复核：锁定后异或根 restrict 必须为 1 终端，
  // 即未锁定输入的全部 2^k 种补全都使两图输出不同。
  const fixed = new Map(cube.map((lit) => [lit.level, lit.value]));
  const verified = bdd.restrict(diffRoot, fixed) === bdd.one;

  return {
    variables: [...variables],
    locked,
    unlocked,
    completionCount: (2n ** BigInt(unlocked.length)).toString(10),
    verified,
  };
}
