FROM python:3.9-slim
RUN rm -f /etc/apt/sources.list.d/* 2>/dev/null || true && \
    echo "deb http://mirrors.aliyun.com/debian/ trixie main contrib non-free" > /etc/apt/sources.list && \
    echo "deb http://mirrors.aliyun.com/debian-security trixie-security main contrib non-free" >> /etc/apt/sources.list && \
    echo "deb http://mirrors.aliyun.com/debian/ trixie-updates main contrib non-free" >> /etc/apt/sources.list

COPY pip.conf /etc/

# 安装 OpenCV 依赖(ddddocr 依赖 opencv-python-headless)
RUN apt-get update && apt-get install -y \
    libglib2.0-0 \
    libsm6 \
    libxrender1 \
    libxext6 \
    libgl1 \
    && apt-get clean

# 设置工作目录
WORKDIR /ddddocr

# 复制项目文件到容器中
COPY src /ddddocr

# 安装项目依赖
RUN pip install --no-cache-dir -r requirements.txt

# 暴露端口
EXPOSE 8000

# 运行项目
CMD ["python", "server.py"]
