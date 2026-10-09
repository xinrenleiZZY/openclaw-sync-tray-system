# ===== 下载云文档 API =====

@app.get("/api/monitor/download")
def download_wiki_document():
    """调用 download_wiki.py 下载云文档并返回 xlsx 文件"""
    WIKI_NODE_TOKEN = os.getenv("WIKI_NODE_TOKEN", "")
    script_path = os.path.join(PROJECT_DIR, "download_wiki.py")

    if not os.path.exists(script_path):
        raise HTTPException(status_code=404, detail="download_wiki.py 未找到")

    try:
        result = subprocess.run(
            [sys.executable, script_path, WIKI_NODE_TOKEN],
            capture_output=True, text=True, cwd=PROJECT_DIR, timeout=120,
        )
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=504, detail="下载超时（120秒）")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"执行脚本失败: {e}")

    # 解析输出，找到生成的 xlsx 文件路径（优先找"重命名"后的路径）
    output = result.stdout
    xlsx_path = None
    for line in output.split("\n"):
        if "重命名" in line and ".xlsx" in line:
            import re as _re
            m = _re.search(r"→ (.+\.xlsx)", line)
            if m:
                xlsx_path = m.group(1).strip()
                if not os.path.isabs(xlsx_path):
                    xlsx_path = os.path.join(PROJECT_DIR, xlsx_path)
                break
    # 回退：尝试从"已下载"行提取
    if not xlsx_path:
        for line in output.split("\n"):
            if "已下载" in line and ".xlsx" in line:
                import re as _re
                m = _re.search(r"→ (.+\.xlsx)", line)
                if m:
                    xlsx_path = m.group(1).strip()
                    if not os.path.isabs(xlsx_path):
                        xlsx_path = os.path.join(PROJECT_DIR, xlsx_path)
                    break

    if not xlsx_path or not os.path.exists(xlsx_path):
        # 尝试在 PROJECT_DIR 下找生成的目录
        try:
            for root, dirs, files in os.walk(PROJECT_DIR):
                for f in files:
                    if f.endswith(".xlsx"):
                        xlsx_path = os.path.join(root, f)
                        break
                if xlsx_path:
                    break
        except Exception:
            pass

    if not xlsx_path or not os.path.exists(xlsx_path):
        raise HTTPException(status_code=500, detail=f"未找到生成的 xlsx 文件\n脚本输出:\n{output}")

    return FileResponse(
        path=xlsx_path,
        filename=os.path.basename(xlsx_path),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )
