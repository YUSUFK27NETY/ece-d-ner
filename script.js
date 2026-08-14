// ==========================================
// QR MENÜ PRO - ECE DÖNER
// FINAL SCRIPT.JS
// Frontend Firebase bağlantısı kaldırıldı.
// Sipariş: Site -> Render Backend -> Firebase Admin -> Firestore
// ==========================================

"use strict";

const FAVORITES_KEY = "eceDonerFavorites";
const API_BASE_URL = "https://ece-d-ner-1.onrender.com";
const ORDER_API_URL = `${API_BASE_URL}/api/orders`;
const WHATSAPP_NUMBER = "905315006996";

let cart = [];
let currentCategory = "all";
let isSendingOrder = false;

let cartItems;
let cartCount;
let totalPrice;
let finishOrderBtn;
let orderModal;
let closeOrderModal;
let orderForm;
let orderSummaryItems;
let orderSummaryTotal;
let toast;
let searchInput;

// ==========================================
// DOM ELEMANLARINI AL
// ==========================================

function cacheDom() {
    cartItems = document.querySelector("#cartItems");
    cartCount = document.querySelector("#cartCount");
    totalPrice = document.querySelector("#totalPrice");
    finishOrderBtn = document.querySelector("#finishOrder");
    orderModal = document.querySelector("#orderModal");
    closeOrderModal = document.querySelector("#closeOrderModal");
    orderForm = document.querySelector("#orderForm");
    orderSummaryItems = document.querySelector("#orderSummaryItems");
    orderSummaryTotal = document.querySelector("#orderSummaryTotal");
    toast = document.querySelector("#toast");
    searchInput = document.querySelector("#search");
}

// ==========================================
// YARDIMCI FONKSİYONLAR
// ==========================================

function formatPrice(price) {
    return Number(price || 0).toLocaleString("tr-TR") + "₺";
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
            Number(item.price) *
            Number(item.quantity);
    }, 0);
}

function getCartCount() {
    return cart.reduce((count, item) => {
        return count + Number(item.quantity);
    }, 0);
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
    const favorites = getFavorites();

    document
        .querySelectorAll(".favorite")
        .forEach(button => {

            const card =
                button.closest(".card");

            const productName =
                card
                    ?.querySelector("h3")
                    ?.textContent
                    .trim();

            if (!productName) return;

            const setState = active => {

                button.classList.toggle(
                    "active",
                    active
                );

                button.textContent =
                    active
                        ? "❤️"
                        : "🤍";
            };

            setState(
                favorites.includes(
                    productName
                )
            );

            button.addEventListener(
                "click",
                () => {

                    let current =
                        getFavorites();

                    const active =
                        current.includes(
                            productName
                        );

                    if (active) {

                        current =
                            current.filter(
                                name =>
                                    name !==
                                    productName
                            );

                        setState(false);

                        showToast(
                            "Favorilerden çıkarıldı"
                        );

                    } else {

                        current.push(
                            productName
                        );

                        setState(true);

                        showToast(
                            "Favorilere eklendi ❤️"
                        );
                    }

                    saveFavorites(current);
                }
            );
        });
}

// ==========================================
// SEPET
// ==========================================

function addToCart(name, price) {

    const existing =
        cart.find(
            item =>
                item.name === name
        );

    if (existing) {

        existing.quantity += 1;

    } else {

        cart.push({
            name,
            price: Number(price),
            quantity: 1
        });
    }

    updateCart();

    showToast(
        `${name} sepete eklendi 🛒`
    );
}

function changeQty(index, delta) {

    if (
        index < 0 ||
        index >= cart.length
    ) {
        return;
    }

    cart[index].quantity += delta;

    if (
        cart[index].quantity <= 0
    ) {
        cart.splice(index, 1);
    }

    updateCart();
}

function removeFromCart(index) {

    if (
        index < 0 ||
        index >= cart.length
    ) {
        return;
    }

    const removed =
        cart[index].name;

    cart.splice(index, 1);

    updateCart();

    showToast(
        `${removed} sepetten çıkarıldı`
    );
}

