import { sleep } from './utils.js';

export class ActionExecutor {
    constructor(tabConnection) {
        this.tabConnection = tabConnection;
    }

    async executeAction(action, timeout = 180000, retries = 3, interval = 2000) {
        var _action = this.normalizeAction(action);
        try {
            switch (_action.type) {
                // 多次尝试执行 指定次数间隔时间
                case "goto":
                    await this.executeWithRetry(
                        () => this.tabConnection.send(_action.data.method, _action.data.params),
                        retries,
                        interval
                    );
                    return true;
                case "action":
                    await this.executeImportJquery();
                    await this.executeWithRetry(
                        () => this.tabConnection.send(_action.data.method, _action.data.params),
                        retries,
                        interval
                    );
                    return true;
                // 多次尝试执行, 指定超时时间
                case "wait":
                    await this.executeImportJquery();
                    await this.executeUntilTrue(
                        () => this.tabConnection.send(_action.data.method, _action.data.params),
                        timeout,
                        interval
                    );
                    return true;
                // 仅执行一次 返回结果值
                case "check":
                    await this.executeImportJquery();
                    return this.extractValue(await this.tabConnection.send(_action.data.method, _action.data.params));
                default:
                    throw new Error(`未知操作类型: ${_action.type}`);
            }
        } catch (error) {
            throw new Error(`执行操作失败: ${error.message}`);
        }
    }

    async executeWithRetry(fn, retries = 3, interval = 1000) {
        for (let i = 0; i < retries; i++) {
            try {
                return await fn();
            } catch (error) {
                if (i === retries - 1) {
                    throw error;
                }
                console.warn(`操作失败，重试 ${i + 1}/${retries}:`, error.message);
                await sleep(interval * Math.pow(2, i));
            }
        }
    }

    async executeUntilTrue(fn, timeout = 180000, interval = 1000) {
        let startTime = Date.now();
        while (Date.now() - startTime < timeout) {
            try {
                let result = await fn();
                if (this.extractValue(result)) return true;
            } catch (error) {
                console.error('操作失败:', error.message);
            }
            await sleep(interval);
        }
        throw new Error(`操作超时: ${timeout}ms`);
    }

    async executeImportJquery(retries = 3, interval = 1000){
                    await this.executeWithRetry(
                        () => this.tabConnection.send(
                            "Runtime.evaluate",
                            {
                        "expression": `
                            (async () => {
                                if (!!window && !window.jQuery) {
                                    await new Promise((resolve, reject) => {
                                        const script = document.createElement('script');
                                        script.src = 'https://cdn.bootcdn.net/ajax/libs/jquery/3.7.1/jquery.min.js';
                                        script.onload = resolve;
                                        script.onerror = reject;
                                        document.head.appendChild(script);
                                    });
                                }
                            })()`,
                        "awaitPromise": true
                    }),
                        retries,
                        interval
                    );
    }

    extractValue(result) {
        if (result && result.result && typeof result.result.value !== 'undefined') {
            return result.result.value;
        }
        return result;
    }
    normalizeAction(action) {
        if (action.goto) {
            return {
                type: "goto",
                data: {
                    "method": "Page.navigate",
                    "params": {
                        "url": action.goto
                    }
                }
            }
        };
        if (action.action) {
            return {
                type: "action",
                data: {
                    "method": "Runtime.evaluate",
                    "params": {
                        "expression": action.action,
                    }
                }
            }
        };
        if (action.wait) {
            return {
                type: "wait",
                data: {
                    "method": "Runtime.evaluate",
                    "params": {
                        "expression": `$(${JSON.stringify(action.wait)}).length > 0`,
                        "returnByValue": true
                    }
                }
            }
        };
        if (action.cwait) {
            return {
                type: "wait",
                data: {
                    "method": "Runtime.evaluate",
                    "params": {
                        "expression": action.cwait,
                        "awaitPromise": true,
                        "returnByValue": true
                    }
                }
            }
        };
        if (action.check) {
            return {
                type: "check",
                data: {
                    "method": "Runtime.evaluate",
                    "params": {
                        "expression": `$(${JSON.stringify(action.check)}).length > 0`,
                        "returnByValue": true
                    }
                }
            }
        };
        if (action.ccheck) {
            return {
                type: "check",
                data: {
                    "method": "Runtime.evaluate",
                    "params": {
                        "expression": action.ccheck,
                        "awaitPromise": true,
                        "returnByValue": true
                    }
                }
            }
        };
        throw new Error(`无法识别的 action: ${JSON.stringify(action)}`);
    }
}
