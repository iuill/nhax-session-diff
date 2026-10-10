#!/usr/bin/env bash
set -euo pipefail

release_version="${1:?Usage: bash scripts/package-release.sh vX.Y.Z}"
if [[ ! "$release_version" =~ ^v[0-9]+\.[0-9]+\.[0-9]+([.-][a-zA-Z0-9.-]+)?$ ]]; then
    printf 'Invalid release version: %s\n' "$release_version" >&2
    exit 1
fi
release_dir="dist/releases/${release_version}"
mkdir -p "$release_dir"
for target_os in linux windows; do
    for target_arch in amd64 arm64; do
        package_name="nhax-diff_${release_version}_${target_os}_${target_arch}"
        package_dir="dist/packages/${package_name}"
        mkdir -p "$package_dir"
        binary_name=nhax-diff
        [[ "$target_os" != windows ]] || binary_name=nhax-diff.exe
        CGO_ENABLED=0 GOOS="$target_os" GOARCH="$target_arch" GOAMD64=v1 \
            go build -trimpath -ldflags "-s -w -X main.version=${release_version}" \
            -o "$package_dir/$binary_name" ./cmd/nhax-diff
        cat > "$package_dir/USAGE.txt" <<'EOF'
NHAX session diff CLI

No Go or Python installation is required.

nhax-diff --version
nhax-diff list --format text sample.nhax
nhax-diff diff --before p0/s0/a0 --after p1/s0/a0 --format text sample.nhax

Use the selectors shown by list. Supply flags before file paths.
On Windows use nhax-diff.exe. On Linux use ./nhax-diff.

Comparison is of raw XML fields. UI names and units are unverified.
https://github.com/iuill/nhax-session-diff
EOF
        if [[ "$target_os" == windows ]]; then
            python3 - "$package_dir" "$release_dir/$package_name.zip" <<'PY'
import pathlib, sys, zipfile
source = pathlib.Path(sys.argv[1])
with zipfile.ZipFile(sys.argv[2], "w", zipfile.ZIP_DEFLATED) as archive:
    for path in sorted(source.iterdir()):
        archive.write(path, path.name)
PY
        else
            tar -czf "$release_dir/$package_name.tar.gz" -C "$package_dir" "$binary_name" USAGE.txt
        fi
    done
done
(
    cd "$release_dir"
    sha256sum ./*.tar.gz ./*.zip > SHA256SUMS
)
