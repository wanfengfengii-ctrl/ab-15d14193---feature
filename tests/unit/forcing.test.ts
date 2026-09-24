import { describe, expect, it } from 'vitest';
import { BddManager, type BddNode } from '../../src/bdd/bdd';
import { analyze, topoOrder } from '../../src/analysis';
import { validatePair } from '../../src/validation';
import type { Graph, NormalNode } from '../../src/types';

// 穷举参考实现只存在于测试中：产品代码不含全赋值枚举/随机搜索。

/** 用 Shannon 结构把任意真值表建成 ROBDD 节点（经 mk 约简） */
function buildByTruthTable(
  m: BddManager,
  vars: string[],
  fn: (a: Record<string, 0 | 1>) => 0 | 1,
): BddNode {
  const go = (i: number, partial: Record<string, 0 | 1>): BddNode => {
    if (i === vars.length) return fn(partial) ? m.one : m.zero;
    const name = vars[i];
    const low = go(i + 1, { ...partial, [name]: 0 });
    const high = go(i + 1, { ...partial, [name]: 1 });
    return m.mk(i, low, high);
  };
  return go(0, {});
}

/**
 * 穷举参考：枚举 3^n 个三态向量（每变量 0/1/自由），
 * 按 (锁定文字数, 变量序字典序 0<1<自由) 取首个“所有补全均为 1”的部分赋值。
 */
function bruteForceForcing(
  vars: string[],
  fn: (a: Record<string, 0 | 1>) => 0 | 1,
): Array<{ level: number; value: 0 | 1 }> | null {
  const n = vars.length;
  const vectors: number[][] = [];
  const gen = (i: number, acc: number[]) => {
    if (i === n) {
      vectors.push(acc);
      return;
    }
    for (const s of [0, 1, 2]) gen(i + 1, [...acc, s]); // 2 = 自由
  };
  gen(0, []);
  const count = (v: number[]) => v.filter((s) => s !== 2).length;
  vectors.sort((x, y) => {
    if (count(x) !== count(y)) return count(x) - count(y);
    for (let i = 0; i < n; i++) if (x[i] !== y[i]) return x[i] - y[i];
    return 0;
  });

  for (const v of vectors) {
    let forces = true;
    for (let mask = 0; mask < 1 << n; mask++) {
      const a: Record<string, 0 | 1> = {};
      vars.forEach((name, i) => {
        a[name] = ((mask >> (n - 1 - i)) & 1) as 0 | 1;
      });
      let compatible = true;
      v.forEach((s, i) => {
        if (s !== 2 && a[vars[i]] !== s) compatible = false;
      });
      if (compatible && fn(a) !== 1) {
        forces = false;
        break;
      }
    }
    if (forces) {
      const out: Array<{ level: number; value: 0 | 1 }> = [];
      v.forEach((s, i) => {
        if (s !== 2) out.push({ level: i, value: s as 0 | 1 });
      });
      return out;
    }
  }
  return null;
}

describe('minimumForcingAssignment：对全部 3 变量布尔函数穷举核对', () => {
  const vars = ['A', 'B', 'C'];
  const n = vars.length;

  for (let table = 1; table < 1 << (1 << n); table++) {
    const fn = (a: Record<string, 0 | 1>): 0 | 1 => {
      let idx = 0;
      for (const name of vars) idx = (idx << 1) | a[name];
      return ((table >> idx) & 1) as 0 | 1;
    };
    const m = new BddManager(vars);
    const root = buildByTruthTable(m, vars, fn);

    const got = m.minimumForcingAssignment(root);
    expect(got).toEqual(bruteForceForcing(vars, fn));

    // 强制条件必须真的强制：逐项 restrict 后必须是 1 终端
    let restricted = root;
    for (const l of got!) restricted = m.restrict(restricted, l.level, l.value);
    expect(m.isOne(restricted)).toBe(true);
  }

  it('0 终端（恒假）返回 null', () => {
    const m = new BddManager(vars);
    expect(m.minimumForcingAssignment(m.zero)).toBeNull();
  });

  it('1 终端（恒真）为空条件', () => {
    const m = new BddManager(vars);
    expect(m.minimumForcingAssignment(m.one)).toEqual([]);
  });
});

