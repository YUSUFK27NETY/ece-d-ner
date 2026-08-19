const express = require("express");
const cors = require("cors");
const admin = require("firebase-admin");
const rateLimit = require("express-rate-limit");
const {
    normalizeRequestedItems,
    priceRequestedItems
} = require("./order-pricing");
const {
    createOriginValidator
} = require("./cors-policy");
const {
    validateOrderRequest
} = require("./order-request");
const {
    hasAdminClaim
} = require("./admin-auth");
const {
    normalizeOrderIdentifier,
    createOrderNumber
} = require("./order-identifier");

const app = express();

/* ==========================================
   AYARLAR
========================================== */

const PORT = process.env.PORT || 3000;

app.set("trust proxy", 1);

/* ==========================================
   CORS
========================================== */

app.use(
    cors({
        origin:
            createOriginValidator(
                process.env.FRONTEND_URL
            ),

        methods: [
            "GET",
            "POST",
            "PATCH",
            "DELETE",
            "OPTIONS"
        ],

        allowedHeaders: [
            "Content-Type",
            "Authorization"
        ]
    })
);

/* ==========================================
   BODY
========================================== */

app.use(
    express.json({
        limit: "100kb"
    })
);

/* ==========================================
   RATE LIMIT
========================================== */

const generalLimiter =
    rateLimit({
        windowMs: 15 * 60 * 1000,
        max: 300,

        standardHeaders: true,
        legacyHeaders: false,

        message: {
            success: false,
            message:
                "Çok fazla istek gönderildi. Lütfen daha sonra tekrar deneyin."
        }
    });

app.use(
    "/api/",
    generalLimiter
);


/* ==========================================
   SİPARİŞ RATE LIMIT
========================================== */

const orderCreateLimiter =
    rateLimit({
        windowMs: 10 * 60 * 1000,
        max: 20,

        standardHeaders: true,
        legacyHeaders: false,

        message: {
            success: false,
            message:
                "Çok fazla sipariş isteği gönderildi. Lütfen biraz bekleyin."
        }
    });


/* ==========================================
   FIREBASE ADMIN
========================================== */

const SERVICE_ACCOUNT_PATH =
    "/etc/secrets/firebase-service-account.json";

try {

    const serviceAccount =
        require(SERVICE_ACCOUNT_PATH);

    admin.initializeApp({
        credential:
            admin.credential.cert(serviceAccount)
    });

    console.log(
        "================================="
    );

    console.log(
        " FIREBASE ADMIN AKTİF"
    );

    console.log(
        "================================="
    );

    console.log(
        " Firebase Project:",
        serviceAccount.project_id
    );

    console.log(
        " Firestore bağlantısı hazır."
    );

    console.log(
        " Firebase Auth doğrulaması hazır."
    );

    console.log(
        "================================="
    );

} catch (error) {

    console.error(
        "================================="
    );

    console.error(
        " FIREBASE BAĞLANTI HATASI"
    );

    console.error(
        "================================="
    );

    console.error(
        error.message
    );

    console.error(
        "================================="
    );

    process.exit(1);
}


/* ==========================================
   FIRESTORE
========================================== */

const db =
    admin.firestore();

const ordersCollection =
    db.collection("orders");

const productsCollection =
    db.collection("products");

/*
   Manuel restoran durumu:

   settings
      └── restaurant
            └── isOpen: true / false
*/

const settingsCollection =
    db.collection("settings");

const restaurantSettingsRef =
    settingsCollection.doc("restaurant");


async function findOrderDocument(
    rawIdentifier
) {

    const identifier =
        normalizeOrderIdentifier(
            rawIdentifier
        );

    if (!identifier) {

        return {
            valid: false,
            doc: null
        };
    }

    const directSnapshot =
        await ordersCollection
            .doc(identifier)
            .get();

    if (directSnapshot.exists) {

        return {
            valid: true,
            doc: directSnapshot
        };
    }

    const legacyId =
        Number(identifier);

    if (Number.isSafeInteger(legacyId)) {

        const legacySnapshot =
            await ordersCollection
                .where(
                    "id",
                    "==",
                    legacyId
                )
                .limit(1)
                .get();

        if (!legacySnapshot.empty) {

            return {
                valid: true,
                doc: legacySnapshot.docs[0]
            };
        }
    }

    return {
        valid: true,
        doc: null
    };
}


