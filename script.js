// ==========================================
// ECE DÖNER QR MENÜ PRO
// MÜŞTERİ SAYFASI - TEMİZ KURTARMA SÜRÜMÜ
// Firebase Ürünleri + Sepet + Sipariş
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

const FAVORITES_KEY =
    "eceDonerFavorites";

const API_BASE_URL =
    "https://ece-d-ner-1.onrender.com";

const ORDER_API_URL =
    `${API_BASE_URL}/api/orders`;

const WHATSAPP_NUMBER =
    "905315006996";
const RESTAURANT_STATUS_URL =
    `${API_BASE_URL}/api/restaurant/status`;
const RESTAURANT_STATUS_REFRESH_MS =
    30000;

let restaurantIsOpen =
    false;

let restaurantStatusLoaded =
    false;

let restaurantStatusError =
    false;

let restaurantStatusRequestInFlight =
    false;

let restaurantStatusPollTimer =
    null;


// ==========================================
// GLOBAL DEĞİŞKENLER
// ==========================================

let cart = [];

let currentCategory =
    "all";

let isSendingOrder =
    false;

let productsUnsubscribe =
    null;


let cartItems =
    null;

let cartCount =
    null;

let totalPrice =
    null;

let finishOrderBtn =
    null;


let orderModal =
    null;

let closeOrderModal =
    null;

let orderForm =
    null;

let orderSummaryItems =
    null;

let orderSummaryTotal =
    null;


let toast =
    null;

let searchInput =
    null;

let menuGrid =
    null;


// ==========================================
// DOM
// ==========================================

function cacheDom() {

    cartItems =
        document.getElementById(
            "cartItems"
        );

    cartCount =
        document.getElementById(
            "cartCount"
        );

    totalPrice =
        document.getElementById(
            "totalPrice"
        );

    finishOrderBtn =
        document.getElementById(
            "finishOrder"
        );


    orderModal =
        document.getElementById(
            "orderModal"
        );

    closeOrderModal =
        document.getElementById(
            "closeOrderModal"
        );

    orderForm =
        document.getElementById(
            "orderForm"
        );

    orderSummaryItems =
        document.getElementById(
            "orderSummaryItems"
        );

    orderSummaryTotal =
        document.getElementById(
            "orderSummaryTotal"
        );


    toast =
        document.getElementById(
            "toast"
        );

    searchInput =
        document.getElementById(
            "search"
        );

    menuGrid =
        document.getElementById(
            "menuGrid"
        );


    if (!menuGrid) {

        menuGrid =
            document.querySelector(
                ".menu-grid"
            );
    }


    console.log(
        "✅ DOM elemanları hazır."
    );
}


function canPlaceOrder() {

    return (
        restaurantStatusLoaded &&
        !restaurantStatusError &&
        restaurantIsOpen
    );
}


function getRestaurantUnavailableMessage() {

    if (!restaurantStatusLoaded) {

        return "Restoran durumu kontrol ediliyor. Lütfen kısa süre sonra tekrar deneyin. 🟡";
    }

    if (restaurantStatusError) {

        return "Restoran durumu doğrulanamadı. Lütfen kısa süre sonra tekrar deneyin. 🟠";
    }

    return "Restoran şu anda kapalı. Sipariş alınamıyor. 🔴";
}


function updateRestaurantStatusUI() {

    const statusText =
        document.querySelector(
            ".status .open"
        );

    const restaurantBtn =
        document.getElementById(
            "restaurantBtn"
        );

    const packageBtn =
        document.getElementById(
            "packageBtn"
        );

    const submitBtn =
        orderForm
            ?.querySelector(
                'button[type="submit"]'
            );


    if (statusText) {

        if (!restaurantStatusLoaded) {

            statusText.textContent =
                "🟡 Durum Kontrol Ediliyor";

            statusText.style.color =
                "#facc15";

        } else if (restaurantStatusError) {

            statusText.textContent =
                "🟠 Durum Alınamadı";

            statusText.style.color =
                "#fb923c";

        } else if (restaurantIsOpen) {

            statusText.textContent =
                "🟢 Şu Anda Açık";

            statusText.style.color =
                "#22c55e";

        } else {

            statusText.textContent =
                "🔴 Şu Anda Kapalı";

            statusText.style.color =
                "#ef4444";
        }
    }


    if (restaurantBtn) {
        restaurantBtn.disabled =
            !canPlaceOrder();
    }


    if (packageBtn) {
        packageBtn.disabled =
            !canPlaceOrder();
    }


    if (finishOrderBtn) {
        finishOrderBtn.disabled =
            !canPlaceOrder() ||
            cart.length === 0;
    }


    if (submitBtn) {
        submitBtn.disabled =
            !canPlaceOrder() ||
            isSendingOrder;
    }
}


