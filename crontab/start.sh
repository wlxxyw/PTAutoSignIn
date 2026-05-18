#!/bin/sh
INIT_DIR=/init.d
if [ -d "$INIT_DIR" ];then
  find "$INIT_DIR" -maxdepth 1 -type f -executable | sort | while read -r script; do
    echo "executing init script: $script ..."
    "$script" # 前台执行初始化命令
  done
fi
if [ $# -eq 0 ]; then # 未传入任何参数
  set -- -inotify /etc/crontab.default
fi
echo "Starting supercronic with arguments: $@"
exec /usr/local/bin/supercronic "$@"