/* ==========================================
   ADMIN AUTH MIDDLEWARE
========================================== */

async function requireAdmin(
    req,
    res,
    next
) {

    try {

        const authorization =
            req.headers.authorization || "";

        if (
            !authorization.startsWith(
                "Bearer "
            )
        ) {

            return res.status(401).json({

                success: false,

                message:
                    "Yetkilendirme gerekli."

            });
        }

        const idToken =
            authorization
                .substring(7)
                .trim();

        if (!idToken) {

            return res.status(401).json({

                success: false,

                message:
                    "Geçersiz yetkilendirme."

            });
        }

        const decodedToken =
            await admin
                .auth()
                .verifyIdToken(idToken);

        if (!hasAdminClaim(decodedToken)) {

            return res.status(403).json({

                success: false,

                message:
                    "Yönetici yetkisi gerekli."

            });
        }

        req.user =
            decodedToken;

        next();

    } catch (error) {

        console.error(
            "Admin token doğrulama hatası:",
            error.message
        );

        return res.status(401).json({

            success: false,

            message:
                "Oturum geçersiz veya süresi dolmuş."

        });
    }
}


/* ==========================================
   YARDIMCI FONKSİYONLAR
========================================== */

function cleanString(
    value,
    maxLength = 500
) {

    return String(
        value ?? ""
    )
        .trim()
        .slice(0, maxLength);
}


/* ==========================================
   RESTORAN DURUMU
========================================== */

/*
   Firestore'dan restoran durumunu okur.

   Ayar belgesi yoksa güvenli biçimde KAPALI kabul edilir.
   Durumu yalnızca admin endpoint'i değiştirir.
*/

async function getRestaurantStatus() {

    const snapshot =
        await restaurantSettingsRef.get();

    if (!snapshot.exists) {

        console.warn(
            "Restoran ayarı bulunamadı; güvenli varsayılan KAPALI."
        );

        return false;
    }

    return (
        snapshot.data().isOpen === true
    );
}


/* ==========================================
   RESTORAN DURUMU - MÜŞTERİ
========================================== */

app.get(
    "/api/restaurant/status",
    async (req, res) => {

        try {

            const isOpen =
                await getRestaurantStatus();

            res.json({

                success: true,

                isOpen,

                status:
                    isOpen
                        ? "open"
                        : "closed",

                message:
                    isOpen
                        ? "Restoran şu anda açık."
                        : "Restoran şu anda kapalı."

            });

        } catch (error) {

            console.error(
                "Restoran durumu alınamadı:",
                error.message
            );

            res.status(500).json({

                success: false,

                message:
                    "Restoran durumu alınamadı."

            });
        }
    }
);


/* ==========================================
   RESTORAN DURUMU - ADMIN
   AÇ / KAPAT
========================================== */

app.patch(
    "/api/admin/restaurant/status",
    requireAdmin,
    async (req, res) => {

        try {

            const isOpen =
                req.body?.isOpen;

            /*
               Sadece true / false kabul edilir.
            */

            if (
                typeof isOpen !== "boolean"
            ) {

                return res.status(400).json({

                    success: false,

                    message:
                        "isOpen değeri true veya false olmalıdır."

                });
            }


            await restaurantSettingsRef.set({

                isOpen,

                updatedAt:
                    new Date().toISOString(),

                updatedBy:
                    req.user?.uid || null

            }, {
                merge: true
            });


            console.log(
                `RESTORAN DURUMU: ${
                    isOpen
                        ? "AÇIK"
                        : "KAPALI"
                }`
            );


            res.json({

                success: true,

                isOpen,

                status:
                    isOpen
                        ? "open"
                        : "closed",

                message:
                    isOpen
                        ? "Restoran açıldı."
                        : "Restoran kapatıldı."

            });

        } catch (error) {

            console.error(
                "Restoran durumu güncellenemedi:",
                error.message
            );

            res.status(500).json({

                success: false,

                message:
                    "Restoran durumu güncellenemedi."

            });
        }
    }
);


/* ==========================================
   ANA TEST
========================================== */