function updateCart() {

    if (cartItems) {

        cartItems.innerHTML = "";

        if (!cart.length) {

            const li =
                document.createElement("li");

            li.innerHTML = `
                <div style="
                    text-align:center;
                    padding:20px 10px;
                    color:#888;
                ">
                    🛒 Sepetiniz şu anda boş.
                </div>
            `;

            cartItems.appendChild(li);

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

    if (cartCount) {

        cartCount.textContent =
            getCartCount();
    }

    if (totalPrice) {

        totalPrice.textContent =
            `Toplam: ${formatPrice(
                getCartTotal()
            )}`;
    }

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
// SEPET EVENTLERİ
// ==========================================

function setupCartEvents() {

    if (!cartItems) return;

    cartItems.addEventListener(
        "click",
        event => {

            const qty =
                event.target.closest(
                    ".qty-btn"
                );

            if (qty) {

                changeQty(
                    Number(
                        qty.dataset.index
                    ),
                    Number(
                        qty.dataset.delta
                    )
                );

                return;
            }

            const del =
                event.target.closest(
                    ".delete-btn"
                );

            if (del) {

                removeFromCart(
                    Number(
                        del.dataset.delete
                    )
                );
            }
        }
    );
}

// ==========================================
// SEPETE EKLE BUTONLARI
// ==========================================

function setupAddCartButtons() {

    document
        .querySelectorAll(".addCart")
        .forEach(button => {

            button.addEventListener(
                "click",
                () => {

                    const name =
                        button.dataset.name;

                    const price =
                        Number(
                            button.dataset.price
                        );

                    if (
                        !name ||
                        !Number.isFinite(price)
                    ) {

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
}

// ==========================================
// KATEGORİ + ARAMA
// ==========================================

function filterProducts() {

    const searchTerm =
        searchInput
            ? searchInput.value
                .trim()
                .toLocaleLowerCase(
                    "tr-TR"
                )
            : "";

    document
        .querySelectorAll(".card")
        .forEach(card => {

            const category =
                card.dataset.category ||
                "";

            const name =
                card
                    .querySelector("h3")
                    ?.textContent
                    .trim()
                    .toLocaleLowerCase(
                        "tr-TR"
                    ) || "";

            const description =
                card
                    .querySelector("p")
                    ?.textContent
                    .trim()
                    .toLocaleLowerCase(
                        "tr-TR"
                    ) || "";

            const categoryMatch =
                currentCategory === "all" ||
                category === currentCategory;

            const searchMatch =
                !searchTerm ||
                name.includes(searchTerm) ||
                description.includes(
                    searchTerm
                );

            card.style.display =
                categoryMatch &&
                searchMatch
                    ? ""
                    : "none";
        });
}

function setupCategories() {

    const buttons =
        document.querySelectorAll(
            ".categories [data-category]"
        );

    buttons.forEach(button => {

        button.addEventListener(
            "click",
            () => {

                const category =
                    button.dataset.category;

                if (!category) return;

                currentCategory =
                    category;

                buttons.forEach(
                    btn =>
                        btn.classList.remove(
                            "active"
                        )
                );

                button.classList.add(
                    "active"
                );

                filterProducts();
            }
        );
    });
}

function setupSearch() {

    if (!searchInput) return;

    searchInput.addEventListener(
        "input",
        filterProducts
    );
}

// ==========================================
// SİPARİŞ TÜRÜ
// ==========================================

function setOrderType(type) {

    const select =
        document.querySelector(
            "#orderType"
        );

    if (!select) return;

    const exists =
        Array.from(
            select.options
        ).some(
            option =>
                option.value === type
        );

    if (exists) {
        select.value = type;
    }
}

// ==========================================
// SİPARİŞ MODALI
// ==========================================

function openOrderModal(
    orderType = null
) {

    if (!cart.length) {

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

    orderModal.classList.add(
        "show"
    );

    document.body.style.overflow =
        "hidden";
}

function closeModal() {

    if (!orderModal) return;

    orderModal.classList.remove(
        "show"
    );

    document.body.style.overflow =
        "";
}

function updateOrderSummary() {

    if (!orderSummaryItems) return;

    orderSummaryItems.innerHTML = "";

    if (!cart.length) {

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
                    ${formatPrice(
                        itemTotal
                    )}
                </strong>
            `;

            orderSummaryItems.appendChild(
                row
            );
        });
    }

    if (orderSummaryTotal) {

        orderSummaryTotal.textContent =
            `Toplam: ${formatPrice(
                getCartTotal()
            )}`;
    }
}

// ==========================================
// MENÜ / MODAL EVENTLERİ
// ==========================================

function setupModal() {

    const menuBtn =
        document.querySelector(
            "#menuBtn"
        );

    if (menuBtn) {

        menuBtn.addEventListener(
            "click",
            () => {

                const menu =
                    document.querySelector(
                        "#menu"
                    );

                if (menu) {

                    menu.scrollIntoView({
                        behavior: "smooth",
                        block: "start"
                    });
                }
            }
        );
    }

    const packageBtn =
        document.querySelector(
            "#packageBtn"
        );

    if (packageBtn) {

        packageBtn.addEventListener(
            "click",
            () =>
                openOrderModal(
                    "Paket Sipariş"
                )
        );
    }

    const restaurantBtn =
        document.querySelector(
            "#restaurantBtn"
        );

    if (restaurantBtn) {

        restaurantBtn.addEventListener(
            "click",
            () =>
                openOrderModal(
                    "Restoranda Sipariş"
                )
        );
    }

    if (finishOrderBtn) {

        finishOrderBtn.addEventListener(
            "click",
            () =>
                openOrderModal()
        );
    }

    if (closeOrderModal) {

        closeOrderModal.addEventListener(
            "click",
            closeModal
        );
    }

    if (orderModal) {

        orderModal.addEventListener(
            "click",
            event => {

                if (
                    event.target ===
                    orderModal
                ) {

                    closeModal();
                }
            }
        );
    }

    document.addEventListener(
        "keydown",
        event => {

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
}

// ==========================================
// TELEFON
// ==========================================

function normalizePhone(phone) {

    return String(phone || "")
        .replace(/\D/g, "");
}

function isValidTurkishPhone(phone) {

    const normalized =
        normalizePhone(phone);

    return (
        /^05\d{9}$/.test(
            normalized
        ) ||
        /^5\d{9}$/.test(
            normalized
        )
    );
}

// ==========================================
// WHATSAPP
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
        "\n\n🛒 *SİPARİŞLER*" +
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
        "\n\n━━━━━━━━━━━━━━" +
        "\nQR Menü Pro";

    return message;
}

function openWhatsApp(message) {

    const url =
        "https://api.whatsapp.com/send?phone=" +
        WHATSAPP_NUMBER +
        "&text=" +
        encodeURIComponent(message);

    window.open(
        url,
        "_blank",
        "noopener,noreferrer"
    );
}

// ==========================================
// RENDER BACKEND
// ==========================================

async function sendOrderToBackend(
    orderData
) {

    const response =
        await fetch(
            ORDER_API_URL,
            {
                method: "POST",

                headers: {
                    "Content-Type":
                        "application/json"
                },

                body:
                    JSON.stringify(
                        orderData
                    )
            }
        );

    let result;

    try {

        result =
            await response.json();

    } catch (error) {

        throw new Error(
            "Sunucudan geçersiz cevap geldi."
        );
    }

    if (
        !response.ok ||
        !result?.success
    ) {

        throw new Error(
            result?.message ||
            "Sipariş sunucuya gönderilemedi."
        );
    }

    return result;
}

// ==========================================
// SİPARİŞ FORMU
// ==========================================

function setupOrderForm() {

    if (!orderForm) return;

    orderForm.addEventListener(
        "submit",
        async event => {

            event.preventDefault();

            if (isSendingOrder) {
                return;
            }

            // ==============================
            // SEPET
            // ==============================

            if (!cart.length) {

                showToast(
                    "Sepetiniz boş 🛒"
                );

                closeModal();

                return;
            }

            // ==============================
            // FORM VERİLERİ
            // ==============================

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
                    ?.value ||
                "Paket Sipariş";

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

            // ==============================
            // İSİM KONTROLÜ
            // ==============================

            if (
                customerName.length < 2
            ) {

                showToast(
                    "Lütfen adınızı ve soyadınızı girin."
                );

                return;
            }

            // ==============================
            // TELEFON KONTROLÜ
            // ==============================

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

            // ==============================
            // SİPARİŞ TÜRÜ
            // ==============================

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

            // ==============================
            // ÜRÜNLER
            // ==============================

            const items =
                cart.map(item => ({

                    name:
                        String(
                            item.name
                        ),

                    price:
                        Number(
                            item.price
                        ),

                    quantity:
                        Number(
                            item.quantity
                        )
                }));

            // ==============================
            // SİPARİŞ VERİSİ
            // ==============================

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

                total:
                    getCartTotal(),

                status:
                    "new",

                createdAt:
                    new Date()
                        .toISOString()
            };

            // ==============================
            // BUTONU KİLİTLE
            // ==============================

            isSendingOrder = true;

            const submitButton =
                orderForm.querySelector(
                    'button[type="submit"]'
                );

            const originalText =
                submitButton
                    ?.textContent || "";

            if (submitButton) {

                submitButton.disabled =
                    true;

                submitButton.textContent =
                    "⏳ Sipariş Gönderiliyor...";

                submitButton.style.opacity =
                    "0.7";
            }

            try {

                // ==========================
                // RENDER BACKEND
                // ==========================

                await sendOrderToBackend(
                    orderData
                );

                // ==========================
                // WHATSAPP
                // ==========================

                const message =
                    createWhatsAppMessage(
                        customerName,
                        customerPhone,
                        orderType,
                        tableNumber,
                        address,
                        note
                    );

                openWhatsApp(
                    message
                );

                // ==========================
                // BAŞARILI
                // ==========================

                showToast(
                    "Siparişiniz başarıyla alındı! ✅"
                );

                // ==========================
                // SEPETİ TEMİZLE
                // ==========================

                cart = [];

                updateCart();

                // ==========================
                // FORMU TEMİZLE
                // ==========================

                orderForm.reset();

                // ==========================
                // MODALI KAPAT
                // ==========================

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

                isSendingOrder =
                    false;

                if (submitButton) {

                    submitButton.disabled =
                        false;

                    submitButton.textContent =
                        originalText ||
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

function initializeApp() {

    cacheDom();

    setupFavorites();

    setupCartEvents();

    setupAddCartButtons();

    setupCategories();

    setupSearch();

    setupModal();

    setupOrderForm();

    updateCart();

    filterProducts();

    console.log(
        "✅ Ece Döner QR Menü Pro hazır."
    );

    console.log(
        "✅ Sipariş API:",
        ORDER_API_URL
    );
}

if (
    document.readyState ===
    "loading"
) {

    document.addEventListener(
        "DOMContentLoaded",
        initializeApp
    );

} else {

    initializeApp();
}

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
