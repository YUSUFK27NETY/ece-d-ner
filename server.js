const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = 3000;

// ==========================================
// AYARLAR
// ==========================================

app.use(cors());
app.use(express.json());

const ORDERS_FILE = path.join(__dirname, "orders.json");

// ==========================================
// SİPARİŞ DOSYASI YOKSA OLUŞTUR
// ==========================================

function ensureOrdersFile() {
    if (!fs.existsSync(ORDERS_FILE)) {
        fs.writeFileSync(
            ORDERS_FILE,
            JSON.stringify([], null, 2),
            "utf8"
        );
    }
}

// ==========================================
// SİPARİŞLERİ DOSYADAN OKU
// ==========================================

function loadOrders() {
    try {
        ensureOrdersFile();

        const data = fs.readFileSync(
            ORDERS_FILE,
            "utf8"
        );

        const orders = JSON.parse(data);

        return Array.isArray(orders)
            ? orders
            : [];

    } catch (error) {

        console.error(
            "Siparişler okunamadı:",
            error
        );

        return [];
    }
}

// ==========================================
// SİPARİŞLERİ DOSYAYA KAYDET
// ==========================================

function saveOrders(orders) {

    try {

        fs.writeFileSync(
            ORDERS_FILE,
            JSON.stringify(
                orders,
                null,
                2
            ),
            "utf8"
        );

        return true;

    } catch (error) {

        console.error(
            "Siparişler kaydedilemedi:",
            error
        );

        return false;
    }
}

// ==========================================
// ANA TEST
// ==========================================

app.get("/", (req, res) => {

    const orders = loadOrders();

    res.json({
        success: true,
        message: "QR Menü Pro Backend çalışıyor.",
        orders: orders.length
    });

});

// ==========================================
// TÜM SİPARİŞLER
// ==========================================

app.get("/api/orders", (req, res) => {

    const orders = loadOrders();

    res.json({
        success: true,
        orders: orders
    });

});

// ==========================================
// YENİ SİPARİŞ
// ==========================================

app.post("/api/orders", (req, res) => {

    const orderData = req.body;

    if (!orderData) {

        return res.status(400).json({
            success: false,
            message: "Sipariş verisi bulunamadı."
        });

    }

    const orders = loadOrders();

    const newOrder = {

        id: Date.now(),

        orderNumber:
            `ECE-${Date.now()
                .toString()
                .slice(-6)}`,

        customerName:
            orderData.customerName ||
            "Müşteri",

        phone:
            orderData.phone ||
            "",

        orderType:
            orderData.orderType ||
            "Paket Sipariş",

        address:
            orderData.address ||
            "",

        tableNumber:
            orderData.tableNumber ||
            "",

        note:
            orderData.note ||
            "",

        items:
            Array.isArray(orderData.items)
                ? orderData.items
                : [],

        total:
            Number(orderData.total) || 0,

        status:
            "new",

        createdAt:
            new Date().toISOString()
    };

    orders.unshift(newOrder);

    const saved = saveOrders(orders);

    if (!saved) {

        return res.status(500).json({
            success: false,
            message: "Sipariş kaydedilemedi."
        });

    }

    console.log(
        "Yeni sipariş:",
        newOrder.orderNumber
    );

    res.status(201).json({

        success: true,

        message:
            "Sipariş başarıyla oluşturuldu.",

        order: newOrder

    });

});

// ==========================================
// SİPARİŞ DURUMU DEĞİŞTİR
// ==========================================

app.patch(
    "/api/orders/:id/status",
    (req, res) => {

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
            !validStatuses.includes(status)
        ) {

            return res.status(400).json({

                success: false,

                message:
                    "Geçersiz sipariş durumu."

            });

        }

        const orders = loadOrders();

        const order =
            orders.find(
                item =>
                    item.id === orderId
            );

        if (!order) {

            return res.status(404).json({

                success: false,

                message:
                    "Sipariş bulunamadı."

            });

        }

        order.status = status;

        const saved =
            saveOrders(orders);

        if (!saved) {

            return res.status(500).json({

                success: false,

                message:
                    "Sipariş durumu kaydedilemedi."

            });

        }

        res.json({

            success: true,

            message:
                "Sipariş durumu güncellendi.",

            order: order

        });

    }
);

// ==========================================
// SİPARİŞ SİL
// ==========================================

app.delete(
    "/api/orders/:id",
    (req, res) => {

        const orderId =
            Number(req.params.id);

        const orders =
            loadOrders();

        const index =
            orders.findIndex(
                item =>
                    item.id === orderId
            );

        if (index === -1) {

            return res.status(404).json({

                success: false,

                message:
                    "Sipariş bulunamadı."

            });

        }

        orders.splice(index, 1);

        const saved =
            saveOrders(orders);

        if (!saved) {

            return res.status(500).json({

                success: false,

                message:
                    "Sipariş silinemedi."

            });

        }

        res.json({

            success: true,

            message:
                "Sipariş silindi."

        });

    }
);

// ==========================================
// SUNUCUYU BAŞLAT
// ==========================================

ensureOrdersFile();


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
            ` Sunucu: http://localhost:${PORT}`
        );

        console.log(
            " Kalıcı sipariş sistemi aktif."
        );

        console.log(
            " Sipariş dosyası: orders.json"
        );

        console.log(
            "================================="
        );

        console.log("");

    }
);

);
