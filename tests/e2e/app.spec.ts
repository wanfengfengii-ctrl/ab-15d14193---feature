import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('页面渲染双栏输入与比较按钮', async ({ page }) => {
  await expect(page.locator('#ta-a')).toBeVisible();
  await expect(page.locator('#ta-b')).toBeVisible();
  await expect(page.getByRole('button', { name: '校验并比较' })).toBeVisible();
});

test('等价改版给出 EQUIVALENT，并渲染两幅 SVG 与逐门复算表', async ({ page }) => {
  await page.getByRole('button', { name: '示例：等价改版' }).click();
  await page.getByRole('button', { name: '校验并比较' }).click();

  const verdict = page.getByTestId('verdict');
  await expect(verdict).toBeVisible();
  await expect(verdict).toHaveAttribute('data-equivalent', 'true');
  await expect(verdict).toContainText('EQUIVALENT');

  // 两图都有 SVG 节点
  await expect(page.locator('[data-testid="旧图 A"] svg g[data-node-id]')).toHaveCount(5);
  await expect(page.locator('[data-testid="新图 B"] svg g[data-node-id]')).toHaveCount(6);

  // 逐门复算两表齐全
  await expect(page.getByText('旧图 A 逐门复算（拓扑顺序）')).toBeVisible();
  await expect(page.getByText('新图 B 逐门复算（拓扑顺序）')).toBeVisible();
});

test('罕见分歧直接给出反例 A=0,B=0,C=1，输出 A=1/B=0', async ({ page }) => {
  await page.getByRole('button', { name: '示例：罕见分歧' }).click();
  await page.getByRole('button', { name: '校验并比较' }).click();

  const verdict = page.getByTestId('verdict');
  await expect(verdict).toHaveAttribute('data-equivalent', 'false');
  await expect(verdict).toContainText('NOT EQUIVALENT');

  const ce = page.getByTestId('counterexample');
  await expect(ce).toBeVisible();
  const bits = ce.locator('.ce__bit');
  await expect(bits).toHaveText(['0', '0', '1']);
  await expect(ce).toContainText('旧图 A = 1');
  await expect(ce).toContainText('新图 B = 0');
});

test('任一错误整次拒绝：显示分类错误且不出现结论与图形', async ({ page }) => {
  await page.getByRole('button', { name: '示例：各类错误' }).click();
  await page.getByRole('button', { name: '校验并比较' }).click();

  const errors = page.getByTestId('errors');
  await expect(errors).toBeVisible();
  const items = errors.locator('.error');
  expect(await items.count()).toBeGreaterThanOrEqual(5);

  // 旧图错误全部排在新图错误之前
  const tags = await errors.locator('.error__tag').allInnerTexts();
  const lastA = tags.lastIndexOf('A');
  const firstB = tags.indexOf('B');
  expect(lastA).toBeGreaterThanOrEqual(0);
  expect(firstB).toBeGreaterThan(lastA);

  // 旧结论与图形清空
  await expect(page.getByTestId('verdict')).toHaveCount(0);
  await expect(page.locator('svg')).toHaveCount(0);

  // 错误类别齐全（syntax/duplicate_id/arity/unknown_ref/output/cycle）
  const expectedCounts: Record<string, number> = {
    syntax: 1,
    duplicate_id: 1,
    unknown_ref: 1,
    arity: 3, // A 图 g1、g2；B 图 g1
    output: 1,
    cycle: 1,
  };
  for (const [kind, count] of Object.entries(expectedCounts)) {
    await expect(errors.locator(`.error--${kind}`)).toHaveCount(count);
  }
});

test('修正错误后重新比较可得到结论（拒绝状态可恢复）', async ({ page }) => {
  await page.getByRole('button', { name: '示例：各类错误' }).click();
  await page.getByRole('button', { name: '校验并比较' }).click();
  await expect(page.getByTestId('errors')).toBeVisible();

  await page.getByRole('button', { name: '示例：等价改版' }).click();
  await page.getByRole('button', { name: '校验并比较' }).click();
  await expect(page.getByTestId('verdict')).toHaveAttribute(
    'data-equivalent',
    'true',
  );
  await expect(page.getByTestId('errors')).toHaveCount(0);
});

