#!/usr/bin/env bash
# After the owner merges a pull request: confirms it reached main, brings the checkout this is run from up to date when
# that checkout is on main (a fast-forward and, if the lockfile changed, an install: never a build, the owner's site
# runs from the main checkout), waits for CI on main and for the production deploy, shows what the deploy did to the
# live database's migrations, and checks the public pages answer. Reads only, apart from that fast-forward.
#   scripts/after-merge.sh 56
set -u
pr=${1:?Usage: scripts/after-merge.sh <pull request number>}
SCOPE=ketflows-projects   # the Vercel team
PROJECT=offboard          # the Vercel project
SITE=https://offboard.club

state=$(gh pr view "$pr" --json state,mergedAt,mergeCommit --jq '"\(.state) \(.mergedAt // "") \(.mergeCommit.oid // "")"') || exit 1
set -- $state
[ "${1:-}" = MERGED ] || { echo "#$pr is $1, not merged."; exit 1; }
sha=$3
echo "#$pr merged at $2 as ${sha:0:7}"
gh pr view "$pr" --json closingIssuesReferences --jq '.closingIssuesReferences[] | "closes #\(.number)"'

git fetch -q origin --prune
if [ "$(git rev-parse --abbrev-ref HEAD)" = main ]; then
  before=$(git rev-parse HEAD)
  if git pull -q --ff-only; then
    echo "this checkout: main at $(git rev-parse --short HEAD)"
    if ! git diff --quiet "$before" HEAD -- pnpm-lock.yaml; then
      echo "the lockfile changed: installing"
      pnpm install --frozen-lockfile 2>&1 | grep -E "^\+ |^- |ERR" | head -10
    fi
  else
    echo "this checkout could not be fast-forwarded: look at git status"
  fi
else
  echo "this checkout is on $(git rev-parse --abbrev-ref HEAD), left as it is"
fi

id=""
for _ in $(seq 1 30); do
  id=$(gh run list --branch main --limit 10 --json databaseId,headSha --jq "[.[] | select(.headSha == \"$sha\")] | first | .databaseId // empty")
  [ -n "$id" ] && break
  sleep 6
done
if [ -n "$id" ]; then
  gh run watch "$id" --exit-status --interval 10 >/dev/null 2>&1
  echo "CI on main: $(gh run view "$id" --json conclusion --jq .conclusion)"
else
  echo "CI on main: no run found for ${sha:0:7} (a later merge may have replaced it)"
fi

deploy=pending; url=""
for _ in $(seq 1 60); do
  line=$(gh api "repos/{owner}/{repo}/commits/$sha/status" --jq '[.statuses[] | select(.context == "Vercel")] | first | "\(.state // "pending") \(.target_url // "")"' 2>/dev/null)
  deploy=${line%% *}; url=${line#* }
  case $deploy in success|failure|error) break ;; esac
  sleep 6
done
echo "production deploy: $deploy"
# What the build did to the live database: "applying NNN_name.sql", "applied N" or "nothing to apply".
latest=$(vercel --scope "$SCOPE" ls "$PROJECT" --prod 2>/dev/null | grep -m1 -o 'https://[a-z0-9-]*\.vercel\.app')
if [ -n "$latest" ]; then
  vercel --scope "$SCOPE" inspect "$latest" --logs 2>&1 | grep -E "applying|applied [0-9]|nothing to apply|left alone|stopped" | sed -E 's/^[^ ]+ +/migrations: /' | head -5
fi
for path in / /seasons /recaps /privacy; do
  printf '%s -> %s   ' "$path" "$(curl -s -o /dev/null -w '%{http_code}' --max-time 30 "$SITE$path")"
done
echo
[ "$deploy" = success ]
