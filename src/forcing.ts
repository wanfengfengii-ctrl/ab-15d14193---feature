// 最少文字强制（锁定）条件提取。
//
// 需求：
//  - 仅在本次比较已成功且结论为不等价（异或根 D 非 0 终端）时提取；
//  - 直接复用本次比较的共享变量序与异或结果（同一 BddManager / 同一 D 根），
//    在既有 ROBDD 上做精确全局裁决，不抽样、不随机搜索、不只验证当前反例；
//  - 求文字数最少的部分赋值，固定后任意其余输入组合都令两图输出不同
//    （即令 D 恒为 1）；多个最少解时按变量名升序、同变量 0 先于 1 取首个；
//  - 报告锁定项、未锁定输入与“所有补全均分歧”的核算结论。

import type { BddManager } from './bdd/bdd';
import type { BddNode } from './bdd/bdd';
import type { LockConditionReport } from './types';

/**
 * 从异或根 diff 提取最少锁定条件。
 * @param bdd      本次比较共享的 BddManager（变量序即 variables）
 * @param diff     两图输出的异或根；调用方须保证其非 0 终端
 * @param variables 本次共享变量序（ASCII 升序）
 */
export function extractLockConditions(
  bdd: BddManager,
  diff: BddNode,
  variables: string[],
): LockConditionReport {
  const literals = bdd.minimumForcingAssignment(diff);
  // diff 非 0 终端 => 可满足 => 必存在（有限变量的部分赋值，如完整反例本身）
  if (literals === null) {
    throw new Error('异或根不可满足，无法提取锁定条件（仅不等价时可提取）');
  }

  // minimumForcingAssignment 返回按 level 升序的序列；变量名经共享变量序映射，
  // 故按 ASCII 变量序稳定展示。
  const locked = literals.map(({ level, value }) => ({
    variable: variables[level],
    value,
  }));

  const lockedSet = new Set(literals.map((l) => l.level));
  const unlocked = variables.filter((_, i) => !lockedSet.has(i));

  // 精确复核（自检，非生成路径）：逐项 restrict 把锁定变量固定后，
  // D 必须化为 1 终端——这正是“任意补全都使 D=1”的 BDD 判定。
  let restricted: BddNode = diff;
  for (const { level, value } of literals) {
    restricted = bdd.restrict(restricted, level, value);
  }
  const allCompletionsDiffer = bdd.isOne(restricted);

  return {
    locked,
    unlocked,
    completionCount: 2 ** unlocked.length,
    allCompletionsDiffer,
  };
}
