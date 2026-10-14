export function isDraftText(text: string, ...starters: string[]) {
  return !text.trim() || starters.includes(text.trim());
}
export function caseContentIssues(value: { title: string; objective: string; steps: Array<{ action: string; expectedResult: string }> }) {
  const issues: string[] = [];
  if (isDraftText(value.title, "New test case")) issues.push("Give this case a specific title.");
  if (isDraftText(value.objective)) issues.push("Describe the test objective.");
  if (value.steps.some((step) => isDraftText(step.action, "Describe the action", "Describe the next action")))
    issues.push("Replace starter actions with actual test steps.");
  if (value.steps.some((step) => isDraftText(step.expectedResult, "Describe the observable result")))
    issues.push("Describe the observable expected result for each step.");
  return issues;
}
export function scenarioContentIssues(value: { title: string; expectedOutcome: string }) {
  return [
    isDraftText(value.title, "New QA scenario") ? "Give this suggestion a specific title." : "",
    isDraftText(value.expectedOutcome, "Describe the expected behaviour.") ? "Describe the expected behaviour before acceptance." : "",
  ].filter(Boolean);
}
