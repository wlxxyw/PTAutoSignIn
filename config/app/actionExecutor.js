import { sleep, sleepRandom, log } from './utils.js';

export class ActionExecutor {
    constructor(domain, tabConnection) {
        this.domain = domain;
        this.tabConnection = tabConnection;
    }

    async executeAction(action, timeout = 180000, retries = 3, interval = 2000) {
        await sleepRandom(1000, 5000);
        const domain = this.domain;
        var _action = this.#normalizeAction(action);
        try {
            switch (_action.type) {
                // 多次尝试执行 指定次数间隔时间
                case "goto":
                    return await this.#executeGoto(_action, retries, interval);
                // 执行脚本
                case "action":
                    return await this.#executeActionScript(_action, retries, interval);
                // 多次尝试执行, 指定超时时间
                case "wait":
                    return await this.#executeWait(_action, timeout, interval);
                // 仅执行一次 返回结果值
                case "check":
                    return await this.#executeCheck(_action, retries, interval);
                // 条件语句
                case "switch":
                    return await this.#executeSwitch(_action, timeout, retries, interval);
                // 循环语句
                case "loop":
                    return await this.#executeLoop(_action, timeout, retries, interval);
                default:
                    throw new Error(`未知操作类型: ${_action.type}`);
            }
        } catch (error) {
            throw new Error(`执行操作失败: ${error.message}`);
        }
    }

