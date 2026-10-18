/**
 * The id of a student, read from the search page the way somebody gets it.
 *
 * Several suites needed a student id and took it from a `<select name="student">`
 * on the search page, which is a reasonable way not to hardcode an id. That
 * control became a type-ahead some time ago and the selector has matched
 * nothing since, so six suites were timing out on a locator that will never
 * resolve, for a reason that had nothing to do with what they were testing.
 *
 * This picks the student the way the page now asks you to and reads the id out
 * of the field the form actually submits, so it keeps the suites' intent: no
 * ids written down, and the real control exercised on the way past.
 */
export async function studentIdByName(page, base, name) {
  await page.goto(`${base}/search`);
  await page.locator("#pick-student input[role='combobox']").waitFor({ state: "visible", timeout: 15000 });
  await page.locator("#pick-student input[role='combobox']").click();
  await page.locator("#pick-student input[role='combobox']").fill(name.split(" ")[0]);
  const option = page.locator("#pick-student [role='option']", { hasText: name }).first();
  await option.waitFor({ state: "visible", timeout: 10000 });
  await option.click();
  const id = await page.locator('#pick-student input[name="student"]').inputValue();
  if (!id) throw new Error(`could not read an id for "${name}" from the search page`);
  return id;
}
