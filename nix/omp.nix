{
  lib,
  stdenv,
  bun2nix,
  bun,
  rustc,
  cargo,
  rustPlatform,
  pkg-config,
  makeWrapper,
  autoPatchelfHook,
  zlib,
  libclang,
  zig,
  jq,
  src,
}:

let
  versionData = builtins.fromJSON (builtins.readFile ../hashes.json);
  inherit (versionData) version cargoHash;

  # Use bun 1.3.14 for transpilation (nixpkgs bun 1.3.13 can't handle
  # #private fields and mis-identifies --target bun as browser mode).
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
      bunTarget = "bun-linux-x64";
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
    bun
    rustc
    cargo
    rustPlatform.cargoSetupHook
    pkg-config
    makeWrapper
    jq
    zig
  ]
  ++ lib.optionals stdenv.hostPlatform.isLinux [ autoPatchelfHook ];

  buildInputs = lib.optionals stdenv.hostPlatform.isLinux [
    stdenv.cc.cc.lib
    zlib
  ];

  env = {
    RUSTC_BOOTSTRAP = 1;
    ${rustTargetEnv} = glimmerRustFlags;
    CFLAGS = "-O2";
  };

  bunDeps = bun2nix.fetchBunDeps {
    bunNix = ../bun.nix;
  };

  dontUseBunBuild = true;
  dontUseBunInstall = true;
  dontRunLifecycleScripts = true;

  dontStrip = true;

  postPatch = ''
    for f in package.json packages/*/package.json; do
      if [ -f "$f" ]; then
        sed -i 's/: "\^/: "/g; s/: "~/: "/g' "$f"
      fi
    done
    sed -i 's/: "\^/: "/g; s/: "~/: "/g' bun.lock

    jq 'del(.workspaces.packages[] | select(. == "python/robomp/web"))' package.json > package.json.tmp && mv package.json.tmp package.json
    sed -i '/robomp-web@workspace/d' bun.lock

    sed -i 's|"@oh-my-pi/pi-coding-agent": "[0-9][^"]*"|"@oh-my-pi/pi-coding-agent": "workspace:*"|' \
      packages/swarm-extension/package.json bun.lock

    cat > packages/stats/src/embedded-client.generated.txt <<'PLACEHOLDER'
    export const EMBEDDED_CLIENT_ARCHIVE_TAR_GZ_BASE64 = "";
    PLACEHOLDER

    # Placeholder for generated tool views
    cat > packages/coding-agent/src/export/html/tool-views.generated.js <<'PLACEHOLDER2'
    export default "";
    PLACEHOLDER2

    # Convert #private method calls to underscore for bun 1.3.13 runtime.
    # These are inherited #private fields that bun 1.3.13 can't resolve
    # through the prototype chain.
    for f in $(find packages/coding-agent/src -name "*.ts" -type f); do
      sed -i -e 's/\(\.\)#/\1_/g' -e 's/\([[:space:]]\|^\)#\([a-zA-Z_][a-zA-Z0-9_]*\)/\1_\2/g' "$f"
    done

    sed -i 's|"bun": ">=[0-9.]*"|"bun": ">=${lib.getVersion bun}"|' packages/utils/package.json
  '';

  buildPhase = ''
    runHook preBuild

    ${lib.optionalString stdenv.hostPlatform.isLinux ''
      export LD_LIBRARY_PATH="${lib.makeLibraryPath [ stdenv.cc.cc.lib ]}"
    ''}

    export LIBCLANG_PATH="${libclang.lib}/lib"

    echo "Building Rust native addon..."
    cargo build --release -p pi-natives --target ${rustTarget} --target-dir target

    mkdir -p packages/natives/native
    cp target/${rustTarget}/release/${platform.nativeLib} \
       packages/natives/native/pi_natives.${platform.nodeTag}.node

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

    if [ -f packages/natives/scripts/gen-enums.ts ] && \
       [ -f packages/natives/native/index.d.ts ]; then
      ${bun}/bin/bun packages/natives/scripts/gen-enums.ts || true
    fi

    echo "Generating docs index..."
    ${bun}/bin/bun packages/coding-agent/scripts/generate-docs-index.ts

    # Transpile TS to JS. --external '*' tells bundler to skip
    # resolution — runtime bun resolves imports from node_modules.
    # The #private patches in postPatch handle bun 1.3.13's limitations.
    echo "Transpiling JS bundle..."
    ${bun}/bin/bun build       --define PI_COMPILED=true       --external '*'       --target bun       --root .       ./packages/coding-agent/src/cli.ts       --outfile dist/omp.js

    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall

    mkdir -p $out/lib/omp $out/bin
    # Copy the full source tree for runtime resolution
    cp -r . $out/lib/omp/
    rm -rf $out/lib/omp/node_modules/.bun/*musl* $out/lib/omp/node_modules/.bun/*@img+sharp* 2>/dev/null || true
    find $out/lib/omp -xtype l -delete 2>/dev/null || true
    cp packages/natives/native/pi_natives.${platform.nodeTag}.node $out/lib/omp/packages/natives/native/

    # Polyfill for Bun-specific globals ($env, $flag) that bun 1.3.13 lacks.
    cat > $out/lib/omp/env-polyfill.ts <<'POLYFILL'
globalThis.$env = process.env;
globalThis.$flag = (name, def) => {
	const value = process.env[name];
	if (!value) return def;
	return !["0", "false", "no", "off", ""].includes(value.trim().toLowerCase());
};
POLYFILL

    makeWrapper ${bun}/bin/bun $out/bin/omp \
      --add-flags "--preload $out/lib/omp/env-polyfill.ts $out/lib/omp/packages/coding-agent/src/cli.ts" \
      --chdir "$out/lib/omp" \
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
  preferLocalBuild = true;

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
