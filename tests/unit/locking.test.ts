import { describe, expect, it } from 'vitest';
import { analyze } from '../../src/analysis';
import { BddManager } from '../../src/bdd/bdd';
import { extractLockingCondition } from '../../src/locking';
import { validatePair } from '../../src/validation';
import type { AnalysisResult, LockLiteral } from '../../src/types';

function analyzePair(
  aNodes: unknown[],
  aOut: string,
  bNodes: unknown[],
  bOut: string,
): AnalysisResult {
  const r = validatePair(
    JSON.stringify({ nodes: aNodes, output: aOut }),
    JSON.stringify({ nodes: bNodes, output: bOut }),
  );
  if (r.errors.length > 0) {
    throw new Error(r.errors.map((e) => e.message).join('; '));
  }
  return analyze(r.graphA!, r.graphB!);
}

const I = (id: string, name: string) => ({ id, type: 'INPUT', name });
const K = (id: string, type: 'CONST0' | 'CONST1') => ({ id, type });
const G = (id: string, type: string, ins: string[]) => ({ id, type, in: ins });

// ---------------------------------------------------------------------------
// 测试专用参考实现：枚举全部 3^n 个部分赋值，独立核对“最少 + 字典序首个”。
// 产品代码不做任何枚举；穷举只存在于测试中（与 bdd.test.ts 的约定一致）。
// ---------------------------------------------------------------------------

type PartialAssign = Array<0 | 1 | undefined>;

/** 该部分赋值是否为强制条件：其全部补全都使异或根为 1 */
function isForcing(result: AnalysisResult, partial: PartialAssign): boolean {
  const vars = result.variables;
  const free: number[] = [];
  const completion: Record<string, 0 | 1> = {};
  vars.forEach((name, i) => {
    const v = partial[i];
    if (v === undefined) free.push(i);
    else completion[name] = v;
  });
  for (let mask = 0; mask < 1 << free.length; mask++) {
    free.forEach((idx, j) => {
      completion[vars[idx]] = ((mask >> j) & 1) as 0 | 1;
    });
    if (result.bdd.evaluate(result.diffRoot, completion) !== 1) return false;
  }
  return true;
}

function allPartials(n: number): PartialAssign[] {
  const out: PartialAssign[] = [];
  const cur: PartialAssign = new Array<0 | 1 | undefined>(n).fill(undefined);
  const rec = (i: number) => {
    if (i === n) {
      out.push([...cur]);
      return;
    }
    cur[i] = undefined;
    rec(i + 1);
    cur[i] = 0;
    rec(i + 1);
    cur[i] = 1;
    rec(i + 1);
    cur[i] = undefined;
  };
  rec(0);
  return out;
}

/** 字典序比较（变量名 ASCII 优先，同变量 0 先于 1），与需求并列规则一致 */
function compareCubes(a: LockLiteral[], b: LockLiteral[]): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i].variable !== b[i].variable) {
      return a[i].variable < b[i].variable ? -1 : 1;
    }
    if (a[i].value !== b[i].value) return a[i].value - b[i].value;
  }
  return a.length - b.length;
}

/** 参考答案：全部强制条件中文字数最少、并列取字典序首个 */
function referenceMinCube(result: AnalysisResult): LockLiteral[] {
  const vars = result.variables;
  const forcing: LockLiteral[][] = [];
  for (const partial of allPartials(vars.length)) {
    if (!isForcing(result, partial)) continue;
    forcing.push(
      partial.flatMap((v, i) =>
        v === undefined ? [] : [{ variable: vars[i], value: v }],
      ),
    );
  }
  expect(forcing.length).toBeGreaterThan(0);
  const minSize = Math.min(...forcing.map((c) => c.length));
  const best = forcing.filter((c) => c.length === minSize).sort(compareCubes);
  return best[0];
}

/** 报告必须与穷举参考完全一致，且复核通过 */
function expectMatchesReference(result: AnalysisResult): void {
  const report = extractLockingCondition(result);
  expect(report).not.toBeNull();
  const expected = referenceMinCube(result);
  expect(report!.locked).toEqual(expected);
  const lockedNames = new Set(expected.map((l) => l.variable));
  expect(report!.unlocked).toEqual(
    result.variables.filter((v) => !lockedNames.has(v)),
  );
  expect(report!.completionCount).toBe(
    (2n ** BigInt(report!.unlocked.length)).toString(10),
  );
  expect(report!.verified).toBe(true);
}

