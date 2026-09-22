/** Marks one quiz attempt. Every question must be answered; an unanswered one counts as wrong. */
export function gradeQuiz(questions: { id: string; correctIndex: number }[], answers: Record<string, number | undefined>, passMark: number) {
  const correct = questions.filter((q) => answers[q.id] === q.correctIndex).length;
  const total = questions.length;
  const score = total ? Math.round((correct / total) * 100) : 0;
  return { correct, total, score, passed: total > 0 && score >= passMark };
}
