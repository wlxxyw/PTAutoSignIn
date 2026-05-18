#!/bin/sh

# 基础参数
BASE_ARGS="--no-sandbox \
          --disable-dev-shm-usage \
          --disable-gpu \
          --remote-debugging-port=${BROWSER_PORT} \
          --start-maximized \
          --disable-background-networking \
          --disable-background-timer-throttling \
          --disable-renderer-backgrounding \
          --disable-backgrounding-occluded-windows \
          --disable-features=TranslateUI \
          about:blank"

PROXY_ARG=""

# 确定代理字符串
# 优先使用 ALL_PROXY 然后 HTTPS_PROXY HTTP_PROXY
if [ -n "$ALL_PROXY" ]; then
    PROXY_ARG="--proxy-server=${ALL_PROXY}"
elif [ -n "$HTTPS_PROXY" ]; then
    PROXY_ARG="--proxy-server=${HTTPS_PROXY}"
elif [ -n "$HTTP_PROXY" ]; then
    PROXY_ARG="--proxy-server=${HTTP_PROXY}"
fi

# 最终命令
exec chromium-browser ${PROXY_ARG} ${BASE_ARGS}
