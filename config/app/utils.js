export function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export function log(...args) {
    console.log(`[${new Date().toLocaleString()}]`, ...args);
}

export function getTodayDate() {
    return new Date().toLocaleDateString();
}

export function isAfterNoon() {
    const now = new Date();
    return now.getHours() >= 12;
}