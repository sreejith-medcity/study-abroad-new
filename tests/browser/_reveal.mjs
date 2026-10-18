/**
 * Getting at a control that is behind a fold.
 *
 * Screens in this portal fold: a section folds, and inside it a panel folds
 * again, so that a long file reads as a list of headings rather than as
 * everything at once. A control inside a shut fold is in the page and cannot
 * be clicked, and a suite that goes straight for it waits thirty seconds for
 * something that will never appear.
 *
 * This opens the folds until the thing is on screen, the way a person does.
 * It opens them repeatedly because they nest: opening the outer one reveals
 * the inner one, which has to be opened in turn.
 */
export async function reveal(page, locator, rounds = 4) {
  const visible = async () => locator.first().isVisible().catch(() => false);
  if (await visible()) return locator;
  for (let i = 0; i < rounds; i++) {
    const shut = page.locator("main details:not([open]) > summary");
    const n = await shut.count();
    if (n === 0) break;
    for (let k = 0; k < n; k++) await shut.nth(k).click({ timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(250);
    if (await visible()) return locator;
  }
  return locator;
}
