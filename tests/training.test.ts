import { test } from "node:test";
import assert from "node:assert/strict";
import { gradeQuiz } from "../src/lib/training";

test("a quiz is marked against its pass mark", () => {
  const qs = [{ id: "a", correctIndex: 1 }, { id: "b", correctIndex: 0 }, { id: "c", correctIndex: 2 }];
  assert.deepEqual(gradeQuiz(qs, { a: 1, b: 0, c: 1 }, 60), { correct: 2, total: 3, score: 67, passed: true });
  assert.deepEqual(gradeQuiz(qs, { a: 1, b: 0, c: 1 }, 70), { correct: 2, total: 3, score: 67, passed: false });
  assert.equal(gradeQuiz(qs, { a: 1 }, 30).passed, true);
  assert.equal(gradeQuiz([], {}, 0).passed, false, "a quiz with no questions is never passed");
});