async function loadRestaurantStatus() {

    if (restaurantStatusRequestInFlight) {

        return;
    }

    restaurantStatusRequestInFlight =
        true;

    try {

        const response =
            await fetch(
                RESTAURANT_STATUS_URL,
                {
                    cache:
                        "no-store"
                }
            );


        const result =
            await response.json();


        if (
            !response.ok ||
            result?.success !== true
        ) {

            throw new Error(
                result?.message ||
                "Restoran durumu alınamadı."
            );
        }


        restaurantIsOpen =
            result.isOpen === true;

        restaurantStatusLoaded =
            true;

        restaurantStatusError =
            false;

        updateRestaurantStatusUI();


    } catch (error) {

        console.error(
            "❌ Restoran durumu alınamadı:",
            error
        );


        restaurantIsOpen =
            false;

        restaurantStatusLoaded =
            true;

        restaurantStatusError =
            true;

        updateRestaurantStatusUI();

    } finally {

        restaurantStatusRequestInFlight =
            false;
    }
}


function startRestaurantStatusPolling() {

    if (restaurantStatusPollTimer) {

        clearInterval(
            restaurantStatusPollTimer
        );
    }

    restaurantStatusPollTimer =
        setInterval(
            loadRestaurantStatus,
            RESTAURANT_STATUS_REFRESH_MS
        );

    document.addEventListener(
        "visibilitychange",
        () => {

            if (
                document.visibilityState ===
                "visible"
            ) {

                loadRestaurantStatus();
            }
        }
    );
}

// ==========================================
// GÜVENLİ HTML
// ==========================================

