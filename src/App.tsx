import { useState } from 'react';
import { analyze } from './analysis';
import { extractLockingCondition } from './locking';
import { validatePair } from './validation';
import type {
  AnalysisResult,
  GateEval,
  Graph,
  GraphError,
  LockingReport,
} from './types';
import { GraphSvg } from './components/GraphSvg';
import { EXAMPLES } from './examples';

type View =
  | { status: 'idle' }
  | { status: 'error'; errors: GraphError[] }
  | {
      status: 'ok';
      graphA: Graph;
      graphB: Graph;
      result: AnalysisResult;
      /** 本次不等价结论下已提取的最少锁定条件；输入变动/重新比较即清除 */
      locking?: LockingReport;
    };

function traceValues(trace: GateEval[]): Map<string, 0 | 1> {
  return new Map(trace.map((t) => [t.id, t.value]));
}

function TraceTable({
  trace,
  outputId,
  title,
}: {
  trace: GateEval[];
  outputId: string;
  title: string;
}) {
  return (
    <div className="trace">
      <h4>{title}</h4>
      <table className="trace__table">
        <thead>
          <tr>
            <th>#</th>
            <th>节点 id</th>
            <th>类型</th>
            <th>入边（id = 复算值）</th>
            <th>输出</th>
          </tr>
        </thead>
        <tbody>
          {trace.map((t, i) => (
            <tr
              key={`${t.graph}-${t.id}`}
              className={t.id === outputId ? 'trace__row--output' : ''}
            >
              <td>{i + 1}</td>
              <td className="mono">{t.id}</td>
              <td className="mono">{t.type}</td>
              <td className="mono">
                {t.inputs.length === 0
                  ? '—'
                  : t.inputs.map((x) => `${x.id}=${x.value}`).join(', ')}
              </td>
              <td className="mono trace__value">{t.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function App() {
  const [textA, setTextA] = useState('');
  const [textB, setTextB] = useState('');
  const [view, setView] = useState<View>({ status: 'idle' });

  // 任一错误整次拒绝：只有在校验全过后才保留门图与结论
  const run = () => {
    const { graphA, graphB, errors } = validatePair(textA, textB);
    if (errors.length > 0 || !graphA || !graphB) {
      setView({ status: 'error', errors });
      return;
    }
    const result = analyze(graphA, graphB);
    // 新比较完成：结论整体替换，旧锁定条件报告随之失效（不携带 locking）
    setView({ status: 'ok', graphA, graphB, result });
  };

  // 输入被重新编辑：旧锁定条件报告不得保留（比较结论语义不变，保留展示）
  const discardLocking = () => {
    setView((prev) =>
      prev.status === 'ok' && prev.locking !== undefined
        ? { ...prev, locking: undefined }
        : prev,
    );
  };

  // 在成功比较出不等价结论后，用户可发起条件提取
  const runExtract = () => {
    if (view.status !== 'ok' || view.result.equivalent) return;
    const report = extractLockingCondition(view.result);
    if (report !== null) setView({ ...view, locking: report });
  };

  const clearAll = () => {
    setTextA('');
    setTextB('');
    setView({ status: 'idle' });
  };

  const loadExample = (key: keyof typeof EXAMPLES) => {
    const ex = EXAMPLES[key];
    setTextA(ex.a);
    setTextB(ex.b);
    setView({ status: 'idle' });
  };

  const traceA =
    view.status === 'ok'
      ? view.result.trace.filter((t) => t.graph === 'A')
      : [];
  const traceB =
    view.status === 'ok'
      ? view.result.trace.filter((t) => t.graph === 'B')
      : [];

  return (
    <div className="app">
      <header className="app__header">
        <h1>联锁控制器门图等价性工作台</h1>
        <p className="app__subtitle">
          纯前端 · ROBDD（ASCII 变量序唯一表/计算表/约简/Apply）·
          异或根为 0 即等价，否则直接读取根节点最小满足赋值摘要作为唯一反例
        </p>
      </header>

      <section className="editors">
        <div className="editor">
          <div className="editor__bar">
            <label htmlFor="ta-a">旧图 A（优先）</label>
            <div className="editor__examples">
              {(['equiv', 'differ', 'errors'] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  className="btn btn--mini"
                  onClick={() => loadExample(k)}
                >
                  {EXAMPLES[k].label}
                </button>
              ))}
            </div>
          </div>
          <textarea
            id="ta-a"
            className="editor__area"
            spellCheck={false}
            value={textA}
            onChange={(e) => {
              setTextA(e.target.value);
              discardLocking();
            }}
            placeholder='{"nodes":[...],"output":"..."}'
          />
        </div>
        <div className="editor">
          <div className="editor__bar">
            <label htmlFor="ta-b">新图 B</label>
          </div>
          <textarea
            id="ta-b"
            className="editor__area"
            spellCheck={false}
            value={textB}
            onChange={(e) => {
              setTextB(e.target.value);
              discardLocking();
            }}
            placeholder='{"nodes":[...],"output":"..."}'
          />
        </div>
      </section>

      <section className="actions">
        <button type="button" className="btn btn--primary" onClick={run}>
          校验并比较
        </button>
        <button type="button" className="btn" onClick={clearAll}>
          清空
        </button>
      </section>

      {view.status === 'error' && (
        <section className="errors" data-testid="errors">
          <h3>本次输入被整次拒绝（共 {view.errors.length} 项错误）</h3>
          <p className="errors__hint">
            按旧图优先、图内 nodes 下标升序汇总；旧结论与图形已清空。
          </p>
          <ol className="errors__list">
            {view.errors.map((e, i) => (
              <li key={i} className={`error error--${e.kind}`}>
                <span className="error__tag">{e.graph}</span>
                <span className="error__kind">{e.kind}</span>
                {e.nodeId && <span className="error__node mono">{e.nodeId}</span>}
                <span className="error__msg">{e.message}</span>
              </li>
            ))}
          </ol>
        </section>
      )}

      {view.status === 'idle' && (
        <section className="idle-hint">
          <p>
            在左右两栏粘贴门图 JSON 后点击「校验并比较」。INPUT 名需匹配{' '}
            <code>[A-Z][A-Z0-9_]{'{0,15}'}</code>，跨图同名 INPUT 视为同一变量。
          </p>
        </section>
      )}

      {view.status === 'ok' && (
        <>
          <section
            className={`verdict ${view.result.equivalent ? 'verdict--ok' : 'verdict--bad'}`}
            data-testid="verdict"
            data-equivalent={view.result.equivalent}
          >
            {view.result.equivalent ? (
              <h2>EQUIVALENT — 两图输出对所有输入恒等</h2>
            ) : (
              <h2>NOT EQUIVALENT — 存在反例（直接读取自异或根摘要）</h2>
            )}
            <div className="verdict__meta">
              共享变量序：
              <span className="mono">
                [{view.result.variables.join(', ')}]
              </span>
              {' · '}唯一表节点 {view.result.bddStats.uniqueNodes} 个 ·
              计算表命中 {view.result.bddStats.cacheHits} / 未命中{' '}
              {view.result.bddStats.cacheMisses}
            </div>
          </section>

          {!view.result.equivalent && (
            <section className="counterexample" data-testid="counterexample">
              <h3>唯一反例赋值（低分支优先，跳过变量补 0）</h3>
              <table className="ce__table">
                <thead>
                  <tr>
                    {view.result.variables.map((v) => (
                      <th key={v} className="mono">
                        {v}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    {view.result.variables.map((v) => (
                      <td key={v} className="mono ce__bit" data-bit={view.result.counterexample[v]}>
                        {view.result.counterexample[v]}
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
              <p className="ce__outputs">
                复算输出：旧图 A = <strong className="mono">{view.result.outputA}</strong>
                ，新图 B = <strong className="mono">{view.result.outputB}</strong>
              </p>
            </section>
          )}

          {!view.result.equivalent && (
            <section className="locking" data-testid="locking">
              <div className="locking__head">
                <h3>最少输入锁定条件</h3>
                <button
                  type="button"
                  className="btn"
                  data-testid="extract-locking"
                  onClick={runExtract}
                >
                  提取最少锁定条件
                </button>
              </div>
              {view.locking === undefined ? (
                <p className="locking__hint">
                  在上方不等价结论基础上可发起条件提取：从本次共享变量序与异或结果
                  直接求出文字数最少的部分赋值——锁定这些输入后，无论其余输入如何
                  变化，改版输出都必然与旧版分歧（精确全局裁决，非抽样）。
                </p>
              ) : (
                (() => {
                  const report = view.locking;
                  const lockMap = new Map(
                    report.locked.map((l) => [l.variable, l.value] as const),
                  );
                  return (
                    <div className="locking__report" data-testid="locking-report">
                      <div className="locking__row">
                        <span className="locking__label">
                          锁定项（{report.locked.length} 项，按 ASCII 变量序）：
                        </span>
                        <span
                          className="locking__chips"
                          data-testid="locking-locked"
                        >
                          {report.locked.length === 0 ? (
                            <span className="locking__none">
                              （空——无需锁定任何输入）
                            </span>
                          ) : (
                            report.locked.map((lit) => (
                              <span
                                key={lit.variable}
                                className="locking__chip mono"
                                data-value={lit.value}
                              >
                                {lit.variable}={lit.value}
                              </span>
                            ))
                          )}
                        </span>
                      </div>
                      <div className="locking__row">
                        <span className="locking__label">
                          未锁定输入（{report.unlocked.length} 个）：
                        </span>
                        <span
                          className="locking__chips"
                          data-testid="locking-unlocked"
                        >
                          {report.unlocked.length === 0 ? (
                            <span className="locking__none">
                              （无——全部输入均已锁定）
                            </span>
                          ) : (
                            report.unlocked.map((v) => (
                              <span
                                key={v}
                                className="locking__chip locking__chip--free mono"
                              >
                                {v}
                              </span>
                            ))
                          )}
                        </span>
                      </div>
                      <table className="locking__table">
                        <thead>
                          <tr>
                            <th>变量（ASCII 序）</th>
                            <th>锁定状态</th>
                          </tr>
                        </thead>
                        <tbody>
                          {report.variables.map((v) => {
                            const lockedValue = lockMap.get(v);
                            return (
                              <tr key={v}>
                                <td className="mono">{v}</td>
                                <td className="mono">
                                  {lockedValue === undefined
                                    ? '未锁定'
                                    : `锁定 = ${lockedValue}`}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                      <p
                        className="locking__verdict"
                        data-testid="locking-verdict"
                      >
                        核算结论：所有补全均分歧 —— 未锁定输入的全部 2^
                        {report.unlocked.length} = {report.completionCount}{' '}
                        种补全下，两图输出必然不同
                        {report.verified
                          ? '（异或根在锁定后归约为 1 终端，精确全局复核通过）'
                          : '（复核未通过：存在不分歧的补全！）'}
                      </p>
                    </div>
                  );
                })()
              )}
            </section>
          )}

          <section className="graphics">
            <GraphSvg
              title="旧图 A"
              graph={view.graphA}
              values={traceValues(traceA)}
              trace={traceA}
            />
            <GraphSvg
              title="新图 B"
              graph={view.graphB}
              values={traceValues(traceB)}
              trace={traceB}
            />
          </section>

          <section className="traces">
            <TraceTable
              title="旧图 A 逐门复算（拓扑顺序）"
              trace={traceA}
              outputId={view.graphA.output}
            />
            <TraceTable
              title="新图 B 逐门复算（拓扑顺序）"
              trace={traceB}
              outputId={view.graphB.output}
            />
          </section>
        </>
      )}

      <footer className="app__footer">
        无业务后端、无在线服务、无第三方 BDD 库；判定全过程在浏览器内完成，可由
        Vitest 单元测试与 Playwright 验收复算。
      </footer>
    </div>
  );
}
