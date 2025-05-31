# File not found: .github/scripts/get-changed-files.sh (branch: diff-re-embed-ci)
#!/usr/bin/env bash
# get-changed-files.sh - outputs a JSON array of changed source code files in the current push
# Requires that the repository has been checked out with full history (fetch-depth:0)
# Works for both push and pull_request events

set -euo pipefail

# Determine base and head commits
if [[ "${GITHUB_EVENT_NAME}" == "pull_request" ]]; then
  BASE_SHA=$(jq -r .pull_request.base.sha < "$GITHUB_EVENT_PATH")
  HEAD_SHA=$(jq -r .pull_request.head.sha < "$GITHUB_EVENT_PATH")
else
  # For push, compare against previous commit on branch
  BASE_SHA="${{ github.event.before }}"
  HEAD_SHA="${{ github.sha }}"
fi

# Get changed files using git diff --name-only
CHANGED_FILES=$(git diff --name-only "$BASE_SHA" "$HEAD_SHA")

# Only include code files (extensions list must match CODE_EXTENSIONS)
CODE_EXTENSIONS=(ts tsx js jsx vue py rb java php go rs c cpp cs swift kt scala sh pl pm)

FILTERED=()
while IFS= read -r file; do
  ext="${file##*.}"
  if [[ " ${CODE_EXTENSIONS[@]} " =~ " $ext " ]]; then
    FILTERED+=("$file")
  fi
done <<< "$CHANGED_FILES"

# Output JSON array
printf '%s
' "${FILTERED[@]}" | jq -R -s -c 'split("\n") | map(select(length > 0))'