function escapeHtml(value) {

    return String(
        value ?? ""
    )

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
// FİYAT
// ==========================================

function formatPrice(price) {

    return Number(
        price || 0
    )
        .toLocaleString(
            "tr-TR"
        ) +
        "₺";
}


// ==========================================
// TOAST
// ==========================================

function showToast(
    message = "İşlem başarılı ✅"
) {

    if (!toast)
        return;


    toast.textContent =
        message;


    toast.classList.add(
        "show"
    );


    clearTimeout(
        window.eceToastTimer
    );


    window.eceToastTimer =
        setTimeout(
            () => {

                toast.classList.remove(
                    "show"
                );

            },
            2200
        );
}


// ==========================================
// FAVORİLER
// ==========================================

function getFavorites() {

    try {

        const data =
            localStorage.getItem(
                FAVORITES_KEY
            );


        if (!data) {

            return [];
        }


        const parsed =
            JSON.parse(
                data
            );


        return Array.isArray(
            parsed
        )
            ? parsed
            : [];

    } catch (error) {

        console.error(
            "❌ Favoriler okunamadı:",
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
            "❌ Favoriler kaydedilemedi:",
            error
        );
    }
}


function setupFavorites() {

    const buttons =
        document.querySelectorAll(
            ".menu-grid .favorite"
        );


    buttons.forEach(
        button => {

            if (
                button.dataset.favoriteReady ===
                "true"
            ) {

                return;
            }


            button.dataset.favoriteReady =
                "true";


            const card =
                button.closest(
                    ".card"
                );


            if (!card)
                return;


            const name =
                card
                    .querySelector("h3")
                    ?.textContent
                    .trim();


            if (!name)
                return;


            function updateFavoriteUI(
                active
            ) {

                button.classList.toggle(
                    "active",
                    active
                );


                button.textContent =
                    active
                        ? "❤️"
                        : "🤍";


                button.setAttribute(
                    "aria-pressed",
                    String(active)
                );


                button.setAttribute(
                    "aria-label",
                    active
                        ? `${name} ürününü favorilerden çıkar`
                        : `${name} ürününü favorilere ekle`
                );
            }


            let favorites =
                getFavorites();


            const favoriteKey =
                card.dataset.productId ||
                name;


            if (
                favoriteKey !== name &&
                favorites.includes(name)
            ) {

                favorites =
                    favorites.filter(
                        item =>
                            item !== name
                    );

                if (
                    !favorites.includes(
                        favoriteKey
                    )
                ) {

                    favorites.push(
                        favoriteKey
                    );
                }

                saveFavorites(
                    favorites
                );
            }


            updateFavoriteUI(
                favorites.includes(
                    favoriteKey
                )
            );


            button.addEventListener(
                "click",
                () => {

                    favorites =
                        getFavorites();


                    const exists =
                        favorites.includes(
                            favoriteKey
                        );


                    if (exists) {

                        favorites =
                            favorites.filter(
                                item =>
                                    item !==
                                    favoriteKey
                            );


                        updateFavoriteUI(
                            false
                        );


                        showToast(
                            "Favorilerden çıkarıldı"
                        );

                    } else {

                        favorites.push(
                            favoriteKey
                        );


                        updateFavoriteUI(
                            true
                        );


                        showToast(
                            "Favorilere eklendi ❤️"
                        );
                    }


                    saveFavorites(
                        favorites
                    );
                }
            );
        }
    );
}


// ==========================================
// KATEGORİ
// ==========================================

function normalizeCategory(
    category
) {

    const value =
        String(
            category || ""
        )
            .trim()
            .toLocaleLowerCase(
                "tr-TR"
            );


    if (
        value === "doner" ||
        value === "döner" ||
        value === "dönerler"
    ) {

        return "doner";
    }


    if (
        value === "menu" ||
        value === "menü" ||
        value === "menüler" ||
        value === "menuler"
    ) {

        return "menu";
    }


    if (
        value === "drink" ||
        value === "içecek" ||
        value === "içecekler" ||
        value === "icecek" ||
        value === "icecekler"
    ) {

        return "drink";
    }


    if (
        value === "dessert" ||
        value === "tatlı" ||
        value === "tatlılar" ||
        value === "tatli" ||
        value === "tatlilar"
    ) {

        return "dessert";
    }


    return (
        value ||
        "all"
    );
}


// ==========================================
// FOTOĞRAF BUL
// ==========================================

function getProductImage(
    product
) {

    const possibleImages = [

        product.imageData,

        product.image,

        product.imageUrl,

        product.imageURL,

        product.photo,

        product.photoURL,

        product.img,

        product.image_url

    ];


    for (
        const value
        of possibleImages
    ) {

        if (
            typeof value ===
                "string" &&
            value.trim() !==
                ""
        ) {

            return value.trim();
        }
    }


    return "";
}


// ==========================================
// FOTOĞRAF HATA YÖNETİMİ
// ==========================================

function handleImageError(
    img
) {

    if (!img)
        return;


    console.error(
        "❌ Ürün fotoğrafı yüklenemedi:",
        img.src
    );


    img.onerror =
        null;


    const wrapper =
        img.closest(
            ".product-image-wrapper"
        );


    if (wrapper) {

        wrapper.innerHTML = `

            <div
                class="product-image-fallback"
            >
                🍽️
            </div>

        `;


        return;
    }


    img.style.display =
        "none";
}

function createProductCard(product, documentId) {

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
            product.category ??
            product.kategori ??
            "all"
        );

    const image =
        getProductImage(product);

    const discount =
        Number(
            product.discount ??
            product.indirim ??
            0
        );

    const card =
        document.createElement("div");

    card.className = "card";

    card.dataset.category =
        category;

    card.dataset.productId =
        documentId;


    // İNDİRİM ROZETİ
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


    // FOTOĞRAF
    let imageHTML = "";

    if (image) {

        imageHTML = `
            <img
                src="${escapeHtml(image)}"
                alt="${escapeHtml(name)}"
                loading="lazy"
                onerror="this.onerror=null; this.style.display='none';"
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


    // KART
    card.innerHTML = `

        ${badgeHTML}

        <button
            class="favorite"
            type="button"
            aria-label="Favorilere ekle"
            aria-pressed="false"
        >
            🤍
        </button>

        ${imageHTML}

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
                data-product-id="${escapeHtml(documentId)}"
                data-name="${escapeHtml(name)}"
                data-price="${price}"
            >
                Sepete Ekle
            </button>

        </div>
    `;

    return card;
}

// ==========================================
// FIREBASE ÜRÜNLERİ
// ==========================================

function loadProductsFromFirebase() {

    if (!db) {

        console.error(
            "❌ Firestore bağlantısı yok."
        );


        showFirebaseError(
            "Firebase bağlantısı kurulamadı."
        );


        return;
    }


    if (!menuGrid) {

        console.error(
            "❌ Menü alanı bulunamadı."
        );


        return;
    }


    console.log(
        "🔥 Firebase ürünleri dinleniyor..."
    );


    if (
        productsUnsubscribe
    ) {

        productsUnsubscribe();


        productsUnsubscribe =
            null;
    }


    productsUnsubscribe =

        db
            .collection(
                "products"
            )
            .onSnapshot(

                snapshot => {

                    console.log(
                        `🔥 Firebase'den ${snapshot.size} ürün geldi.`
                    );


                    menuGrid.innerHTML =
                        "";


                    if (
                        snapshot.empty
                    ) {

                        menuGrid.innerHTML = `

                            <div
                                style="
                                    grid-column:1/-1;
                                    text-align:center;
                                    padding:50px 20px;
                                "
                            >

                                <div
                                    style="
                                        font-size:55px;
                                        margin-bottom:15px;
                                    "
                                >
                                    🍽️
                                </div>


                                <h3>
                                    Henüz ürün bulunmuyor
                                </h3>


                                <p>
                                    Admin panelinden ürün ekleyebilirsiniz.
                                </p>

                            </div>

                        `;


                        return;
                    }


                    let visibleCount =
                        0;


                    snapshot.forEach(
                        doc => {

                            const product =
                                doc.data();


                            if (
                                product.active ===
                                    false ||

                                product.aktif ===
                                    false ||

                                product.available ===
                                    false
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


                            visibleCount++;
                        }
                    );


                    if (
                        visibleCount ===
                        0
                    ) {

                        menuGrid.innerHTML = `

                            <div
                                style="
                                    grid-column:1/-1;
                                    text-align:center;
                                    padding:50px 20px;
                                "
                            >

                                <div
                                    style="
                                        font-size:50px;
                                    "
                                >
                                    😕
                                </div>


                                <h3>
                                    Şu anda gösterilecek ürün yok.
                                </h3>

                            </div>

                        `;
                    }


                    setupFavorites();


                    filterProducts();


                    console.log(
                        "✅ Ürünler müşteri sayfasına aktarıldı."
                    );
                },


                error => {

                    console.error(
                        "❌ Firestore ürün hatası:",
                        error
                    );


                    showFirebaseError(

                        "Ürünler yüklenemedi. Firebase bağlantısını kontrol edin."

                    );
                }
            );
}


