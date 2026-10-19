#!/usr/bin/env bash
# Runs the real `netplan generate` against committed fixtures inside an isolated,
# throw-away container. It ONLY uses --root-dir pointing at a temp directory.
# It never runs `netplan apply` or `netplan try`, never touches /etc/netplan, and
# never starts/stops/installs network services. Output files are only listed, not printed.
set -euo pipefail

cd "$(dirname "$0")/.."
echo "== Environment =="
grep PRETTY_NAME /etc/os-release
dpkg-query -W -f='netplan.io ${Version}\n' netplan.io
if dpkg-query -W libnetplan1 >/dev/null 2>&1; then dpkg-query -W -f='libnetplan1 ${Version}\n' libnetplan1; fi
if dpkg-query -W libnetplan0 >/dev/null 2>&1; then dpkg-query -W -f='libnetplan0 ${Version}\n' libnetplan0; fi

fail=0
run_one() {
  local fixture="$1" root
  root="$(mktemp -d)"
  mkdir -p "$root/etc/netplan"
  cp "$fixture" "$root/etc/netplan/90-test.yaml"
  chmod 600 "$root/etc/netplan/90-test.yaml"
  if netplan generate --root-dir "$root" >"$root/out.log" 2>&1; then
    echo "$root"
    return 0
  fi
  echo "$root"
  return 1
}

echo
echo "== Valid fixtures: must be accepted and produce backend files =="
for f in fixtures/valid/*.yaml; do
  if root="$(run_one "$f")"; then
    outputs="$(find "$root/run" -type f 2>/dev/null | sed "s#^$root/##" | sort || true)"
    if [ -z "$outputs" ]; then
      echo "FAIL (no output files): $f"; cat "$root/out.log"; fail=1; continue
    fi
    case "$f" in
      *-nm.yaml|*nm-*.yaml)
        if ! grep -q '^run/NetworkManager/system-connections/' <<<"$outputs"; then
          echo "FAIL (no NetworkManager keyfiles): $f"; fail=1; continue
        fi ;;
      *networkd*.yaml)
        if ! grep -q '^run/systemd/network/' <<<"$outputs"; then
          echo "FAIL (no systemd-networkd units): $f"; fail=1; continue
        fi ;;
    esac
    echo "ok   $f -> $(wc -l <<<"$outputs") file(s): $(tr '\n' ' ' <<<"$outputs")"
    if grep -qiE 'warning|deprecat' "$root/out.log"; then
      echo "     netplan output:"; sed 's/^/       /' "$root/out.log"
    fi
  else
    echo "FAIL (rejected): $f"; sed 's/^/       /' "$root/out.log"; fail=1
  fi
  rm -rf "$root"
done

echo
echo "== Invalid fixtures: must be rejected =="
for f in fixtures/invalid/*.yaml; do
  if root="$(run_one "$f")"; then
    echo "FAIL (unexpectedly accepted): $f"; fail=1
  else
    echo "ok   $f rejected: $(grep -v '^$' "$root/out.log" | head -n 2 | tr '\n' ' ')"
  fi
  rm -rf "$root"
done

echo
if [ "$fail" -ne 0 ]; then echo "netplan fixture check FAILED"; exit 1; fi
echo "All fixtures behaved as expected. (No configuration was applied anywhere.)"
