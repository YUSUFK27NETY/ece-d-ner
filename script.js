// ==========================================
// QR MENÜ PRO - ECE DÖNER
// FIREBASE ÜRÜN SİSTEMİ + RENDER SİPARİŞ SİSTEMİ
// ==========================================

"use strict";

// ==========================================
// FIREBASE
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

let db = null;

try {
    if (!firebase.apps.length) {
        firebase.initializeApp(firebaseConfig);
    }

    db = firebase.firestore();

    console.log("✅ Firebase bağlantısı hazır.");

} catch (error) {

    console.error(
        "❌ Firebase başlatılamadı:",
        error
    );
}

// ==========================================
// AYARLAR
// ==========================================

const FAVORITES_KEY = "eceDonerFavorites";

const API_BASE_URL =
    "https://ece-d-ner-1.onrender.com";

const ORDER_API_URL =
    `${API_BASE_URL}/api/orders`;

const WHATSAPP_NUMBER =
    "905315006996";

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

let menuGrid;

// Firebase listener
let productsUnsubscribe = null;


// ==========================================
// DOM ELEMANLARI
// ==========================================

function cacheDom() {

    cartItems =
        document.querySelector("#cartItems");

    cartCount =
        document.querySelector("#cartCount");

    totalPrice =
        document.querySelector("#totalPrice");

    finishOrderBtn =
        document.querySelector("#finishOrder");

    orderModal =
        document.querySelector("#orderModal");

    closeOrderModal =
        document.querySelector("#closeOrderModal");

    orderForm =
        document.querySelector("#orderForm");

    orderSummaryItems =
        document.querySelector(
            "#orderSummaryItems"
        );

    orderSummaryTotal =
        document.querySelector(
            "#orderSummaryTotal"
        );

    toast =
        document.querySelector("#toast");

    searchInput =
        document.querySelector("#search");

    menuGrid =
        document.querySelector("#menuGrid");

    // Eğer ID eklenmediyse mevcut menu-grid'i bul
    if (!menuGrid) {

        menuGrid =
            document.querySelector(
                ".menu-grid"
            );
    }
}


// ==========================================
// FİYAT
// ==========================================

function formatPrice(price) {

    return Number(price || 0)
        .toLocaleString("tr-TR") + "₺";
}


// ==========================================
// TOAST
// ==========================================

function showToast(
    message = "İşlem başarılı ✅"
) {

    if (!toast) return;

    toast.textContent =
        message;

    toast.classList.add(
        "show"
    );

    clearTimeout(
        window.toastTimer
    );

    window.toastTimer =
        setTimeout(() => {

            toast.classList.remove(
                "show"
            );

        }, 2200);
}


// ==========================================
// SEPET HESAPLARI
// ==========================================

function getCartTotal() {

    return cart.reduce(
        (total, item) => {

            return total +
                Number(item.price) *
                Number(item.quantity);

        },
        0
    );
}


function getCartCount() {

    return cart.reduce(
        (count, item) => {

            return count +
                Number(item.quantity);

        },
        0
    );
}


// ==========================================
// XSS KORUMASI
// ==========================================

function escapeHtml(value) {

    return String(value ?? "")
        .replace(
            /&/g,
            "&amp;"
        )
        .replace(
            /</g,
            "&lt;"
        )
        .replace(
            />/g,
            "&gt;"
        )
        .replace(
            /"/g,
            "&quot;"
        )
        .replace(
            /'/g,
            "&#039;"
        );
}


// ==========================================
// FAVORİLER
// ==========================================

