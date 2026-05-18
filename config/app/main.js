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
//固定的配置
const configFile = './config.yaml';
const SUPERVISORD_PROCESS_NAME = 'chrome';

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
        log('浏览器启动成功');
        await sleep(5000);
    } catch (error) {
        log('启动浏览器失败:', error.message);
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

async function executeSiteActions(site, browserManager, triedToDay) {
    const tabManager = browserManager.tabManager;
    const existingTab = await tabManager.findTabByUrl(site.domain);

    if (triedToDay && site.status > 0 && !existingTab) {
        log(`站点 ${site.domain} 当天已失败过，但浏览器无对应标签页，视为已人工处理并标记为成功`);
        return { success: true, closeConnection: null };
    }

    if (existingTab) {
        log(`站点 ${site.domain} 已存在标签页，跳过`);
        return { success: false, closeConnection: null };
    }

    const newTab = await tabManager.openTab(`https://${site.domain}`);
    const tabConnection = await browserManager.getConnection(newTab.webSocketDebuggerUrl);
    const actionExecutor = new ActionExecutor(tabConnection);

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
    for (const site of sites) {
        const promise = (async () => {
            log(`开始处理站点: ${site.domain}`);

            const { success } = await executeSiteActions(site, browserManager, site.date === today);

            updateSiteStatus(site, success);

            return { site, success };
        })();

        executing.push(promise);
        results.push(promise);

        if (executing.length >= limit) {
            await Promise.race(executing);
            const completed = await Promise.allSettled(executing);
            executing.length = 0;

            for (const result of completed) {
                if (result.status === 'rejected') {
                    log('站点执行出错:', result.reason);
                }
            }
        }
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
        if (filteredSites.filter(site => site.status !== 0 || !site.retry).length == 0) {//没有 失败就保持页面的站点
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