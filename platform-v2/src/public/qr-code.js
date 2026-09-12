"use strict";

const QR_VERSION = 6;
const QR_SIZE = 4 * QR_VERSION + 17;
const DATA_CODEWORDS = 136;
const ECC_CODEWORDS_PER_BLOCK = 18;
const BLOCK_COUNT = 2;
const TOTAL_CODEWORDS = 172;
const MAX_BYTE_PAYLOAD = 134;

function multiplyGf256(x, y) {
    let z = 0;
    for (let i = 7; i >= 0; i -= 1) {
        z = (z << 1) ^ ((z >>> 7) * 0x11D);
        z ^= ((y >>> i) & 1) * x;
    }
    return z;
}

function reedSolomonDivisor(degree) {
    const result = new Array(degree).fill(0);
    result[degree - 1] = 1;
    let root = 1;
    for (let i = 0; i < degree; i += 1) {
        for (let j = 0; j < degree; j += 1) {
            result[j] = multiplyGf256(result[j], root);
            if (j + 1 < degree) result[j] ^= result[j + 1];
        }
        root = multiplyGf256(root, 0x02);
    }
    return result;
}

function reedSolomonRemainder(data, divisor) {
    const result = new Array(divisor.length).fill(0);
    for (const byte of data) {
        const factor = byte ^ result.shift();
        result.push(0);
        for (let i = 0; i < divisor.length; i += 1) {
            result[i] ^= multiplyGf256(divisor[i], factor);
        }
    }
    return result;
}

function appendBits(target, value, length) {
    if (!Number.isInteger(value) || value < 0 || !Number.isInteger(length) || length < 0 || value >>> length !== 0) {
        throw new TypeError("QR bit girdisi geçersiz.");
    }
    for (let i = length - 1; i >= 0; i -= 1) target.push((value >>> i) & 1);
}

function createDataCodewords(text) {
    if (typeof text !== "string" || text.length === 0) throw new TypeError("QR payload gerekli.");
    const bytes = [...Buffer.from(text, "utf8")];
    if (bytes.length > MAX_BYTE_PAYLOAD) throw new TypeError("QR payload çok uzun.");

    const bits = [];
    appendBits(bits, 0b0100, 4);
    appendBits(bits, bytes.length, 8);
    for (const byte of bytes) appendBits(bits, byte, 8);

    const capacityBits = DATA_CODEWORDS * 8;
    appendBits(bits, 0, Math.min(4, capacityBits - bits.length));
    while (bits.length % 8 !== 0) bits.push(0);

    const data = [];
    for (let i = 0; i < bits.length; i += 8) {
        let value = 0;
        for (let j = 0; j < 8; j += 1) value = (value << 1) | bits[i + j];
        data.push(value);
    }
    for (let pad = 0; data.length < DATA_CODEWORDS; pad += 1) {
        data.push(pad % 2 === 0 ? 0xEC : 0x11);
    }
    return data;
}

function formatBits(mask) {
    const data = (1 << 3) | mask;
    let remainder = data;
    for (let i = 0; i < 10; i += 1) {
        remainder = (remainder << 1) ^ ((remainder >>> 9) * 0x537);
    }
    return ((data << 10) | remainder) ^ 0x5412;
}

