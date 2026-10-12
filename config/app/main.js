#!/usr/bin/node

import fs from 'fs';
import axios from 'axios';
import yaml from 'js-yaml';
import { log, sleep, getTodayDate } from './utils.js';
import { BrowserManager } from './browserManager.js';
import { ActionExecutor } from './actionExecutor.js';
import { filterSites, updateSiteStatus } from './siteFilter.js';

//从环境变量中获取配置
const BROWSER_CDP = `http://localhost:${process.env.BROWSER_PORT}`;
const SUPERVISORD_USERNAME = process.env.SUPERVISOR_WEB_USERNAME;
const SUPERVISORD_PASSWORD = process.env.SUPERVISOR_WEB_PASSWORD;
const SUPERVISORD_API = `http://localhost:${process.env.SUPERVISOR_WEB_PORT}`;
const OPERATION_TIMEOUT = parseInt(process.env.OPERATION_TIMEOUT || '180000');
const WAIT_CHECK_INTERVAL = parseInt(process.env.WAIT_CHECK_INTERVAL || '2000');
const MAX_CONCURRENT_SITES = parseInt(process.env.MAX_CONCURRENT_SITES || '3');
const GOTIFY_MSG_API = process.env.GOTIFY_MSG_API;
const QIYEWEIXIN_MSG_API = process.env.QIYEWEIXIN_MSG_API;
//固定的配置
const configFile = './config.yaml';
const SUPERVISORD_PROCESS_NAME = 'chrome';

// 浏览器启动检查参数
const STARTUP_RETRY_COUNT = 5;
const STARTUP_RETRY_INTERVAL_MS = 2000;

function loadConfig() {
    try {
        const data = fs.readFileSync(configFile, 'utf8');
        try {
            return yaml.load(data);
        } catch (parseError) {
            log('解析YAML时发生错误:', parseError);
            return [];
        }
    } catch (err) {
        log('读取文件时发生错误:', err);
        return [];
    }
}

function saveConfig(configJson) {
    fs.writeFileSync(configFile, yaml.dump(configJson));
    log('配置已保存');
}

async function testConnection(url) {
    try {
        await axios.get(url, { timeout: 5000 });
        return true;
    } catch {
        return false;
    }
}

async function startBrowser() {
    const auth = Buffer.from(`${SUPERVISORD_USERNAME}:${SUPERVISORD_PASSWORD}`).toString('base64');
    try {
        await axios.get(
            `${SUPERVISORD_API}/index.html?processname=${SUPERVISORD_PROCESS_NAME}&action=start`,
            {
                headers: { Authorization: `Basic ${auth}` },
                timeout: 5000
            }
        );
        log('浏览器启动指令已发送');
        await sleep(5000);
        // 多次检查 CDP 是否真正可用
        for (let i = 1; i <= STARTUP_RETRY_COUNT; i++) {
            log(`检查浏览器 CDP 连接 (${i}/${STARTUP_RETRY_COUNT})...`);
            const isReady = await testConnection(BROWSER_CDP);
            if (isReady) {
                log('浏览器 CDP 已就绪');
                return;
            }
            if (i < STARTUP_RETRY_COUNT) {
                await sleep(STARTUP_RETRY_INTERVAL_MS);
            }
        }
        throw new Error(`浏览器启动后 CDP 不可用，已重试 ${STARTUP_RETRY_COUNT} 次`);
    } catch (error) {
        log('启动浏览器失败:', error.message);
        sendNotification("启动浏览器失败");
        throw error;
    }
}

async function stopBrowser() {
    const auth = Buffer.from(`${SUPERVISORD_USERNAME}:${SUPERVISORD_PASSWORD}`).toString('base64');
    try {
        await axios.get(
            `${SUPERVISORD_API}/index.html?processname=${SUPERVISORD_PROCESS_NAME}&action=stop`,
            {
                headers: { Authorization: `Basic ${auth}` },
                timeout: 5000
            }
        );
        log('浏览器停止成功');
        await sleep(5000);
    } catch (error) {
        log('启动浏览器失败:', error.message);
        throw error;
    }
}

async function sendNotification(message) {
    if(!!GOTIFY_MSG_API){
        try {
            await axios.post(
                GOTIFY_MSG_API,
                {
                    title: "签到提醒",
                    message: message,
                    priority: 5
                },
                {
                    headers: { 'Content-Type': 'application/json' },
                    timeout: 5000
                }
            );
            log(`通知已发送: ${message}`);
        } catch (error) {
            log(`发送通知失败: ${error.message}`);
        }
    }
    if(!!QIYEWEIXIN_MSG_API){
        try{
            await axios.post(
                QIYEWEIXIN_MSG_API,
                {
                    msgtype: 'text',
                    text: {
                        content: message
                    }
                },
                {
                    headers: { 'Content-Type': 'application/json' },
                    timeout: 5000
                }
            );
            log(`通知已发送: ${message}`);
        } catch (error) {
            log(`发送通知失败: ${error.message}`);
        }

    }
}