describe('extractLockingCondition 基本形态', () => {
  it('罕见分歧示例：(A∧B)∨C vs A∧B => 锁定 A=0, C=1；B 未锁定', () => {
    const r = analyzePair(
      [
        I('a', 'A'),
        I('b', 'B'),
        I('c', 'C'),
        G('ab', 'AND', ['a', 'b']),
        G('o', 'OR', ['ab', 'c']),
      ],
      'o',
      [I('x', 'A'), I('y', 'B'), G('o', 'AND', ['x', 'y'])],
      'o',
    );
    expect(r.equivalent).toBe(false);
    const report = extractLockingCondition(r)!;
    expect(report.locked).toEqual([
      { variable: 'A', value: 0 },
      { variable: 'C', value: 1 },
    ]);
    expect(report.unlocked).toEqual(['B']);
    expect(report.completionCount).toBe('2');
    expect(report.verified).toBe(true);
    // 锁定 A=0,C=1 后：旧图恒 1、新图恒 0，B 的两种取值都分歧
    expectMatchesReference(r);
  });

  it('XOR vs OR：唯一最少条件 A=1,B=1，无未锁定输入', () => {
    const r = analyzePair(
      [I('a', 'A'), I('b', 'B'), G('o', 'XOR', ['a', 'b'])],
      'o',
      [I('x', 'A'), I('y', 'B'), G('o', 'OR', ['x', 'y'])],
      'o',
    );
    const report = extractLockingCondition(r)!;
    expect(report.locked).toEqual([
      { variable: 'A', value: 1 },
      { variable: 'B', value: 1 },
    ]);
    expect(report.unlocked).toEqual([]);
    expect(report.completionCount).toBe('1');
    expectMatchesReference(r);
  });

  it('常量互补（异或根为 1 终端）：空锁定，全部输入未锁定', () => {
    const r = analyzePair(
      [I('a', 'A'), K('z', 'CONST0')],
      'z',
      [K('o', 'CONST1')],
      'o',
    );
    expect(r.equivalent).toBe(false);
    const report = extractLockingCondition(r)!;
    expect(report.locked).toEqual([]);
    expect(report.unlocked).toEqual(['A']);
    expect(report.completionCount).toBe('2');
    expect(report.verified).toBe(true);
    expectMatchesReference(r);
  });

  it('等价时不存在可提取条件：返回 null', () => {
    const r = analyzePair(
      [I('a', 'A'), I('b', 'B'), G('o', 'XOR', ['a', 'b'])],
      'o',
      [I('x', 'A'), I('y', 'B'), G('o', 'XOR', ['x', 'y'])],
      'o',
    );
    expect(r.equivalent).toBe(true);
    expect(extractLockingCondition(r)).toBeNull();
  });
});

describe('extractLockingCondition 并列次序', () => {
  it('同变量并列时 0 先于 1：A XOR B 的分歧条件取 A=0,B=1', () => {
    const r = analyzePair(
      [I('a', 'A'), I('b', 'B'), G('o', 'XOR', ['a', 'b'])],
      'o',
      [K('z', 'CONST0')],
      'z',
    );
    // 最少条件：{A=0,B=1} 与 {A=1,B=0}，同长，取 0 先于 1
    const report = extractLockingCondition(r)!;
    expect(report.locked).toEqual([
      { variable: 'A', value: 0 },
      { variable: 'B', value: 1 },
    ]);
    expectMatchesReference(r);
  });

  it('不同变量并列时按变量名取首个：(A∧B)∨(B∧C) 取 A=1,B=1 而非 B=1,C=1', () => {
    const r = analyzePair(
      [
        I('a', 'A'),
        I('b', 'B'),
        I('c', 'C'),
        G('ab', 'AND', ['a', 'b']),
        G('bc', 'AND', ['b', 'c']),
        G('o', 'OR', ['ab', 'bc']),
      ],
      'o',
      [K('z', 'CONST0')],
      'z',
    );
    const report = extractLockingCondition(r)!;
    expect(report.locked).toEqual([
      { variable: 'A', value: 1 },
      { variable: 'B', value: 1 },
    ]);
    expectMatchesReference(r);
  });

  it('跳过无关变量：分歧只依赖 B 时锁定 B=1，A 未锁定', () => {
    const r = analyzePair(
      [I('a', 'A'), I('b', 'B')],
      'b',
      [K('z', 'CONST0')],
      'z',
    );
    const report = extractLockingCondition(r)!;
    expect(report.locked).toEqual([{ variable: 'B', value: 1 }]);
    expect(report.unlocked).toEqual(['A']);
    expectMatchesReference(r);
  });
});

