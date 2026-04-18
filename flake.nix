{
  description = "KToolBox packaged with uv2nix";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";

    pyproject-nix = {
      url = "github:pyproject-nix/pyproject.nix";
      inputs.nixpkgs.follows = "nixpkgs";
    };

    uv2nix = {
      url = "github:pyproject-nix/uv2nix";
      inputs.nixpkgs.follows = "nixpkgs";
      inputs.pyproject-nix.follows = "pyproject-nix";
    };
  };

  outputs = { self, nixpkgs, flake-utils, pyproject-nix, uv2nix, ... }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs { inherit system; };
        python = pkgs.python311;

        workspace = uv2nix.lib.workspace.loadWorkspace {
          workspaceRoot = ./.;
        };

        overlay = workspace.mkPyprojectOverlay {
          sourcePreference = "wheel";
        };

        editableOverlay = workspace.mkEditablePyprojectOverlay {
          root = ./.;
        };

        pythonSet = pkgs.callPackage pyproject-nix.build.packages {
          inherit python;
        };

        finalPythonSet = pythonSet.overrideScope' (pkgs.lib.composeManyExtensions [
          overlay
          editableOverlay
        ]);

        ktoolboxPkg = finalPythonSet.ktoolbox;

        ktoolboxApp = pkgs.writeShellApplication {
          name = "ktoolbox";
          runtimeInputs = [ ktoolboxPkg ];
          text = ''
            exec ${ktoolboxPkg}/bin/ktoolbox "$@"
          '';
        };
      in {
        packages = {
          default = ktoolboxPkg;
          ktoolbox = ktoolboxPkg;
          ktoolbox-app = ktoolboxApp;
        };

        apps = {
          default = flake-utils.lib.mkApp { drv = ktoolboxApp; };
          ktoolbox = flake-utils.lib.mkApp { drv = ktoolboxApp; };
        };

        devShells.default = pkgs.mkShell {
          packages = [
            pkgs.uv
            python
          ];
          inputsFrom = [ ktoolboxPkg ];
        };
      });
}
