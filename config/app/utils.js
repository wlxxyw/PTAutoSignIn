export function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export function log(...args) {
    console.log(`[${new Date().toISOString()}]`, ...args);
}

export function getTodayDate() {
    return new Date().toISOString().split('T')[0];
}