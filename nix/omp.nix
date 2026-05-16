{
  lib,
  stdenv,
  bun2nix,
  bun,
  fetchurl,
  rustc,
  cargo,
  rustPlatform,
  pkg-config,
  makeWrapper,
  autoPatchelfHook,
  zlib,
  libclang,
  zig,
  src,
}:

let
  versionData = builtins.fromJSON (builtins.readFile ../hashes.json);
  inherit (versionData) version cargoHash;

  # nixpkgs currently ships bun 1.3.13; the source requires >= 1.3.14. The
  # bun-compiled binary embeds whatever bun runtime built it, so the runtime
  # version check rejects nixpkgs's bun. Override to the 1.3.14 release
  # tarball directly. nixpkgs bun is a precompiled binary unpack, so a src
  # swap is sufficient — no toolchain rebuild. Linux-x64 only for now;
  # other platforms fall through to nixpkgs bun (and will fail the runtime
  # check until their hashes are added).
  bunPinned =
    if stdenv.hostPlatform.system == "x86_64-linux" then
      bun.overrideAttrs (_old: {
        version = "1.3.14";
        src = fetchurl {
          url = "https://github.com/oven-sh/bun/releases/download/bun-v1.3.14/bun-linux-x64.zip";
          hash = "sha256-lR7iruhV8IWVruxiJSJqKY0/6oOj3NZGXAnLzN9+hI8=";
        };
      })
    else
      bun;
  platformsBySystem = {
    aarch64-darwin = {
      bunTarget = "bun-darwin-arm64";
      nativeLib = "libpi_natives.dylib";
      nodeTag = "darwin-arm64";
    };
    aarch64-linux = {
      bunTarget = "bun-linux-arm64";
      nativeLib = "libpi_natives.so";
      nodeTag = "linux-arm64";
    };
    x86_64-darwin = {
      bunTarget = "bun-darwin-x64";
      nativeLib = "libpi_natives.dylib";
      nodeTag = "darwin-x64";
    };
    x86_64-linux = {
      bunTarget = "bun-linux-x64-modern";
      nativeLib = "libpi_natives.so";
      nodeTag = "linux-x64";
    };
  };
  platform =
    platformsBySystem.${stdenv.hostPlatform.system}
      or (throw "Unsupported platform for omp: ${stdenv.hostPlatform.system}");
  rustTarget = stdenv.hostPlatform.rust.rustcTarget;
  rustTargetEnv = "CARGO_TARGET_${
    lib.toUpper (builtins.replaceStrings [ "-" ] [ "_" ] rustTarget)
  }_RUSTFLAGS";
  glimmerRustFlags = lib.concatStringsSep " " [
    "-Clink-arg=-Wl,-u,tree_sitter_glimmer_external_scanner_create"
    "-Clink-arg=-Wl,-u,tree_sitter_glimmer_external_scanner_destroy"
    "-Clink-arg=-Wl,-u,tree_sitter_glimmer_external_scanner_reset"
    "-Clink-arg=-Wl,-u,tree_sitter_glimmer_external_scanner_scan"
    "-Clink-arg=-Wl,-u,tree_sitter_glimmer_external_scanner_serialize"
    "-Clink-arg=-Wl,-u,tree_sitter_glimmer_external_scanner_deserialize"
  ];
