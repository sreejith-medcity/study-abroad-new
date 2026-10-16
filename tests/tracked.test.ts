import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

/**
 * Nothing the app is built from may be invisible to git.
 *
 * .gitignore held the bare pattern `uploads/`, which matches a directory of
 * that name at any depth, so src/app/api/uploads never went into a commit.
 * The browser posted documents to a route the deployed build did not have,
 * and every upload came back 500 with nothing in the server log. Locally
 * everything passed, because locally the file was there.
 *
 * git add says nothing about a file it is ignoring, so this does.
 */
const git = (args: string[]) => execFileSync("git", args, { encoding: "utf8" });

test("no source file is ignored by git", () => {
  const source = git(["ls-files", "--others", "--ignored", "--exclude-standard", "--directory", "src", "scripts", "tests", "drizzle"])
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  assert.deepEqual(source, [], `git is ignoring these, so they never reach the server:\n${source.join("\n")}`);
});

test("every route the browser posts a document to is committed", () => {
  const routes = ["src/app/api/uploads/document/route.ts", "src/app/api/uploads/portal-document/route.ts"];
  const tracked = new Set(git(["ls-files", "src/app/api"]).split("\n").map((l) => l.trim()));
  for (const route of routes) assert.ok(tracked.has(route), `${route} is not committed`);
});
