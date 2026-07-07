{
  description = "omp — Bun + Rust coding agent (John2143 fork)";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    flake-utils.url = "github:numtide/flake-utils";
    bun2nix = {
      url = "github:nix-community/bun2nix/staging-2.1.0";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs =
    {
      self,
      nixpkgs,
      flake-utils,
      bun2nix,
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
          pkgs = (import nixpkgs { inherit system; }).extend bun2nix.overlays.default;
          omp = pkgs.callPackage ./nix/omp.nix {
            inherit (pkgs) bun2nix;
            src = pkgs.lib.cleanSource ./.;
          };
        in
        {
          packages.omp = omp;
          packages.default = omp;
        }
      );
}
