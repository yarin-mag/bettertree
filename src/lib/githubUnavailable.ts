export interface UnavailableInfo {
  title: string;
  hint: string;
}

// Maps the backend's free-form GitHub status reason to actionable guidance.
export function describeGithubUnavailable(reason: string | null, hasOwner = false): UnavailableInfo {
  const r = (reason ?? "").toLowerCase();
  if (r.includes("failed to run gh") || r.includes("not installed") || r.includes("no such file")) {
    return { title: "GitHub CLI not found", hint: "Install GitHub CLI (brew install gh), then reopen this tab." };
  }
  if (hasOwner || r.includes("auth") || r.includes("logged in") || r.includes("login")) {
    return { title: "Not signed in to GitHub", hint: "Run `gh auth login` in a terminal, then reopen this tab." };
  }
  if (!hasOwner && (r.includes("remote") || r.includes("github"))) {
    return {
      title: "Not a GitHub repository",
      hint: "This repository has no GitHub remote, so pull requests are unavailable.",
    };
  }
  return { title: "GitHub unavailable", hint: reason || "Pull requests could not be loaded for this repository." };
}
