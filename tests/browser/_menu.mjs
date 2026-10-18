/**
 * Clicking something in the side menu, now that the menu is in groups.
 *
 * The menu used to be one flat list, so a suite could ask for a link by name
 * and click it. It is in folded groups now, with only the group you are in
 * open, which is what somebody reading nineteen entries actually wanted. A
 * link inside a shut group is still in the page but is not something a person
 * or a test can click, so five suites started timing out on a locator that
 * will never resolve.
 *
 * This opens whichever group holds the link, then clicks it, which is what a
 * person does. It is deliberately not a goto: these suites are checking that
 * the way to a screen exists in the menu, not just that the screen renders.
 */
export async function clickInMenu(page, name) {
  // The menu is part of the shell and arrives with it, so a suite that has
  // only just signed in can get here before there is a menu to read.
  await page.locator("aside nav a").first().waitFor({ state: "attached", timeout: 15000 });
  const link = page.locator("aside nav a").filter({ hasText: name }).first();
  for (let t0 = Date.now(); (await link.count()) === 0 && Date.now() - t0 < 10000; ) await page.waitForTimeout(200);
  if ((await link.count()) === 0) throw new Error(`no menu link matching "${name}"`);
  if (!(await link.isVisible())) {
    // Open every shut group: which one holds it is the menu's business, not
    // this helper's, and opening them all is what a person does when hunting.
    await page.locator("aside nav details:not([open]) > summary").evaluateAll((els) => els.forEach((e) => e.click()));
    await page.waitForTimeout(250);
  }
  await link.click();
}
