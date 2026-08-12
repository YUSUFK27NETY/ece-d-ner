// ==========================================
// QR MENÜ PRO - ECE DÖNER
// CUSTOMER SCRIPT.JS
// BACKEND + WHATSAPP SÜRÜMÜ
// ==========================================

"use strict";


// ==========================================
// AYARLAR
// ==========================================

const API_URL = "https://ece-d-ner.onrender.com/api/orders";


// ==========================================
// ANA BUTONLAR
// ==========================================

const restaurantBtn =
    document.querySelector("#restaurantBtn");

const packageBtn =
    document.querySelector("#packageBtn");

const menuBtn =
    document.querySelector("#menuBtn");


if (restaurantBtn) {

    restaurantBtn.addEventListener(
        "click",
        function () {

            alert("🍽️ Restoran Sipariş Sistemi");

        }
    );

}


if (packageBtn) {

    packageBtn.addEventListener(
        "click",
        function () {

            alert("🛵 Paket Sipariş Sistemi");

        }
    );

}


if (menuBtn) {

    menuBtn.addEventListener(
        "click",
        function () {

            const menuSection =
                document.querySelector(".menu-section");

            if (menuSection) {

                menuSection.scrollIntoView({
                    behavior: "smooth"
                });

            }

        }
    );

}


// ==========================================
// KATEGORİ FİLTRELEME
// ==========================================

const categoryButtons =
    document.querySelectorAll(
        ".categories button"
    );


const productCards =
    document.querySelectorAll(
        ".card"
    );


categoryButtons.forEach(
    function (button) {

        button.addEventListener(
            "click",
            function () {

                categoryButtons.forEach(
                    function (btn) {

                        btn.classList.remove(
                            "active"
                        );

                    }
                );


                this.classList.add(
                    "active"
                );


                const selectedCategory =
                    this.dataset.category;


                productCards.forEach(
                    function (card) {

                        const cardCategory =
                            card.dataset.category;


                        if (
                            selectedCategory ===
                            "all" ||
                            cardCategory ===
                            selectedCategory
                        ) {

                            card.style.display =
                                "";

                        }

                        else {

                            card.style.display =
                                "none";

                        }

                    }
                );

            }
        );

    }
);


// ==========================================
// SEPET
// ==========================================

let cart = [];


const cartCount =
    document.querySelector(
        "#cartCount"
    );


const cartItems =
    document.querySelector(
        "#cartItems"
    );


const totalPrice =
    document.querySelector(
        "#totalPrice"
    );


const finishOrder =
    document.querySelector(
        "#finishOrder"
    );


const toast =
    document.querySelector(
        "#toast"
    );


// ==========================================
// TOAST
// ==========================================

function showToast(message) {

    if (!toast) {

        console.log(message);

        return;

    }


    toast.innerText =
        message;


    toast.classList.add(
        "show"
    );


    setTimeout(
        function () {

            toast.classList.remove(
                "show"
            );

        },
        2200
    );

}


// ==========================================
// SEPETİ GÜNCELLE
// ==========================================

