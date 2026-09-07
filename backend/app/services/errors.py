"""域错误 → HTTP 的唯一一种形状。

`detail` 默认就是给人看的那句中文；**只有调用方需要据此分支的错误**才额外带 `code`，
此时 detail 升成 `{"code": ..., "message": ...}`。不带 code 的一律保持字符串——
这样加一个机器码不会把既有 267 条断言文案的测试全冲掉，也不影响别的消费者。

为什么要有这个文件：2026-09-07 之前，「是不是写冲突」「是不是没设导出目录」这两个判断
在前端靠正则匹配中文散文（`/已被|409/`、`includes("还没有设置导出目录")`），
后端改一个字就静默改掉前端行为。规则：需要分支的事实走 code，人看的走 message。
"""
from typing import Any


def http_kwargs(cause: Any) -> dict[str, Any]:
    """把一个带 status_code / detail（可选 code）的域错误换成 HTTPException 的参数。"""
    detail = getattr(cause, "detail", "")
    code = getattr(cause, "code", None)
    return {
        "status_code": cause.status_code,
        "detail": {"code": code, "message": detail} if code else detail,
    }
