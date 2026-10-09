"""
下载飞书 Wiki 节点内容到本地文件

支持类型：
  - docx  → 导出为 .txt
  - sheet → 导出为 .csv（每个工作表一个文件）
  - bitable → 导出为 .csv

用法:
    python download_wiki.py                        # 使用 .env 中的 WIKI_NODE_TOKEN
    python download_wiki.py <wiki_node_token>       # 指定 token
    python download_wiki.py <wiki_url>              # 指定完整 URL
"""

import os
import re
import sys
from datetime import datetime

from feishu_client import FeishuClient


def generate_output_filename(base_name: str = "单位人工费录入") -> str:
    """生成输出文件名: 2026.7.4单位人工费录入20260704_175500.xlsx"""
    now = datetime.now()
    date_part = f"{now.year}.{now.month}.{now.day}"
    ts_part = now.strftime("%Y%m%d_%H%M%S")
    return f"{date_part}{base_name}{ts_part}.xlsx"


def extract_token(text: str) -> str:
    """从 URL 或 token 字符串中提取 wiki_node_token"""
    # 匹配飞书 Wiki URL 格式 .../wiki/xxxxxxxxx
    m = re.search(r"wiki/(\w+)", text)
    if m:
        return m.group(1)
    # 直接是纯 token（字母数字混合，不含 /）
    if re.fullmatch(r"\w+", text):
        return text
    raise ValueError(f"无法从输入中提取 Wiki 节点 token: {text}")


def main():
    # 确定 wiki_node_token
    if len(sys.argv) > 1:
        wiki_token = extract_token(sys.argv[1])
    else:
        wiki_token = os.getenv("WIKI_NODE_TOKEN", "")
        if not wiki_token:
            print("[ERR] 未指定 Wiki 节点 token。")
            print("  用法: python download_wiki.py <token_or_url>")
            print("  或设置环境变量 WIKI_NODE_TOKEN")
            sys.exit(1)

    print(f"Wiki 节点 token: {wiki_token}")

    # 创建客户端
    client = FeishuClient()

    # 读取节点信息（先获取类型和名称）
    node = client.get_wiki_node_info(wiki_token)
    title = node.get("title", "untitled")
    obj_type = node.get("obj_type", "")
    obj_token = node.get("obj_token", "")
    print(f"节点标题: {title}")
    print(f"节点类型: {obj_type}")
    print(f"对象 token: {obj_token}")

    # 根据类型下载
    if obj_type == "docx":
        content = client.get_document_raw_content(obj_token)
        filename = f"{title}.txt"
        with open(filename, "w", encoding="utf-8") as f:
            f.write(content)
        print(f"[OK] 已下载 docx → {filename}（{len(content)} 字符）")

    elif obj_type == "sheet":
        try:
            import openpyxl
            from openpyxl.utils import get_column_letter
        except ImportError:
            print("[ERR] 生成 xlsx 需要 openpyxl: pip install openpyxl")
            sys.exit(1)

        result = client.read_wiki_node(wiki_token)
        os.makedirs(title, exist_ok=True)
        for sheet_name, sheet_data in result.get("data", {}).items():
            wb = openpyxl.Workbook()
            ws = wb.active
            ws.title = sheet_name
            rows_data = [sheet_data["headers"]] + sheet_data["rows"]
            for row_idx, row in enumerate(rows_data, 1):
                for col_idx, val in enumerate(row, 1):
                    cell = ws.cell(row=row_idx, column=col_idx, value=val)
            # 自动调整列宽
            for col_idx in range(1, len(sheet_data["headers"]) + 1):
                max_len = 0
                for row_idx in range(1, min(len(rows_data) + 1, 200)):
                    val = ws.cell(row=row_idx, column=col_idx).value
                    if val is not None:
                        # 中文字符算两个宽度
                        length = sum(2 if ord(c) > 127 else 1 for c in str(val))
                        max_len = max(max_len, length)
                ws.column_dimensions[get_column_letter(col_idx)].width = min(max_len + 2, 50)

            filename = os.path.join(title, f"{sheet_name}.xlsx")
            wb.save(filename)
            print(f"[OK] 已下载 sheet → {filename}（{len(rows_data)} 行，列宽自适应）")

            # 重命名为统一格式：日期+单位人工费录入+时间戳
            new_filename = os.path.join(title, generate_output_filename())
            if os.path.exists(new_filename):
                os.remove(new_filename)
            os.rename(filename, new_filename)
            print(f"[OK] 重命名 → {new_filename}")

    elif obj_type == "bitable":
        table_id = os.getenv("TABLE_ID", "")
        if not table_id:
            print("[ERR] 下载多维表格需要 TABLE_ID，请在 .env 中设置")
            sys.exit(1)
        records = client.list_records(obj_token, table_id)
        flat = [FeishuClient.flatten_bitable_record(r) for r in records]
        filename = f"{title}.csv"
        FeishuClient.records_to_csv(flat, filename)
        print(f"[OK] 已下载 bitable → {filename}（{len(flat)} 条记录）")

    else:
        print(f"[ERR] 不支持的节点类型: {obj_type}")
        sys.exit(1)


if __name__ == "__main__":
    main()
