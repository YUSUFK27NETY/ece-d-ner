"use strict";

function classifyHttpError(error) {
    if (error?.message === "CORS engellendi.") {
        return {
            status: 403,
            message: "İstek kaynağına izin verilmiyor."
        };
    }

    if (error?.type === "entity.parse.failed") {
        return {
            status: 400,
            message: "Geçersiz JSON verisi."
        };
    }

    if (
        error?.type === "entity.too.large" ||
        error?.status === 413
    ) {
        return {
            status: 413,
            message: "İstek gövdesi çok büyük."
        };
    }

    return {
        status: 500,
        message: "Sunucu hatası oluştu."
    };
}

module.exports = {
    classifyHttpError
};
