// ROBDD 核心：共享变量序（ASCII 升序）、唯一表、计算表、约简与 Apply。
//
// 设计约束（对应需求）：
//  - 不做全赋值枚举，不使用任何现成 BDD 库；
//  - 每个唯一化变量节点同时维护 witness：从该节点到 1 终端的“最小满足赋值”
//    摘要（低分支可满足时取低分支，否则取高分支，跳过的变量补 0）；
//  - witness 不变量在 mk（建点/约简）时建立，Apply 只复用既有节点，因此天然保持。

export type BddNode = number;

/** 变量节点的内部表示 */
interface InternalNode {
  /** 变量在变量序中的下标 */
  level: number;
  /** 变量取 0 时的分支 */
  low: BddNode;
  /** 变量取 1 时的分支 */
  high: BddNode;
  /** 最小满足赋值摘要：仅记录被“取 1”的变量下标（跳过的变量补 0，不记录） */
  witness: number[];
}

/** 布尔二元算子 */
export type BinOp = 'and' | 'or' | 'xor';

const ZERO: BddNode = 0;
const ONE: BddNode = 1;

/** 强制条件文字：变量序下标 + 固定值 */
export interface ForcingLiteral {
  level: number;
  value: 0 | 1;
}

export class BddManager {
  /** 下标 0/1 预留给两个终端；变量节点从下标 2 开始 */
  private nodes: InternalNode[] = [];
  /** 唯一表：(level, low, high) -> 节点下标 */
  private uniqueTable = new Map<string, BddNode>();
  /** Apply 计算表：(op, f, g) -> 结果节点 */
  private computedTable = new Map<string, BddNode>();

  cacheHits = 0;
  cacheMisses = 0;

  constructor(readonly variables: string[]) {}

  /** 变量序下标 -> 变量名 */
  varName(level: number): string {
    return this.variables[level];
  }

  get zero(): BddNode {
    return ZERO;
  }
  get one(): BddNode {
    return ONE;
  }

  /** 唯一表中变量节点个数（不含两个终端） */
  get uniqueNodeCount(): number {
    return this.nodes.length;
  }

  /**
   * 建点（同时完成两条约简规则）：
   *  1) 低/高分支相同 -> 该节点冗余，直接返回低分支；
   *  2) (level, low, high) 已在唯一表 -> 返回既有节点。
   * 否则登记新节点，并在此处维护 witness 不变量。
   */
  mk(level: number, low: BddNode, high: BddNode): BddNode {
    // 约简规则 1
    if (low === high) return low;

    const key = `${level}:${low}:${high}`;
    // 约简规则 2：唯一表
    const cached = this.uniqueTable.get(key);
    if (cached !== undefined) return cached;

    // witness 不变量：
    //  - 低分支可满足（不为 0 终端）时走低分支，当前变量取 0（不写入 witness）；
    //  - 否则走高分支，当前变量取 1，并追加其下层 witness。
    //  0 终端没有满足路径（witness 为 null），1 终端的满足路径为空集。
    const witness =
      low !== ZERO
        ? this.witnessOf(low)
        : [level, ...this.witnessOf(high)];

    const id = this.nodes.length + 2;
    this.nodes.push({ level, low, high, witness });
    this.uniqueTable.set(key, id);
    return id;
  }

  /** 读取节点的最小满足赋值摘要；终端 0 不可满足，调用方须自行规避 */
  private witnessOf(n: BddNode): number[] {
    if (n === ONE) return [];
    return this.nodes[n - 2].witness;
  }

  /** 取变量节点（变量取 0 到 ZERO、取 1 到 ONE 的规范节点） */
  ithVar(level: number): BddNode {
    return this.mk(level, ZERO, ONE);
  }

  not(f: BddNode): BddNode {
    if (f === ZERO) return ONE;
    if (f === ONE) return ZERO;
    const n = this.nodes[f - 2];
    // NOT 不改变变量层级，分别对低/高取反后重建，约简与 witness 由 mk 维护
    return this.mk(n.level, this.not(n.low), this.not(n.high));
  }

