{
  description = "KToolBox - Packaged with uv2nix";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";

    pyproject-nix = {
      url = "github:pyproject-nix/pyproject.nix";
      inputs.nixpkgs.follows = "nixpkgs";
    };

    uv2nix = {
      url = "github:pyproject-nix/uv2nix";
      inputs.pyproject-nix.follows = "pyproject-nix";
      inputs.nixpkgs.follows = "nixpkgs";
    };

    pyproject-build-systems = {
      url = "github:pyproject-nix/build-system-pkgs";
      inputs.pyproject-nix.follows = "pyproject-nix";
      inputs.uv2nix.follows = "uv2nix";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs = { self, nixpkgs, flake-utils, uv2nix, pyproject-nix, pyproject-build-systems, ... }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs { inherit system; };

        python = pkgs.python311;

        workspace = uv2nix.lib.workspace.loadWorkspace { workspaceRoot = ./.; };

        uvLockedOverlay = workspace.mkPyprojectOverlay {
          sourcePreference = "wheel";
        };

        pythonSet = (pkgs.callPackage pyproject-nix.build.packages {
          inherit python;
        }).overrideScope (
          pkgs.lib.composeManyExtensions [
            pyproject-build-systems.overlays.default
            uvLockedOverlay
          ]
        );

        # 1. Define the runtime application environment
        # Here we tell mkVirtualEnv to build our local 'ktoolbox' package WITH its extras
        ktoolboxApp = pythonSet.mkVirtualEnv "ktoolbox-app" {
          "ktoolbox" = [ "webui" "urwid" ];
        };

        # 2. Define the development environment
        # We merge all dependency groups (dev, test, docs) with the app itself
        devEnv = pythonSet.mkVirtualEnv "ktoolbox-dev-env" (
          workspace.deps.all // { "ktoolbox" = [ "webui" "urwid" ]; }
        );
      in
      {
        devShells.default = pkgs.mkShell {
          packages = [
            devEnv
            pkgs.uv
          ];
        };

        # Expose the fully built virtual environment as the default package.
        # It automatically includes the `ktoolbox` binary in its /bin/ folder!
        packages.default = ktoolboxApp;

        apps.default = {
          type = "app";
          program = "${ktoolboxApp}/bin/ktoolbox";
        };
      }
    );
}