from __future__ import annotations

import warnings

import pytest

from ktoolbox.configuration import config


def test_editor_reads_proxy_root_fields_without_attribute_error() -> None:
    pytest.importorskip("urwid")
    from ktoolbox.editor import model_to_widgets

    with warnings.catch_warnings():
        warnings.filterwarnings(
            "ignore",
            message="Don't use user_arg argument, use user_args instead.",
            category=DeprecationWarning,
        )
        widgets = list(model_to_widgets(config, ["ssl_verify"]))
    assert widgets
