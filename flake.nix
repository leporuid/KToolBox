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
    flake-utils.lib.eachDefaultSystem (
      system:
      let
        pkgs = import nixpkgs {
          inherit system;
        };

        # Python 3.11 is within the project's supported range:
        # >=3.10,<3.15.
        python = pkgs.python311;

        workspace = uv2nix.lib.workspace.loadWorkspace {
          workspaceRoot = ./.;
        };

        uvLockedOverlay = workspace.mkPyprojectOverlay {
          # Prefer wheels where available. This keeps builds faster and
          # avoids unnecessary native compilation.
          sourcePreference = "wheel";
        };

        pythonSet =
          (pkgs.callPackage pyproject-nix.build.packages {
            inherit python;
          }).overrideScope
            (
              pkgs.lib.composeManyExtensions [
                pyproject-build-systems.overlays.default
                uvLockedOverlay
              ]
            );

        # Runtime environment:
        # - webui enables the WebUI dependencies
        # - urwid enables the terminal configuration editor
        ktoolboxApp = pythonSet.mkVirtualEnv "ktoolbox-app" {
          ktoolbox = [
            "webui"
            "urwid"
          ];
        };

        # Development environment:
        # workspace.deps.all includes all optional dependencies and all
        # dependency groups declared by the project.
        ktoolboxDevEnv = pythonSet.mkVirtualEnv "ktoolbox-dev-env" (
          workspace.deps.all
          // {
            ktoolbox = [
              "webui"
              "urwid"
            ];
          }
        );
      in
      {
        packages.default = ktoolboxApp;

        apps.default = {
          type = "app";
          program = "${ktoolboxApp}/bin/ktoolbox";
        };

        devShells.default = pkgs.mkShell {
          packages = [
            ktoolboxDevEnv
            pkgs.uv
          ];

          env = {
            # uv2nix owns the environment in this shell.
            UV_NO_SYNC = "1";

            # Use the Nix-provided interpreter rather than allowing uv to
            # download another Python interpreter.
            UV_PYTHON = python.interpreter;

            UV_PYTHON_DOWNLOADS = "never";
          };

          shellHook = ''
            # Avoid PYTHONPATH pollution from Nix Python builders.
            unset PYTHONPATH
          '';
        };
      }
    );
}