    async #executeGoto(action, retries, interval) {
        const domain = this.domain;
        await this.#executeWithRetry(
            () => {
                log(`${domain} goto: ${action.data}`);
                return this.tabConnection.send(
                    "Page.navigate",
                    {
                        "url": action.data
                    }
                );
            },
            retries,
            interval
        );
        return true;
    }
    async #executeActionScript(action, retries, interval) {
        const domain = this.domain;
        await this.#executeWithRetry(
            () => {
                log(`${domain} action: ${action.data}`);
                return this.tabConnection.send(
                    "Runtime.evaluate",
                    {
                        "expression": `(async () => { ${action.data} })()`,
                        "awaitPromise": true,
                        "returnByValue": true
                    }
                );
            },
            retries,
            interval
        );
        return true;
    }
    async #executeWait(action, timeout, interval) {
        const domain = this.domain;
        await this.#executeUntilTrue(
            () => {
                log(`${domain} wait: ${action.data}`);
                return this.tabConnection.send(
                    "Runtime.evaluate",
                    {
                        "expression": `(async () => { ${action.data} })()`,
                        "awaitPromise": true,
                        "returnByValue": true
                    }
                );
            },
            timeout,
            interval
        );
        return true;
    }
    async #executeCheck(action, retries, interval) {
        const domain = this.domain;
        return await this.#executeWithRetry(
            () => {
                log(`${domain} action: ${action.data}`);
                return this.tabConnection.send(
                    "Runtime.evaluate",
                    {
                        "expression": `(async () => { ${action.data} })()`,
                        "awaitPromise": true,
                        "returnByValue": true
                    }
                );
            },
            retries,
            interval
        );
    }
    async #executeSwitch(action, timeout, retries, interval) {
        const domain = this.domain;
        if (!Array.isArray(action.data)) {
            throw new Error('switch 必须是数组');
        }
        log(`${domain} switch: 开始检查 ${action.data.length} 个 case`);
        for (let i = 0; i < action.data.length; i++) {
            const currentCase = action.data[i];
            if (!currentCase || (!currentCase.check && !currentCase.ccheck)) {
                log(`${domain} switch case[${i}] 缺少 check/ccheck`);
                continue;
            }
            const currentCaseCheck = this.#normalizeAction(!!currentCase.check ? {check: currentCase.check} : {ccheck: currentCase.ccheck});
            log(`${domain} switch: 检查 case[${i}]`);
            const result = await this.#executeCheck(currentCaseCheck, retries, interval);

            if (!!result) {
                log(`${domain} switch: case[${i}] 命中`);
                if (currentCase.actions != null) {
                    if (!Array.isArray(currentCase.actions)) {
                        throw new Error( `switch case[${i}].actions 必须是数组`);
                    }
                    for (let j = 0; j < currentCase.actions.length; j++) {
                        const currentCaseAction = currentCase.actions[j];
                        await this.executeAction(
                            currentCaseAction,
                            timeout,
                            retries,
                            interval
                        );
                    }
                }
                // 命中后立即结束 switch
                return true;
            }
        }
        log(`${domain} switch: 没有匹配的 case`);
        return false;
    }

    async #executeLoop(action, timeout, retries, interval) {
        const domain = this.domain;
        const currentLoop = action.data;

        if ( currentLoop.times !== undefined && currentLoop.times !== null ){ // 模式一：times 非空
            const times = Number(currentLoop.times);
            if (!Number.isInteger(times) || times < 0) {
                log(`${domain} loop times 必须是非负整数`);
                return false;
            }
            log(`${domain} loop 固定执行 ${times} 次`);
            for (let count = 0; count < times; count++) {
                log(`${domain} loop 第 ${count + 1}/${times} 次`);
                if (currentLoop.actions != null) {
                    if (!Array.isArray(currentLoop.actions)) {
                        throw new Error( `loop actions 必须是数组`);
                    }
                    for (let i = 0; i < currentLoop.actions.length; i++) {
                        const currentLoopAction = currentLoop.actions[i];
                        await this.executeAction(
                            currentLoopAction,
                            timeout,
                            retries,
                            interval
                        );
                    }
                }
            }
        }else if(!!currentLoop.check || !!currentLoop.ccheck){ //模式二：条件循环
            const currentLoopCheck = this.#normalizeAction(!!currentLoop.check ? {check: currentLoop.check} : {ccheck: currentLoop.ccheck});
            let count = 0;
            while (true) {
                count++;
                log(`${domain} loop 检查第 ${count} 次` );
                const result = await this.#executeCheck(currentLoopCheck, retries, interval);
                if (!result) {
                    log(`${domain} loop check 条件不满足，循环结束`);
                    break;
                }
                log(`${domain} loop check 条件满足，执行 actions`);
                if (currentLoop.actions != null) {
                    if (!Array.isArray(currentLoop.actions)) {
                        throw new Error( `switch loop actions 必须是数组`);
                    }
                    for (let i = 0; i < currentLoop.actions.length; i++) {
                        const currentLoopAction = currentLoop.actions[i];
                        await this.executeAction(
                            currentLoopAction,
                            timeout,
                            retries,
                            interval
                        );
                    }
                }
                if(count > 100){
                    log(`${domain} loop 次数过多！！`);
                    break;
                }
            }
        }else{
            log(`${domain} loop 未定义循环次数/条件`);
        }
        return true;
    }

    async #executeWithRetry(fn, retries = 3, interval = 1000) {
        for (let i = 0; i < retries; i++) {
            try {
                var result = await fn();
                return this.#extractValue(result);
            } catch (error) {
                if (i === retries - 1) {
                    throw error;
                }
                console.warn(`操作失败，重试 ${i + 1}/${retries}:`, error.message);
                await sleep(interval * Math.pow(2, i));
            }
        }
        return false;
    }

    async #executeUntilTrue(fn, timeout = 180000, interval = 1000) {
        let startTime = Date.now();
        while (Date.now() - startTime < timeout) {
            try {
                let result = await fn();
                if (this.#extractValue(result)) return true;
            } catch (error) {
                console.error('操作失败:', error.message);
            }
            await sleep(interval);
        }
        throw new Error(`操作超时: ${timeout}ms`);
    }

    #extractValue(result) {
        const domain = this.domain;
        log(`${domain} extract result: ${JSON.stringify(result)}`)
        // 如果执行出错，视为条件不满足
        if (result && result.exceptionDetails) {
            console.log(result.exceptionDetails)
            return false;
            //throw new Error(`脚本执行错误: ${result.exceptionDetails.text}`);
        }
        if (result && result.result) {
            if (Object.prototype.hasOwnProperty.call(result.result, "value")) {
                return result.result.value;
            }
            return undefined;
        }
        return false;
    }

    #normalizeAction(action) {
        if (action.goto) {
            return {
                type: "goto",
                data: action.goto
            }
        };
        if (action.action) {
            return {
                type: "action",
                data: action.action
            }
        };
        if (action.wait) {
            return {
                type: "wait",
                data: `return !!document.querySelector(${JSON.stringify(action.wait)});`
            }
        };
        if (action.cwait) {
            return {
                type: "wait",
                data: action.cwait
            }
        };
        if (action.check) {
            return {
                type: "check",
                data: `return !!document.querySelector(${JSON.stringify(action.check)});`
            }
        };
        if (action.ccheck) {
            return {
                type: "check",
                data: action.ccheck
            }
        };
        if (action.switch){
            return {
                type: "switch",
                data: action.switch
            }
        }
        if (action.loop){
            return {
                type: "loop",
                data: action.loop
            }
        }
        throw new Error(`无法识别的 action: ${JSON.stringify(action)}`);
    }
}