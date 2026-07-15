from __future__ import annotations

import inspect
import json
import re
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple, get_args, get_origin

from pydantic import BaseModel, ValidationError

from ktoolbox import _configuration_zh
from ktoolbox.configuration import (
    APIConfiguration,
    Configuration,
    DownloaderConfiguration,
    JobConfiguration,
    LoggerConfiguration,
    PostStructureConfiguration,
    config,
)

__all__ = ["ConfigValidationError", "build_config_schema", "save_config_values"]


class ConfigValidationError(ValueError):
    def __init__(self, errors: List[Dict[str, Any]]):
        super().__init__("Invalid configuration")
        self.errors = errors


_IVAR_RE = re.compile(r":ivar\s+(\w+):\s*(.*?)(?=\n\s*:ivar\s+\w+:|\Z)", re.S)
_ZH_MODEL_BY_ENGLISH_MODEL = {
    Configuration: _configuration_zh.Configuration,
    APIConfiguration: _configuration_zh.APIConfiguration,
    DownloaderConfiguration: _configuration_zh.DownloaderConfiguration,
    PostStructureConfiguration: _configuration_zh.PostStructureConfiguration,
    JobConfiguration: _configuration_zh.JobConfiguration,
    LoggerConfiguration: _configuration_zh.LoggerConfiguration,
}


def _is_model_type(value: Any) -> bool:
    return isinstance(value, type) and issubclass(value, BaseModel)


def _doc_map(model_type: type, language: str) -> Dict[str, str]:
    doc_type = _ZH_MODEL_BY_ENGLISH_MODEL.get(model_type, model_type) if language == "zh" else model_type
    doc = inspect.getdoc(doc_type) or ""
    return {
        match.group(1): " ".join(match.group(2).split())
        for match in _IVAR_RE.finditer(doc)
    }


def _serialize(value: Any) -> Any:
    if isinstance(value, Path):
        return str(value)
    if isinstance(value, set):
        return sorted(_serialize(item) for item in value)
    if isinstance(value, tuple):
        return [_serialize(item) for item in value]
    if isinstance(value, list):
        return [_serialize(item) for item in value]
    if isinstance(value, dict):
        return {str(key): _serialize(item) for key, item in value.items()}
    return value


def _type_label(annotation: Any) -> str:
    origin = get_origin(annotation)
    args = get_args(annotation)
    if origin is None:
        return getattr(annotation, "__name__", str(annotation).replace("typing.", ""))
    if origin in (list, List, set, tuple):
        return "array"
    if str(origin) == "typing.Literal":
        return "choice"
    if any(arg is type(None) for arg in args):
        non_null = [arg for arg in args if arg is not type(None)]
        if len(non_null) == 1:
            return "optional[" + _type_label(non_null[0]) + "]"
    return str(annotation).replace("typing.", "")


def _choices(annotation: Any) -> Optional[List[Any]]:
    if str(get_origin(annotation)) == "typing.Literal":
        return list(get_args(annotation))
    return None


def _iter_fields(
        model: BaseModel,
        model_type: type,
        default_model: BaseModel,
        prefix: str = "",
        group: str = "",
        language: str = "zh"
) -> List[Dict[str, Any]]:
    fields = []
    docs = _doc_map(model_type, language)
    for field_name, field_info in model_type.model_fields.items():
        if field_name == "model_config":
            continue

        path = f"{prefix}.{field_name}" if prefix else field_name
        env_name = "KTOOLBOX_" + path.upper().replace(".", "__")
        value = getattr(model, field_name)
        default_value = getattr(default_model, field_name)
        annotation = field_info.annotation

        if _is_model_type(annotation):
            fields.extend(
                _iter_fields(
                    value,
                    annotation,
                    default_value,
                    prefix=path,
                    group=field_name if not group else group,
                    language=language,
                )
            )
            continue

        fields.append({
            "path": path,
            "env": env_name,
            "group": group or "general",
            "name": field_name,
            "type": _type_label(annotation),
            "choices": _choices(annotation),
            "description": docs.get(field_name, ""),
            "value": _serialize(value),
            "default": _serialize(default_value),
        })
    return fields


def build_config_schema(language: str = "zh") -> Dict[str, Any]:
    default_config = Configuration(_env_file="")
    return {
        "envPath": str(_target_env_path()),
        "fields": _iter_fields(config, Configuration, default_config, language=language),
    }


def _target_env_path() -> Path:
    prod_env = Path("prod.env")
    return prod_env if prod_env.is_file() else Path(".env")


def _set_path(data: Dict[str, Any], path: str, value: Any) -> None:
    target = data
    parts = path.split(".")
    for part in parts[:-1]:
        target = target.setdefault(part, {})
    target[parts[-1]] = value


def _apply_config(new_config: Configuration) -> None:
    for field_name in Configuration.model_fields:
        if field_name != "model_config":
            setattr(config, field_name, getattr(new_config, field_name))


def _dotenv_value(value: Any) -> str:
    value = _serialize(value)
    if isinstance(value, (list, dict)):
        return json.dumps(value, ensure_ascii=False)
    if isinstance(value, bool):
        return "True" if value else "False"
    if value is None:
        return ""
    text = str(value)
    if text == "" or any(char in text for char in (" ", "#", "\t", "\n", "\"", "'")):
        return json.dumps(text, ensure_ascii=False)
    return text


def _iter_env_values(model: BaseModel, default_model: BaseModel, prefix: str = "") -> List[Tuple[str, str]]:
    values = []
    for field_name in model.model_fields:
        if field_name == "model_config":
            continue
        current_value = getattr(model, field_name)
        default_value = getattr(default_model, field_name)
        path = f"{prefix}__{field_name.upper()}" if prefix else field_name.upper()
        if isinstance(current_value, BaseModel):
            values.extend(_iter_env_values(current_value, default_value, path))
            continue
        if _serialize(current_value) != _serialize(default_value):
            values.append(("KTOOLBOX_" + path, _dotenv_value(current_value)))
    return values


def _write_env_file(new_config: Configuration) -> Path:
    target = _target_env_path()
    default_config = Configuration(_env_file="")
    lines = [
        f"{key}={value}"
        for key, value in sorted(_iter_env_values(new_config, default_config))
    ]
    target.write_text("\n".join(lines) + ("\n" if lines else ""), encoding="utf-8")
    return target


def save_config_values(values: Dict[str, Any], language: str = "zh") -> Dict[str, Any]:
    data = config.model_dump(mode="python")
    for path, value in values.items():
        _set_path(data, path, value)

    try:
        new_config = Configuration(_env_file="", **data)
    except ValidationError as exc:
        raise ConfigValidationError(exc.errors()) from exc

    env_path = _write_env_file(new_config)
    _apply_config(new_config)
    schema = build_config_schema(language=language)
    schema["envPath"] = str(env_path)
    return schema
