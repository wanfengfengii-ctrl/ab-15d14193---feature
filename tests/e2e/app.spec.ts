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

test('不等价结论后可提取最少锁定条件，并按 ASCII 序稳定展示', async ({
  page,
}) => {
  await page.getByRole('button', { name: '示例：罕见分歧' }).click();
  await page.getByRole('button', { name: '校验并比较' }).click();
  await expect(page.getByTestId('verdict')).toHaveAttribute(
    'data-equivalent',
    'false',
  );

  // 提取前只有入口与说明，没有报告
  await expect(page.getByTestId('extract-locking')).toBeVisible();
  await expect(page.getByTestId('locking-report')).toHaveCount(0);

  await page.getByTestId('extract-locking').click();

  const report = page.getByTestId('locking-report');
  await expect(report).toBeVisible();

  // 锁定项：A=0、C=1，且按 ASCII 变量序排列（A 在 C 前）
  const locked = page.getByTestId('locking-locked');
  await expect(locked).toContainText('A=0');
  await expect(locked).toContainText('C=1');
  const lockedText = await locked.innerText();
  expect(lockedText.indexOf('A=0')).toBeLessThan(lockedText.indexOf('C=1'));

  // 未锁定输入：B
  const unlocked = page.getByTestId('locking-unlocked');
  await expect(unlocked).toContainText('B');
  await expect(unlocked).not.toContainText('A');
  await expect(unlocked).not.toContainText('C');

  // 核算结论：所有补全均分歧（2^1 = 2 种补全）
  const verdict = page.getByTestId('locking-verdict');
  await expect(verdict).toContainText('所有补全均分歧');
  await expect(verdict).toContainText('2^1 = 2');
  await expect(verdict).toContainText('复核通过');

  // 逐变量状态表：A 锁定 0、B 未锁定、C 锁定 1
  const rows = report.locator('.locking__table tbody tr');
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText('A');
  await expect(rows.nth(0)).toContainText('锁定 = 0');
  await expect(rows.nth(1)).toContainText('B');
  await expect(rows.nth(1)).toContainText('未锁定');
  await expect(rows.nth(2)).toContainText('C');
  await expect(rows.nth(2)).toContainText('锁定 = 1');
});

test('等价结论不提供条件提取入口', async ({ page }) => {
  await page.getByRole('button', { name: '示例：等价改版' }).click();
  await page.getByRole('button', { name: '校验并比较' }).click();
  await expect(page.getByTestId('verdict')).toHaveAttribute(
    'data-equivalent',
    'true',
  );
  await expect(page.getByTestId('locking')).toHaveCount(0);
  await expect(page.getByTestId('extract-locking')).toHaveCount(0);
});

test('输入被重新编辑后，旧锁定条件报告被清除（比较结论保持）', async ({
  page,
}) => {
  await page.getByRole('button', { name: '示例：罕见分歧' }).click();
  await page.getByRole('button', { name: '校验并比较' }).click();
  await page.getByTestId('extract-locking').click();
  await expect(page.getByTestId('locking-report')).toBeVisible();

  // 重新编辑任一输入框
  await page.locator('#ta-b').click();
  await page.keyboard.press(' ');

  await expect(page.getByTestId('locking-report')).toHaveCount(0);
  // 原比较结论语义不变，仍保留展示
  await expect(page.getByTestId('verdict')).toHaveAttribute(
    'data-equivalent',
    'false',
  );
});

test('重新比较后旧锁定条件报告不保留，需重新发起提取', async ({ page }) => {
  await page.getByRole('button', { name: '示例：罕见分歧' }).click();
  await page.getByRole('button', { name: '校验并比较' }).click();
  await page.getByTestId('extract-locking').click();
  await expect(page.getByTestId('locking-report')).toBeVisible();

  await page.getByRole('button', { name: '校验并比较' }).click();
  await expect(page.getByTestId('verdict')).toHaveAttribute(
    'data-equivalent',
    'false',
  );
  await expect(page.getByTestId('locking-report')).toHaveCount(0);
  await expect(page.getByTestId('extract-locking')).toBeVisible();
});

test('校验失败整次拒绝时，旧锁定条件报告不保留', async ({ page }) => {
  await page.getByRole('button', { name: '示例：罕见分歧' }).click();
  await page.getByRole('button', { name: '校验并比较' }).click();
  await page.getByTestId('extract-locking').click();
  await expect(page.getByTestId('locking-report')).toBeVisible();

  await page.getByRole('button', { name: '示例：各类错误' }).click();
  await page.getByRole('button', { name: '校验并比较' }).click();
  await expect(page.getByTestId('errors')).toBeVisible();
  await expect(page.getByTestId('locking')).toHaveCount(0);
  await expect(page.getByTestId('locking-report')).toHaveCount(0);
});