app.get(
    "/",
    async (req, res) => {

        try {

            const snapshot =
                await ordersCollection
                    .limit(1)
                    .get();

            const isOpen =
                await getRestaurantStatus();

            res.json({

                success: true,

                message:
                    "QR Menü Pro Backend çalışıyor.",

                firebase: true,

                firestore: true,

                firebaseAuth: true,

                restaurantStatus:
                    isOpen
                        ? "open"
                        : "closed",

                restaurantOpen:
                    isOpen,

                ordersCollection:
                    "orders",

                hasOrders:
                    !snapshot.empty

            });

        } catch (error) {

            console.error(
                "Ana test hatası:",
                error.message
            );

            res.status(500).json({

                success: false,

                message:
                    "Backend test hatası."

            });
        }
    }
);


/* ==========================================
   TÜM SİPARİŞLER
   SADECE ADMIN
========================================== */

app.get(
    "/api/orders",
    requireAdmin,
    async (req, res) => {

        try {

            const snapshot =
                await ordersCollection
                    .orderBy(
                        "createdAt",
                        "desc"
                    )
                    .limit(200)
                    .get();

            const orders = [];

            snapshot.forEach(
                doc => {

                    orders.push({

                        firestoreId:
                            doc.id,

                        ...doc.data()

                    });

                }
            );

            res.json({

                success: true,

                orders

            });

        } catch (error) {

            console.error(
                "Siparişler alınamadı:",
                error.message
            );

            res.status(500).json({

                success: false,

                message:
                    "Siparişler alınamadı."

            });
        }
    }
);


/* ==========================================
   YENİ SİPARİŞ
   MÜŞTERİ TARAFI
========================================== */

app.post(
    "/api/orders",
    orderCreateLimiter,
    async (req, res) => {

        try {

            /*
               ==================================
               KRİTİK KONTROL
               ==================================

               Restoran kapalıysa frontend
               kandırılsa bile backend sipariş
               kabul etmez.
            */

            const isOpen =
                await getRestaurantStatus();

            if (!isOpen) {

                return res.status(403).json({

                    success: false,

                    message:
                        "Restoran şu anda kapalı. Sipariş alınamıyor."

                });
            }


            const orderData =
                req.body;


            const orderRequestResult =
                validateOrderRequest(
                    orderData
                );

            if (!orderRequestResult.ok) {

                return res
                    .status(orderRequestResult.status)
                    .json({

                        success: false,

                        message:
                            orderRequestResult.message

                    });
            }

            const {
                customerName,
                phone,
                orderType,
                address,
                tableNumber,
                note
            } = orderRequestResult.details;


            const requestedItemsResult =
                normalizeRequestedItems(
                    orderData.items
                );

            if (!requestedItemsResult.ok) {

                return res
                    .status(requestedItemsResult.status)
                    .json({

                        success: false,

                        message:
                            requestedItemsResult.message

                    });
            }


            /* --------------------------
               FİYATLAR FIRESTORE'DAN
            -------------------------- */

            const productRefs =
                requestedItemsResult.items
                    .map(item =>
                        productsCollection.doc(
                            item.productId
                        )
                    );

            const productSnapshots =
                await db.getAll(
                    ...productRefs
                );

            const productsById =
                new Map();

            productSnapshots.forEach(
                snapshot => {

                    if (snapshot.exists) {

                        productsById.set(
                            snapshot.id,
                            snapshot.data()
                        );
                    }
                }
            );

            const pricedOrderResult =
                priceRequestedItems(
                    requestedItemsResult.items,
                    productsById
                );

            if (!pricedOrderResult.ok) {

                return res
                    .status(pricedOrderResult.status)
                    .json({

                        success: false,

                        message:
                            pricedOrderResult.message

                    });
            }

            const items =
                pricedOrderResult.items;

            const total =
                pricedOrderResult.total;


            /* --------------------------
               SİPARİŞ NUMARASI
            -------------------------- */

            const docRef =
                ordersCollection.doc();

            const id =
                docRef.id;

            const orderNumber =
                createOrderNumber(
                    docRef.id
                );


            /* --------------------------
               YENİ SİPARİŞ
            -------------------------- */

            const newOrder = {

                id,

                orderNumber,

                customerName,

                phone,

                orderType,

                address,

                tableNumber,

                note,

                items,

                total,

                status:
                    "new",

                createdAt:
                    new Date()
                        .toISOString()

            };


            /* --------------------------
               FIRESTORE
            -------------------------- */

            await docRef.set(
                newOrder
            );


            console.log("");

            console.log(
                "Yeni sipariş:",
                orderNumber
            );

            console.log(
                "Firestore ID:",
                docRef.id
            );

            console.log(
                "Toplam:",
                total + "₺"
            );

            console.log("");



            res.status(201).json({

                success: true,

                message:
                    "Sipariş başarıyla oluşturuldu.",

                order: {

                    firestoreId:
                        docRef.id,

                    ...newOrder

                }

            });

        } catch (error) {

            console.error(
                "Sipariş oluşturma hatası:",
                error.message
            );

            res.status(500).json({

                success: false,

                message:
                    "Sipariş oluşturulamadı."

            });
        }
    }
);


