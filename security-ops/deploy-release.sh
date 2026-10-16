#!/usr/bin/env bash
# Dedicated runner, fixed installation root; never executes untrusted PRs.
set -euo pipefail
umask 077
base=/srv/consulting-cockpit
mode=${1:?deploy or rollback}
exec 9>"$base/deploy.lock"
flock -n 9 || { echo 'Another release is active'; exit 1; }
old=$(readlink -f "$base/current" || true)
if [[ "$mode" == rollback ]]; then
  target=$(readlink -f "$base/previous")
  [[ "$target" == "$base/releases/"* && -f "$target/ecosystem.config.cjs" ]] || exit 1
elif [[ "$mode" == deploy ]]; then
  archive=${2:?release archive required}
  sha=${3:?commit SHA required}
  [[ "$sha" =~ ^[a-f0-9]{40}$ ]] || exit 1
  target="$base/releases/$sha"
  [[ ! -e "$target" ]] || { echo 'Release already exists; use rollback or a new commit'; exit 1; }
  mkdir -p "$target"
  tar -xzf "$archive" -C "$target" --no-same-owner
  [[ -f "$base/shared/.env" ]] || { echo 'Provision shared environment first'; exit 1; }
  (cd "$target" && bun install --frozen-lockfile)
  ln -s "$base/shared/.env" "$target/.env"
else
  exit 1
fi
activate() {
  ln -sfn "$1" "$base/current.next"
  mv -Tf "$base/current.next" "$base/current"
  (cd "$base/current" && RELEASE_SHA="$(basename "$1")" bun run start)
}
restore_on_error() {
  if [[ -n "$old" && -d "$old" ]]; then activate "$old"; fi
  echo 'Release failed; previous code restored where available. Database was not modified.'
}
trap restore_on_error ERR
activate "$target"
for attempt in {1..20}; do
  if headers=$(curl --fail --silent --max-time 3 --dump-header - --output /dev/null http://127.0.0.1:4200/api/health) && printf '%s\n' "$headers" | tr -d '\r' | grep -qi "^x-cockpit-release: $(basename "$target")$"; then
    if [[ -n "$old" && "$old" != "$target" ]]; then ln -sfn "$old" "$base/previous"; fi
    trap - ERR
    echo 'Release activated; no database migration ran.'
    exit 0
  fi
  sleep 1
done
false
