const axios = require('axios');
const cron = require('node-cron');

// Configuration
const uptimeRobotApiKey = 'ur2668505-c1c0b82ddde31edbbf4effb0';
const cloudflareApiKey = 'lXNHQjU2DWm-UMpORU-69-RtTm9FxBjpFKqIIvqb';
const cloudflareZoneId = 'ee57d0e2d8ab3de831a2a93d83391ef4';
const checkInterval = '*/1 * * * *'; // Every 1 minute

const backupIP = '62.171.134.159';

// DNS entries to switch for each monitor - these numbers are the monitor IDs from uptime robot
// Add more monitors as objects with IDs inside of the monitorConfig (no upper limit)
const monitorConfig = {
    '797680283': { // Backend server monitor ID
        dnsEntries: ['accounts.openguessr.com', 'competitions.openguessr.com', 'maps.openguessr.com'], // '@' for root domain or '*' for wildcard subdomains is not supported - the Cloudflare API wants to get these as example.com or *.example.com
        primaryIP: '45.10.163.87'
    }
};

// Tracking DNS state
let currentDNSState = {};

// Control whether DNS entries should actually be switched (for debugging)
const switchDNS = true; // Set to `true` to enable DNS switching

// Fetch the current state of DNS entries
async function fetchCurrentDNSState() {
    try {
        const response = await axios.get(`https://api.cloudflare.com/client/v4/zones/${cloudflareZoneId}/dns_records`, {
            headers: { Authorization: `Bearer ${cloudflareApiKey}` }
        });

        // Reset currentDNSState
        currentDNSState = {};

        response.data.result.forEach(record => {
            if (record.type === 'A') {
                currentDNSState[record.name] = record.content;
            }
        });

        console.log('Current DNS State:', currentDNSState); // Debugging line to check state

    } catch (error) {
        console.error('Error fetching DNS state:', error);
    }
}

// Switch DNS entry's IP if it's not already using that IP
async function switchCloudflareDNS(entry, targetIP) {
    try {
        const response = await axios.get(`https://api.cloudflare.com/client/v4/zones/${cloudflareZoneId}/dns_records?name=${entry}`, {
            headers: { Authorization: `Bearer ${cloudflareApiKey}` }
        });

        const record = response.data.result[0];
        if (record) {
            if (record.content !== targetIP) {
                if (switchDNS) {
                    await axios.patch(`https://api.cloudflare.com/client/v4/zones/${cloudflareZoneId}/dns_records/${record.id}`, {
                        content: targetIP // Only updating the content (IP address)
                    }, {
                        headers: { Authorization: `Bearer ${cloudflareApiKey}` }
                    });

                    console.log(`Switched DNS for ${entry} to ${targetIP}`);
                } else {
                    console.log(`DNS switch for ${entry} to ${targetIP} skipped (switchDNS is false).`);
                }
                currentDNSState[entry] = targetIP;
            } else {
                console.log(`${entry} was checked in switchCloudflareDNS function and was found to be already pointed to the correct IP (${targetIP}).`);
            }
        } else {
            console.log(`DNS Record for ${entry} was not found.`);
        }
    } catch (error) {
        console.error(`Error switching DNS for ${entry}:`, error);
    }
}

// Check UptimeRobot status for a monitor
async function checkUptimeRobotMonitor(monitorId) {
    try {
        const response = await axios.post(
            `https://api.uptimerobot.com/v2/getMonitors`,
            `api_key=${uptimeRobotApiKey}&monitors=${monitorId}&format=json`,
            { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
        );

        // Check if the response contains the expected structure
        if (response.data && response.data.monitors && response.data.monitors.length > 0) {
            const monitor = response.data.monitors[0];
            return monitor.status === 2; // 2 means the server is online
        } else {
            console.error(`Unexpected UptimeRobot API response for monitor ${monitorId}:`, response.data);
            return null; // Treat as an error
        }
    } catch (error) {
        console.error(`Error checking monitor ${monitorId}:`, error);
        return null; // Treat as an error
    }
}

// Handle DNS switching logic based on UptimeRobot status
async function handleFailover(monitorId, config) {
    const isOnline = await checkUptimeRobotMonitor(monitorId);
    
    if (isOnline == null) {
        console.log(`Monitor ${monitorId} status unavailable, skipping DNS switching.`);
        return;
    }

    for (const entry of config.dnsEntries) {
        const currentState = currentDNSState[entry] || config.primaryIP; // Get the current state (IP) from fetched data
        const targetIP = isOnline ? config.primaryIP : backupIP;

        if (currentState !== targetIP) {
            console.log(`${entry} is ${isOnline ? 'online' : 'offline'}. Switching DNS to ${targetIP}.`);
            await switchCloudflareDNS(entry, targetIP);
        } else {
            console.log(`${entry} is already pointed to the correct IP (${targetIP}).`);
        }
    }
}

// Periodically check servers and switch DNS if necessary
async function checkServers() {
    await fetchCurrentDNSState();

    for (const [monitorId, config] of Object.entries(monitorConfig)) {
        await handleFailover(monitorId, config);
    }
}

// Schedule DNS checks every 1 minute
cron.schedule(checkInterval, checkServers);

console.log('Failover system initialized.');

// Test - switch the locations subdomain over to its primary ip (that it is already using)
// switchCloudflareDNS(monitorConfig[797680280].dnsEntries[0], monitorConfig[797680280].primaryIP);
