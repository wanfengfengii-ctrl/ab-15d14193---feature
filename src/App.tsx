import { useState } from 'react';
import { analyze } from './analysis';
import { validatePair } from './validation';
import type {
  AnalysisResult,
  GateEval,
  Graph,
  GraphError,
  LockConditionReport,
} from './types';
import { GraphSvg } from './components/GraphSvg';
import { EXAMPLES } from './examples';

type View =
  | { status: 'idle' }
  | { status: 'error'; errors: GraphError[] }
  | { status: 'ok'; graphA: Graph; graphB: Graph; result: AnalysisResult };

/**
 * 锁定条件区的生命周期：
 *  - hidden：不可提取（编辑后未重比 / 等价 / 校验失败 / 尚未比较）
 *  - ready：本次非等价比较已完成，用户可发起提取
 *  - shown：已展示本次比较的条件报告
 * 任何使“本次比较”失效的动作都必须回到 hidden，旧报告绝不残留。
 */
type LockView = 'hidden' | 'ready' | 'shown';

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

function LockConditionCard({ report }: { report: LockConditionReport }) {
  return (
    <section className="lock-card" data-testid="lock-report">
      <h3>
        最少输入锁定条件（{report.locked.length} 项文字，ROBDD 精确全局裁决）
      </h3>

      <div className="lock-card__block">
        <div className="lock-card__label">锁定项（ASCII 变量序）</div>
        <ul className="lock-card__list">
          {report.locked.map((l) => (
            <li key={l.variable} className="lock-lit" data-bit={l.value}>
              <span className="mono lock-lit__var">{l.variable}</span>
              <span className="lock-lit__eq">＝</span>
              <span className="mono lock-lit__val">{l.value}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="lock-card__block">
        <div className="lock-card__label">未锁定输入（可任意变化）</div>
        {report.unlocked.length === 0 ? (
          <p className="lock-card__none mono">（无，所有输入均已锁定）</p>
        ) : (
          <p className="lock-card__unlocked mono">
            {report.unlocked.join(', ')}
          </p>
        )}
      </div>

      <p
        className={`lock-card__conclusion ${
          report.allCompletionsDiffer
            ? 'lock-card__conclusion--ok'
            : 'lock-card__conclusion--bad'
        }`}
        data-testid="lock-conclusion"
        data-holds={report.allCompletionsDiffer}
      >
        核算结论：固定以上 {report.locked.length} 项后，未锁定 {report.unlocked.length}{' '}
        个输入共 <strong className="mono">{report.completionCount}</strong>{' '}
        种补全，
        <strong>
          {report.allCompletionsDiffer ? '所有补全均分歧' : '存在补全不分歧'}
        </strong>
        （异或根经逐项约束后化为 {report.allCompletionsDiffer ? '1 终端' : '非 1 终端'}
        ）。
      </p>
    </section>
  );
}

export function App() {
  const [textA, setTextA] = useState('');
  const [textB, setTextB] = useState('');
  const [view, setView] = useState<View>({ status: 'idle' });
  const [lockView, setLockView] = useState<LockView>('hidden');
  const [lockReport, setLockReport] = useState<LockConditionReport | null>(null);

  // 切换结论视图时连带作废旧锁定报告（重比/清空/载入示例都经此）
  const transition = (next: View) => {
    setLockView('hidden');
    setLockReport(null);
    setView(next);
  };

  // 任一错误整次拒绝：只有在校验全过后才保留门图与结论
  const run = () => {
    const { graphA, graphB, errors } = validatePair(textA, textB);
    if (errors.length > 0 || !graphA || !graphB) {
      transition({ status: 'error', errors });
      return;
    }
    const result = analyze(graphA, graphB);
    setLockView(result.equivalent ? 'hidden' : 'ready');
    setLockReport(null);
    setView({ status: 'ok', graphA, graphB, result });
  };

  const clearAll = () => {
    setTextA('');
    setTextB('');
    transition({ status: 'idle' });
  };

  const loadExample = (key: keyof typeof EXAMPLES) => {
    const ex = EXAMPLES[key];
    setTextA(ex.a);
    setTextB(ex.b);
    transition({ status: 'idle' });
  };

  // 输入被重新编辑：新比较尚未完成前，旧锁定条件入口与报告都不得保留
  const editA = (v: string) => {
    setTextA(v);
    if (lockView !== 'hidden') {
      setLockView('hidden');
      setLockReport(null);
    }
  };
  const editB = (v: string) => {
    setTextB(v);
    if (lockView !== 'hidden') {
      setLockView('hidden');
      setLockReport(null);
    }
  };

  // 用户在成功比较出不等价后发起条件提取；仅当前结果处于 ready 时可提取
  const extract = () => {
    if (view.status !== 'ok' || view.result.equivalent || lockView !== 'ready') return;
    setLockReport(view.result.extractLockConditions!());
    setLockView('shown');
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
            onChange={(e) => editA(e.target.value)}
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
            onChange={(e) => editB(e.target.value)}
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

          {!view.result.equivalent && lockView === 'shown' && lockReport && (
            <LockConditionCard report={lockReport} />
          )}

          {!view.result.equivalent && lockView === 'ready' && (
            <section className="lock-action" data-testid="lock-action">
              <button
                type="button"
                className="btn btn--primary"
                onClick={extract}
              >
                提取最少输入锁定条件
              </button>
              <p className="lock-action__hint">
                在本次共享变量序与异或结果（既有 ROBDD）上精确求出文字数最少的部分赋值：
                固定这些输入后，无论其余输入如何变化，两图输出必然分歧。
              </p>
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
