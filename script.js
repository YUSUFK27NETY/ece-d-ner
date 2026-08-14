// ==========================================
// QR MENÜ PRO - ECE DÖNER
// PROFESYONEL SCRIPT.JS
// ==========================================

"use strict";

// ==========================================
// FIREBASE AYARLARI
// ==========================================

const firebaseConfig = {
    apiKey: "AIzaSyCfPqMm1Azo6ZS9ee4NNd1y-bFzPv9JaCU",
    authDomain: "ece-2e44c.firebaseapp.com",
    projectId: "ece-2e44c",
    storageBucket: "ece-2e44c.firebasestorage.app",
    messagingSenderId: "937356035748",
    appId: "1:937356035748:web:6c8f79c774f4c3c64b0831",
    measurementId: "G-9VEVNMW5T0"
};

// ==========================================
// FIREBASE BAŞLAT
// ==========================================

let db = null;

try {
    if (typeof firebase !== "undefined") {

        if (!firebase.apps.length) {
            firebase.initializeApp(firebaseConfig);
        }

        db = firebase.firestore();

    } else {
        console.error("Firebase yüklenemedi.");
    }

} catch (error) {
    console.error("Firebase başlatma hatası:", error);
}


// ==========================================
// GENEL DEĞİŞKENLER
// ==========================================

let cart = [];

let currentCategory = "all";

let isSendingOrder = false;

const FAVORITES_KEY = "eceDonerFavorites";


// ==========================================
// DOM ELEMANLARI
// ==========================================

const cartItems = document.querySelector("#cartItems");
const cartCount = document.querySelector("#cartCount");
const totalPrice = document.querySelector("#totalPrice");

const finishOrderBtn =
    document.querySelector("#finishOrder");

const orderModal =
    document.querySelector("#orderModal");

const closeOrderModal =
    document.querySelector("#closeOrderModal");

const orderForm =
    document.querySelector("#orderForm");

const orderSummaryItems =
    document.querySelector("#orderSummaryItems");

const orderSummaryTotal =
    document.querySelector("#orderSummaryTotal");

const toast =
    document.querySelector("#toast");

const searchInput =
    document.querySelector("#search");


// ==========================================
// YARDIMCI FONKSİYONLAR
// ==========================================

function formatPrice(price) {

    return Number(price || 0)
        .toLocaleString("tr-TR") + "₺";

}


function showToast(message = "İşlem başarılı ✅") {

    if (!toast) return;

    toast.textContent = message;

    toast.classList.add("show");

    clearTimeout(window.toastTimer);

    window.toastTimer = setTimeout(() => {

        toast.classList.remove("show");

    }, 2200);
}


function getCartTotal() {

    return cart.reduce((total, item) => {

        return total +
            (Number(item.price) *
                Number(item.quantity));

    }, 0);

}


function getCartCount() {

    return cart.reduce((count, item) => {

        return count +
            Number(item.quantity);

    }, 0);

}


// ==========================================
// FAVORİLER
// ==========================================

function getFavorites() {

    try {

        const saved =
            localStorage.getItem(FAVORITES_KEY);

        if (!saved) return [];

        const parsed =
            JSON.parse(saved);

        return Array.isArray(parsed)
            ? parsed
            : [];

    } catch (error) {

        console.error(
            "Favoriler okunamadı:",
            error
        );

        return [];
    }
}


function saveFavorites(favorites) {

    try {

        localStorage.setItem(
            FAVORITES_KEY,
            JSON.stringify(favorites)
        );

    } catch (error) {

        console.error(
            "Favoriler kaydedilemedi:",
            error
        );
    }
}