async function executeSiteActions(site, browserManager, triedToDay) {
    const tabManager = browserManager.tabManager;
    const existingTab = await tabManager.findTabByUrl(site.domain);

    if (existingTab) {
        log(`站点 ${site.domain} 已存在标签页，跳过`);
        return { success: false, closeConnection: null };
    }

    // 非retry站点今天已执行失败过，但不存在相关窗口
    if(triedToDay && site.status > 0 && !site.retry &&  !existingTab){
        log(`站点 ${site.domain} 当天已失败过，但浏览器无对应标签页，视为已人工处理并标记为成功`);
        return { success: true, closeConnection: null };
    }

    const newTab = await tabManager.openTab(`https://${site.domain}`);
    const tabConnection = await browserManager.getConnection(newTab.webSocketDebuggerUrl);
    const actionExecutor = new ActionExecutor(site.domain, tabConnection);

    var totalSuccess;
    try {
        for (const action of site.actions) {
            const success = await actionExecutor.executeAction(action, OPERATION_TIMEOUT, WAIT_CHECK_INTERVAL);
            if (!success) {
                throw new Error(`操作失败: ${JSON.stringify(action)}`);
            }
        }

        log(`站点 ${site.domain} 签到成功`);
        totalSuccess = true;
    } catch (error) {
        log(`站点 ${site.domain} 执行失败:`, error.message);
        totalSuccess = false;
    }
    //如果成功 或者设置了失败重试 则关闭标签页
    if (totalSuccess) {
        await tabManager.closeTab(tabConnection, newTab.id);
    } else if (!!site.retry) {
        await tabManager.closeTab(tabConnection, newTab.id);
        log(`站点 ${site.domain} 签到失败，关闭标签页等待重试`);
    } else {
        log(`站点 ${site.domain} 签到失败，保留标签页等待人工处理`);
    }
    await browserManager.closeConnection(newTab.webSocketDebuggerUrl);
    return { success: totalSuccess, closeConnection: null };
}

async function executeWithConcurrencyLimit(sites, browserManager, limit) {
    const results = [];
    const executing = [];
    const today = getTodayDate();

    // 单个站点的执行逻辑（抽出来，方便复用和调度）
    const runSite = async (site) => {
        log(`开始处理站点: ${site.domain}`);

        const { success } = await executeSiteActions(site, browserManager, site.date === today);

        // 处理失败通知：只有失败且超过12点，且今天尚未发送过通知时才发送
        if (!success && new Date().getHours() >= 12 && site.lastFailNotifyDate !== today) {
            const notifyMsg = `站点 ${site.domain} 签到失败，请及时人工处理。`;
            await sendNotification(notifyMsg);
            site.lastFailNotifyDate = today;  // 持久化，避免重复发送
        }

        updateSiteStatus(site, success);
        
        return { site, success };
    };

    for (const site of sites) {
        // 如果当前并发已经到上限，等一个完成
        if (executing.size >= limit) {
            await Promise.race(executing);
        }

        // 创建一个包装 Promise，完成后自动从池中移除
        const p = runSite(site)
            .then((value) => {
                results.push({ status: 'fulfilled', value });
            })
            .catch((reason) => {
                log('站点执行出错:', reason);
                results.push({ status: 'rejected', reason });
            })
            .finally(() => {
                executing.delete(p);   // ← 关键：完成后立刻让位
            });

        executing.add(p);
    }

    await Promise.allSettled(executing);
    return Promise.all(results);
}

async function main() {
    log('开始执行自动签到任务');

    let config = loadConfig();
    if (!Array.isArray(config)) {
        log('配置格式错误');
        return;
    }

    const { filteredSites, configChanged } = filterSites(config);
    if (configChanged) {
        await sendNotification("任务过期-存在站点任务过期，请注意检查！");
        saveConfig(config);
    }

    if (filteredSites.length === 0) {
        log('没有需要执行的站点');
        return;
    }

    log(`找到 ${filteredSites.length} 个需要执行的站点`);

    const browserWasRunning = await testConnection(BROWSER_CDP);
    if (!browserWasRunning) {
        log('CDP 连接失败，尝试启动浏览器');
        await startBrowser();
    }

    const browserManager = new BrowserManager(BROWSER_CDP, {
        apiUrl: SUPERVISORD_API,
        username: SUPERVISORD_USERNAME,
        password: SUPERVISORD_PASSWORD
    });

    await executeWithConcurrencyLimit(filteredSites, browserManager, MAX_CONCURRENT_SITES, browserWasRunning);

    saveConfig(config);

    await browserManager.closeAll();

    if (!browserWasRunning) { //浏览器是本次打开的
        if (filteredSites.filter(site => site.status !== 0 && !site.retry).length == 0) { //没有 失败就保持页面的站点
            log('浏览器是本次打开的,且无失败不重试的站点，尝试停止浏览器');
            await stopBrowser();
        }

    }
    log('自动签到任务完成');
}

main().catch(error => {
    log('程序执行出错:', error);
    process.exit(1);
});