function updateCart() {

    if (!cartItems) {

        updateCartCount();

        return;

    }


    cartItems.innerHTML = "";


    let total = 0;

    let itemCount = 0;


    cart.forEach(
        function (item, index) {

            const itemTotal =
                item.price *
                item.quantity;


            total +=
                itemTotal;


            itemCount +=
                item.quantity;


            const li =
                document.createElement(
                    "li"
                );


            li.innerHTML = `

                <div class="cart-item">

                    <div>

                        <strong>
                            ${escapeHTML(item.name)}
                        </strong>

                        <br>

                        <span>
                            ${item.price}₺ ×
                            ${item.quantity}
                        </span>

                    </div>


                    <div class="cart-controls">

                        <button
                            class="minus-btn"
                            data-index="${index}"
                            type="button"
                        >
                            −
                        </button>


                        <span>
                            ${item.quantity}
                        </span>


                        <button
                            class="plus-btn"
                            data-index="${index}"
                            type="button"
                        >
                            +
                        </button>


                        <button
                            class="delete-btn"
                            data-index="${index}"
                            type="button"
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


    if (cartCount) {

        cartCount.innerText =
            itemCount;

    }


    if (totalPrice) {

        totalPrice.innerText =
            "Toplam: " +
            total +
            "₺";

    }


    setupCartButtons();

}


// ==========================================
// SEPET SAYISI
// ==========================================

function updateCartCount() {

    if (!cartCount) {

        return;

    }


    const count =
        cart.reduce(
            function (total, item) {

                return total +
                    Number(
                        item.quantity
                    );

            },
            0
        );


    cartCount.innerText =
        count;

}


// ==========================================
// SEPET BUTONLARI
// ==========================================

function setupCartButtons() {


    document
        .querySelectorAll(".minus-btn")
        .forEach(
            function (button) {

                button.addEventListener(
                    "click",
                    function () {

                        const index =
                            Number(
                                this.dataset.index
                            );


                        if (!cart[index]) {

                            return;

                        }


                        cart[index].quantity--;


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
                );

            }
        );


    document
        .querySelectorAll(".plus-btn")
        .forEach(
            function (button) {

                button.addEventListener(
                    "click",
                    function () {

                        const index =
                            Number(
                                this.dataset.index
                            );


                        if (!cart[index]) {

                            return;

                        }


                        cart[index].quantity++;


                        updateCart();

                    }
                );

            }
        );


    document
        .querySelectorAll(".delete-btn")
        .forEach(
            function (button) {

                button.addEventListener(
                    "click",
                    function () {

                        const index =
                            Number(
                                this.dataset.index
                            );


                        cart.splice(
                            index,
                            1
                        );


                        updateCart();


                        showToast(
                            "Ürün sepetten kaldırıldı 🗑️"
                        );

                    }
                );

            }
        );

}


// ==========================================
// SEPETE EKLE
// ==========================================

const addCartButtons =
    document.querySelectorAll(
        ".addCart"
    );


addCartButtons.forEach(
    function (button) {

        button.addEventListener(
            "click",
            function () {

                const name =
                    this.dataset.name;


                const price =
                    Number(
                        this.dataset.price
                    );


                const existingItem =
                    cart.find(
                        function (item) {

                            return item.name ===
                                name;

                        }
                    );


                if (existingItem) {

                    existingItem.quantity++;

                }

                else {

                    cart.push({

                        name:
                            name,

                        price:
                            price,

                        quantity:
                            1

                    });

                }


                updateCart();


                const oldText =
                    this.innerText;


                this.innerText =
                    "✔ Eklendi";


                this.style.background =
                    "#16a34a";


                this.style.color =
                    "white";


                const currentButton =
                    this;


                setTimeout(
                    function () {

                        currentButton.innerText =
                            oldText;


                        currentButton.style.background =
                            "";


                        currentButton.style.color =
                            "";

                    },
                    1200
                );


                showToast(
                    "Ürün sepete eklendi ✅"
                );

            }
        );

    }
);


// ==========================================
// SİPARİŞ MODALI
// ==========================================

const orderModal =
    document.querySelector(
        "#orderModal"
    );


const closeOrderModal =
    document.querySelector(
        "#closeOrderModal"
    );


const orderForm =
    document.querySelector(
        "#orderForm"
    );


const orderSummaryItems =
    document.querySelector(
        "#orderSummaryItems"
    );


const orderSummaryTotal =
    document.querySelector(
        "#orderSummaryTotal"
    );


// ==========================================
// SİPARİŞ MODALINI AÇ
// ==========================================

if (finishOrder) {

    finishOrder.addEventListener(
        "click",
        function () {

            if (cart.length === 0) {

                showToast(
                    "Sepetiniz boş 🛒"
                );

                return;

            }


            if (!orderModal) {

                showToast(
                    "Sipariş ekranı bulunamadı."
                );

                return;

            }


            if (orderSummaryItems) {

                orderSummaryItems.innerHTML =
                    "";

            }


            let total = 0;


            cart.forEach(
                function (item) {

                    const itemTotal =
                        item.price *
                        item.quantity;


                    total +=
                        itemTotal;


                    if (orderSummaryItems) {

                        const div =
                            document.createElement(
                                "div"
                            );


                        div.className =
                            "summary-item";


                        div.innerHTML = `

                            <span>
                                ${escapeHTML(item.name)}
                                × ${item.quantity}
                            </span>

                            <strong>
                                ${itemTotal}₺
                            </strong>

                        `;


                        orderSummaryItems.appendChild(
                            div
                        );

                    }

                }
            );


            if (orderSummaryTotal) {

                orderSummaryTotal.innerText =
                    "Toplam: " +
                    total +
                    "₺";

            }


            orderModal.classList.add(
                "show"
            );

        }
    );

}


// ==========================================
// MODALI KAPAT
// ==========================================

if (closeOrderModal) {

    closeOrderModal.addEventListener(
        "click",
        function () {

            if (orderModal) {

                orderModal.classList.remove(
                    "show"
                );

            }

        }
    );

}


if (orderModal) {

    orderModal.addEventListener(
        "click",
        function (event) {

            if (
                event.target ===
                orderModal
            ) {

                orderModal.classList.remove(
                    "show"
                );

            }

        }
    );

}


document.addEventListener(
    "keydown",
    function (event) {

        if (
            event.key ===
            "Escape"
        ) {

            if (orderModal) {

                orderModal.classList.remove(
                    "show"
                );

            }

        }

    }
);


// ==========================================
// SİPARİŞ GÖNDER
// BACKEND + WHATSAPP
// ==========================================

if (orderForm) {

    orderForm.addEventListener(
        "submit",
        async function (event) {

            event.preventDefault();


            // ==================================
            // FORM ELEMANLARI
            // ==================================

            const customerNameElement =
                document.querySelector(
                    "#customerName"
                );


            const customerPhoneElement =
                document.querySelector(
                    "#customerPhone"
                );


            const orderTypeElement =
                document.querySelector(
                    "#orderType"
                );


            const tableNumberElement =
                document.querySelector(
                    "#tableNumber"
                );


            const orderAddressElement =
                document.querySelector(
                    "#orderAddress"
                );


            const orderNoteElement =
                document.querySelector(
                    "#orderNote"
                );


            // ==================================
            // DEĞERLER
            // ==================================

            const customerName =
                customerNameElement
                    ? customerNameElement.value.trim()
                    : "";


            const customerPhone =
                customerPhoneElement
                    ? customerPhoneElement.value.trim()
                    : "";


            const orderType =
                orderTypeElement
                    ? orderTypeElement.value
                    : "Paket Servis";


            const tableNumber =
                tableNumberElement
                    ? tableNumberElement.value.trim()
                    : "";


            const orderAddress =
                orderAddressElement
                    ? orderAddressElement.value.trim()
                    : "";


            const orderNote =
                orderNoteElement
                    ? orderNoteElement.value.trim()
                    : "";


            // ==================================
            // KONTROL
            // ==================================

            if (
                !customerName ||
                !customerPhone
            ) {

                showToast(
                    "Lütfen ad soyad ve telefon bilgilerini doldurun."
                );

                return;

            }


            if (cart.length === 0) {

                showToast(
                    "Sepetiniz boş."
                );

                return;

            }


            // ==================================
            // TOPLAM
            // ==================================

            let total = 0;


            cart.forEach(
                function (item) {

                    total +=
                        Number(item.price) *
                        Number(item.quantity);

                }
            );


            // ==================================
            // BACKEND SİPARİŞİ
            // ==================================

            const orderData = {

                customerName:
                    customerName,

                phone:
                    customerPhone,

                orderType:
                    orderType,

                address:
                    orderAddress,

                note:
                    orderNote,

                tableNumber:
                    tableNumber,

                items:
                    cart.map(
                        function (item) {

                            return {

                                name:
                                    item.name,

                                price:
                                    Number(
                                        item.price
                                    ),

                                quantity:
                                    Number(
                                        item.quantity
                                    )

                            };

                        }
                    ),

                total:
                    total

            };


            // ==================================
            // BUTONU KİLİTLE
            // ==================================

            const submitButton =
                orderForm.querySelector(
                    'button[type="submit"]'
                );


            const oldButtonText =
                submitButton
                    ? submitButton.innerText
                    : "";


            if (submitButton) {

                submitButton.disabled =
                    true;


                submitButton.innerText =
                    "⏳ Sipariş gönderiliyor...";

            }


            // ==================================
            // BACKEND'E GÖNDER
            // ==================================

            try {

                const response =
                    await fetch(
                        API_URL,
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


                const data =
                    await response.json();


                if (!response.ok) {

                    throw new Error(
                        data.message ||
                        "Sipariş gönderilemedi."
                    );

                }


                console.log(
                    "Backend siparişi:",
                    data
                );


                // ==================================
                // WHATSAPP MESAJI
                // ==================================

                let message =
                    "🛵 ECE DÖNER SİPARİŞ\n\n";


                message +=
                    "🔢 Sipariş No: " +
                    (
                        data.order?.orderNumber ||
                        "Yeni Sipariş"
                    ) +
                    "\n";


                message +=
                    "👤 Müşteri: " +
                    customerName +
                    "\n";


                message +=
                    "📱 Telefon: " +
                    customerPhone +
                    "\n";


                message +=
                    "📦 Sipariş Türü: " +
                    orderType +
                    "\n";


                if (tableNumber) {

                    message +=
                        "🪑 Masa No: " +
                        tableNumber +
                        "\n";

                }


                if (orderAddress) {

                    message +=
                        "📍 Adres: " +
                        orderAddress +
                        "\n";

                }


                message +=
                    "\n🛒 SİPARİŞLER\n";


                cart.forEach(
                    function (item) {

                        const itemTotal =
                            Number(item.price) *
                            Number(item.quantity);


                        message +=
                            "• " +
                            item.name +
                            " x" +
                            item.quantity +
                            " = " +
                            itemTotal +
                            "₺\n";

                    }
                );


                message +=
                    "\n💰 TOPLAM: " +
                    total +
                    "₺";


                if (orderNote) {

                    message +=
                        "\n\n📝 Not: " +
                        orderNote;

                }


                // ==================================
                // WHATSAPP
                // ==================================

                const restaurantWhatsApp =
                    "905315006996";


                const whatsappURL =
                    "https://api.whatsapp.com/send?phone=" +
                    restaurantWhatsApp +
                    "&text=" +
                    encodeURIComponent(
                        message
                    );


                // ==================================
                // WHATSAPP'I AÇ
                // ==================================

                window.open(
                    whatsappURL,
                    "_blank"
                );


                // ==================================
                // BAŞARILI
                // ==================================

                showToast(
                    "Sipariş alındı! WhatsApp açılıyor 📲"
                );


                // ==================================
                // SEPETİ TEMİZLE
                // ==================================

                cart = [];


                updateCart();


                if (orderForm) {

                    orderForm.reset();

                }


                if (orderModal) {

                    orderModal.classList.remove(
                        "show"
                    );

                }

            }

            catch (error) {

                console.error(
                    "Sipariş gönderme hatası:",
                    error
                );


                showToast(
                    "Sipariş gönderilemedi. Sunucu bağlantısını kontrol edin."
                );

            }


            // ==================================
            // BUTONU AÇ
            // ==================================

            if (submitButton) {

                submitButton.disabled =
                    false;


                submitButton.innerText =
                    oldButtonText ||
                    "Sipariş Ver";

            }

        }
    );

}


// ==========================================
// FAVORİLER
// ==========================================

const favoriteButtons =
    document.querySelectorAll(
        ".favorite"
    );


favoriteButtons.forEach(
    function (button) {

        button.addEventListener(
            "click",
            function (event) {

                event.stopPropagation();


                this.classList.toggle(
                    "active"
                );


                if (
                    this.classList.contains(
                        "active"
                    )
                ) {

                    this.innerText =
                        "❤️";

                }

                else {

                    this.innerText =
                        "🤍";

                }

            }
        );

    }
);


// ==========================================
// CANLI ARAMA
// ==========================================

const search =
    document.querySelector(
        "#search"
    );


if (search) {

    search.addEventListener(
        "input",
        function () {

            const value =
                this.value
                    .toLowerCase()
                    .trim();


            document
                .querySelectorAll(
                    ".card"
                )
                .forEach(
                    function (card) {

                        const text =
                            card.innerText
                                .toLowerCase();


                        if (
                            text.includes(
                                value
                            )
                        ) {

                            card.style.display =
                                "";

                        }

                        else {

                            card.style.display =
                                "none";

                        }

                    }
                );

        }
    );

}


// ==========================================
// HTML GÜVENLİ HALE GETİR
// ==========================================

function escapeHTML(value) {

    if (
        value === null ||
        value === undefined
    ) {

        return "";

    }


    return String(value)
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
// BAŞLANGIÇ
// ==========================================

updateCart();

console.log(
    "QR Menü Pro Customer sistemi hazır."
);

console.log(
    "Backend:",
    API_URL
);
