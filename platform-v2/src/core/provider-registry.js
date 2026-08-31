class ProviderRegistry {
    #providers = new Map();

    register(name, provider) {
        const key = String(name ?? "").trim();

        if (!key) {
            throw new TypeError("Provider adı gerekli.");
        }

        if (!provider) {
            throw new TypeError("Provider instance gerekli.");
        }

        this.#providers.set(key, provider);
        return this;
    }

    get(name) {
        const key = String(name ?? "").trim();
        const provider = this.#providers.get(key);

        if (!provider) {
            throw new Error(`Provider kayıtlı değil: ${key}`);
        }

        return provider;
    }

    has(name) {
        return this.#providers.has(String(name ?? "").trim());
    }
}

module.exports = {
    ProviderRegistry
};
