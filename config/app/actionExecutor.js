import { sleep, sleepRandom, log } from './utils.js';

export class ActionExecutor {
    constructor(domain, tabConnection) {
        this.domain = domain;
        this.tabConnection = tabConnection;
    }

    async executeAction(action, timeout = 180000, retries = 3, interval = 2000) {
        await sleepRandom(1000, 5000);
        const domain = this.domain;
        var _action = this.normalizeAction(action);
        try {
            switch (_action.type) {
                // 多次尝试执行 指定次数间隔时间
                case "goto":
                    await this.executeWithRetry(
                        () => {
                            log(`${domain} goto: ${_action.data.params.url}`)
                            return this.tabConnection.send(_action.data.method, _action.data.params);
                        },
                        retries,
                        interval
                    );
                    return true;
                case "action":
                    await this.executeWithRetry(
                        () => {
                            log(`${domain} action: ${_action.data.params.expression}`);
                            return this.tabConnection.send(_action.data.method, _action.data.params);
                        },
                        retries,
                        interval
                    );
                    return true;
                // 多次尝试执行, 指定超时时间
                case "wait":
                    await this.executeUntilTrue(
                        () => {
                            log(`${domain} wait: ${_action.data.params.expression}`);
                            return this.tabConnection.send(_action.data.method, _action.data.params);
                        },
                        timeout,
                        interval
                    );
                    return true;
                // 仅执行一次 返回结果值
                case "check":
                    log(`${domain} check: ${_action.data.params.expression}`)
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
                var result = await fn();
                return this.extractValue(result);
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

    extractValue(result) {
        const domain = this.domain;
        log(`${domain} extract result: ${JSON.stringify(result)}`)
        // 如果执行出错，视为条件不满足
        if (result && result.exceptionDetails) {
            console.log(result.exceptionDetails)
            throw new Error(`脚本执行错误: ${result.exceptionDetails.text}`);
        }
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
                        "expression": `(async () => { ${action.action} })()`,
                        "awaitPromise": true,
                        "returnByValue": true
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
                        "expression": `(async () => { return !!document.querySelector(${JSON.stringify(action.wait)}); })()`,
                        "awaitPromise": true,
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
                        "expression": `(async () => { ${action.cwait} })()`,
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
                        "expression": `(async () => { return !!document.querySelector(${JSON.stringify(action.check)}); })()`,
                        "awaitPromise": true,
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
                        "expression": `(async () => { ${action.ccheck} })()`,
                        "awaitPromise": true,
                        "returnByValue": true
                    }
                }
            }
        };
        throw new Error(`无法识别的 action: ${JSON.stringify(action)}`);
    }
}