FROM alpine:3.23

ENV SUPERCRONIC_URL=https://github.com/aptible/supercronic/releases/download/v0.2.45/supercronic-linux-amd64 \
    SUPERCRONIC=supercronic-linux-amd64

# 更换阿里云镜像源，并安装tzdata 否则时区不对
RUN sed -i 's/dl-cdn.alpinelinux.org/mirrors.aliyun.com/g' /etc/apk/repositories \
    && apk add --no-cache tzdata

# download or copy from local
RUN curl -fsSLO "$SUPERCRONIC_URL" && \
    chmod +x "$SUPERCRONIC" && \
    mv "$SUPERCRONIC" "/usr/local/bin/${SUPERCRONIC}" && \
    ln -s "/usr/local/bin/${SUPERCRONIC}" /usr/local/bin/supercronic
#COPY supercronic /usr/local/bin/ 

# 默认定时任务配置示例
COPY crontab.default /etc 
# 启动脚本
COPY start.sh / 
RUN chmod +x /start.sh
# 接收后续参数传入脚本
RUN ENTRYPOINT ["/start.sh"]
