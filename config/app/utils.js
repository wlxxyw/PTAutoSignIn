export function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export function sleepRandom(min, max) {
  const ms = Math.floor(Math.random() * (max - min + 1)) + min;
  return sleep(ms);
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