"use strict";

function hasAdminClaim(decodedToken) {
    return (
        decodedToken !== null &&
        typeof decodedToken === "object" &&
        decodedToken.admin === true
    );
}

module.exports = {
    hasAdminClaim
};