function setupFavorites() {

    const favoriteButtons =
        document.querySelectorAll(".favorite");

    const favorites =
        getFavorites();

    favoriteButtons.forEach(button => {

        const card =
            button.closest(".card");

        if (!card) return;

        const productName =
            card.querySelector("h3")?.textContent
                .trim();

        if (!productName) return;

        if (favorites.includes(productName)) {

            button.classList.add("active");

            button.textContent = "❤️";

        }

        button.addEventListener(
            "click",
            function () {

                let currentFavorites =
                    getFavorites();

                const isFavorite =
                    currentFavorites.includes(
                        productName
                    );

                if (isFavorite) {

                    currentFavorites =
                        currentFavorites.filter(
                            name =>
                                name !== productName
                        );

                    button.classList.remove(
                        "active"
                    );

                    button.textContent = "🤍";

                    showToast(
                        "Favorilerden çıkarıldı"
                    );

                } else {

                    currentFavorites.push(
                        productName
                    );

                    button.classList.add(
                        "active"
                    );

                    button.textContent = "❤️";

                    showToast(
                        "Favorilere eklendi ❤️"
                    );
                }

                saveFavorites(
                    currentFavorites
                );

            }
        );
    });
}


// ==========================================
// SEPETE EKLE
// ==========================================

function addToCart(name, price) {

    const existingItem =
        cart.find(
            item => item.name === name
        );

    if (existingItem) {

        existingItem.quantity += 1;

    } else {

        cart.push({

            name: name,

            price: Number(price),

            quantity: 1

        });
    }

    updateCart();

    showToast(
        `${name} sepete eklendi 🛒`
    );
}


// ==========================================
// SEPETTEN ÜRÜN MİKTARI DEĞİŞTİR
// ==========================================

function changeQty(index, delta) {

    if (
        index < 0 ||
        index >= cart.length
    ) {
        return;
    }

    cart[index].quantity += delta;

    if (cart[index].quantity <= 0) {

        cart.splice(index, 1);
    }

    updateCart();
}


// ==========================================
// ÜRÜNÜ SEPETTEN TAMAMEN SİL
// ==========================================

function removeFromCart(index) {

    if (
        index < 0 ||
        index >= cart.length
    ) {
        return;
    }

    const removedProduct =
        cart[index].name;

    cart.splice(index, 1);

    updateCart();

    showToast(
        `${removedProduct} sepetten çıkarıldı`
    );
}


// ==========================================
// SEPETİ GÜNCELLE
// ==========================================

function updateCart() {

    if (cartItems) {

        cartItems.innerHTML = "";

        if (cart.length === 0) {

            const emptyItem =
                document.createElement("li");

            emptyItem.innerHTML = `
                <div style="
                    text-align:center;
                    padding:20px 10px;
                    color:#888;
                ">
                    🛒 Sepetiniz şu anda boş.
                </div>
            `;

            cartItems.appendChild(
                emptyItem
            );

        } else {

            cart.forEach(
                (item, index) => {

                    const li =
                        document.createElement("li");

                    li.innerHTML = `

                        <div class="cart-item">

                            <div>
                                <strong>
                                    ${escapeHtml(item.name)}
                                </strong>

                                <br>

                                <span>
                                    ${formatPrice(item.price)}
                                    ×
                                    ${item.quantity}
                                </span>
                            </div>

                            <div class="cart-controls">

                                <button
                                    type="button"
                                    class="qty-btn"
                                    data-index="${index}"
                                    data-delta="-1"
                                    aria-label="Azalt"
                                >
                                    −
                                </button>

                                <span>
                                    ${item.quantity}
                                </span>

                                <button
                                    type="button"
                                    class="qty-btn"
                                    data-index="${index}"
                                    data-delta="1"
                                    aria-label="Artır"
                                >
                                    +
                                </button>

                                <button
                                    type="button"
                                    class="delete-btn"
                                    data-delete="${index}"
                                    aria-label="Ürünü sil"
                                >
                                    🗑️
                                </button>

                            </div>

                        </div>

                    `;

                    cartItems.appendChild(li);

                }
            );
        }
    }


    // ======================================
    // SEPET SAYACI
    // ======================================

    if (cartCount) {

        cartCount.textContent =
            getCartCount();

    }


    // ======================================
    // TOPLAM
    // ======================================

    const total =
        getCartTotal();

    if (totalPrice) {

        totalPrice.textContent =
            `Toplam: ${formatPrice(total)}`;

    }


    // ======================================
    // SEPET BUTONU DURUMU
    // ======================================

    if (finishOrderBtn) {

        finishOrderBtn.disabled =
            cart.length === 0;

        finishOrderBtn.style.opacity =
            cart.length === 0
                ? "0.55"
                : "1";

    }


    updateOrderSummary();
}