in
stdenv.mkDerivation {
  pname = "omp";
  inherit version src;

  cargoDeps = rustPlatform.fetchCargoVendor {
    name = "omp-${version}-cargo-vendor";
    inherit src;
    hash = cargoHash;
  };

  nativeBuildInputs = [
    bun2nix.hook
    bunPinned
    rustc
    cargo
    rustPlatform.cargoSetupHook
    pkg-config
    makeWrapper
    zig
  ]
  ++ lib.optionals stdenv.hostPlatform.isLinux [ autoPatchelfHook ];

  buildInputs = lib.optionals stdenv.hostPlatform.isLinux [
    stdenv.cc.cc.lib
    zlib
  ];

  # smallvec's `specialization` feature requires nightly Rust.
  # RUSTC_BOOTSTRAP=1 enables nightly features on stable rustc.
  #
  # CFLAGS forces -O2 for cc-rs C compiles (tree-sitter-* crates' build.rs
  # invokes gcc on huge generated parser.c files). gcc 15 occasionally emits
  # malformed assembly at -O3 on these (~5MB parser.c) — manifests as the
  # assembler rejecting "unknown pseudo-op: .jero" (single-bit-flipped .zero).
  # gcc takes the last -O flag, so a trailing -O2 overrides cc-rs's -O3 and
  # dodges the optimizer path that trips this. Only affects C — Rust code
  # still builds at the cargo profile's release -O level.
  env = {
    RUSTC_BOOTSTRAP = 1;
    ${rustTargetEnv} = glimmerRustFlags;
    CFLAGS = "-O2";
  };

  bunDeps = bun2nix.fetchBunDeps {
    bunNix = ../bun.nix;
  };

  # We handle build and install ourselves
  dontUseBunBuild = true;
  dontUseBunInstall = true;
  dontRunLifecycleScripts = true;

  # bun compile embeds JS in the binary; stripping would break it
  dontStrip = true;

  postPatch = ''
    # bun resolves caret-range specifiers via the npm registry even when the
    # pinned version is already in the local cache. In the Nix sandbox this
    # fails because the network is blocked. Strip ^ and ~ prefixes so bun
    # treats them as exact.
    for f in package.json packages/*/package.json; do
      if [ -f "$f" ]; then
        sed -i 's/: "\^/: "/g; s/: "~/: "/g' "$f"
      fi
    done
    sed -i 's/: "\^/: "/g; s/: "~/: "/g' bun.lock

    # swarm-extension declares a peerDependency on @oh-my-pi/pi-coding-agent
    # with a hard-coded major (e.g. ^13) that upstream forgot to bump for the
    # v14 release. With the workspace package now at 14.x bun cannot satisfy
    # the constraint locally and falls back to the npm registry, which is
    # unreachable in the sandbox. Rewrite it to the workspace reference.
    sed -i 's|"@oh-my-pi/pi-coding-agent": "[0-9][^"]*"|"@oh-my-pi/pi-coding-agent": "workspace:*"|' \
      packages/swarm-extension/package.json bun.lock

    # Reset the stats embedded client bundle to the placeholder so we don't
    # need to build the full React dashboard.
    cat > packages/stats/src/embedded-client.generated.txt <<'PLACEHOLDER'
    export const EMBEDDED_CLIENT_ARCHIVE_TAR_GZ_BASE64 = "";
    PLACEHOLDER
  '';

  buildPhase = ''
    runHook preBuild

    # Native node modules like @napi-rs/cli need libstdc++ at build time
    ${lib.optionalString stdenv.hostPlatform.isLinux ''
      export LD_LIBRARY_PATH="${lib.makeLibraryPath [ stdenv.cc.cc.lib ]}"
    ''}

    # bindgen (used by zlob crate) needs libclang
    export LIBCLANG_PATH="${libclang.lib}/lib"

    # Build the Rust native addon
    echo "Building Rust native addon..."
    cargo build --release -p pi-natives --target ${rustTarget} --target-dir target

    # Install the native addon where the JS code expects it
    mkdir -p packages/natives/native
    cp target/${rustTarget}/release/${platform.nativeLib} \
       packages/natives/native/pi_natives.${platform.nodeTag}.node

    # Generate the napi type definitions and JS loader by running the
    # napi CLI from node_modules
    napiBin="$(pwd)/node_modules/.bin/napi"
    if [ -x "$napiBin" ]; then
      "$napiBin" build \
        --manifest-path crates/pi-natives/Cargo.toml \
        --package-json-path packages/natives/package.json \
        --platform \
        --no-js \
        --dts index.d.ts \
        -o packages/natives/native \
        --release \
        || echo "napi CLI post-processing failed; using cargo output directly"
    fi

    # Generate runtime enum exports from const enums in the type definitions
    if [ -f packages/natives/scripts/gen-enums.ts ] && \
       [ -f packages/natives/native/index.d.ts ]; then
      ${bunPinned}/bin/bun packages/natives/scripts/gen-enums.ts || true
    fi

    # Generate the docs index (prepack script in coding-agent)
    echo "Generating docs index..."
    ${bunPinned}/bin/bun packages/coding-agent/scripts/generate-docs-index.ts

    # Compile the standalone binary. bun2nix.hook drags bun 1.3.13 onto PATH;
    # use the pinned binary via absolute path so the embedded runtime is 1.3.14.
    echo "Compiling standalone binary..."
    ${bunPinned}/bin/bun build --compile \
      --define PI_COMPILED=true \
      --external mupdf \
      --target="${platform.bunTarget}" \
      --root . \
      ./packages/coding-agent/src/cli.ts \
      --outfile dist/omp

    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall

    mkdir -p $out/lib/omp $out/bin
    cp dist/omp $out/lib/omp/omp
    # native.ts probes dirname(process.execPath) for the addon. On x64 it
    # looks for -modern / -baseline / plain in that order, on arm64 only
    # the plain name. Ship the plain name so both arches resolve it.
    cp packages/natives/native/pi_natives.${platform.nodeTag}.node $out/lib/omp/

    makeWrapper $out/lib/omp/omp $out/bin/omp \
      --set PI_SKIP_VERSION_CHECK 1 \
    ${lib.optionalString stdenv.hostPlatform.isLinux "--prefix LD_LIBRARY_PATH : ${
      lib.makeLibraryPath [
        zlib
        stdenv.cc.cc.lib
      ]
    }"}

    runHook postInstall
  '';

  passthru.category = "AI Coding Agents";

  meta = with lib; {
    description = "A terminal-based coding agent with multi-model support (John2143 fork)";
    homepage = "https://github.com/John2143/oh-my-pi";
    changelog = "https://github.com/John2143/oh-my-pi/releases/tag/v${version}";
    license = licenses.mit;
    sourceProvenance = with lib.sourceTypes; [ fromSource ];
    mainProgram = "omp";
    platforms = builtins.attrNames platformsBySystem;
  };
}
