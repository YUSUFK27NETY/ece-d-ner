const express = require("express");
const cors = require("cors");
const admin = require("firebase-admin");
const rateLimit = require("express-rate-limit");
const {
    normalizeRequestedItems,
    priceRequestedItems
} = require("./order-pricing");

const app = express();

/* ==========================================
   AYARLAR
========================================== */

const PORT = process.env.PORT || 3000;

const FRONTEND_URL =
    process.env.FRONTEND_URL || "";

app.set("trust proxy", 1);

/* ==========================================
   CORS
========================================== */

app.use(
    cors({
        origin: function (origin, callback) {

            // Mobil uygulama / Postman / doğrudan istek
            if (!origin) {
                return callback(null, true);
            }

            // FRONTEND_URL tanımlı değilse mevcut sistem bozulmasın
            if (!FRONTEND_URL) {
                return callback(null, true);
            }

            const allowedOrigins =
                FRONTEND_URL
                    .split(",")
                    .map(url => url.trim())
                    .filter(Boolean);

            if (allowedOrigins.includes(origin)) {
                return callback(null, true);
            }

            return callback(
                new Error("CORS engellendi.")
            );
        },

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

        /*
           Mevcut sistemde Firebase'e
           giriş yapmış kullanıcı admin
           olarak kabul ediliyor.
        */

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


function cleanPhone(value) {

    return String(
        value ?? ""
    )
        .replace(/[^\d+]/g, "")
        .slice(0, 20);
}


/* ==========================================
   RESTORAN DURUMU
========================================== */

/*
   Firestore'dan restoran durumunu okur.

   İlk kez çalışıyorsa:
   restoran otomatik olarak AÇIK başlar.

   Daha sonra sadece admin değiştirir.
*/

async function getRestaurantStatus() {

    const snapshot =
        await restaurantSettingsRef.get();

    if (!snapshot.exists) {

        await restaurantSettingsRef.set({

            isOpen: true,

            updatedAt:
                new Date().toISOString()

        });

        return true;
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


            if (
                !orderData ||
                typeof orderData !== "object" ||
                Array.isArray(orderData)
            ) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Geçersiz sipariş verisi."

                });
            }


            /* --------------------------
               MÜŞTERİ BİLGİLERİ
            -------------------------- */

            const customerName =
                cleanString(
                    orderData.customerName,
                    100
                );

            const phone =
                cleanPhone(
                    orderData.phone
                );

            const orderType =
                cleanString(
                    orderData.orderType ||
                    "Paket Sipariş",
                    50
                );

            const address =
                cleanString(
                    orderData.address,
                    500
                );

            const tableNumber =
                cleanString(
                    orderData.tableNumber,
                    30
                );

            const note =
                cleanString(
                    orderData.note,
                    500
                );


            /* --------------------------
               TEMEL KONTROLLER
            -------------------------- */

            if (!customerName) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Müşteri adı gerekli."

                });
            }


            if (!phone) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Telefon numarası gerekli."

                });
            }


            /*
               Paket siparişte adres zorunlu.
            */

            if (
                orderType
                    .toLowerCase()
                    .includes("paket") &&
                !address
            ) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Adres gerekli."

                });
            }


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

            const id =
                Date.now();

            const orderNumber =
                `ECE-${id
                    .toString()
                    .slice(-6)}`;


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

            const docRef =
                await ordersCollection
                    .add(newOrder);


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

            const orderId =
                Number(
                    req.params.id
                );

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
                !Number.isSafeInteger(
                    orderId
                )
            ) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Geçersiz sipariş ID."

                });
            }


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


            const snapshot =
                await ordersCollection
                    .where(
                        "id",
                        "==",
                        orderId
                    )
                    .limit(1)
                    .get();


            if (
                snapshot.empty
            ) {

                return res.status(404).json({

                    success: false,

                    message:
                        "Sipariş bulunamadı."

                });
            }


            const doc =
                snapshot.docs[0];


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

            const orderId =
                Number(
                    req.params.id
                );


            if (
                !Number.isSafeInteger(
                    orderId
                )
            ) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Geçersiz sipariş ID."

                });
            }


            const snapshot =
                await ordersCollection
                    .where(
                        "id",
                        "==",
                        orderId
                    )
                    .limit(1)
                    .get();


            if (
                snapshot.empty
            ) {

                return res.status(404).json({

                    success: false,

                    message:
                        "Sipariş bulunamadı."

                });
            }


            const doc =
                snapshot.docs[0];


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