// ==========================================
// SEPET EVENT DELEGATION
// ==========================================

if (cartItems) {

    cartItems.addEventListener(
        "click",
        function (event) {

            const qtyButton =
                event.target.closest(
                    ".qty-btn"
                );

            if (qtyButton) {

                const index =
                    Number(
                        qtyButton.dataset.index
                    );

                const delta =
                    Number(
                        qtyButton.dataset.delta
                    );

                changeQty(
                    index,
                    delta
                );

                return;
            }


            const deleteButton =
                event.target.closest(
                    ".delete-btn"
                );

            if (deleteButton) {

                const index =
                    Number(
                        deleteButton.dataset.delete
                    );

                removeFromCart(index);

            }

        }
    );
}


// ==========================================
// XSS KORUMASI
// ==========================================

function escapeHtml(value) {

    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}


// ==========================================
// ÜRÜN BUTONLARI
// ==========================================

document
    .querySelectorAll(".addCart")
    .forEach(button => {

        button.addEventListener(
            "click",
            function () {

                const name =
                    button.dataset.name;

                const price =
                    Number(
                        button.dataset.price
                    );

                if (!name || !Number.isFinite(price)) {

                    showToast(
                        "Ürün bilgisi hatalı ❌"
                    );

                    return;
                }

                addToCart(
                    name,
                    price
                );

            }
        );
    });


// ==========================================
// KATEGORİ FİLTRELEME
// ==========================================

const categoryButtons =
    document.querySelectorAll(
        "[data-category]"
    );


categoryButtons.forEach(button => {

    if (
        !button.classList.contains(
            "card"
        )
    ) {

        button.addEventListener(
            "click",
            function () {

                const category =
                    button.dataset.category;

                if (!category) return;

                currentCategory =
                    category;

                document
                    .querySelectorAll(
                        ".categories button"
                    )
                    .forEach(btn => {

                        btn.classList.remove(
                            "active"
                        );

                    });

                button.classList.add(
                    "active"
                );

                filterProducts();

            }
        );
    }
});


// ==========================================
// ÜRÜNLERİ FİLTRELE
// ==========================================

function filterProducts() {

    const cards =
        document.querySelectorAll(
            ".card"
        );

    const searchTerm =
        searchInput
            ? searchInput.value
                .trim()
                .toLocaleLowerCase("tr-TR")
            : "";

    cards.forEach(card => {

        const category =
            card.dataset.category || "";

        const name =
            card.querySelector("h3")
                ?.textContent
                .trim()
                .toLocaleLowerCase("tr-TR")
                || "";

        const description =
            card.querySelector("p")
                ?.textContent
                .trim()
                .toLocaleLowerCase("tr-TR")
                || "";

        const categoryMatch =
            currentCategory === "all" ||
            category === currentCategory;

        const searchMatch =
            !searchTerm ||
            name.includes(searchTerm) ||
            description.includes(searchTerm);

        if (
            categoryMatch &&
            searchMatch
        ) {

            card.style.display = "";

        } else {

            card.style.display = "none";

        }

    });
}


// ==========================================
// ARAMA
// ==========================================

if (searchInput) {

    searchInput.addEventListener(
        "input",
        function () {

            filterProducts();

        }
    );
}


// ==========================================
// MENÜ BUTONU
// ==========================================

const menuBtn =
    document.querySelector("#menuBtn");

if (menuBtn) {

    menuBtn.addEventListener(
        "click",
        function () {

            const menu =
                document.querySelector("#menu");

            if (menu) {

                menu.scrollIntoView({
                    behavior: "smooth",
                    block: "start"
                });

            }

        }
    );
}


