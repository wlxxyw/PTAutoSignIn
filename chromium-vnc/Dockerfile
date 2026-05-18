FROM alpine:3.23

# 更换阿里云镜像源，并启用 community 仓库以安装 chromium
RUN sed -i 's/dl-cdn.alpinelinux.org/mirrors.aliyun.com/g' /etc/apk/repositories \
    && echo "http://mirrors.aliyun.com/alpine/v3.23/community" >> /etc/apk/repositories \
    && apk add --no-cache \
        bash \
        xvfb \
        fluxbox \
        tigervnc \
        supervisor \
        ttf-freefont \
        fontconfig \
        font-wqy-zenhei \
        chromium \
    && fc-cache -fv

# 环境变量：虚拟显示、分辨率、VNC 密码（空为无认证）
ENV DISPLAY=:99 \
    SCREEN_WIDTH=1366 \
    SCREEN_HEIGHT=768 \
    SCREEN_DEPTH=16 \
    SUPERVISOR_WEB_USERNAME=admin \
    SUPERVISOR_WEB_PASSWORD=admin \
    SUPERVISOR_WEB_PORT=9001 \
    BROWSER_PORT=9222

# 复制启动脚本
COPY start_vnc.sh /etc/supervisor/conf.d/start_vnc.sh
COPY start_chromium.sh /etc/supervisor/conf.d/start_chromium.sh
# 复制 supervisor 主配置
COPY supervisord.conf /etc/supervisor/supervisord.conf

# 暴露 VNC 端口
EXPOSE 5900

CMD ["/usr/bin/supervisord", "-c", "/etc/supervisor/supervisord.conf", "-j", "/run/supervisord.pid"]
