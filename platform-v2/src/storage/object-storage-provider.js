class ObjectStorageProvider {
    async putObject() {
        throw new Error("putObject uygulanmalı.");
    }

    async getObject() {
        throw new Error("getObject uygulanmalı.");
    }

    async listObjects() {
        throw new Error("listObjects uygulanmalı.");
    }

    async deleteObject() {
        throw new Error("deleteObject uygulanmalı.");
    }
}

function assertStorageProvider(provider) {
    const requiredMethods = [
        "putObject",
        "getObject",
        "listObjects",
        "deleteObject"
    ];

    for (const method of requiredMethods) {
        if (!provider || typeof provider[method] !== "function") {
            throw new TypeError(`Storage provider ${method} metodunu uygulamalı.`);
        }
    }

    return provider;
}

module.exports = {
    ObjectStorageProvider,
    assertStorageProvider
};
