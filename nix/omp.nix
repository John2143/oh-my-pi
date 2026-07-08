{
  lib,
  stdenv,
  bun,
  rustc,
  cargo,
  rustPlatform,
  pkg-config,
  zlib,
  libclang,
  zig,
  jq,
  cacert,
  src,
}:

let
  versionData = builtins.fromJSON (builtins.readFile ../hashes.json);
  inherit (versionData) version cargoHash;

  platformsBySystem = {
    aarch64-darwin = {
      nativeLib = "libpi_natives.dylib";
      nodeTag = "darwin-arm64";
      bunTarget = "bun-darwin-arm64";
    };
    aarch64-linux = {
      nativeLib = "libpi_natives.so";
      nodeTag = "linux-arm64";
      bunTarget = "bun-linux-arm64";
    };
    x86_64-darwin = {
      nativeLib = "libpi_natives.dylib";
      nodeTag = "darwin-x64-modern";
      bunTarget = "bun-darwin-x64";
    };
    x86_64-linux = {
      nativeLib = "libpi_natives.so";
      nodeTag = "linux-x64-modern";
      bunTarget = "bun-linux-x64-baseline";
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

  workspacePackages = {
    "@oh-my-pi/pi-coding-agent" = "packages/coding-agent";
    "@oh-my-pi/pi-ai" = "packages/ai";
    "@oh-my-pi/pi-catalog" = "packages/catalog";
    "@oh-my-pi/pi-tui" = "packages/tui";
    "@oh-my-pi/pi-natives" = "packages/natives";
    "@oh-my-pi/pi-utils" = "packages/utils";
    "@oh-my-pi/omp-stats" = "packages/stats";
    "@oh-my-pi/collab-web" = "packages/collab-web";
    "@oh-my-pi/swarm-extension" = "packages/swarm-extension";
    "@oh-my-pi/pi-mnemopi" = "packages/mnemopi";
    "@oh-my-pi/typescript-edit-benchmark" = "packages/typescript-edit-benchmark";
    "@oh-my-pi/terminal-bench" = "packages/terminal-bench";
    "@oh-my-pi/pi-wire" = "packages/wire";
    "@oh-my-pi/pi-agent-core" = "packages/agent";
    "@oh-my-pi/hashline" = "packages/hashline";
    "@oh-my-pi/snapcompact" = "packages/snapcompact";
  };

  nodeModules = stdenv.mkDerivation {
    name = "omp-node-modules-${version}";
    inherit src;
    nativeBuildInputs = [ bun cacert jq ];
    outputHashAlgo = "sha256";
    outputHashMode = "recursive";
    outputHash = "sha256-rZtzjoC+om5zE2FCYu9URggSGwsY8MToqTq7YY/Qm/E=";

    buildPhase = ''
      export HOME=$TMPDIR
      export SSL_CERT_FILE="${cacert}/etc/ssl/certs/ca-bundle.crt"

      jq 'del(.workspaces.packages[] | select(. == "python/robomp/web"))' package.json > pkg.tmp && mv pkg.tmp package.json
      sed -i '/robomp-web@workspace/d' bun.lock

      sed -i 's|"@oh-my-pi/pi-coding-agent": "[0-9][^"]*"|"@oh-my-pi/pi-coding-agent": "workspace:*"|' \
        packages/swarm-extension/package.json bun.lock

      bun install --ignore-scripts

      # Pre-download the target bun runtime needed for --compile --target
      export BUN_INSTALL_CACHE_DIR=$PWD/.bun-cache
      mkdir -p "$BUN_INSTALL_CACHE_DIR"
      echo "" > dummy.ts
      ${bun}/bin/bun build --compile --target ${platform.bunTarget} dummy.ts --outfile /dev/null 2>/dev/null || true
    '';

    installPhase = ''
      mkdir -p $out $out/bun-target
      cp -r node_modules $out/
      cp .bun-cache/${platform.bunTarget}-v${lib.getVersion bun} $out/bun-target/ 2>/dev/null || true
      find $out/node_modules -type l -lname '../../../packages/*' -delete
      find $out/node_modules -type l -lname '../../packages/*' -delete
      find $out/node_modules -type l -lname '../packages/*' -delete
      rm -rf $out/node_modules/.bin
    '';
  };

  mkWorkspaceLinks = lib.concatMapStringsSep "\n" (
    name:
    let
      dir = workspacePackages.${name};
    in
    ''
      mkdir -p "node_modules/$(dirname ${lib.escapeShellArg name})"
      ln -sf "../../${dir}" "node_modules/${name}"
    ''
  ) (builtins.attrNames workspacePackages);
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
    bun
    rustc
    cargo
    rustPlatform.cargoSetupHook
    pkg-config
    jq
    zig
  ];

  buildInputs = lib.optionals stdenv.hostPlatform.isLinux [
    stdenv.cc.cc.lib
    zlib
  ];

  env = {
    RUSTC_BOOTSTRAP = 1;
    ${rustTargetEnv} = glimmerRustFlags;
    CFLAGS = "-O2";
  };

  dontStrip = true;

  postPatch = ''
    cat > packages/stats/src/embedded-client.generated.txt <<'PLACEHOLDER'
    export const EMBEDDED_CLIENT_ARCHIVE_TAR_GZ_BASE64 = "";
    PLACEHOLDER

    cat > packages/coding-agent/src/export/html/tool-views.generated.js <<'PLACEHOLDER2'
    export default "";
    PLACEHOLDER2

    sed -i '/^async function formatInPlace/,/^}$/{
      /^async function formatInPlace/!d
      s/.*/async function formatInPlace(_targets: readonly string[]): Promise<void> { }/
    }' packages/coding-agent/scripts/generate-legacy-pi-bundled-registry.ts
  '';

  buildPhase = ''
    runHook preBuild

    ${lib.optionalString stdenv.hostPlatform.isLinux ''
      export LD_LIBRARY_PATH="${lib.makeLibraryPath [ stdenv.cc.cc.lib ]}"
    ''}

    export LIBCLANG_PATH="${libclang.lib}/lib"

    # Provide pre-downloaded baseline bun runtime for --target
    export BUN_INSTALL_CACHE_DIR=$PWD/.bun-targets
    mkdir -p "$BUN_INSTALL_CACHE_DIR"
    cp ${nodeModules}/bun-target/* "$BUN_INSTALL_CACHE_DIR/" 2>/dev/null || true

    # Merge node_modules
    mkdir -p node_modules
    for item in ${nodeModules}/node_modules/*; do
      name=$(basename "$item")
      if [ "$name" = "@oh-my-pi" ]; then
        mkdir -p "node_modules/@oh-my-pi"
        for sub in "$item"/*; do
          subname=$(basename "$sub")
          ln -sf "$sub" "node_modules/@oh-my-pi/$subname"
        done
      else
        ln -sf "$item" "node_modules/$name"
      fi
    done
  '' + mkWorkspaceLinks + ''

    echo "Building Rust native addon..."
    cargo build --release -p pi-natives --target ${rustTarget} --target-dir target

    mkdir -p packages/natives/native
    cp target/${rustTarget}/release/${platform.nativeLib} \
       packages/natives/native/pi_natives.${platform.nodeTag}.node

    if [ -f packages/natives/scripts/gen-enums.ts ] && \
       [ -f packages/natives/native/index.d.ts ]; then
      ${bun}/bin/bun packages/natives/scripts/gen-enums.ts || true
    fi

    echo "Generating docs, stats, tool views..."
    ${bun}/bin/bun --cwd=packages/stats run gen:stats
    ${bun}/bin/bun --cwd=packages/coding-agent run gen:docs
    ${bun}/bin/bun --cwd=packages/collab-web run gen:tool-views
    ${bun}/bin/bun --cwd=packages/natives run gen:native
    ${bun}/bin/bun --cwd=packages/coding-agent run gen:mupdf
    ${bun}/bin/bun packages/coding-agent/scripts/generate-legacy-pi-bundled-registry.ts --generate

    echo "Compiling self-contained binary..."
    ${bun}/bin/bun build \
      --compile \
      --no-compile-autoload-bunfig \
      --no-compile-autoload-dotenv \
      --no-compile-autoload-tsconfig \
      --no-compile-autoload-package-json \
      --target ${platform.bunTarget} \
      --keep-names \
      --define 'process.env.PI_COMPILED="true"' \
      --external fastembed \
      --external onnxruntime-node \
      --root . \
      ./packages/coding-agent/src/cli.ts \
      --outfile dist/omp

    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall

    mkdir -p $out/bin
    cp dist/omp $out/bin/omp

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
