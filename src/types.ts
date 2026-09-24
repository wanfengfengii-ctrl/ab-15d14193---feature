// 门图共享类型定义

/** 支持的节点类型 */
export type NodeType =
  | 'INPUT'
  | 'CONST0'
  | 'CONST1'
  | 'NOT'
  | 'AND'
  | 'OR'
  | 'XOR';

/** 原始节点（用户 JSON 中的元素，in 为字符串数组） */
export interface RawNode {
  id: string;
  type: NodeType;
  /** INPUT 节点的变量名；其余节点可省略 */
  name?: string;
  /** 入边：按位置排列的前驱节点 id */
  in?: unknown;
}

/** 一份门图的原始 JSON 结构 */
export interface RawGraph {
  nodes?: unknown;
  output?: unknown;
}

/** 规范化后的节点（in 已收窄为字符串数组） */
export interface NormalNode {
  id: string;
  type: NodeType;
  name?: string;
  in: string[];
}

/** 规范化后的门图 */
export interface Graph {
  nodes: NormalNode[];
  output: string;
}

/** 校验错误；graph 为 'A'（旧图/左栏）或 'B'（新图/右栏） */
export interface GraphError {
  graph: 'A' | 'B';
  /** 节点 id；图级错误（如图缺 output）时省略 */
  nodeId?: string;
  kind:
    | 'syntax'
    | 'duplicate_id'
    | 'unknown_ref'
    | 'arity'
    | 'output'
    | 'cycle';
  message: string;
}

/** 单门复算结果 */
export interface GateEval {
  graph: 'A' | 'B';
  id: string;
  type: NodeType;
  inputs: Array<{ id: string; value: 0 | 1 }>;
  value: 0 | 1;
}

/** 单个锁定项（一个输入被固定为某个值） */
export interface LockedLiteral {
  /** INPUT 变量名 */
  variable: string;
  /** 被锁定的取值 */
  value: 0 | 1;
}

/**
 * 最少文字强制（锁定）条件报告。
 * 仅在“本次比较已成功且结论为不等价”时可提取；
 * 输入被重新编辑、校验失败、两图等价或尚未重新比较时一律失效。
 */
export interface LockConditionReport {
  /** 最少文字的部分赋值，按变量名 ASCII 升序排列 */
  locked: LockedLiteral[];
  /** 未被锁定的输入变量，按变量名 ASCII 升序排列 */
  unlocked: string[];
  /** 未锁定输入的自由组合数 = 2^|unlocked|（“所有补全”即此数） */
  completionCount: number;
  /**
   * 精确全局裁决：对锁定条件逐项 restrict 后，异或根是否化为 1 终端。
   * 为 true 表示所有 completionCount 种补全下两图输出均不同。
   */
  allCompletionsDiffer: boolean;
}

/** 等价性分析的完整结果 */
export interface AnalysisResult {
  equivalent: boolean;
  /** 共享 INPUT 变量，ASCII 升序 */
  variables: string[];
  /** 等价时为全 0 占位；不等价时为唯一反例的各位取值 */
  counterexample: Record<string, 0 | 1>;
  /** 反例下两图每个门的逐门复算（拓扑顺序） */
  trace: GateEval[];
  /** 两图输出在反例下的值 */
  outputA: 0 | 1;
  outputB: 0 | 1;
  /**
   * 仅不等价时存在：在本次比较的共享 BDD / 异或根上提取最少锁定条件。
   * 闭包绑定“本次”结果，重新比较后旧闭包不再被使用，保证报告不陈旧。
   */
  extractLockConditions?: () => LockConditionReport;
  bddStats: {
    /** 唯一表中变量节点个数 */
    uniqueNodes: number;
    /** 建图期间 Apply 计算表命中次数 */
    cacheHits: number;
    cacheMisses: number;
  };
}
