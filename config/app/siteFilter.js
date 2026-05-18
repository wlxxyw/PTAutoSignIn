import { getTodayDate } from './utils.js';

export function filterSites(sites) {
    const today = getTodayDate();
    const filteredSites = [];
    let configChanged = false;
    
    for (const site of sites) {
        if (site.pause) {
            continue;
        }
        
        if (site.expireDate && site.expireDate <= today) {
            site.pause = true;
            configChanged = true;
            continue;
        }
        
        if (site.date !== today || site.status !== 0) {
            filteredSites.push(site);
        }
    }
    
    return { filteredSites, configChanged };
}

export function updateSiteStatus(site, success) {
    site.date = getTodayDate();
    if (success) {
        site.status = 0;
    } else {
        site.status = (site.status || 0) + 1;
    }
}