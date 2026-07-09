{
  description = "omp — Bun + Rust coding agent (John2143 fork)";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs =
    {
      self,
      nixpkgs,
      flake-utils,
    }:
    flake-utils.lib.eachSystem
      [
        "x86_64-linux"
        "aarch64-linux"
        "x86_64-darwin"
        "aarch64-darwin"
      ]
      (
        system:
        let
          pkgs = import nixpkgs { inherit system; };

          # Platform-specific bun binary name for GitHub releases
          bunBinaryName = {
            x86_64-linux = "bun-linux-x64";
            aarch64-linux = "bun-linux-aarch64";
            x86_64-darwin = "bun-darwin-x64";
            aarch64-darwin = "bun-darwin-aarch64";
          }.${system} or (throw "Unsupported platform for bun: ${system}");

          bun_1_3_14 = pkgs.stdenv.mkDerivation {
            pname = "bun";
            version = "1.3.14";
            src = pkgs.fetchurl {
              url = "https://github.com/oven-sh/bun/releases/download/bun-v1.3.14/${bunBinaryName}.zip";
              hash = "sha256-lR7iruhV8IWVruxiJSJqKY0/6oOj3NZGXAnLzN9+hI8=";
            };
            nativeBuildInputs = [ pkgs.unzip pkgs.autoPatchelfHook ];
            buildInputs = with pkgs; [ openssl zlib ];
            installPhase = ''
              runHook preInstall
              mkdir -p $out/bin
              cp bun $out/bin/bun
              ln -sf $out/bin/bun $out/bin/bunx
              runHook postInstall
            '';
            meta = with pkgs.lib; {
              description = "Incredibly fast JavaScript runtime, bundler, test runner, and package manager";
              homepage = "https://bun.sh";
              license = licenses.mit;
              mainProgram = "bun";
              platforms = [ "x86_64-linux" "aarch64-linux" "x86_64-darwin" "aarch64-darwin" ];
            };
          };

          omp = pkgs.callPackage ./nix/omp.nix {
            bun = bun_1_3_14;
            src = pkgs.lib.cleanSource ./.;
          };
        in
        {
          packages.omp = omp;
          packages.default = omp;
        }
      );
}