describe('restrict（约束/余因子）精确性', () => {
  const vars = ['A', 'B', 'C', 'D'];
  const m = new BddManager(vars);
  const f = buildByTruthTable(
    m,
    vars,
    (a) => (((a.A | a.D) & a.B) ^ a.C ? 1 : 0) as 0 | 1,
  );

  it('固定变量后对所有相容赋值，余函数下降求值与原函数一致', () => {
    for (const level of [0, 1, 2, 3]) {
      for (const value of [0, 1] as const) {
        const r = m.restrict(f, level, value);
        for (let mask = 0; mask < 1 << vars.length; mask++) {
          const a: Record<string, 0 | 1> = {};
          vars.forEach((name, i) => {
            a[name] = ((mask >> (vars.length - 1 - i)) & 1) as 0 | 1;
          });
          if (a[vars[level]] !== value) continue;
          expect(m.evaluate(r, a)).toBe(m.evaluate(f, a));
        }
      }
    }
  });

  it('约束到函数不依赖的变量时节点原样返回', () => {
    const g = m.apply('xor', m.ithVar(0), m.ithVar(1)); // 只依赖 A,B
    expect(m.restrict(g, 3, 0)).toBe(g);
    expect(m.restrict(g, 3, 1)).toBe(g);
  });

  it('约束全部支撑变量后必为终端', () => {
    let r = f;
    r = m.restrict(r, 0, 1);
    r = m.restrict(r, 1, 0);
    r = m.restrict(r, 2, 1);
    r = m.restrict(r, 3, 0);
    expect(r === m.zero || r === m.one).toBe(true);
  });
});

function buildGraph(nodes: unknown[], output: string): Graph {
  const r = validatePair(
    JSON.stringify({ nodes, output }),
    JSON.stringify({ nodes: [{ id: '_', type: 'CONST0' }], output: '_' }),
  );
  if (r.errors.length > 0) throw new Error(r.errors.map((e) => e.message).join('; '));
  return r.graphA!;
}

const I = (id: string, name: string) => ({ id, type: 'INPUT', name });
const K = (id: string, type: 'CONST0' | 'CONST1') => ({ id, type });
const G = (id: string, type: string, ins: string[]) => ({ id, type, in: ins });

/** 测试用普通布尔复算（拓扑顺序），对所有补全独立核对强制语义 */
function simulate(graph: Graph, assignment: Record<string, 0 | 1>): 0 | 1 {
  const values = new Map<string, 0 | 1>();
  for (const n of topoOrder(graph) as NormalNode[]) {
    const ins = n.in.map((id) => values.get(id)!);
    let v: 0 | 1;
    switch (n.type) {
      case 'INPUT':
        v = assignment[n.name!] ?? 0;
        break;
      case 'CONST0':
        v = 0;
        break;
      case 'CONST1':
        v = 1;
        break;
      case 'NOT':
        v = (ins[0] ^ 1) as 0 | 1;
        break;
      case 'AND':
        v = (ins[0] & ins[1]) as 0 | 1;
        break;
      case 'OR':
        v = (ins[0] | ins[1]) as 0 | 1;
        break;
      case 'XOR':
        v = (ins[0] ^ ins[1]) as 0 | 1;
        break;
    }
    values.set(n.id, v);
  }
  return values.get(graph.output)!;
}

/** 枚举未锁定输入的全部补全，断言两图输出始终不同 */
function expectForcesDivergence(
  graphA: Graph,
  graphB: Graph,
  variables: string[],
  locked: Array<{ variable: string; value: 0 | 1 }>,
) {
  const lockMap = new Map(locked.map((l) => [l.variable, l.value]));
  const free = variables.filter((v) => !lockMap.has(v));
  for (let mask = 0; mask < 1 << free.length; mask++) {
    const asg: Record<string, 0 | 1> = {};
    free.forEach((v, i) => {
      asg[v] = ((mask >> (free.length - 1 - i)) & 1) as 0 | 1;
    });
    for (const [v, val] of lockMap) asg[v] = val;
    expect(simulate(graphA, asg)).not.toBe(simulate(graphB, asg));
  }
}