// ==========================================
// PAKET SİPARİŞ BUTONU
// ==========================================

const packageBtn =
    document.querySelector("#packageBtn");

if (packageBtn) {

    packageBtn.addEventListener(
        "click",
        function () {

            openOrderModal(
                "Paket Sipariş"
            );

        }
    );
}


// ==========================================
// RESTORAN SİPARİŞ BUTONU
// ==========================================

const restaurantBtn =
    document.querySelector(
        "#restaurantBtn"
    );

if (restaurantBtn) {

    restaurantBtn.addEventListener(
        "click",
        function () {

            openOrderModal(
                "Restoranda Sipariş"
            );

        }
    );
}


// ==========================================
// SİPARİŞ TÜRÜNÜ SEÇ
// ==========================================

function setOrderType(type) {

    const orderType =
        document.querySelector(
            "#orderType"
        );

    if (!orderType) return;

    const optionExists =
        Array.from(
            orderType.options
        ).some(
            option =>
                option.value === type
        );

    if (optionExists) {

        orderType.value = type;

    }
}


// ==========================================
// SİPARİŞ MODALINI AÇ
// ==========================================

function openOrderModal(
    orderType = null
) {

    if (cart.length === 0) {

        showToast(
            "Önce sepete ürün ekleyin 🛒"
        );

        return;
    }

    if (!orderModal) return;

    if (orderType) {

        setOrderType(orderType);

    }

    updateOrderSummary();

    orderModal.classList.add("show");

    document.body.style.overflow =
        "hidden";

}


// ==========================================
// MODALI KAPAT
// ==========================================

function closeModal() {

    if (!orderModal) return;

    orderModal.classList.remove(
        "show"
    );

    document.body.style.overflow =
        "";

}


// ==========================================
// SİPARİŞ TAMAMLA
// ==========================================

if (finishOrderBtn) {

    finishOrderBtn.addEventListener(
        "click",
        function () {

            openOrderModal();

        }
    );
}


// ==========================================
// KAPAT BUTONU
// ==========================================

if (closeOrderModal) {

    closeOrderModal.addEventListener(
        "click",
        closeModal
    );

}


// ==========================================
// MODAL ARKA PLANINA TIKLAMA
// ==========================================

if (orderModal) {

    orderModal.addEventListener(
        "click",
        function (event) {

            if (
                event.target ===
                orderModal
            ) {

                closeModal();

            }

        }
    );
}


// ==========================================
// ESC İLE KAPAT
// ==========================================

document.addEventListener(
    "keydown",
    function (event) {

        if (
            event.key === "Escape" &&
            orderModal &&
            orderModal.classList.contains(
                "show"
            )
        ) {

            closeModal();

        }

    }
);


// ==========================================
// SİPARİŞ ÖZETİ
// ==========================================

function updateOrderSummary() {

    if (!orderSummaryItems) return;

    orderSummaryItems.innerHTML = "";

    if (cart.length === 0) {

        orderSummaryItems.innerHTML = `
            <div style="
                color:#888;
                text-align:center;
                padding:10px;
            ">
                Sepet boş
            </div>
        `;

    } else {

        cart.forEach(item => {

            const row =
                document.createElement(
                    "div"
                );

            row.className =
                "summary-item";

            const itemTotal =
                Number(item.price) *
                Number(item.quantity);

            row.innerHTML = `

                <span>
                    ${escapeHtml(item.name)}
                    × ${item.quantity}
                </span>

                <strong>
                    ${formatPrice(itemTotal)}
                </strong>

            `;

            orderSummaryItems.appendChild(
                row
            );

        });
    }

    const total =
        getCartTotal();

    if (orderSummaryTotal) {

        orderSummaryTotal.textContent =
            `Toplam: ${formatPrice(total)}`;

    }
}


// ==========================================
// TELEFON NUMARASI TEMİZLE
// ==========================================

function normalizePhone(phone) {

    return String(phone || "")
        .replace(/\D/g, "");

}


