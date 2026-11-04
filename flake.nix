{
  description = "KToolBox - packaged with uv2nix";

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
      uv2nix,
      pyproject-nix,
      pyproject-build-systems,
      ...
    }:
    let
      inherit (nixpkgs) lib;

      workspace = uv2nix.lib.workspace.loadWorkspace {
        workspaceRoot = self;
      };

      pyprojectToml = lib.importTOML (self + "/pyproject.toml");

      # Combine requirements from uv.lock and pyproject.toml
      effectiveRequiresPython =
        workspace.requires-python
        ++ lib.optionals (pyprojectToml ? project.requires-python) (
          pyproject-nix.lib.pep440.parseVersionConds pyprojectToml.project.requires-python
        );

      # Pyproject overlay for wheel builds
      uvLockedOverlay = workspace.mkPyprojectOverlay {
        sourcePreference = "wheel";
      };
    in
    flake-utils.lib.eachDefaultSystem (
      system:
      let
        pkgs = nixpkgs.legacyPackages.${system};

        # Dynamically select matching Python interpreter from nixpkgs
        matchingInterpreters = pyproject-nix.lib.util.filterPythonInterpreters {
          requires-python = effectiveRequiresPython;
          inherit (pkgs) pythonInterpreters;
        };
        python = lib.head matchingInterpreters;

        # Base Python package set
        pythonSet =
          (pkgs.callPackage pyproject-nix.build.packages {
            inherit python;
          }).overrideScope
            (lib.composeManyExtensions [
              pyproject-build-systems.overlays.default
              uvLockedOverlay
            ]);

        # Development environment with editable overlay support
        editablePythonSet = pythonSet.overrideScope (
          lib.composeManyExtensions [
            (workspace.mkEditablePyprojectOverlay {
              root = "$REPO_ROOT";
            })
          ]
        );

        ktoolboxDevEnv = editablePythonSet.mkVirtualEnv "ktoolbox-dev-env" (
          workspace.deps.all
          // {
            ktoolbox = [ "webui" "urwid" ];
          }
        );

        ktoolboxPackage = lib.pipe (pythonSet.mkVirtualEnv "ktoolbox-app" {
          ktoolbox = [ "webui" "urwid" ];
        }) [
          (env: lib.addMetaAttrs { mainProgram = "ktoolbox"; } env)
        ];
      in
      {
        packages = {
          ktoolbox = ktoolboxPackage;
          default = self.packages.${system}.ktoolbox;
        };

        apps = {
          ktoolbox = {
            type = "app";
            program = "${self.packages.${system}.ktoolbox}/bin/ktoolbox";
          };
          default = self.apps.${system}.ktoolbox;
        };

        devShells = {
          ktoolbox = pkgs.mkShell {
            packages = [
              ktoolboxDevEnv
              pkgs.uv
            ];

            env = {
              UV_NO_SYNC = "1";
              UV_PYTHON = python.interpreter;
              UV_PYTHON_DOWNLOADS = "never";
            };

            shellHook = ''
              export REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
              unset PYTHONPATH
            '';
          };
          default = self.devShells.${system}.ktoolbox;
        };
      }
    )
    // {
      overlays.default = final: prev: {
        ktoolbox = self.packages.${final.stdenv.hostPlatform.system}.default;
      };
    };
}