// ==========================================
// FIREBASE HATA MESAJI
// ==========================================

function showFirebaseError(
    message
) {

    if (!menuGrid)
        return;


    menuGrid.innerHTML = `

        <div
            style="
                grid-column:1/-1;
                text-align:center;
                padding:50px 20px;
                color:#ff6b6b;
            "
        >

            <div
                style="
                    font-size:50px;
                    margin-bottom:15px;
                "
            >
                ⚠️
            </div>


            <h3>
                ${escapeHtml(
                    message
                )}
            </h3>


            <p
                style="
                    margin-top:10px;
                    color:#999;
                "
            >
                Sayfayı yenileyip tekrar deneyin.
            </p>

        </div>

    `;
}


// ==========================================
// SEPET
// ==========================================

function getCartTotal() {

    return cart.reduce(

        (
            total,
            item
        ) => {

            return (

                total +

                Number(
                    item.price
                ) *

                Number(
                    item.quantity
                )

            );

        },

        0
    );
}


function getCartCount() {

    return cart.reduce(

        (
            total,
            item
        ) => {

            return (

                total +

                Number(
                    item.quantity
                )

            );

        },

        0
    );
}


function getBackendOrderItems() {

    return cart.map(
        item => ({

            productId:
                String(
                    item.productId
                ),

            // Eski backend sürümüyle kısa dağıtım geçişinde uyumluluk.
            // Yeni backend ad ve fiyatı yok sayıp Firestore'dan okur.
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
}


function addToCart(
    productId,
    name,
    price
) {

    const existing =
        cart.find(

            item =>
                item.productId ===
                productId
        );


    if (existing) {

        existing.quantity++;

    } else {

        cart.push({

            productId:
                String(
                    productId
                ),

            name:
                String(
                    name
                ),

            price:
                Number(
                    price
                ),

            quantity:
                1

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
        index <
            0 ||

        index >=
            cart.length
    ) {

        return;
    }


    cart[index].quantity +=
        delta;


    if (
        cart[index].quantity <=
        0
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
        index <
            0 ||

        index >=
            cart.length
    ) {

        return;
    }


    const name =
        cart[index].name;


    cart.splice(
        index,
        1
    );


    updateCart();


    showToast(
        `${name} sepetten çıkarıldı`
    );
}


// ==========================================
// SEPETİ GÜNCELLE
// ==========================================

function updateCart() {

    if (cartItems) {

        cartItems.innerHTML =
            "";


        if (
            !cart.length
        ) {

            cartItems.innerHTML = `

                <li>

                    <div
                        style="
                            text-align:center;
                            padding:20px;
                            color:#888;
                        "
                    >
                        🛒 Sepetiniz şu anda boş.
                    </div>

                </li>

            `;

        } else {

            cart.forEach(

                (
                    item,
                    index
                ) => {

                    const li =
                        document.createElement(
                            "li"
                        );


                    li.innerHTML = `

                        <div
                            class="cart-item"
                        >

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


                            <div
                                class="cart-controls"
                            >

                                <button
                                    type="button"
                                    class="qty-btn"
                                    data-index="${index}"
                                    data-delta="-1"
                                    aria-label="${escapeHtml(item.name)} miktarını azalt"
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
                                    aria-label="${escapeHtml(item.name)} miktarını artır"
                                >
                                    +
                                </button>


                                <button
                                    type="button"
                                    class="delete-btn"
                                    data-delete="${index}"
                                    aria-label="${escapeHtml(item.name)} ürününü sepetten çıkar"
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


    if (
        finishOrderBtn
    ) {

        finishOrderBtn.disabled =
            !canPlaceOrder() ||
            cart.length === 0;


        finishOrderBtn.style.opacity =
            finishOrderBtn.disabled
                ? "0.55"
                : "1";
    }


    updateOrderSummary();
}


// ==========================================
// SEPET EVENTLERİ
// ==========================================

function setupCartEvents() {

    if (!cartItems)
        return;


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
// SEPETE EKLE
// ==========================================

function setupAddCartButtons() {

    if (!menuGrid)
        return;


    menuGrid.addEventListener(

        "click",

        event => {

            const button =
                event.target.closest(
                    ".addCart"
                );


            if (!button)
                return;


            const name =
                button.dataset.name;


            const productId =
                button.dataset.productId;


            const price =
                Number(
                    button.dataset.price
                );


            if (
                !productId ||

                !name ||

                !Number.isFinite(
                    price
                )
            ) {

                showToast(
                    "Ürün bilgisi hatalı ❌"
                );


                return;
            }


            addToCart(
                productId,
                name,
                price
            );
        }
    );
}


// ==========================================
// FİLTRE
// ==========================================

function filterProducts() {

    const searchTerm =

        searchInput

            ? searchInput
                .value
                .trim()
                .toLocaleLowerCase(
                    "tr-TR"
                )

            : "";


    const cards =
        Array.from(
            document.querySelectorAll(
                ".menu-grid .card"
            )
        );


    const previousEmptyState =
        menuGrid
            ?.querySelector(
                ".filter-empty-state"
            );


    previousEmptyState?.remove();


    let visibleCount =
        0;


    cards.forEach(
            card => {

                const category =
                    card.dataset.category ||
                    "";


                const name =

                    card
                        .querySelector(
                            "h3"
                        )
                        ?.textContent
                        .trim()
                        .toLocaleLowerCase(
                            "tr-TR"
                        )

                    ||
                    "";


                const description =

                    card
                        .querySelector(
                            "p"
                        )
                        ?.textContent
                        .trim()
                        .toLocaleLowerCase(
                            "tr-TR"
                        )

                    ||
                    "";


                const categoryMatch =

                    currentCategory ===
                        "all"

                    ||

                    category ===
                        currentCategory;


                const searchMatch =

                    !searchTerm

                    ||

                    name.includes(
                        searchTerm
                    )

                    ||

                    description.includes(
                        searchTerm
                    );


                const isVisible =
                    categoryMatch &&
                    searchMatch;


                card.style.display =
                    isVisible
                        ? ""
                        : "none";


                if (isVisible) {

                    visibleCount++;
                }
            }
        );


    if (
        menuGrid &&
        cards.length > 0 &&
        visibleCount === 0
    ) {

        const emptyState =
            document.createElement(
                "div"
            );

        emptyState.className =
            "filter-empty-state";

        emptyState.setAttribute(
            "role",
            "status"
        );

        emptyState.textContent =
            searchTerm
                ? `“${searchInput.value.trim()}” için ürün bulunamadı.`
                : "Bu kategoride şu anda ürün bulunmuyor.";

        menuGrid.appendChild(
            emptyState
        );
    }
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
                        btn => {

                            btn.classList.remove(
                                "active"
                            );
                        }
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
// MODAL
// ==========================================

function setOrderType(
    type
) {

    const select =
        document.getElementById(
            "orderType"
        );


    if (!select)
        return;


    const exists =

        Array.from(
            select.options
        )

            .some(

                option =>
                    option.value ===
                    type
            );


    if (exists) {

        select.value =
            type;

        syncOrderTypeFields();
    }
}


function syncOrderTypeFields() {

    const select =
        document.getElementById(
            "orderType"
        );

    const tableLabel =
        document.getElementById(
            "tableNumberLabel"
        );

    const tableInput =
        document.getElementById(
            "tableNumber"
        );

    const addressLabel =
        document.getElementById(
            "orderAddressLabel"
        );

    const addressInput =
        document.getElementById(
            "orderAddress"
        );

    if (
        !select ||
        !tableInput ||
        !addressInput
    ) {

        return;
    }

    const isRestaurantOrder =
        select.value ===
        "Restoranda Sipariş";

    tableInput.hidden =
        !isRestaurantOrder;

    tableInput.required =
        isRestaurantOrder;

    addressInput.hidden =
        isRestaurantOrder;

    addressInput.required =
        !isRestaurantOrder;

    if (tableLabel) {

        tableLabel.hidden =
            !isRestaurantOrder;
    }

    if (addressLabel) {

        addressLabel.hidden =
            isRestaurantOrder;
    }

    if (isRestaurantOrder) {

        addressInput.value =
            "";

    } else {

        tableInput.value =
            "";
    }
}


function setupOrderTypeFields() {

    const select =
        document.getElementById(
            "orderType"
        );

    if (!select) {

        return;
    }

    select.addEventListener(
        "change",
        syncOrderTypeFields
    );

    syncOrderTypeFields();
}


function openOrderModal(
    orderType = null
) {
    if (!canPlaceOrder()) {

        showToast(
            getRestaurantUnavailableMessage()
        );

        return;
    }
    if (
        !cart.length
    ) {

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


// ==========================================
// SİPARİŞ ÖZETİ
// ==========================================

function updateOrderSummary() {

    if (!orderSummaryItems)
        return;


    orderSummaryItems.innerHTML =
        "";


    if (
        !cart.length
    ) {

        orderSummaryItems.innerHTML = `

            <div
                style="
                    text-align:center;
                    color:#888;
                    padding:10px;
                "
            >
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

                    Number(
                        item.price
                    )

                    *

                    Number(
                        item.quantity
                    );


                row.innerHTML = `

                    <span>
                        ${escapeHtml(
                            item.name
                        )}

                        ×

                        ${item.quantity}
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


    if (
        orderSummaryTotal
    ) {

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
        document.getElementById(
            "menuBtn"
        );


    if (menuBtn) {

        menuBtn.addEventListener(

            "click",

            () => {

                const menu =
                    document.getElementById(
                        "menu"
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
        document.getElementById(
            "packageBtn"
        );


    if (packageBtn) {

        packageBtn.addEventListener(

            "click",

            () => {

                openOrderModal(
                    "Paket Sipariş"
                );
            }
        );
    }


    const restaurantBtn =
        document.getElementById(
            "restaurantBtn"
        );


    if (restaurantBtn) {

        restaurantBtn.addEventListener(

            "click",

            () => {

                openOrderModal(
                    "Restoranda Sipariş"
                );
            }
        );
    }


    if (
        finishOrderBtn
    ) {

        finishOrderBtn.addEventListener(

            "click",

            () => {

                openOrderModal();
            }
        );
    }


    if (
        closeOrderModal
    ) {

        closeOrderModal.addEventListener(

            "click",

            closeModal
        );
    }


    if (
        orderModal
    ) {

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
                    "Escape"

                &&

                orderModal

                &&

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
        )

        ||

        /^5\d{9}$/.test(
            normalized
        )

        ||

        /^905\d{9}$/.test(
            normalized
        )

        ||

        /^00905\d{9}$/.test(
            normalized
        )

    );
}


// ==========================================
// WHATSAPP MESAJI
// ==========================================

function createWhatsAppMessage(

    customerName,

    customerPhone,

    orderType,

    tableNumber,

    address,

    note,

    confirmedItems,

    confirmedTotal

) {

    const orderItems =
        Array.isArray(confirmedItems)
            ? confirmedItems
            : cart;

    const orderTotal =
        Number.isFinite(
            Number(confirmedTotal)
        )
            ? Number(confirmedTotal)
            : getCartTotal();

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


    if (
        tableNumber
    ) {

        message +=
            "\n🪑 *Masa No:* " +
            tableNumber;
    }


    if (
        address
    ) {

        message +=
            "\n📍 *Adres:* " +
            address;
    }


    message +=
        "\n\n🛒 *SİPARİŞLER*" +
        "\n━━━━━━━━━━━━━━";


    orderItems.forEach(
        item => {

            const itemTotal =

                Number(
                    item.price
                )

                *

                Number(
                    item.quantity
                );


            message +=

                `\n• ${item.name} × ${item.quantity} = ${formatPrice(
                    itemTotal
                )}`;
        }
    );


    message +=

        "\n\n💰 *TOPLAM: " +

        formatPrice(
            orderTotal
        )

        +

        "*";


    if (
        note
    ) {

        message +=
            "\n\n📝 *Sipariş Notu:* " +
            note;
    }


    message +=
        "\n\n━━━━━━━━━━━━━━" +
        "\nQR Menü Pro";


    return message;
}


// ==========================================
// WHATSAPP
// ==========================================

function buildWhatsAppUrl(
    message
) {

    return (

        "https://api.whatsapp.com/send?phone="

        +

        WHATSAPP_NUMBER

        +

        "&text="

        +

        encodeURIComponent(
            message
        )
    );
}


function prepareWhatsAppWindow() {

    let preparedWindow =
        null;

    try {

        preparedWindow =
            window.open(
                "about:blank",
                "_blank"
            );

    } catch {

        return null;
    }

    if (!preparedWindow) {

        return null;
    }

    try {

        preparedWindow.opener =
            null;

        preparedWindow.document.title =
            "Ece Döner Siparişi";

        preparedWindow.document.body.textContent =
            "Sipariş doğrulanıyor, WhatsApp hazırlanıyor...";

    } catch {

        // Pencere hazırlanmışsa yönlendirme yine yapılabilir.
    }

    return preparedWindow;
}


function closePreparedWhatsAppWindow(
    preparedWindow
) {

    if (
        preparedWindow &&
        !preparedWindow.closed
    ) {

        try {

            preparedWindow.close();

        } catch {

            // Kapanamayan pencere sipariş akışını bozmamalı.
        }
    }
}


function openWhatsApp(
    message,
    preparedWindow = null
) {

    const url =
        buildWhatsAppUrl(
            message
        );

    if (
        preparedWindow &&
        !preparedWindow.closed
    ) {

        try {

            preparedWindow.location.replace(
                url
            );

            return true;

        } catch {

            closePreparedWhatsAppWindow(
                preparedWindow
            );
        }
    }


    try {

        window.location.assign(
            url
        );

        return true;

    } catch {

        return false;
    }
}


// ==========================================
// BACKEND
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


    let result =
        null;


    try {

        result =
            await response.json();

    } catch {

        throw new Error(

            "Sunucudan geçersiz cevap geldi."

        );
    }


    if (
        !response.ok

        ||

        !result?.success
    ) {

        throw new Error(

            result?.message

            ||

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

            if (!canPlaceOrder()) {

                showToast(
                    getRestaurantUnavailableMessage()
                );

                return;
            }

            if (
                isSendingOrder
            ) {

                return;
            }


            if (
                !cart.length
            ) {

                showToast(
                    "Sepetiniz boş 🛒"
                );


                closeModal();


                return;
            }


            const customerName =

                document
                    .getElementById(
                        "customerName"
                    )
                    ?.value
                    .trim()

                ||

                "";


            const customerPhone =

                document
                    .getElementById(
                        "customerPhone"
                    )
                    ?.value
                    .trim()

                ||

                "";


            const orderType =

                document
                    .getElementById(
                        "orderType"
                    )
                    ?.value

                ||

                "Paket Sipariş";


            const tableNumber =

                document
                    .getElementById(
                        "tableNumber"
                    )
                    ?.value
                    .trim()

                ||

                "";


            const address =

                document
                    .getElementById(
                        "orderAddress"
                    )
                    ?.value
                    .trim()

                ||

                "";


            const note =

                document
                    .getElementById(
                        "orderNote"
                    )
                    ?.value
                    .trim()

                ||

                "";


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
                    "Geçerli bir telefon numarası girin."
                );


                return;
            }


            if (
                orderType ===
                    "Paket Sipariş"

                &&

                !address
            ) {

                showToast(
                    "Paket siparişi için adres gerekli 📍"
                );


                return;
            }


            if (
                orderType ===
                    "Restoranda Sipariş"

                &&

                !tableNumber
            ) {

                showToast(
                    "Restoran siparişi için masa numarası gerekli 🪑"
                );


                return;
            }


            const items =
                getBackendOrderItems();


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

                items
            };


            const preparedWhatsAppWindow =
                prepareWhatsAppWindow();


            isSendingOrder =
                true;


            const submitButton =

                orderForm.querySelector(

                    'button[type="submit"]'

                );


            const originalText =

                submitButton?.textContent

                ||

                "📲 WhatsApp'tan Sipariş Ver";


            if (
                submitButton
            ) {

                submitButton.disabled =
                    true;


                submitButton.textContent =
                    "⏳ Sipariş Gönderiliyor...";


                submitButton.style.opacity =
                    "0.7";
            }


            try {

                const result =
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

                        note,

                        result?.order?.items,

                        result?.order?.total

                    );


                const whatsAppOpened =
                    openWhatsApp(
                        message,
                        preparedWhatsAppWindow
                    );


                showToast(
                    whatsAppOpened
                        ? "Siparişiniz başarıyla alındı! ✅"
                        : "Siparişiniz alındı; WhatsApp açılamadı. ✅"
                );


                cart =
                    [];


                updateCart();


                orderForm.reset();

                syncOrderTypeFields();


                closeModal();

            } catch (error) {

                closePreparedWhatsAppWindow(
                    preparedWhatsAppWindow
                );

                console.error(
                    "❌ Sipariş gönderme hatası:",
                    error
                );


                showToast(
                    error?.message ||
                    "Sipariş gönderilemedi. Tekrar deneyin. ❌"
                );

            } finally {

                isSendingOrder =
                    false;


                if (
                    submitButton
                ) {

                    submitButton.disabled =
                        !canPlaceOrder();


                    submitButton.textContent =
                        originalText;


                    submitButton.style.opacity =
                        submitButton.disabled
                            ? "0.7"
                            : "1";
                }
            }
        }
    );
}


// ==========================================
// BAŞLAT
// ==========================================

function initializeApp() {

    cacheDom();

    updateRestaurantStatusUI();

    loadRestaurantStatus();

    startRestaurantStatusPolling();

    setupCartEvents();


    setupAddCartButtons();


    setupCategories();


    setupSearch();


    setupModal();

    setupOrderTypeFields();


    setupOrderForm();


    updateCart();


    setupFavorites();


    filterProducts();


    loadProductsFromFirebase();


    console.log(
        "================================"
    );


    console.log(
        "✅ ECE DÖNER QR MENÜ PRO HAZIR"
    );


    console.log(
        "🔥 Firebase ürün sistemi aktif"
    );


    console.log(
        "🛒 Sepet sistemi aktif"
    );


    console.log(
        "📦 Sipariş sistemi aktif"
    );


    console.log(
        "================================"
    );
}


// ==========================================
// BAŞLAT
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


window.handleImageError =
    handleImageError;
