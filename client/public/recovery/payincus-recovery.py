#!/usr/bin/env python3
"""Interactive frontend for the installed, sealed PayIncus recovery executor."""
import getpass
import json
import os
from pathlib import Path
import subprocess
import sys


def main():
    if sys.platform != "linux" or os.geteuid() != 0:
        raise ValueError("请在已安装兼容稳定版本 PayIncus 的 Linux 目标主控上使用 sudo 运行。")
    root = Path("/opt/incudal")
    app = root / "current" if (root / "current").is_dir() else root
    cli = app / "server/dist/scripts/platform-backup-cli.js"
    if not cli.is_file():
        raise ValueError("未找到已安装的恢复程序，请先安装与备份相同或兼容更新的稳定面板版本。")
    command = sys.argv[1] if len(sys.argv) == 2 else input("操作 configure/status/preview/restore/rollback/resume：").strip()
    payload = {}
    if command == "configure":
        payload = {"region": input("OSS 区域（例如 oss-cn-hangzhou）：").strip(),
                   "bucket": input("存储桶名称：").strip(),
                   "prefix": input("备份根目录（例如 payincus-backups/）：").strip(),
                   "accessKeyId": getpass.getpass("AccessKey ID："),
                   "accessKeySecret": getpass.getpass("AccessKey Secret："),
                   "backupPassword": getpass.getpass("备份密码："),
                   "intervalHours": 24, "retention": 3}
    elif command == "preview":
        payload = {"prefix": input("完整备份集目录（以安装 ID/备份 ID/ 结尾）：").strip(),
                   "password": getpass.getpass("该备份的原密码：")}
    elif command == "restore":
        preview = input("status 中成功预检的任务 ID：").strip()
        print("正式恢复会暂停业务、切换数据库和主控身份；恢复后保持保护，等待人工核对。")
        payload = {"previewId": preview, "confirmation": input(f"请输入 RESTORE {preview}：").strip()}
    elif command in ("rollback", "resume"):
        expected = "ROLLBACK RESTORE" if command == "rollback" else "RESUME AFTER RECONCILIATION"
        print("回退后仍需核对；恢复运营前请核对支付、宿主、库存、权限和待处理任务。")
        payload = {"confirmation": input(f"请输入 {expected}：").strip()}
    elif command != "status":
        raise ValueError("不支持的操作。")
    env = dict(os.environ, NODE_ENV="production", INCUDAL_APP_DIR=str(app), ENV_FILE=str(root / ".env"))
    result = subprocess.run(["node", str(cli), command], input=json.dumps(payload), text=True, cwd=str(app / "server"), env=env, check=False)
    return result.returncode


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (ValueError, OSError, KeyboardInterrupt, EOFError):
        print("操作未完成。请核对 Linux root 权限、已安装版本与输入；不会输出凭据。", file=sys.stderr)
        sys.exit(1)
