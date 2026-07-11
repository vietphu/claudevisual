export function addSkillInvocation(skillsInvoked: string[], input: Record<string, unknown> | undefined): string[] {
  const name = extractSkillName(input);
  if (!name || skillsInvoked.includes(name)) {
    return skillsInvoked;
  }
  return [...skillsInvoked, name];
}

function extractSkillName(input: Record<string, unknown> | undefined): string | undefined {
  if (!input) {
    return undefined;
  }
  for (const key of ["command", "skill", "name"]) {
    const value = input[key];
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }
  return undefined;
}
