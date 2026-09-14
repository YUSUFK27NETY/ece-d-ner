(() => {
    "use strict";

    const bootstrap = window.PLATFORM_BOOTSTRAP || {};
    const firebaseConfig = bootstrap.firebase;
    const APP_NAME = "platform-admin-auth";

    if (!firebaseConfig || typeof firebase === "undefined" ||
        !Array.isArray(firebase.apps) || typeof firebase.initializeApp !== "function" ||
        typeof firebase.auth !== "function") {
        return;
    }

    const authFactory = firebase.auth;
    let adminApp = firebase.apps.find(app => app?.name === APP_NAME) || null;
    if (!adminApp) {
        adminApp = firebase.initializeApp(firebaseConfig, APP_NAME);
    }

    const adminAuth = Reflect.apply(authFactory, firebase, [adminApp]);
    const scopedAuthFactory = new Proxy(authFactory, {
        apply(target, _thisArg, args) {
            if (!args || args.length === 0) return adminAuth;
            return Reflect.apply(target, firebase, args);
        }
    });

    try {
        firebase.auth = scopedAuthFactory;
    } catch {
        try {
            Object.defineProperty(firebase, "auth", {
                configurable: true,
                writable: true,
                value: scopedAuthFactory
            });
        } catch {
            return;
        }
    }

    if (firebase.auth !== scopedAuthFactory) return;

    Object.defineProperty(window, "PLATFORM_ADMIN_AUTH", {
        configurable: false,
        enumerable: false,
        writable: false,
        value: adminAuth
    });
})();
