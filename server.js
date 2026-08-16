const express = require("express");
const cors = require("cors");
const admin = require("firebase-admin");

const app = express();

/* =========================================================
   AYARLAR
========================================================= */

const PORT = process.env.PORT || 3000;

const SERVICE_ACCOUNT_PATH =
    "/etc/secrets/firebase-service-account.json";

/* =========================================================
   MIDDLEWARE
========================================================= */

app.disable("x-powered-by");

app.use(cors());

app.use(
    express.json({
        limit: "1mb"
    })
);

/* =========================================================
   FIREBASE ADMIN
========================================================= */

try {
    const serviceAccount =
        require(SERVICE_ACCOUNT_PATH);

    admin.initializeApp({
        credential:
            admin.credential.cert(serviceAccount)
    });

    console.log("");
    console.log("=================================");
    console.log(" FIREBASE ADMIN AKTİF");
    console.log("=================================");
    console.log(
        " Firebase Project:",
        serviceAccount.project_id
    );
    console.log(" Firestore bağlantısı hazır.");
    console.log("=================================");
    console.log("");

} catch (error) {

    console.error("");
    console.error("=================================");
    console.error(" FIREBASE BAĞLANTI HATASI");
    console.error("=================================");
    console.error(error.message);
    console.error("=================================");
    console.error("");

    process.exit(1);
}

/* =========================================================
   FIRESTORE
========================================================= */

const db =
    admin.firestore();

const ordersCollection =
    db.collection("orders");

/* =========================================================
   YARDIMCI FONKSİYONLAR
========================================================= */

function cleanString(value) {
    return String(value ?? "").trim();
}

function isValidPhone(phone) {
    const digits =
        phone.replace(/\D/g, "");

    return digits.length >= 10;
}

function createOrderNumber() {

    const id =
        Date.now();

    return {
        id,
        orderNumber:
            `ECE-${id
                .toString()
                .slice(-6)}`
    };
}

/* =========================================================
   ANA / HEALTH TESTİ
========================================================= */

app.get("/", async (req, res) => {

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

            ordersCollection:
                "orders",

            hasOrders:
                !snapshot.empty

        });

    } catch (error) {

        console.error(
            "Firestore test hatası:",
            error
        );

        res.status(500).json({

            success: false,

            message:
                "Firestore bağlantı hatası."

        });
    }
});

/* =========================================================
   TÜM SİPARİŞLER
========================================================= */

app.get("/api/orders", async (req, res) => {

    try {

        const snapshot =
            await ordersCollection
                .orderBy(
                    "createdAt",
                    "desc"
                )
                .get();

        const orders = [];

        snapshot.forEach(doc => {

            orders.push({

                firestoreId:
                    doc.id,

                ...doc.data()

            });

        });

        res.json({

            success: true,

            orders

        });

    } catch (error) {

        console.error(
            "Siparişler alınamadı:",
            error
        );

        res.status(500).json({

            success: false,

            message:
                "Siparişler alınamadı."

        });
    }
});

/* =========================================================
   YENİ SİPARİŞ
========================================================= */