describe('extractLockConditions 端到端', () => {
  it('(A∧B)∨C 与 A∧B：A=0,C=1（B 自由，2 种补全均分歧）', () => {
    const a = buildGraph(
      [I('a', 'A'), I('b', 'B'), I('c', 'C'), G('ab', 'AND', ['a', 'b']), G('o', 'OR', ['ab', 'c'])],
      'o',
    );
    const b = buildGraph(
      [I('x', 'A'), I('y', 'B'), G('o', 'AND', ['x', 'y'])],
      'o',
    );
    const r = analyze(a, b);
    expect(r.equivalent).toBe(false);
    const report = r.extractLockConditions!();

    // A=0 与 B=0 同为二文字最少条件，按变量名取 A=0；0 先于 1 由穷举测试覆盖
    expect(report.locked).toEqual([
      { variable: 'A', value: 0 },
      { variable: 'C', value: 1 },
    ]);
    expect(report.unlocked).toEqual(['B']);
    expect(report.completionCount).toBe(2);
    expect(report.allCompletionsDiffer).toBe(true);
    expectForcesDivergence(a, b, r.variables, report.locked);
  });

  it('XOR(A,B) 与 CONST0：A=0,B=1 与 A=1,B=0 平票，0 先于 1', () => {
    const a = buildGraph([I('a', 'A'), I('b', 'B'), G('o', 'XOR', ['a', 'b'])], 'o');
    const b = buildGraph([K('o', 'CONST0')], 'o');
    const report = analyze(a, b).extractLockConditions!();
    expect(report.locked).toEqual([
      { variable: 'A', value: 0 },
      { variable: 'B', value: 1 },
    ]);
    expect(report.unlocked).toEqual([]);
    expect(report.completionCount).toBe(1);
    expect(report.allCompletionsDiffer).toBe(true);
    expectForcesDivergence(a, b, ['A', 'B'], report.locked);
  });

  it('XOR(A,B) 与 OR(A,B)：唯一最少 A=1,B=1', () => {
    const a = buildGraph([I('a', 'A'), I('b', 'B'), G('o', 'XOR', ['a', 'b'])], 'o');
    const b = buildGraph([I('x', 'A'), I('y', 'B'), G('o', 'OR', ['x', 'y'])], 'o');
    const report = analyze(a, b).extractLockConditions!();
    expect(report.locked).toEqual([
      { variable: 'A', value: 1 },
      { variable: 'B', value: 1 },
    ]);
    expectForcesDivergence(a, b, ['A', 'B'], report.locked);
  });

  it('¬A 与 ¬(A∧D)：A=1,D=0，跨图变量并集正确', () => {
    const a = buildGraph([I('a', 'A'), G('o', 'NOT', ['a'])], 'o');
    const b = buildGraph(
      [I('x', 'A'), I('d', 'D'), G('xd', 'AND', ['x', 'd']), G('o', 'NOT', ['xd'])],
      'o',
    );
    const r = analyze(a, b);
    const report = r.extractLockConditions!();
    expect(report.locked).toEqual([
      { variable: 'A', value: 1 },
      { variable: 'D', value: 0 },
    ]);
    expect(report.unlocked).toEqual([]);
    expectForcesDivergence(a, b, r.variables, report.locked);
  });

  it('单文字强制：A⊕E 与 A⊕E⊕D 只差 D，D=1 即强制，A、E 自由（4 种补全均分歧）', () => {
    const gA = buildGraph(
      [I('a', 'A'), I('e', 'E'), G('o', 'XOR', ['a', 'e'])],
      'o',
    );
    const gB = buildGraph(
      [
        I('x', 'A'), I('w', 'E'), I('d', 'D'),
        G('xe', 'XOR', ['x', 'w']), G('o', 'XOR', ['xe', 'd']),
      ],
      'o',
    );
    const r = analyze(gA, gB);
    expect(r.equivalent).toBe(false);
    const report = r.extractLockConditions!();
    expect(report.locked).toEqual([{ variable: 'D', value: 1 }]);
    expect(report.unlocked).toEqual(['A', 'E']);
    expect(report.completionCount).toBe(4);
    expect(report.allCompletionsDiffer).toBe(true);
    expectForcesDivergence(gA, gB, r.variables, report.locked);
  });

  it('等价结果不提供提取入口', () => {
    const a = buildGraph([I('a', 'A'), I('b', 'B'), G('o', 'XOR', ['a', 'b'])], 'o');
    const b = buildGraph([I('x', 'A'), I('y', 'B'), G('o', 'XOR', ['x', 'y'])], 'o');
    expect(analyze(a, b).extractLockConditions).toBeUndefined();
  });
});
