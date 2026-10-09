"""源码分发 API：供局域网主机通过 cmd 下载部署包与版本信息"""
import io
import os
import zipfile
from urllib.parse import quote

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import Response

router = APIRouter(prefix="/api/source", tags=["源码分发"])

# 项目根目录：容器内由 compose 只读挂载到 /app/source；本地开发取脚本上级目录
SOURCE_ROOT = os.getenv(
    "MHC_SOURCE_DIR",
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))),
)

# 打包时排除的敏感/运行时文件
EXCLUDE_DIR_NAMES = {
    ".git", ".agents", ".codex", "node_modules", ".next", ".idea", "build", "dist",
    "mhc-data", "logs", "__pycache__", ".venv", "venv", "visualizations",
    "_chk", "模型健康监控",
}
EXCLUDE_FILE_NAMES = {
    ".env", "sessions.json", ".usage-cost-cache.json", "cookie.txt",
}
EXCLUDE_FILE_SUFFIXES = (".db", ".pyc", ".pyo", ".log", ".zip")


def _read_version() -> str:
    try:
        with open(os.path.join(SOURCE_ROOT, "version.txt"), "r", encoding="utf-8") as f:
            lines = [ln.strip() for ln in f if ln.strip()]
        return lines[0] if lines else "0.0.0"
    except Exception:
        return "0.0.0"


def _read_version_date() -> str:
    try:
        with open(os.path.join(SOURCE_ROOT, "version.txt"), "r", encoding="utf-8") as f:
            lines = [ln.strip() for ln in f if ln.strip()]
        return lines[1] if len(lines) > 1 else ""
    except Exception:
        return ""


def _should_skip(rel: str) -> bool:
    parts = rel.replace("\\", "/").split("/")
    if any(p in EXCLUDE_DIR_NAMES for p in parts[:-1]):
        return True
    name = parts[-1]
    if name in EXCLUDE_FILE_NAMES:
        return True
    if name.lower().endswith(EXCLUDE_FILE_SUFFIXES):
        return True
    return False


def _read_text_tolerant(path: str) -> str:
    """按 UTF-8(BOM) → GB18030 依次尝试解码，仍失败则替换非法字节"""
    with open(path, "rb") as f:
        raw = f.read()
    for enc in ("utf-8-sig", "gb18030"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", errors="replace")


def _add_dir(zf: zipfile.ZipFile, root: str, zip_prefix: str, allowed_subdirs: set[str] | None = None):
    """把 root 下文件加入 zip（zip_prefix 为 zip 内前缀路径）"""
    for cur, dirs, files in os.walk(root):
        dirs[:] = [d for d in dirs if d not in EXCLUDE_DIR_NAMES]
        for fn in files:
            abs_path = os.path.join(cur, fn)
            rel = os.path.relpath(abs_path, root)
            if allowed_subdirs and not any(rel.startswith(s + os.sep) or rel == s for s in allowed_subdirs):
                continue
            if _should_skip(rel):
                continue
            arc = os.path.join(zip_prefix, rel)
            if fn.lower().endswith(".ps1"):
                # .ps1 统一补 UTF-8 BOM：PowerShell 5.1 读无 BOM 中文脚本会按 ANSI 解码导致解析失败
                zf.writestr(arc, _read_text_tolerant(abs_path).encode("utf-8-sig"))
            else:
                zf.write(abs_path, arc)


def _build_zip(target: str, server_base: str = "") -> bytes:
    if not os.path.isdir(SOURCE_ROOT):
        raise HTTPException(status_code=500, detail=f"源码目录不存在: {SOURCE_ROOT}")

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        if target == "tray":
            # 分发最小集：托盘工具 + 用量脚本 + 版本 + 说明书
            tray_root = os.path.join(SOURCE_ROOT, "openclaw-sync-tray")
            if not os.path.isdir(tray_root):
                raise HTTPException(status_code=500, detail="openclaw-sync-tray 目录不存在")
            _add_dir(zf, tray_root, "模型健康监控/openclaw-sync-tray")
            for name in ("openclaw_usage_stats.py", "version.txt", "使用说明书.md", "CHANGELOG.md", "mhc-install.ps1"):
                p = os.path.join(SOURCE_ROOT, name)
                if not os.path.isfile(p):
                    continue
                if name == "mhc-install.ps1" and server_base:
                    # 注入实际服务器地址（以 utf-8-sig 写出保留 BOM，PS 5.1 才能正确解析）
                    content = _read_text_tolerant(p).replace("__MHC_SERVER__", server_base)
                    zf.writestr(f"模型健康监控/{name}", content.encode("utf-8-sig"))
                else:
                    zf.write(p, f"模型健康监控/{name}")
        else:
            # 完整项目源码（排除敏感/运行时文件）
            _add_dir(zf, SOURCE_ROOT, "模型健康监控")
    return buf.getvalue()


@router.get("/version")
def get_source_version():
    """获取当前版本（供托盘自动更新对比）"""
    return {
        "version": _read_version(),
        "date": _read_version_date(),
        "name": "模型健康监控中心",
    }


@router.get("/download")
def download_source(request: Request, target: str = "tray"):
    """下载部署包
    - target=tray: 同步托盘工具 + 用量脚本 + 使用说明书（默认，供其他电脑部署）
    - target=full: 完整项目源码（排除 .env / 数据库 / 依赖 / 日志等）
    """
    if target not in ("tray", "full"):
        raise HTTPException(status_code=400, detail="target 仅支持 tray 或 full")
    data = _build_zip(target, str(request.base_url).rstrip("/"))
    filename = f"模型健康监控_{target}.zip"
    # Content-Disposition 使用 ASCII 兜底 + RFC5987 中文文件名（header 必须 latin-1 可编码）
    disposition = f"attachment; filename=\"mhc-{target}.zip\"; filename*=UTF-8''{quote(filename)}"
    return Response(
        content=data,
        media_type="application/zip",
        headers={"Content-Disposition": disposition},
    )


@router.get("/mhc-install")
def get_mhc_install(request: Request):
    """返回一键安装脚本（mhc-install.ps1），虚拟机下载后可直接执行：mhc-install 你的机器名"""
    script_path = os.path.join(SOURCE_ROOT, "mhc-install.ps1")
    if not os.path.isfile(script_path):
        raise HTTPException(status_code=404, detail="mhc-install.ps1 不存在")
    with open(script_path, "r", encoding="utf-8") as f:
        content = f.read()
    # 把默认监控中心替换为当前请求的服务器地址，使脚本按从哪里下载就安装到哪台监控中心
    base = str(request.base_url).rstrip("/")
    content = content.replace("__MHC_SERVER__", base)
    return Response(
        content=content,
        media_type="text/plain; charset=utf-8",
        headers={"Content-Disposition": "attachment; filename=\"mhc-install.ps1\""},
    )
