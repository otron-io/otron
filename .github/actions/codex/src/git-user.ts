export function setGitHubActionsUser(): void {
  const commands = [
    ["git", "config", "--global", "user.name", "otron-agent[bot]"],
    [
      "git",
      "config",
      "--global",
      "user.email",
      "otron-agent[bot]@users.noreply.github.com",
    ],
  ];

  for (const command of commands) {
    Bun.spawnSync(command);
  }
}
