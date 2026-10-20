import requests
from flask import Flask, request, jsonify
import ddddocr
import logging
import re
import base64

app = Flask(__name__)

# 设置日志记录
logging.basicConfig(filename='/var/log/ocr-api.log', level=logging.DEBUG,
                    format='%(asctime)s %(levelname)s %(name)s %(threadName)s : %(message)s')


def get_image_bytes(image_data):
    if isinstance(image_data, bytes):
        return image_data
    elif image_data.startswith('http'):
        response = requests.get(image_data, verify=False)
        response.raise_for_status()
        return response.content
    elif isinstance(image_data, str):
        return base64.b64decode(image_data)
    else:
        raise ValueError("Unsupported image data type")

class CAPTCHA:
    def __init__(self):
        self.ocr = ddddocr.DdddOcr()

    # OCR识别函数，接收一个图像和一个png_fix参数，返回OCR识别结果
    def classification(self, image):
        try:
            image_bytes = get_image_bytes(image)
            res = self.ocr.classification(image_bytes)
            return res
        except Exception as e:
            app.logger.error(f"出现错误: {e}")
            return None

    # 计算类验证码处理函数，接收一个图像，返回计算结果
    def calculate(self, image):
        try:
            image_bytes = get_image_bytes(image)
            expression = self.ocr.classification(image_bytes)
            expression = re.sub('=.*$', '', expression)
            expression = re.sub('[^0-9+\-*/()]', '', expression)
            result = eval(expression)
            return result
        except Exception as e:
            app.logger.error(f"出现错误: {e}")
            app.logger.error(f"错误类型: {type(e)}")
            app.logger.error(f"错误详细信息: {e.args}")
            return None


# 初始化CAPTCHA类
captcha = CAPTCHA()

@app.after_request
def after_request(response):
    response.headers.add('Access-Control-Allow-Origin', '*')
    response.headers.add('Access-Control-Allow-Headers', 'Content-Type,Authorization')
    response.headers.add('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,OPTIONS')
    return response
# OCR识别路由，接收POST请求，返回OCR识别结果
@app.route('/ocr', methods=['OPTIONS'])
def handle_ocr_options():
    return '', 200
@app.route('/ocr', methods=['POST'])
def classification():
    try:
        data = request.get_json()
        image = data['image']
        result = captcha.classification(image)
        if result is None:
            app.logger.error('处理过程中出现错误.')
            return jsonify({'error': '处理过程中出现错误.'}), 500
        return jsonify({'result': result})
    except Exception as e:
        app.logger.error(f"出现错误: {e}")
        return jsonify({'error': f"出现错误: {e}"}), 400


# 计算类验证码处理路由，接收POST请求，返回计算结果
@app.route('/calculate', methods=['OPTIONS'])
def handle_calculate_options():
    return '', 200
@app.route('/calculate', methods=['POST'])
def calculate():
    try:
        data = request.get_json()
        image = data['image']
        result = captcha.calculate(image)
        if result is None:
            app.logger.error('处理过程中出现错误.')
            return jsonify({'error': '处理过程中出现错误.'}), 500
        return jsonify({'result': result})
    except Exception as e:
        app.logger.error(f"出现错误: {e}")
        return jsonify({'error': f"出现错误: {e}"}), 400

# 基本运行状态路由，返回一个表示服务器正常运行的消息
@app.route('/')
def hello_world():
    return 'API运行成功！'


# 启动Flask应用
if __name__ == '__main__':
    app.run(host='::', threaded=True, debug=True, port=8000)