test('不等价时可提取最少锁定条件：A=0、C=1 锁定，B 自由，2 种补全均分歧', async ({ page }) => {
  await page.getByRole('button', { name: '示例：罕见分歧' }).click();
  await page.getByRole('button', { name: '校验并比较' }).click();

  const action = page.getByTestId('lock-action');
  await expect(action).toBeVisible();
  await action.getByRole('button', { name: '提取最少输入锁定条件' }).click();

  const report = page.getByTestId('lock-report');
  await expect(report).toBeVisible();

  // 锁定项按 ASCII 变量序：A=0 在前，C=1 在后（A=0 与 B=0 平票时取变量名靠前的 A）
  const lits = report.locator('.lock-lit');
  await expect(lits).toHaveCount(2);
  await expect(lits.nth(0)).toContainText('A');
  await expect(lits.nth(0)).toHaveAttribute('data-bit', '0');
  await expect(lits.nth(1)).toContainText('C');
  await expect(lits.nth(1)).toHaveAttribute('data-bit', '1');

  // 未锁定输入与补全数
  await expect(report).toContainText('B');
  await expect(report).toContainText('2');

  // 精确裁决结论
  const conclusion = page.getByTestId('lock-conclusion');
  await expect(conclusion).toHaveAttribute('data-holds', 'true');
  await expect(conclusion).toContainText('所有补全均分歧');
});

test('等价改版不提供锁定条件提取入口', async ({ page }) => {
  await page.getByRole('button', { name: '示例：等价改版' }).click();
  await page.getByRole('button', { name: '校验并比较' }).click();
  await expect(page.getByTestId('verdict')).toHaveAttribute(
    'data-equivalent',
    'true',
  );
  await expect(page.getByTestId('lock-action')).toHaveCount(0);
  await expect(page.getByTestId('lock-report')).toHaveCount(0);
});

test('输入被重新编辑后旧锁定报告立即消失（即使尚未重新比较）', async ({ page }) => {
  await page.getByRole('button', { name: '示例：罕见分歧' }).click();
  await page.getByRole('button', { name: '校验并比较' }).click();
  await page.getByTestId('lock-action').getByRole('button', { name: '提取最少输入锁定条件' }).click();
  await expect(page.getByTestId('lock-report')).toBeVisible();

  // 编辑左栏
  await page.locator('#ta-a').pressSequentially('\n');
  await expect(page.getByTestId('lock-report')).toHaveCount(0);
  await expect(page.getByTestId('lock-action')).toHaveCount(0);

  // 重新比较后入口恢复，可再次提取
  await page.getByRole('button', { name: '校验并比较' }).click();
  await expect(page.getByTestId('lock-action')).toBeVisible();
  await page.getByTestId('lock-action').getByRole('button', { name: '提取最少输入锁定条件' }).click();
  await expect(page.getByTestId('lock-report')).toBeVisible();

  // 编辑右栏同样作废旧报告
  await page.locator('#ta-b').pressSequentially('\n');
  await expect(page.getByTestId('lock-report')).toHaveCount(0);
});

test('校验失败或改比等价图后旧锁定报告均不保留', async ({ page }) => {
  await page.getByRole('button', { name: '示例：罕见分歧' }).click();
  await page.getByRole('button', { name: '校验并比较' }).click();
  await page.getByTestId('lock-action').getByRole('button', { name: '提取最少输入锁定条件' }).click();
  await expect(page.getByTestId('lock-report')).toBeVisible();

  // 改比等价改版
  await page.getByRole('button', { name: '示例：等价改版' }).click();
  await page.getByRole('button', { name: '校验并比较' }).click();
  await expect(page.getByTestId('lock-report')).toHaveCount(0);
  await expect(page.getByTestId('lock-action')).toHaveCount(0);

  // 再回到分歧并提取
  await page.getByRole('button', { name: '示例：罕见分歧' }).click();
  await page.getByRole('button', { name: '校验并比较' }).click();
  await page.getByTestId('lock-action').getByRole('button', { name: '提取最少输入锁定条件' }).click();
  await expect(page.getByTestId('lock-report')).toBeVisible();

  // 触发校验失败（错误示例）
  await page.getByRole('button', { name: '示例：各类错误' }).click();
  await page.getByRole('button', { name: '校验并比较' }).click();
  await expect(page.getByTestId('errors')).toBeVisible();
  await expect(page.getByTestId('lock-report')).toHaveCount(0);
  await expect(page.getByTestId('verdict')).toHaveCount(0);
});
