{
  description = "KToolBox — CLI tool for downloading posts from Kemono";

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

  outputs =
    {
      self,
      nixpkgs,
      flake-utils,
      pyproject-nix,
      uv2nix,
      pyproject-build-systems,
    }:
    flake-utils.lib.eachDefaultSystem (
      system:
      let
        pkgs = nixpkgs.legacyPackages.${system};
        python = pkgs.python312;

        workspace = uv2nix.lib.workspace.loadWorkspace { workspaceRoot = ./.; };

        overlay = workspace.mkPyprojectOverlay {
          sourcePreference = "wheel";
        };

        pythonSet =
          (pkgs.callPackage pyproject-nix.build.packages { inherit python; }).overrideScope
            (
              pkgs.lib.composeManyExtensions [
                pyproject-build-systems.overlays.default
                overlay
              ]
            );

        # Runtime package (no dev/test extras)
        ktoolbox = pythonSet.mkVirtualEnv "ktoolbox-env" workspace.deps.default;

        # Dev environment with test + dev groups
        devEnv = pythonSet.mkVirtualEnv "ktoolbox-dev-env" (
          workspace.deps.default
          // {
            ktoolbox = [ ];
          }
          // workspace.deps.groups.test or { }
          // workspace.deps.groups.dev or { }
        );
      in
      {
        packages = {
          default = ktoolbox;
          ktoolbox = ktoolbox;
        };

        apps.default = {
          type = "app";
          program = "${ktoolbox}/bin/ktoolbox";
        };

        devShells = {
          default = pkgs.mkShell {
            packages = [
              devEnv
              pkgs.uv
            ];

            env = {
              # Prevent uv from trying to manage Python itself
              UV_PYTHON_DOWNLOADS = "never";
              UV_PYTHON = python.interpreter;
            };

            shellHook = ''
              unset PYTHONPATH
            '';
          };

          # Impure shell: uv manages its own venv, Nix only provides uv + Python
          impure = pkgs.mkShell {
            packages = [
              python
              pkgs.uv
            ];

            env = {
              UV_PYTHON_DOWNLOADS = "never";
            };
          };
        };
      }
    );
}