  apply(op: BinOp, f: BddNode, g: BddNode): BddNode {
    // 终端短路：常量折叠，避免无谓登记
    const folded = this.fold(op, f, g);
    if (folded !== undefined) return folded;

    const key = `${op}:${f}:${g}:0`;
    const cached = this.computedTable.get(key);
    if (cached !== undefined) {
      this.cacheHits++;
      return cached;
    }
    this.cacheMisses++;

    const nf = f >= 2 ? this.nodes[f - 2] : undefined;
    const ng = g >= 2 ? this.nodes[g - 2] : undefined;
    const lf = nf ? nf.level : Number.POSITIVE_INFINITY;
    const lg = ng ? ng.level : Number.POSITIVE_INFINITY;

    let level: number;
    let fLow: BddNode;
    let fHigh: BddNode;
    let gLow: BddNode;
    let gHigh: BddNode;

    if (lf === lg) {
      // 两节点同层：各自沿对应分支下降
      level = nf!.level;
      fLow = nf!.low;
      fHigh = nf!.high;
      gLow = ng!.low;
      gHigh = ng!.high;
    } else if (lf < lg) {
      // f 的变量更靠前：g 在该层“不出现”，两条子问题里 g 都保持不变
      level = nf!.level;
      fLow = nf!.low;
      fHigh = nf!.high;
      gLow = gHigh = g;
    } else {
      level = ng!.level;
      fLow = fHigh = f;
      gLow = ng!.low;
      gHigh = ng!.high;
    }

    const low = this.apply(op, fLow, gLow);
    const high = this.apply(op, fHigh, gHigh);
    const result = this.mk(level, low, high);
    this.computedTable.set(key, result);
    return result;
  }

  /** 终端（含一侧终端）的常量折叠；无法仅靠终端判定时返回 undefined */
  private fold(op: BinOp, f: BddNode, g: BddNode): 0 | 1 | undefined {
    if (f >= 2 || g >= 2) {
      // 一侧为终端时的吸收律
      if (op === 'and') {
        if (f === ZERO || g === ZERO) return 0;
        if (f === ONE) return undefined; // g 未知
        if (g === ONE) return undefined; // f 未知
      }
      if (op === 'or') {
        if (f === ONE || g === ONE) return 1;
        if (f === ZERO) return undefined;
        if (g === ZERO) return undefined;
      }
      // xor 与非常量终端无法折叠
      return undefined;
    }
    const a = f === ONE ? 1 : 0;
    const b = g === ONE ? 1 : 0;
    switch (op) {
      case 'and':
        return (a & b) as 0 | 1;
      case 'or':
        return (a | b) as 0 | 1;
      case 'xor':
        return (a ^ b) as 0 | 1;
    }
  }

  /**
   * 直接读取节点的最小满足赋值摘要（需求明确：不得另写路径搜索/回溯）。
   * 返回按变量序排列的完整赋值；ZERO 终端返回 null。
   */
  satisfyingAssignment(f: BddNode): Record<string, 0 | 1> | null {
    if (f === ZERO) return null;
    const assignment: Record<string, 0 | 1> = {};
    // 跳过的变量补 0
    for (const name of this.variables) assignment[name] = 0;
    const witness = f === ONE ? [] : this.nodes[f - 2].witness;
    for (const level of witness) assignment[this.variables[level]] = 1;
    return assignment;
  }

  /**
   * 单赋值求值（标准 BDD restrict 下降）：仅用于测试交叉核对与自检，
   * 不参与反例生成——反例只允许来自 satisfyingAssignment 的摘要直读。
   */
  evaluate(f: BddNode, assignment: Record<string, 0 | 1>): 0 | 1 {
    let n = f;
    while (n >= 2) {
      const node = this.nodes[n - 2];
      n = assignment[this.variables[node.level]] === 1 ? node.high : node.low;
    }
    return n === ONE ? 1 : 0;
  }

  /** 是否为 1 终端（恒真） */
  isOne(f: BddNode): boolean {
    return f === ONE;
  }