// ==========================================
// TELEFON DOĞRULAMA
// ==========================================

function isValidTurkishPhone(phone) {

    const normalized =
        normalizePhone(phone);

    return (
        /^05\d{9}$/.test(normalized) ||
        /^5\d{9}$/.test(normalized)
    );
}


// ==========================================
// WHATSAPP TELEFON
// ==========================================

const WHATSAPP_NUMBER =
    "905315006996";


// ==========================================
// WHATSAPP MESAJI OLUŞTUR
// ==========================================

function createWhatsAppMessage(
    customerName,
    customerPhone,
    orderType,
    tableNumber,
    address,
    note
) {

    const total =
        getCartTotal();

    let message =
        "🍽️ *ECE DÖNER SİPARİŞİ*";

    message +=
        "\n\n━━━━━━━━━━━━━━";

    message +=
        "\n👤 *Müşteri:* " +
        customerName;

    message +=
        "\n📱 *Telefon:* " +
        customerPhone;

    message +=
        "\n📦 *Sipariş Türü:* " +
        orderType;


    if (tableNumber) {

        message +=
            "\n🪑 *Masa No:* " +
            tableNumber;

    }


    if (address) {

        message +=
            "\n📍 *Adres:* " +
            address;

    }


    message +=
        "\n\n🛒 *SİPARİŞLER*";

    message +=
        "\n━━━━━━━━━━━━━━";


    cart.forEach(item => {

        const itemTotal =
            Number(item.price) *
            Number(item.quantity);

        message +=
            `\n• ${item.name} × ${item.quantity} = ${formatPrice(itemTotal)}`;

    });


    message +=
        "\n\n💰 *TOPLAM: " +
        formatPrice(total) +
        "*";


    if (note) {

        message +=
            "\n\n📝 *Sipariş Notu:* " +
            note;

    }


    message +=
        "\n\n━━━━━━━━━━━━━━";

    message +=
        "\nQR Menü Pro";

    return message;
}


// ==========================================
// SİPARİŞ FORMU
// ==========================================

