import WebSocket from 'ws';
import axios from 'axios';
import { log } from './utils.js';

export class TabConnection {
    constructor(webSocketDebuggerUrl) {
        this.webSocketDebuggerUrl = webSocketDebuggerUrl;
        this.ws = null;
        this.requestId = 0;
        this.callbacks = new Map();
        this.connected = false;
    }

    async connect() {
        return new Promise((resolve, reject) => {
            this.ws = new WebSocket(this.webSocketDebuggerUrl);
            
            this.ws.on('open', () => {
                this.connected = true;
                resolve();
            });
            
            this.ws.on('error', (error) => {
                this.connected = false;
                reject(error);
            });
            
            this.ws.on('message', (data) => {
                try {
                    const response = JSON.parse(data.toString());
                    const callback = this.callbacks.get(response.id);
                    if (callback) {
                        this.callbacks.delete(response.id);
                        callback(response);
                    }
                } catch (error) {
                    console.error('解析 CDP 响应失败:', error);
                }
            });
            
            this.ws.on('close', () => {
                this.connected = false;
            });
        });
    }

    async send(method, params = {}) {
        if (!this.connected || !this.ws) {
            throw new Error('WebSocket 未连接');
        }

        const id = ++this.requestId;
        return new Promise((resolve, reject) => {
            this.callbacks.set(id, (response) => {
                if (response.error) {
                    reject(new Error(`CDP 错误: ${response.error.message}`));
                } else {
                    resolve(response.result);
                }
            });
            
            this.ws.send(JSON.stringify({ id, method, params }));
        });
    }

    async close() {
        if (this.ws) {
            this.ws.close();
            this.connected = false;
        }
    }
}

export class TabManager {
    constructor(cdpUrl) {
        this.cdpUrl = cdpUrl;
    }

    async getTabs() {
        try {
            const response = await axios.get(`${this.cdpUrl}/json/list`, { timeout: 5000 });
            return response.data;
        } catch (error) {
            log('获取标签页列表失败:', error.message);
            return [];
        }
    }

    async findTabByUrl(url) {
        const tabs = await this.getTabs();
        return tabs.find(tab => tab.url.includes(url));
    }

    async openTab(url) {
        try {
            const response = await axios.put(`${this.cdpUrl}/json/new?url=${encodeURIComponent(url)}`, { timeout: 5000 });
            return response.data;
        } catch (error) {
            log('打开标签页失败:', error.message);
            throw error;
        }
    }

    async closeTab(tabConnection, targetId) {
        try {
            await tabConnection.send('Target.closeTarget', { targetId });
            log(`标签页 ${targetId} 已关闭`);
        } catch (error) {
            log('关闭标签页失败:', error.message);
        }
    }
}

export class BrowserManager {
    constructor(cdpUrl, supervisordConfig = null) {
        this.cdpUrl = cdpUrl;
        this.connections = new Map();
        this.tabManager = new TabManager(cdpUrl);
        this.supervisordConfig = supervisordConfig;
    }

    async getConnection(webSocketDebuggerUrl) {
        let connection = this.connections.get(webSocketDebuggerUrl);
        
        if (!connection || !connection.connected) {
            connection = new TabConnection(webSocketDebuggerUrl);
            await connection.connect();
            this.connections.set(webSocketDebuggerUrl, connection);
        }
        
        return connection;
    }

    async closeConnection(webSocketDebuggerUrl) {
        const connection = this.connections.get(webSocketDebuggerUrl);
        if (connection) {
            await connection.close();
            this.connections.delete(webSocketDebuggerUrl);
        }
    }

    async closeAll() {
        for (const [url, connection] of this.connections) {
            await connection.close();
        }
        this.connections.clear();
    }

}