app.post("/api/orders", async (req, res) => {

    try {

        const orderData =
            req.body;

        /* -----------------------------------------------
           GENEL VERİ KONTROLÜ
        ------------------------------------------------ */

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

        /* -----------------------------------------------
           MÜŞTERİ BİLGİLERİ
        ------------------------------------------------ */

        const customerName =
            cleanString(
                orderData.customerName
            );

        const phone =
            cleanString(
                orderData.phone
            );

        const orderType =
            cleanString(
                orderData.orderType ||
                "Paket Sipariş"
            );

        const address =
            cleanString(
                orderData.address
            );

        const tableNumber =
            cleanString(
                orderData.tableNumber
            );

        const note =
            cleanString(
                orderData.note
            );

        /* -----------------------------------------------
           ZORUNLU ALANLAR
        ------------------------------------------------ */

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

        if (!isValidPhone(phone)) {

            return res.status(400).json({

                success: false,

                message:
                    "Geçerli bir telefon numarası girin."

            });
        }

        /* -----------------------------------------------
           SİPARİŞ TİPİNE GÖRE ADRES / MASA
        ------------------------------------------------ */

        const normalizedOrderType =
            orderType.toLowerCase();

        const isTableOrder =
            normalizedOrderType.includes("masa") ||
            normalizedOrderType.includes("restoran") ||
            normalizedOrderType.includes("salon");

        const isDeliveryOrder =
            normalizedOrderType.includes("paket") ||
            normalizedOrderType.includes("adres") ||
            normalizedOrderType.includes("teslim");

        if (
            isDeliveryOrder &&
            !address
        ) {

            return res.status(400).json({

                success: false,

                message:
                    "Paket siparişi için adres gerekli."

            });
        }

        if (
            isTableOrder &&
            !tableNumber
        ) {

            return res.status(400).json({

                success: false,

                message:
                    "Masa numarası gerekli."

            });
        }

        /* -----------------------------------------------
           SEPET KONTROLÜ
        ------------------------------------------------ */

        if (
            !Array.isArray(orderData.items) ||
            orderData.items.length === 0
        ) {

            return res.status(400).json({

                success: false,

                message:
                    "Sipariş sepeti boş."

            });
        }

        if (
            orderData.items.length > 100
        ) {

            return res.status(400).json({

                success: false,

                message:
                    "Siparişte çok fazla ürün var."

            });
        }

        /* -----------------------------------------------
           ÜRÜNLERİ TEMİZLE
        ------------------------------------------------ */

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
                            "Ürün"
                        );

                    const price =
                        Number(item.price);

                    const quantity =
                        Number(item.quantity);

                    if (
                        !Number.isFinite(price) ||
                        !Number.isFinite(quantity)
                    ) {
                        return null;
                    }

                    if (
                        price < 0 ||
                        quantity <= 0
                    ) {
                        return null;
                    }

                    if (
                        quantity > 99
                    ) {
                        return null;
                    }

                    return {

                        name:
                            name.slice(0, 150),

                        price:

                            Number(
                                price.toFixed(2)
                            ),

                        quantity:

                            Math.floor(
                                quantity
                            )

                    };

                })
                .filter(Boolean);

        /* -----------------------------------------------
           GEÇERLİ ÜRÜN KONTROLÜ
        ------------------------------------------------ */

        if (
            items.length === 0
        ) {

            return res.status(400).json({

                success: false,

                message:
                    "Geçerli ürün bulunamadı."

            });
        }

        /* -----------------------------------------------
           TOPLAM TUTAR
           SUNUCU TARAFINDAN HESAPLANIR
        ------------------------------------------------ */

        const total =
            Number(
                items
                    .reduce(
                        (sum, item) => {

                            return (
                                sum +
                                (
                                    item.price *
                                    item.quantity
                                )
                            );

                        },
                        0
                    )
                    .toFixed(2)
            );

        /* -----------------------------------------------
           SİPARİŞ NUMARASI
        ------------------------------------------------ */

        const {
            id,
            orderNumber
        } =
            createOrderNumber();

        /* -----------------------------------------------
           YENİ SİPARİŞ
        ------------------------------------------------ */

        const newOrder = {

            id,

            orderNumber,

            customerName:
                customerName.slice(
                    0,
                    100
                ),

            phone:
                phone.slice(
                    0,
                    30
                ),

            orderType:
                orderType.slice(
                    0,
                    50
                ),

            address:
                address.slice(
                    0,
                    500
                ),

            tableNumber:
                tableNumber.slice(
                    0,
                    30
                ),

            note:
                note.slice(
                    0,
                    500
                ),

            items,

            total,

            status:
                "new",

            createdAt:
                new Date().toISOString()

        };

        /* -----------------------------------------------
           FIRESTORE'A KAYDET
        ------------------------------------------------ */

        const docRef =
            await ordersCollection.add(
                newOrder
            );

        console.log("");
        console.log(
            "================================="
        );
        console.log(
            " YENİ SİPARİŞ"
        );
        console.log(
            "================================="
        );
        console.log(
            " Sipariş:",
            orderNumber
        );
        console.log(
            " Müşteri:",
            customerName
        );
        console.log(
            " Toplam:",
            total + "₺"
        );
        console.log(
            " Firestore:",
            docRef.id
        );
        console.log(
            "================================="
        );
        console.log("");

        /* -----------------------------------------------
           BAŞARILI CEVAP
        ------------------------------------------------ */

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
            error
        );

        res.status(500).json({

            success: false,

            message:
                "Sipariş oluşturulamadı."

        });
    }
});

/* =========================================================
   SİPARİŞ DURUMU DEĞİŞTİR
========================================================= */

app.patch(
    "/api/orders/:id/status",
    async (req, res) => {

        try {

            const orderId =
                Number(
                    req.params.id
                );

            const status =
                cleanString(
                    req.body?.status
                );

            const validStatuses = [

                "new",

                "preparing",

                "ready",

                "completed"

            ];

            if (
                !Number.isFinite(orderId)
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
                error
            );

            res.status(500).json({

                success: false,

                message:
                    "Sipariş durumu güncellenemedi."

            });
        }
    }
);

/* =========================================================
   SİPARİŞ SİL
========================================================= */

app.delete(
    "/api/orders/:id",
    async (req, res) => {

        try {

            const orderId =
                Number(
                    req.params.id
                );

            if (
                !Number.isFinite(orderId)
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

            console.log(
                "Sipariş silindi:",
                orderId
            );

            res.json({

                success: true,

                message:
                    "Sipariş başarıyla silindi."

            });

        } catch (error) {

            console.error(
                "Sipariş silme hatası:",
                error
            );

            res.status(500).json({

                success: false,

                message:
                    "Sipariş silinemedi."

            });
        }
    }
);

/* =========================================================
   404
========================================================= */

app.use(
    (req, res) => {

        res.status(404).json({

            success: false,

            message:
                "Endpoint bulunamadı."

        });

    }
);

/* =========================================================
   GENEL HATA YAKALAYICI
========================================================= */

app.use(
    (error, req, res, next) => {

        console.error(
            "Sunucu hatası:",
            error
        );

        if (
            error instanceof SyntaxError &&
            error.status === 400 &&
            error.type ===
                "entity.parse.failed"
        ) {

            return res.status(400).json({

                success: false,

                message:
                    "Geçersiz JSON verisi."

            });
        }

        res.status(500).json({

            success: false,

            message:
                "Sunucu hatası."

        });
    }
);

/* =========================================================
   SUNUCUYU BAŞLAT
========================================================= */

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
            " Kalıcı sipariş sistemi: AKTİF"
        );
        console.log(
            " Sipariş doğrulama: AKTİF"
        );
        console.log(
            " Hata yönetimi: AKTİF"
        );
        console.log(
            "================================="
        );
        console.log("");

    }
);