function createMatrix(text) {
    const data = createDataCodewords(text);
    const divisor = reedSolomonDivisor(ECC_CODEWORDS_PER_BLOCK);
    const blockDataLength = DATA_CODEWORDS / BLOCK_COUNT;
    const blocks = Array.from({ length: BLOCK_COUNT }, (_, index) => {
        const blockData = data.slice(index * blockDataLength, (index + 1) * blockDataLength);
        return Object.freeze({ data: blockData, ecc: reedSolomonRemainder(blockData, divisor) });
    });
    const allCodewords = [];
    for (let i = 0; i < blockDataLength; i += 1) {
        for (const block of blocks) allCodewords.push(block.data[i]);
    }
    for (let i = 0; i < ECC_CODEWORDS_PER_BLOCK; i += 1) {
        for (const block of blocks) allCodewords.push(block.ecc[i]);
    }
    if (allCodewords.length !== TOTAL_CODEWORDS) throw new Error("QR codeword sayısı geçersiz.");

    const modules = Array.from({ length: QR_SIZE }, () => new Array(QR_SIZE).fill(false));
    const isFunction = Array.from({ length: QR_SIZE }, () => new Array(QR_SIZE).fill(false));

    function setFunction(x, y, dark) {
        if (x < 0 || x >= QR_SIZE || y < 0 || y >= QR_SIZE) return;
        modules[y][x] = Boolean(dark);
        isFunction[y][x] = true;
    }

    function drawFinder(cx, cy) {
        for (let dy = -4; dy <= 4; dy += 1) {
            for (let dx = -4; dx <= 4; dx += 1) {
                const distance = Math.max(Math.abs(dx), Math.abs(dy));
                setFunction(cx + dx, cy + dy, distance !== 2 && distance !== 4);
            }
        }
    }

    function drawAlignment(cx, cy) {
        for (let dy = -2; dy <= 2; dy += 1) {
            for (let dx = -2; dx <= 2; dx += 1) {
                setFunction(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
            }
        }
    }

    for (let i = 0; i < QR_SIZE; i += 1) {
        setFunction(6, i, i % 2 === 0);
        setFunction(i, 6, i % 2 === 0);
    }
    drawFinder(3, 3);
    drawFinder(QR_SIZE - 4, 3);
    drawFinder(3, QR_SIZE - 4);
    drawAlignment(34, 34);

    const fmt = formatBits(0);
    const bit = index => ((fmt >>> index) & 1) !== 0;
    for (let i = 0; i <= 5; i += 1) setFunction(8, i, bit(i));
    setFunction(8, 7, bit(6));
    setFunction(8, 8, bit(7));
    setFunction(7, 8, bit(8));
    for (let i = 9; i < 15; i += 1) setFunction(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i += 1) setFunction(QR_SIZE - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i += 1) setFunction(8, QR_SIZE - 15 + i, bit(i));
    setFunction(8, QR_SIZE - 8, true);

    let bitIndex = 0;
    for (let right = QR_SIZE - 1; right >= 1; right -= 2) {
        if (right === 6) right = 5;
        const upward = ((right + 1) & 2) === 0;
        for (let vert = 0; vert < QR_SIZE; vert += 1) {
            const y = upward ? QR_SIZE - 1 - vert : vert;
            for (let offset = 0; offset < 2; offset += 1) {
                const x = right - offset;
                if (isFunction[y][x]) continue;
                let dark = false;
                if (bitIndex < allCodewords.length * 8) {
                    const byte = allCodewords[bitIndex >>> 3];
                    dark = ((byte >>> (7 - (bitIndex & 7))) & 1) !== 0;
                }
                bitIndex += 1;
                if ((x + y) % 2 === 0) dark = !dark;
                modules[y][x] = dark;
            }
        }
    }
    if (bitIndex < allCodewords.length * 8) throw new Error("QR payload yerleştirilemedi.");
    return modules;
}

function createQrSvg(text, { border = 4 } = {}) {
    if (!Number.isInteger(border) || border < 4 || border > 16) throw new TypeError("QR border geçersiz.");
    const matrix = createMatrix(text);
    const dimension = QR_SIZE + border * 2;
    const path = [];
    for (let y = 0; y < QR_SIZE; y += 1) {
        for (let x = 0; x < QR_SIZE; x += 1) {
            if (matrix[y][x]) path.push(`M${x + border},${y + border}h1v1h-1z`);
        }
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${dimension} ${dimension}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/><path d="${path.join("")}" fill="#000"/></svg>`;
}

module.exports = { createQrSvg, createMatrix, MAX_BYTE_PAYLOAD, QR_VERSION };
