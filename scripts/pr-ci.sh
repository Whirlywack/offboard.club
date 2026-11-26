#!/usr/bin/env bash
# Waits for CI on a pull request's (or a branch's) latest commit and prints what a hand-over needs: the conclusion, the
# test tallies, the failing lines if it failed, and whether the pull request can merge. Reads only.
#   scripts/pr-ci.sh 56            scripts/pr-ci.sh ticket-57-check-and-guards
set -u
target=${1:?Usage: scripts/pr-ci.sh <pull request number | branch>}
if [[ $target =~ ^[0-9]+$ ]]; then
  branch=$(gh pr view "$target" --json headRefName --jq .headRefName) || exit 1
  sha=$(gh pr view "$target" --json headRefOid --jq .headRefOid)
else
  branch=$target
  sha=$(git ls-remote origin "refs/heads/$branch" | cut -f1)
fi
[ -n "${sha:-}" ] || { echo "No such pull request or branch on GitHub: $target"; exit 1; }

# The run for exactly this commit: an older run for the branch is not an answer. While a pull request is open, its own
# run ("CI") is the one main requires: the push run beside it ("CI before a pull request") only looks for the pull request.
only=""
[ "$(gh pr list --head "$branch" --state open --json number --jq length)" != 0 ] && only=' and .workflowName == "CI"'
id=""
for _ in $(seq 1 40); do
  id=$(gh run list --branch "$branch" --limit 10 --json databaseId,headSha,workflowName --jq "[.[] | select(.headSha == \"$sha\"$only)] | first | .databaseId // empty")
  [ -n "$id" ] && break
  sleep 6
done
[ -n "$id" ] || { echo "No CI run for ${sha:0:7} on $branch after four minutes. CI runs for pull requests, main, and ticket-* branches."; exit 1; }

gh run watch "$id" --exit-status --interval 10 >/dev/null 2>&1
conclusion=$(gh run view "$id" --json conclusion --jq .conclusion)
echo "CI on $branch at ${sha:0:7}: $conclusion"
# gh prints a log's colour codes as the two characters "^[" where the terminal would get an escape; both are removed.
plain() { perl -pe 's/(\e|\^\[)\[[0-9;]*m//g; s/^[^\t]*\t[^\t]*\t[0-9TZ:.-]+ //'; }
gh run view "$id" --log 2>/dev/null | plain | grep -E "^ *(Test Files|Tests|Errors) " | sed -E 's/^ +//'
if [ "$conclusion" != success ]; then
  gh run view "$id" --json jobs --jq '.jobs[] | .steps[] | select(.conclusion == "failure") | "failed step: " + .name'
  gh run view "$id" --log-failed 2>/dev/null | plain | grep -E "FAIL|Error|error|AssertionError|Unhandled|expected|timed out" | head -30 | cut -c1-240
fi
pr=$(gh pr list --head "$branch" --state open --json number --jq '.[0].number // empty')
if [ -n "$pr" ]; then
  sleep 5
  gh pr view "$pr" --json number,mergeable,mergeStateStatus --jq '"#\(.number): \(.mergeable), \(.mergeStateStatus)"'
else
  echo "No open pull request for $branch."
fi
[ "$conclusion" = success ]