  /**
   * 约束（Shannon cofactor）：把第 level 个变量固定为 value，返回 f|_{v=value}。
   * 纯函数式下降 + mk 重建：只复用/约简既有节点，不改动任何已有节点；
   * 这是建立在既有 ROBDD 上的精确操作（无抽样、无枚举），供强制条件核算使用。
   */
  restrict(f: BddNode, level: number, value: 0 | 1): BddNode {
    const cache = new Map<BddNode, BddNode>();
    const go = (n: BddNode): BddNode => {
      // 终端与任何变量无关
      if (n < 2) return n;
      const cached = cache.get(n);
      if (cached !== undefined) return cached;

      const node = this.nodes[n - 2];
      let result: BddNode;
      if (node.level === level) {
        // 命中被约束变量：整条分支被选定（分支指针直接共享，无需重建）
        result = value === 1 ? node.high : node.low;
      } else if (node.level < level) {
        // 更靠前的变量：约束只作用于两条下层子函数
        result = this.mk(node.level, go(node.low), go(node.high));
      } else {
        // 更靠后的变量：该函数与被约束变量无关，原样返回
        result = n;
      }
      cache.set(n, result);
      return result;
    };
    return go(f);
  }

  /**
   * 在既有 ROBDD 节点 f 上求“文字数最少的强制（forcing）部分赋值”：
   * 固定返回的每个文字后，其余变量任意取值，f 恒为 1。
   *
   * 精确全局裁决（纯 BDD 结构递推，不抽样、不随机搜索、不只验证单个反例）：
   * 对变量序最前的变量 v（低 L、高 H），任意部分赋值只有三种选择——
   *   (a) 锁 v=0：再求 L 的最少强制条件；
   *   (b) 锁 v=1：再求 H 的最少强制条件；
   *   (c) 不锁 v：需要同一组更深的赋值同时令 L、H 恒为 1，
   *       等价于令 Apply(and, L, H) 恒为 1（AND 仍是同一 ROBDD 上的精确运算）。
   * 三者取文字数最少；字数相同时按“变量名升序、同变量 0 先于 1”的字典序
   * 取首个——(a)/(b) 首文字即 v，必早于 (c) 的更深首文字，且 0 先于 1。
   *
   * f 可满足时返回非 null（异或根非 0 终端即可满足）；ZERO 终端返回 null。
   */
  minimumForcingAssignment(f: BddNode): ForcingLiteral[] | null {
    if (f === ONE) return [];
    if (f === ZERO) return null;

    const memo = new Map<BddNode, ForcingLiteral[] | null>();

    const lessLits = (a: ForcingLiteral[], b: ForcingLiteral[]): boolean => {
      const n = Math.min(a.length, b.length);
      for (let i = 0; i < n; i++) {
        if (a[i].level !== b[i].level) return a[i].level < b[i].level;
        if (a[i].value !== b[i].value) return a[i].value < b[i].value;
      }
      return a.length < b.length;
    };

    const solve = (n: BddNode): ForcingLiteral[] | null => {
      if (n === ONE) return [];
      if (n === ZERO) return null;
      const cached = memo.get(n);
      if (cached !== undefined) return cached;

      const node = this.nodes[n - 2];
      const candidates: ForcingLiteral[][] = [];

      // 选择 (a) v=0 / (b) v=1：0 先于 1 入列
      const subLow = solve(node.low);
      if (subLow) candidates.push([{ level: node.level, value: 0 }, ...subLow]);
      const subHigh = solve(node.high);
      if (subHigh) candidates.push([{ level: node.level, value: 1 }, ...subHigh]);

      // 选择 (c) 不锁 v：同一深赋值须同时强制 L 与 H，即强制 AND(L, H)
      const subBoth = solve(this.apply('and', node.low, node.high));
      if (subBoth) candidates.push(subBoth);

      let best: ForcingLiteral[] | null = null;
      for (const cand of candidates) {
        if (best === null || cand.length < best.length ||
            (cand.length === best.length && lessLits(cand, best))) {
          best = cand;
        }
      }
      memo.set(n, best);
      return best;
    };

    return solve(f);
  }

  /** 供调试/测试：导出节点内部结构 */
  inspect(f: BddNode): unknown {
    if (f === ZERO) return 0;
    if (f === ONE) return 1;
    const n = this.nodes[f - 2];
    return {
      var: this.variables[n.level],
      low: this.inspect(n.low),
      high: this.inspect(n.high),
      witness: n.witness.map((l) => this.variables[l]),
    };
  }
}
