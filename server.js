const express = require("express");
const cors = require("cors");
const admin = require("firebase-admin");
const rateLimit = require("express-rate-limit");

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

            // Mobil uygulamalar / Postman / doğrudan istekler
            if (!origin) {
                return callback(null, true);
            }

            // FRONTEND_URL Render'da tanımlı değilse
            // geçici olarak tüm originlere izin ver.
            if (!FRONTEND_URL) {
                return callback(null, true);
            }

            const allowedOrigins =
                FRONTEND_URL
                    .split(",")
                    .map(url => url.trim())
                    .filter(Boolean);

            if (
                allowedOrigins.includes(origin)
            ) {
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

/*
   Genel API limiti.
*/

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

app.use("/api/", generalLimiter);


/*
   Sipariş oluşturma için daha sıkı limit.

   Aynı IP'nin kısa sürede
   binlerce sahte sipariş göndermesini engeller.
*/

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


const db =
    admin.firestore();

const ordersCollection =
    db.collection("orders");


/* ==========================================
   ADMIN AUTH MIDDLEWARE
========================================== */

/*
   Admin panelinden gelen istek:

   Authorization:
   Bearer FIREBASE_ID_TOKEN

   şeklinde olmalı.

   Firebase token geçerli değilse
   istek reddedilir.
*/

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
           Şimdilik Firebase'e giriş yapmış
           kullanıcıları admin kabul ediyoruz.

           Daha ileri güvenlikte custom claim
           ile sadece admin rolünü kabul edeceğiz.
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


function cleanPositiveNumber(
    value
) {

    const number =
        Number(value);

    if (
        !Number.isFinite(number) ||
        number < 0
    ) {
        return null;
    }

    return number;
}


function cleanQuantity(
    value
) {

    const quantity =
        Number(value);

    if (
        !Number.isFinite(quantity) ||
        quantity <= 0 ||
        quantity > 99
    ) {
        return null;
    }

    return Math.floor(quantity);
}


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

            res.json({

                success: true,

                message:
                    "QR Menü Pro Backend çalışıyor.",

                firebase: true,

                firestore: true,

                firebaseAuth: true,

                ordersCollection:
                    "orders",

                hasOrders:
                    !snapshot.empty

            });

        } catch (error) {

            console.error(
                "Firestore test hatası:",
                error.message
            );

            res.status(500).json({

                success: false,

                message:
                    "Firestore bağlantı hatası."

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


            if (
                !Array.isArray(
                    orderData.items
                ) ||
                orderData.items.length === 0
            ) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Sipariş sepeti boş."

                });
            }


            /*
               Maksimum ürün sayısı.
            */

            if (
                orderData.items.length > 50
            ) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Siparişte çok fazla ürün var."

                });
            }


            /* --------------------------
               ÜRÜNLERİ TEMİZLE
            -------------------------- */

            const items =
                orderData.items
                    .map(item => {

                        if (
                            !item ||
                            typeof item !== "object"
                        ) {
                            return null;
                        }

                        const name =
                            cleanString(
                                item.name ||
                                "Ürün",
                                150
                            );

                        const price =
                            cleanPositiveNumber(
                                item.price
                            );

                        const quantity =
                            cleanQuantity(
                                item.quantity
                            );

                        if (
                            !name ||
                            price === null ||
                            quantity === null
                        ) {
                            return null;
                        }

                        return {

                            name,

                            price,

                            quantity

                        };

                    })
                    .filter(Boolean);


            if (
                items.length === 0
            ) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Geçerli ürün bulunamadı."

                });
            }


            /* --------------------------
               TOPLAM SUNUCUDA HESAPLANIR
            -------------------------- */

            const total =
                items.reduce(
                    (
                        sum,
                        item
                    ) => {

                        return (
                            sum +
                            (
                                item.price *
                                item.quantity
                            )
                        );

                    },
                    0
                );


            /*
               Aşırı büyük toplamları engelle.
            */

            if (
                total <= 0 ||
                total > 100000
            ) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Geçersiz sipariş toplamı."

                });
            }


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
            " Kalıcı sipariş sistemi: AKTİF"
        );

        console.log(
            "================================="
        );

        console.log("");

    }
);