/* ==========================================
   SİPARİŞ DURUMU DEĞİŞTİR
   SADECE ADMIN
========================================== */

app.patch(
    "/api/orders/:id/status",
    requireAdmin,
    async (req, res) => {

        try {

            const status =
                cleanString(
                    req.body?.status,
                    30
                );

            const validStatuses = [

                "new",

                "preparing",

                "ready",

                "completed"

            ];


            if (
                !validStatuses.includes(
                    status
                )
            ) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Geçersiz sipariş durumu."

                });
            }


            const orderLookup =
                await findOrderDocument(
                    req.params.id
                );

            if (!orderLookup.valid) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Geçersiz sipariş ID."

                });
            }


            if (!orderLookup.doc) {

                return res.status(404).json({

                    success: false,

                    message:
                        "Sipariş bulunamadı."

                });
            }


            const doc =
                orderLookup.doc;


            await doc.ref.update({

                status

            });


            const updatedOrder = {

                firestoreId:
                    doc.id,

                ...doc.data(),

                status

            };


            res.json({

                success: true,

                message:
                    "Sipariş durumu güncellendi.",

                order:
                    updatedOrder

            });

        } catch (error) {

            console.error(
                "Durum güncelleme hatası:",
                error.message
            );

            res.status(500).json({

                success: false,

                message:
                    "Sipariş durumu güncellenemedi."

            });
        }
    }
);


/* ==========================================
   SİPARİŞ SİL
   SADECE ADMIN
========================================== */

app.delete(
    "/api/orders/:id",
    requireAdmin,
    async (req, res) => {

        try {

            const orderLookup =
                await findOrderDocument(
                    req.params.id
                );

            if (!orderLookup.valid) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Geçersiz sipariş ID."

                });
            }


            if (!orderLookup.doc) {

                return res.status(404).json({

                    success: false,

                    message:
                        "Sipariş bulunamadı."

                });
            }


            const doc =
                orderLookup.doc;


            await doc.ref.delete();


            res.json({

                success: true,

                message:
                    "Sipariş başarıyla silindi."

            });

        } catch (error) {

            console.error(
                "Sipariş silme hatası:",
                error.message
            );

            res.status(500).json({

                success: false,

                message:
                    "Sipariş silinemedi."

            });
        }
    }
);


/* ==========================================
   404
========================================== */

app.use(
    (req, res) => {

        res.status(404).json({

            success: false,

            message:
                "Endpoint bulunamadı."

        });

    }
);


/* ==========================================
   GENEL HATA
========================================== */

app.use(
    (error, req, res, next) => {

        console.error(
            "Sunucu hatası:",
            error.message
        );

        res.status(500).json({

            success: false,

            message:
                "Sunucu hatası oluştu."

        });

    }
);


/* ==========================================
   SUNUCU
========================================== */

app.listen(
    PORT,
    "0.0.0.0",
    () => {

        console.log("");

        console.log(
            "================================="
        );

        console.log(
            " QR MENÜ PRO BACKEND"
        );

        console.log(
            "================================="
        );

        console.log(
            ` Port: ${PORT}`
        );

        console.log(
            " Firebase Firestore: AKTİF"
        );

        console.log(
            " Firebase Auth: AKTİF"
        );

        console.log(
            " Admin API koruması: AKTİF"
        );

        console.log(
            " Rate Limit: AKTİF"
        );

        console.log(
            " Manuel restoran kontrolü: AKTİF"
        );

        console.log(
            " Kalıcı sipariş sistemi: AKTİF"
        );

        console.log(
            "================================="
        );

        console.log("");

    }
);