describe('extractLockingCondition 全局强制性（穷举交叉核对）', () => {
  it('四变量：¬((A∨D)∧B) 与 ¬(A∧B) 的分歧条件', () => {
    const r = analyzePair(
      [
        I('a', 'A'),
        I('b', 'B'),
        I('d', 'D'),
        G('ad', 'OR', ['a', 'd']),
        G('adb', 'AND', ['ad', 'b']),
        G('o', 'NOT', ['adb']),
      ],
      'o',
      [I('x', 'A'), I('y', 'B'), G('ab', 'AND', ['x', 'y']), G('o', 'NOT', ['ab'])],
      'o',
    );
    expect(r.equivalent).toBe(false);
    expectMatchesReference(r);
  });

  it('四变量：XOR(AND(A,B), OR(C,D)) 与 AND(A, XOR(B,C))', () => {
    const r = analyzePair(
      [
        I('a', 'A'),
        I('b', 'B'),
        I('c', 'C'),
        I('d', 'D'),
        G('ab', 'AND', ['a', 'b']),
        G('cd', 'OR', ['c', 'd']),
        G('o', 'XOR', ['ab', 'cd']),
      ],
      'o',
      [
        I('x', 'A'),
        I('y', 'B'),
        I('z', 'C'),
        G('bc', 'XOR', ['y', 'z']),
        G('o', 'AND', ['x', 'bc']),
      ],
      'o',
    );
    expect(r.equivalent).toBe(false);
    expectMatchesReference(r);
  });

  it('报告锁定项按 ASCII 变量序稳定排列，未锁定项为其补集', () => {
    const r = analyzePair(
      [
        I('a', 'A'),
        I('b', 'B'),
        I('c', 'C'),
        G('ab', 'AND', ['a', 'b']),
        G('o', 'OR', ['ab', 'c']),
      ],
      'o',
      [I('x', 'A'), I('y', 'B'), G('o', 'AND', ['x', 'y'])],
      'o',
    );
    const report = extractLockingCondition(r)!;
    const lockedNames = report.locked.map((l) => l.variable);
    const sorted = [...lockedNames].sort((x, y) => (x < y ? -1 : 1));
    expect(lockedNames).toEqual(sorted);
    expect([...lockedNames, ...report.unlocked].sort()).toEqual(
      [...report.variables].sort(),
    );
  });
});

describe('BddManager.minImplicant / restrict 基础性质', () => {
  it('1 终端的最少蕴含项为空条件；0 终端无解', () => {
    const m = new BddManager(['A', 'B']);
    expect(m.minImplicant(m.one)).toEqual([]);
    expect(m.minImplicant(m.zero)).toBeNull();
  });

  it('单变量函数 A：唯一最少条件 A=1', () => {
    const m = new BddManager(['A', 'B']);
    expect(m.minImplicant(m.ithVar(0))).toEqual([{ level: 0, value: 1 }]);
  });

  it('A∨B：最少条件为单文字，并列按变量序取首个 => A=1', () => {
    const m = new BddManager(['A', 'B']);
    const f = m.apply('or', m.ithVar(0), m.ithVar(1));
    // 单文字蕴含项：A=1 或 B=1；按变量序取首个 => A=1
    expect(m.minImplicant(f)).toEqual([{ level: 0, value: 1 }]);
  });

  it('restrict 固定变量后得到余因子，锁定蕴含项后恒为 1 终端', () => {
    const m = new BddManager(['A', 'B']);
    const f = m.apply('and', m.ithVar(0), m.ithVar(1));
    expect(m.restrict(f, new Map([[0, 1]]))).toBe(m.ithVar(1));
    expect(m.restrict(f, new Map([[0, 0]]))).toBe(m.zero);
    const cube = m.minImplicant(f)!;
    expect(m.restrict(f, new Map(cube.map((l) => [l.level, l.value])))).toBe(
      m.one,
    );
  });
});
