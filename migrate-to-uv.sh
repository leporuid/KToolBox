#!/usr/bin/env bash
set -euo pipefail

cat > pyproject.toml <<'EOF'
[build-system]
requires = ["hatchling>=1.24"]
build-backend = "hatchling.build"

[project]
name = "ktoolbox"
version = "0.24.0"
description = "A useful CLI tool for downloading posts in Kemono.cr / .su / .party"
readme = "README.md"
requires-python = ">=3.8.1,<=3.14"
license = { text = "BSD-3-Clause" }
authors = [
  { name = "Ljzd-PRO", email = "me@ljzd.link" }
]
keywords = ["kemono", "kemono.cr", "kemono.su", "kemono.party", "cli-app", "downloader", "os-independent"]
classifiers = [
  "Programming Language :: Python :: 3",
  "License :: OSI Approved :: BSD License",
  "Operating System :: OS Independent",
  "Development Status :: 5 - Production/Stable",
  "Topic :: Terminals",
]
dependencies = [
  "pydantic>=2.4.2",
  "pydantic-settings>=2.0.3",
  "tenacity>=8.2.3,<10.0.0",
  "httpx[socks]>=0.24.1,<0.29.0",
  "fire>=0.5,<0.8",
  "tqdm>=4.66.1",
  "loguru>=0.7.2",
  "aiofiles>=23.2.1",
  "pathvalidate>=3.2.0",
  "settings-doc>=4.3.1",
  "rich>=14.1.0",
]

[project.optional-dependencies]
uvloop = ["uvloop>=0.19,<0.22; platform_system != 'Windows'"]
winloop = ["winloop>=0.1.6; platform_system == 'Windows'"]
urwid = [
  "urwid>=2.6.16; platform_system != 'Windows'",
  "urwid[curses]>=2.6.16; platform_system == 'Windows'",
]

[project.urls]
Homepage = "https://ktoolbox.readthedocs.io/"
Repository = "https://github.com/Ljzd-PRO/KToolBox"
Documentation = "https://ktoolbox.readthedocs.io/"
"Bug Tracker" = "https://github.com/Ljzd-PRO/KToolBox/issues"

[project.scripts]
ktoolbox = "ktoolbox.__main__:main"

[dependency-groups]
dev = [
  "datamodel-code-generator>=0.22.1,<0.24.0",
]

test = [
  "pytest==8.3.3",
  "pytest-asyncio==0.23.5",
  "pytest-cov==4.1.0",
  "allpairspy==2.5.1",
]

docs = [
  "mkdocs>=1.5.3",
  "mkdocs-static-i18n>=1.2.0",
  "mkdocs-material>=9.4.14",
  "mkdocstrings[python]>=0.24,<0.27",
  "mike>=2.0.0",
]

pyinstaller = [
  "pyinstaller==6.15.0",
]
EOF

python - <<'PY'
from pathlib import Path

replacements = {
    "README.md": [
        ('pip3 install pipx\n  \n  # Windows\n  pipx install "ktoolbox[urwid,winloop]"\n  # Linux / macOS\n  pipx install "ktoolbox[urwid,uvloop]"',
         'uv tool install ktoolbox\n  \n- From a checkout\n  ```bash\n  uv sync\n  uv run ktoolbox --help\n  ```\n\n- With optional extras\n  ```bash\n  uv tool install "ktoolbox[urwid,uvloop]"\n  # Windows\n  uv tool install "ktoolbox[urwid,winloop]"'),
        ('pip3 install ktoolbox-pure-py', 'uv tool install ktoolbox-pure-py'),
    ],
    "README_zh-CN.md": [
        ('pip3 install pipx\n  \n  # Windows\n  pipx install ktoolbox[urwid,winloop]\n  # Linux / macOS\n  pipx install ktoolbox[urwid,uvloop]',
         'uv tool install ktoolbox\n  \n- 从源码仓库安装\n  ```bash\n  uv sync\n  uv run ktoolbox --help\n  ```\n\n- 带可选依赖\n  ```bash\n  uv tool install "ktoolbox[urwid,uvloop]"\n  # Windows\n  uv tool install "ktoolbox[urwid,winloop]"'),
        ('pip3 install ktoolbox-pure-py', 'uv tool install ktoolbox-pure-py'),
    ],
    "docs/en/index.md": [
        ('    pip3 install pipx\n    # Windows\n    pipx install ktoolbox[urwid,winloop]\n    # Linux / macOS\n    pipx install ktoolbox[urwid,uvloop]',
         '    uv tool install "ktoolbox[urwid,winloop]"\n    # Linux / macOS\n    uv tool install "ktoolbox[urwid,uvloop]"'),
        ('    pip3 install pipx\n    pipx install ktoolbox-pure-py', '    uv tool install ktoolbox-pure-py'),
        ('    pip3 install ktoolbox-pure-py', '    uv tool install ktoolbox-pure-py'),
    ],
    "docs/zh/index.md": [
        ('   pip3 install pipx\n   # Windows\n   pipx install ktoolbox[urwid,winloop]\n   # Linux / macOS\n   pipx install ktoolbox[urwid,uvloop]',
         '   uv tool install "ktoolbox[urwid,winloop]"\n   # Linux / macOS\n   uv tool install "ktoolbox[urwid,uvloop]"'),
        ('   pip3 install pipx\n   pipx install ktoolbox-pure-py', '   uv tool install ktoolbox-pure-py'),
        ('    pip3 install ktoolbox-pure-py', '    uv tool install ktoolbox-pure-py'),
    ],
    "docs/en/faq.md": [
        ('pip install ktoolbox[winloop]', 'uv tool install "ktoolbox[winloop]"'),
        ('pip install ktoolbox[uvloop]', 'uv tool install "ktoolbox[uvloop]"'),
        ('pip3 install pipx\npipx install ktoolbox[urwid] --force', 'uv tool install "ktoolbox[urwid]"'),
    ],
}

for file_name, reps in replacements.items():
    p = Path(file_name)
    s = p.read_text()
    for old, new in reps:
        s = s.replace(old, new)
    p.write_text(s)

p = Path("docs/zh/more.md")
s = p.read_text()
if "## 安装" not in s:
    s += "\n\n## 安装\n\n```bash\nuv tool install ktoolbox\n```\n\n```bash\nuv tool install \"ktoolbox[urwid,uvloop]\"\n```\n"
p.write_text(s)
PY

uv lock
EOF
