{
  description = "KToolBox - packaged with uv2nix";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

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
      uv2nix,
      pyproject-nix,
      pyproject-build-systems,
      ...
    }:
    let
      inherit (nixpkgs) lib;

      systems = [
        "x86_64-linux"
        "aarch64-linux"
        "x86_64-darwin"
        "aarch64-darwin"
      ];
      forAllSystems = lib.genAttrs systems;

      workspace = uv2nix.lib.workspace.loadWorkspace {
        workspaceRoot = ./.;
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

      perSystem = forAllSystems (
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
              (final: prev: {
                ktoolbox = prev.ktoolbox.overrideAttrs (old: {
                  nativeBuildInputs =
                    (old.nativeBuildInputs or [ ])
                    ++ final.resolveBuildSystem {
                      editables = [ ];
                    };
                });
              })
            ]
          );

          ktoolboxDevEnv = editablePythonSet.mkVirtualEnv "ktoolbox-dev-env" {
            ktoolbox = [
              "webui"
              "urwid"
              "uvloop"
              "dev"
              "test"
            ];
          };

          # Frontend bundle built hermetically via buildNpmPackage + importNpmLock
          ktoolboxWebui = pkgs.buildNpmPackage {
            pname = "ktoolbox-webui";
            version = pyprojectToml.project.version or "0.0.0";
            src = lib.fileset.toSource {
              root = ./webui;
              fileset = lib.fileset.unions [
                ./webui/index.html
                ./webui/package.json
                ./webui/package-lock.json
                ./webui/tsconfig.json
                ./webui/tsconfig.app.json
                ./webui/tsconfig.node.json
                ./webui/vite.config.ts
                ./webui/src
              ];
            };
            nodejs = pkgs.nodejs_24;
            npmDeps = pkgs.importNpmLock {
              npmRoot = ./webui;
            };
            npmConfigHook = pkgs.importNpmLock.npmConfigHook;
            npmFlags = [ "--ignore-scripts" ];
            env = {
              PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = "1";
              PUPPETEER_SKIP_DOWNLOAD = "true";
            };
            buildPhase = ''
              runHook preBuild
              npx tsc -b
              npx vite build --outDir build-dist
              runHook postBuild
            '';
            installPhase = ''
              runHook preInstall
              mkdir -p "$out"
              cp -r build-dist/* "$out/"
              runHook postInstall
            '';
          };

          # Inject freshly built Nix WebUI assets into the packaged uv2nix build
          packagedPythonSet = pythonSet.overrideScope (
            _final: prev: {
              ktoolbox = prev.ktoolbox.overrideAttrs (old: {
                postPatch = (old.postPatch or "") + ''
                  mkdir -p ktoolbox/webui
                  rm -rf ktoolbox/webui/static
                  cp -r ${ktoolboxWebui} ktoolbox/webui/static
                  chmod -R u+w ktoolbox/webui/static
                '';
              });
            }
          );

          ktoolboxPackage = lib.pipe (packagedPythonSet.mkVirtualEnv "ktoolbox-app" {
            ktoolbox = [ "webui" "urwid" ];
          }) [
            (env: lib.addMetaAttrs { mainProgram = "ktoolbox"; } env)
          ];
        in
        {
          packages = {
            ktoolbox = ktoolboxPackage;
            webui = ktoolboxWebui;
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
                pkgs.nodejs_24
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
      );
    in
    {
      packages = forAllSystems (system: perSystem.${system}.packages);
      apps = forAllSystems (system: perSystem.${system}.apps);
      devShells = forAllSystems (system: perSystem.${system}.devShells);
      overlays.default = final: _prev: {
        ktoolbox = self.packages.${final.stdenv.hostPlatform.system}.default;
      };
    };
}
