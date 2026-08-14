const express = require("express");
const cors = require("cors");
const admin = require("firebase-admin");

const app = express();

/* ==========================================
   AYARLAR
========================================== */

const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: "1mb" }));

/* ==========================================
   FIREBASE ADMIN
========================================== */

const SERVICE_ACCOUNT_PATH =
    "/etc/secrets/firebase-service-account.json";

try {
    const serviceAccount = require(SERVICE_ACCOUNT_PATH);

    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });

    console.log("=================================");
    console.log(" FIREBASE ADMIN AKTİF");
    console.log("=================================");
    console.log(
        " Firebase Project:",
        serviceAccount.project_id
    );
    console.log(" Firestore bağlantısı hazır.");
    console.log("=================================");
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

const db = admin.firestore();
const ordersCollection = db.collection("orders");

/* ==========================================
   ANA TEST
========================================== */

app.get("/", async (req, res) => {
    try {
        const snapshot = await ordersCollection.limit(1).get();

        res.json({
            success: true,
            message: "QR Menü Pro Backend çalışıyor.",
            firebase: true,
            firestore: true,
            ordersCollection: "orders",
            hasOrders: !snapshot.empty
        });

    } catch (error) {

        console.error(
            "Firestore test hatası:",
            error
        );

        res.status(500).json({
            success: false,
            message: "Firestore bağlantı hatası.",
            error: error.message
        });
    }
});

/* ==========================================
   TÜM SİPARİŞLER
========================================== */

app.get("/api/orders", async (req, res) => {

    try {

        const snapshot = await ordersCollection
            .orderBy("createdAt", "desc")
            .get();

        const orders = [];

        snapshot.forEach(doc => {

            orders.push({
                firestoreId: doc.id,
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
            message: "Siparişler alınamadı.",
            error: error.message
        });
    }
});

/* ==========================================
   YENİ SİPARİŞ
========================================== */

app.post("/api/orders", async (req, res) => {

    try {

        const orderData = req.body;

        if (
            !orderData ||
            typeof orderData !== "object"
        ) {

            return res.status(400).json({
                success: false,
                message: "Geçersiz sipariş verisi."
            });
        }

        const customerName =
            String(
                orderData.customerName || ""
            ).trim();

        const phone =
            String(
                orderData.phone || ""
            ).trim();

        const orderType =
            String(
                orderData.orderType ||
                "Paket Sipariş"
            ).trim();

        const address =
            String(
                orderData.address || ""
            ).trim();

        const tableNumber =
            String(
                orderData.tableNumber || ""
            ).trim();

        const note =
            String(
                orderData.note || ""
            ).trim();

        /* --------------------------
           TEMEL KONTROLLER
        -------------------------- */

        if (!customerName) {

            return res.status(400).json({
                success: false,
                message: "Müşteri adı gerekli."
            });
        }

        if (!phone) {

            return res.status(400).json({
                success: false,
                message: "Telefon numarası gerekli."
            });
        }

        if (
            !Array.isArray(orderData.items) ||
            orderData.items.length === 0
        ) {

            return res.status(400).json({
                success: false,
                message: "Sipariş sepeti boş."
            });
        }

        /* --------------------------
           ÜRÜNLERİ TEMİZLE
        -------------------------- */

        const items =
            orderData.items.map(item => {

                const name =
                    String(
                        item.name || "Ürün"
                    ).trim();

                const price =
                    Number(item.price) || 0;

                const quantity =
                    Number(item.quantity) || 1;

                return {
                    name,
                    price,
                    quantity
                };

            }).filter(item =>
                item.price >= 0 &&
                item.quantity > 0
            );

        if (items.length === 0) {

            return res.status(400).json({
                success: false,
                message: "Geçerli ürün bulunamadı."
            });
        }

        /* --------------------------
           TOPLAM TUTARI SUNUCU HESAPLASIN
        -------------------------- */

        const total =
            items.reduce(
                (sum, item) =>
                    sum +
                    (item.price * item.quantity),
                0
            );

        /* --------------------------
           SİPARİŞ NUMARASI
        -------------------------- */

        const id = Date.now();

        const orderNumber =
            `ECE-${id
                .toString()
                .slice(-6)}`;

        /* --------------------------
           SİPARİŞ
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

            status: "new",

            createdAt:
                new Date().toISOString()
        };

        /* --------------------------
           FIRESTORE'A KAYDET
        -------------------------- */

        const docRef =
            await ordersCollection.add(
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
                firestoreId: docRef.id,
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
                "Sipariş oluşturulamadı.",

            error:
                error.message

        });
    }
});

/* ==========================================
   SİPARİŞ DURUMU DEĞİŞTİR
========================================== */

app.patch(
    "/api/orders/:id/status",
    async (req, res) => {

        try {

            const orderId =
                Number(req.params.id);

            const status =
                req.body.status;

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
                    message: "Geçersiz sipariş ID."
                });
            }

            if (
                !validStatuses.includes(status)
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

            if (snapshot.empty) {

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
                firestoreId: doc.id,
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
                    "Sipariş durumu güncellenemedi.",

                error:
                    error.message

            });
        }
    }
);

/* ==========================================
   SİPARİŞ SİL
========================================== */

app.delete(
    "/api/orders/:id",
    async (req, res) => {

        try {

            const orderId =
                Number(req.params.id);

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

            if (snapshot.empty) {

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
                error
            );

            res.status(500).json({

                success: false,

                message:
                    "Sipariş silinemedi.",

                error:
                    error.message

            });
        }
    }
);

/* ==========================================
   404
========================================== */

app.use((req, res) => {

    res.status(404).json({

        success: false,

        message:
            "Endpoint bulunamadı."

    });
});

/* ==========================================
   SUNUCUYU BAŞLAT
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
            " Kalıcı sipariş sistemi: AKTİF"
        );

        console.log(
            "================================="
        );

        console.log("");
    }
);