if (orderForm) {

    orderForm.addEventListener(
        "submit",
        async function (event) {

            event.preventDefault();

            if (isSendingOrder) {
                return;
            }


            // ==================================
            // SEPET KONTROL
            // ==================================

            if (cart.length === 0) {

                showToast(
                    "Sepetiniz boş 🛒"
                );

                closeModal();

                return;
            }


            // ==================================
            // FORM VERİLERİ
            // ==================================

            const customerName =
                document
                    .querySelector(
                        "#customerName"
                    )
                    ?.value
                    .trim() || "";


            const customerPhone =
                document
                    .querySelector(
                        "#customerPhone"
                    )
                    ?.value
                    .trim() || "";


            const orderType =
                document
                    .querySelector(
                        "#orderType"
                    )
                    ?.value || "Paket Sipariş";


            const tableNumber =
                document
                    .querySelector(
                        "#tableNumber"
                    )
                    ?.value
                    .trim() || "";


            const address =
                document
                    .querySelector(
                        "#orderAddress"
                    )
                    ?.value
                    .trim() || "";


            const note =
                document
                    .querySelector(
                        "#orderNote"
                    )
                    ?.value
                    .trim() || "";


            // ==================================
            // İSİM KONTROL
            // ==================================

            if (customerName.length < 2) {

                showToast(
                    "Lütfen adınızı ve soyadınızı girin."
                );

                return;
            }


            // ==================================
            // TELEFON KONTROL
            // ==================================

            if (
                !isValidTurkishPhone(
                    customerPhone
                )
            ) {

                showToast(
                    "Lütfen geçerli bir telefon numarası girin."
                );

                return;
            }


            // ==================================
            // SİPARİŞ TÜRÜ KONTROLLERİ
            // ==================================

            if (
                orderType ===
                "Paket Sipariş" &&
                !address
            ) {

                showToast(
                    "Paket siparişi için adres gerekli 📍"
                );

                return;
            }


            if (
                orderType ===
                "Restoranda Sipariş" &&
                !tableNumber
            ) {

                showToast(
                    "Restoran siparişi için masa numarasını girin 🪑"
                );

                return;
            }


            // ==================================
            // TOPLAM
            // ==================================

            const total =
                getCartTotal();


            // ==================================
            // ÜRÜNLERİ GÜVENLİ KOPYALA
            // ==================================

            const items =
                cart.map(item => ({

                    name: String(
                        item.name
                    ),

                    price: Number(
                        item.price
                    ),

                    quantity: Number(
                        item.quantity
                    )

                }));


            // ==================================
            // FIREBASE VERİSİ
            // ==================================

            const orderData = {

                customerName,

                phone:
                    normalizePhone(
                        customerPhone
                    ),

                orderType,

                tableNumber,

                address,

                note,

                items,

                total,

                status: "new",

                createdAt:
                    firebase.firestore
                        .FieldValue
                        .serverTimestamp()

            };


            // ==================================
            // BUTONU KİLİTLE
            // ==================================

            isSendingOrder = true;


            const submitButton =
                orderForm.querySelector(
                    'button[type="submit"]'
                );


            const originalButtonText =
                submitButton
                    ? submitButton.textContent
                    : "";


            if (submitButton) {

                submitButton.disabled =
                    true;

                submitButton.textContent =
                    "⏳ Sipariş Gönderiliyor...";

                submitButton.style.opacity =
                    "0.7";

            }


            try {

                // ==================================
                // FIREBASE KONTROL
                // ==================================

                if (!db) {

                    throw new Error(
                        "Firebase bağlantısı kurulamadı."
                    );

                }


                // ==================================
                // FIREBASE'E KAYDET
                // ==================================

                await db
                    .collection("orders")
                    .add(orderData);


                // ==================================
                // WHATSAPP MESAJI
                // ==================================

                const message =
                    createWhatsAppMessage(
                        customerName,
                        customerPhone,
                        orderType,
                        tableNumber,
                        address,
                        note
                    );


                const whatsappUrl =
                    "https://api.whatsapp.com/send?phone=" +
                    WHATSAPP_NUMBER +
                    "&text=" +
                    encodeURIComponent(
                        message
                    );


                // ==================================
                // WHATSAPP'I AÇ
                // ==================================

                window.open(
                    whatsappUrl,
                    "_blank",
                    "noopener,noreferrer"
                );


                // ==================================
                // BAŞARILI
                // ==================================

                showToast(
                    "Siparişiniz başarıyla alındı! ✅"
                );


                // ==================================
                // SEPETİ TEMİZLE
                // ==================================

                cart = [];

                updateCart();


                // ==================================
                // FORMU TEMİZLE
                // ==================================

                orderForm.reset();


                // ==================================
                // MODALI KAPAT
                // ==================================

                closeModal();


            } catch (error) {

                console.error(
                    "Sipariş gönderme hatası:",
                    error
                );


                showToast(
                    "Sipariş gönderilemedi. Lütfen tekrar deneyin. ❌"
                );

            } finally {

                isSendingOrder = false;


                if (submitButton) {

                    submitButton.disabled =
                        false;

                    submitButton.textContent =
                        originalButtonText ||
                        "📲 WhatsApp'tan Sipariş Ver";

                    submitButton.style.opacity =
                        "1";

                }

            }

        }
    );
}


// ==========================================
// BAŞLANGIÇ
// ==========================================

document.addEventListener(
    "DOMContentLoaded",
    function () {

        setupFavorites();

        updateCart();

        filterProducts();

    }
);


// ==========================================
// GLOBAL FONKSİYONLAR
// ==========================================

window.changeQty =
    changeQty;

window.removeFromCart =
    removeFromCart;

window.openOrderModal =
    openOrderModal;

window.closeModal =
    closeModal;


// ==========================================
// BAŞLANGIÇ LOGU
// ==========================================

console.log(
    "✅ Ece Döner QR Menü Pro hazır."
);