function getFavorites() {

    try {

        const saved =
            localStorage.getItem(
                FAVORITES_KEY
            );

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


function saveFavorites(
    favorites
) {

    try {

        localStorage.setItem(
            FAVORITES_KEY,
            JSON.stringify(
                favorites
            )
        );

    } catch (error) {

        console.error(
            "Favoriler kaydedilemedi:",
            error
        );
    }
}


function setupFavorites() {

    const favorites =
        getFavorites();

    document
        .querySelectorAll(
            ".favorite"
        )
        .forEach(button => {

            const card =
                button.closest(
                    ".card"
                );

            const productName =
                card
                    ?.querySelector("h3")
                    ?.textContent
                    .trim();

            if (!productName) return;

            const setState =
                active => {

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

                    saveFavorites(
                        current
                    );
                }
            );
        });
}


// ==========================================
// FIREBASE ÜRÜN VERİLERİNİ NORMALLEŞTİR
// ==========================================

function normalizeCategory(
    category
) {

    const value =
        String(
            category || "all"
        )
        .trim()
        .toLocaleLowerCase(
            "tr-TR"
        );

    if (
        value === "döner" ||
        value === "doner" ||
        value === "dönerler"
    ) {
        return "doner";
    }

    if (
        value === "menü" ||
        value === "menu" ||
        value === "menüler" ||
        value === "menuler"
    ) {
        return "menu";
    }

    if (
        value === "içecek" ||
        value === "icecek" ||
        value === "içecekler" ||
        value === "icecekler"
    ) {
        return "drink";
    }

    if (
        value === "tatlı" ||
        value === "tatli" ||
        value === "tatlılar" ||
        value === "tatlilar"
    ) {
        return "dessert";
    }

    return value || "all";
}


// ==========================================
// FIREBASE ÜRÜN KARTI
// ==========================================

function createProductCard(
    product,
    documentId
) {

    const name =
        product.name ||
        product.productName ||
        product.title ||
        "İsimsiz Ürün";

    const description =
        product.description ||
        product.desc ||
        "Lezzetli Ece Döner ürünü.";

    const price =
        Number(
            product.price ??
            product.fiyat ??
            0
        );

    const category =
        normalizeCategory(
            product.category ||
            product.kategori ||
            "all"
        );

    const image =
        product.image ||
        product.imageUrl ||
        product.imageURL ||
        product.photo ||
        product.photoURL ||
        "";

    const discount =
        Number(
            product.discount ??
            product.indirim ??
            0
        );

    const card =
        document.createElement(
            "div"
        );

    card.className =
        "card";

    card.dataset.category =
        category;

    card.dataset.productId =
        documentId;

    let badgeHTML = "";

    if (
        Number.isFinite(discount) &&
        discount > 0
    ) {

        badgeHTML = `
            <span class="badge">
                %${discount} İNDİRİM
            </span>
        `;
    }

    let imageHTML = "";

    if (image) {

        imageHTML = `
            <img
                src="${escapeHtml(image)}"
                alt="${escapeHtml(name)}"
                loading="lazy"
                onerror="this.style.display='none';"
            >
        `;

    } else {

        imageHTML = `
            <div style="
                width:100%;
                height:180px;
                display:flex;
                align-items:center;
                justify-content:center;
                background:#222;
                font-size:55px;
            ">
                🍽️
            </div>
        `;
    }

    card.innerHTML = `

        ${badgeHTML}

        <button
            class="favorite"
            type="button"
            aria-label="Favorilere ekle"
        >
            🤍
        </button>

        ${imageHTML}

        <div class="card-body">

            <h3>
                ${escapeHtml(name)}
            </h3>

            <p>
                ${escapeHtml(description)}
            </p>

            <div class="card-footer">

                <span class="price">
                    ${formatPrice(price)}
                </span>

                <button
                    class="addCart"
                    type="button"
                    data-name="${escapeHtml(name)}"
                    data-price="${price}"
                >
                    Sepete Ekle
                </button>

            </div>

        </div>
    `;

    return card;
}


// ==========================================
// FIREBASE'DEN ÜRÜNLERİ OKU
// ==========================================

function loadProductsFromFirebase() {

    if (!db) {

        console.error(
            "❌ Firebase bağlantısı yok."
        );

        return;
    }

    if (!menuGrid) {

        console.error(
            "❌ menuGrid bulunamadı."
        );

        return;
    }

    console.log(
        "🔥 Firebase ürünleri dinleniyor..."
    );

    try {

        productsUnsubscribe =
            db
                .collection("products")
                .onSnapshot(
                    snapshot => {

                        console.log(
                            `🔥 ${snapshot.size} ürün Firebase'den geldi.`
                        );

                        menuGrid.innerHTML =
                            "";

                        if (
                            snapshot.empty
                        ) {

                            menuGrid.innerHTML = `
                                <div style="
                                    grid-column:1/-1;
                                    text-align:center;
                                    padding:40px 20px;
                                    color:#888;
                                ">
                                    <div style="
                                        font-size:45px;
                                        margin-bottom:10px;
                                    ">
                                        🍽️
                                    </div>

                                    <h3 style="
                                        color:#bbb;
                                        margin-bottom:8px;
                                    ">
                                        Henüz ürün bulunmuyor
                                    </h3>

                                    <p>
                                        Admin panelinden ürün ekleyebilirsiniz.
                                    </p>
                                </div>
                            `;

                            return;
                        }

                        snapshot.forEach(
                            doc => {

                                const product =
                                    doc.data();

                                // Aktiflik kontrolü
                                // active false ise gösterme
                                if (
                                    product.active === false ||
                                    product.aktif === false
                                ) {
                                    return;
                                }

                                const card =
                                    createProductCard(
                                        product,
                                        doc.id
                                    );

                                menuGrid.appendChild(
                                    card
                                );
                            }
                        );

                        // Dinamik ürünler oluşturulduktan
                        // sonra eventleri tekrar kur
                        setupFavorites();

                        filterProducts();

                        console.log(
                            "✅ Firebase ürünleri menüye aktarıldı."
                        );
                    },

                    error => {

                        console.error(
                            "❌ Firebase ürünleri okunamadı:",
                            error
                        );

                        menuGrid.innerHTML = `
                            <div style="
                                grid-column:1/-1;
                                text-align:center;
                                padding:40px 20px;
                                color:#ff6b6b;
                            ">
                                <div style="
                                    font-size:45px;
                                    margin-bottom:10px;
                                ">
                                    ⚠️
                                </div>

                                <h3>
                                    Ürünler yüklenemedi
                                </h3>

                                <p style="
                                    margin-top:8px;
                                    color:#aaa;
                                ">
                                    Firebase bağlantısını veya
                                    Firestore kurallarını kontrol edin.
                                </p>
                            </div>
                        `;
                    }
                );

    } catch (error) {

        console.error(
            "❌ Firebase ürün sistemi hatası:",
            error
        );
    }
}


// ==========================================
// SEPET
// ==========================================

function addToCart(
    name,
    price
) {

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


function changeQty(
    index,
    delta
) {

    if (
        index < 0 ||
        index >= cart.length
    ) {
        return;
    }

    cart[index].quantity +=
        delta;

    if (
        cart[index].quantity <= 0
    ) {

        cart.splice(
            index,
            1
        );
    }

    updateCart();
}


function removeFromCart(
    index
) {

    if (
        index < 0 ||
        index >= cart.length
    ) {
        return;
    }

    const removed =
        cart[index].name;

    cart.splice(
        index,
        1
    );

    updateCart();

    showToast(
        `${removed} sepetten çıkarıldı`
    );
}


function updateCart() {

    if (cartItems) {

        cartItems.innerHTML =
            "";

        if (!cart.length) {

            const li =
                document.createElement(
                    "li"
                );

            li.innerHTML = `
                <div style="
                    text-align:center;
                    padding:20px 10px;
                    color:#888;
                ">
                    🛒 Sepetiniz şu anda boş.
                </div>
            `;

            cartItems.appendChild(
                li
            );

        } else {

            cart.forEach(
                (item, index) => {

                    const li =
                        document.createElement(
                            "li"
                        );

                    li.innerHTML = `
                        <div class="cart-item">

                            <div>
                                <strong>
                                    ${escapeHtml(
                                        item.name
                                    )}
                                </strong>

                                <br>

                                <span>
                                    ${formatPrice(
                                        item.price
                                    )}
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
                                >
                                    +
                                </button>

                                <button
                                    type="button"
                                    class="delete-btn"
                                    data-delete="${index}"
                                >
                                    🗑️
                                </button>

                            </div>

                        </div>
                    `;

                    cartItems.appendChild(
                        li
                    );
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
// DİNAMİK SEPETE EKLE
// ==========================================

function setupAddCartButtons() {

    if (!menuGrid) return;

    // Event delegation
    // Firebase'den sonradan gelen ürünler
    // de otomatik çalışır.

    menuGrid.addEventListener(
        "click",
        event => {

            const button =
                event.target.closest(
                    ".addCart"
                );

            if (!button) return;

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
        .querySelectorAll(
            ".menu-grid .card"
        )
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
                category ===
                    currentCategory;

            const searchMatch =
                !searchTerm ||
                name.includes(
                    searchTerm
                ) ||
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

    buttons.forEach(
        button => {

            button.addEventListener(
                "click",
                () => {

                    const category =
                        button.dataset.category;

                    if (!category)
                        return;

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
        }
    );
}


function setupSearch() {

    if (!searchInput)
        return;

    searchInput.addEventListener(
        "input",
        filterProducts
    );
}


// ==========================================
// SİPARİŞ TÜRÜ
// ==========================================

function setOrderType(
    type
) {

    const select =
        document.querySelector(
            "#orderType"
        );

    if (!select)
        return;

    const exists =
        Array.from(
            select.options
        ).some(
            option =>
                option.value ===
                type
        );

    if (exists) {

        select.value =
            type;
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

    if (!orderModal)
        return;

    if (orderType) {

        setOrderType(
            orderType
        );
    }

    updateOrderSummary();

    orderModal.classList.add(
        "show"
    );

    document.body.style.overflow =
        "hidden";
}


function closeModal() {

    if (!orderModal)
        return;

    orderModal.classList.remove(
        "show"
    );

    document.body.style.overflow =
        "";
}


function updateOrderSummary() {

    if (!orderSummaryItems)
        return;

    orderSummaryItems.innerHTML =
        "";

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

        cart.forEach(
            item => {

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
                        ${escapeHtml(
                            item.name
                        )}
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
            }
        );
    }

    if (orderSummaryTotal) {

        orderSummaryTotal.textContent =
            `Toplam: ${formatPrice(
                getCartTotal()
            )}`;
    }
}


// ==========================================
// MODAL EVENTLERİ
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
                        behavior:
                            "smooth",

                        block:
                            "start"
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
                event.key ===
                    "Escape" &&
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

function normalizePhone(
    phone
) {

    return String(
        phone || ""
    )
        .replace(
            /\D/g,
            ""
        );
}


function isValidTurkishPhone(
    phone
) {

    const normalized =
        normalizePhone(
            phone
        );

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

    cart.forEach(
        item => {

            const itemTotal =
                Number(item.price) *
                Number(item.quantity);

            message +=
                `\n• ${item.name} × ${item.quantity} = ${formatPrice(itemTotal)}`;
        }
    );

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


function openWhatsApp(
    message
) {

    const url =
        "https://api.whatsapp.com/send?phone=" +
        WHATSAPP_NUMBER +
        "&text=" +
        encodeURIComponent(
            message
        );

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
                method:
                    "POST",

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

    if (!orderForm)
        return;

    orderForm.addEventListener(
        "submit",
        async event => {

            event.preventDefault();

            if (isSendingOrder)
                return;

            if (!cart.length) {

                showToast(
                    "Sepetiniz boş 🛒"
                );

                closeModal();

                return;
            }

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

            if (
                customerName.length <
                2
            ) {

                showToast(
                    "Lütfen adınızı ve soyadınızı girin."
                );

                return;
            }

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

            const items =
                cart.map(
                    item => ({

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
                    })
                );

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

            isSendingOrder =
                true;

            const submitButton =
                orderForm.querySelector(
                    'button[type="submit"]'
                );

            const originalText =
                submitButton
                    ?.textContent ||
                "";

            if (submitButton) {

                submitButton.disabled =
                    true;

                submitButton.textContent =
                    "⏳ Sipariş Gönderiliyor...";

                submitButton.style.opacity =
                    "0.7";
            }

            try {

                await sendOrderToBackend(
                    orderData
                );

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

                showToast(
                    "Siparişiniz başarıyla alındı! ✅"
                );

                cart = [];

                updateCart();

                orderForm.reset();

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

    setupCartEvents();

    setupAddCartButtons();

    setupCategories();

    setupSearch();

    setupModal();

    setupOrderForm();

    updateCart();

    // Önce mevcut HTML ürünlerine
    // event bağlanabilir.
    setupFavorites();

    filterProducts();

    // 🔥 ASIL YENİ SİSTEM
    loadProductsFromFirebase();

    console.log(
        "✅ Ece Döner QR Menü Pro hazır."
    );

    console.log(
        "✅ Sipariş API:",
        ORDER_API_URL
    );
}


// ==========================================
// UYGULAMAYI BAŞLAT
// ==========================================

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
// GLOBAL
// ==========================================

window.changeQty =
    changeQty;

window.removeFromCart =
    removeFromCart;

window.openOrderModal =
    openOrderModal;

window.closeModal =
    closeModal;
