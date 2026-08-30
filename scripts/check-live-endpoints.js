"use strict";

const {
    checkLiveEndpoints
} = require("../live-health");

async function main() {
    try {
        const result = await checkLiveEndpoints({
            frontendUrl:
                process.env.FRONTEND_HEALTH_URL,
            backendHealthUrl:
                process.env.BACKEND_HEALTH_URL,
            backendStatusUrl:
                process.env.BACKEND_STATUS_URL
        });

        console.log(
            JSON.stringify({
                event: "live_health_check",
                ...result
            })
        );
    } catch (error) {
        console.error(
            JSON.stringify({
                event: "live_health_check_failed",
                checkedAt: new Date().toISOString(),
                message: error.message
            })
        );
        process.exitCode = 1;
    }
}

main();
