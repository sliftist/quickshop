import fs from "fs";
import path from "path";
import zlib from "zlib";

const OUTPUT_FOLDER = "./assets";
const ICON_SIZES = [16, 48, 128];
const STORE_ICON_SIZE = 128;
const STORE_ICON_PADDING = 16;
const SUPERSAMPLES = 8;
const BACKGROUND = { r: 23, g: 140, b: 129 };
const FOREGROUND = { r: 255, g: 255, b: 255 };
const CORNER_RADIUS_FRACTION = 0.22;
const STROKE_WIDTH_FRACTION = 0.09;
const MIN_STROKE_WIDTH_PX = 1.6;
const WHEEL_RADIUS_FRACTION = 0.08;
const MIN_WHEEL_RADIUS_PX = 1.2;
const CART_POINTS: [number, number][] = [
    [0.15, 0.24],
    [0.28, 0.24],
    [0.38, 0.63],
    [0.76, 0.63],
    [0.85, 0.33],
    [0.31, 0.33],
];
const WHEEL_CENTERS: [number, number][] = [
    [0.42, 0.79],
    [0.72, 0.79],
];

type Point = { x: number; y: number };

function insideRoundedSquare(point: Point, origin: number, size: number, radius: number) {
    let localX = point.x - origin;
    let localY = point.y - origin;
    if (localX < 0 || localY < 0 || localX > size || localY > size) return false;
    let cornerX = Math.min(localX, size - localX);
    let cornerY = Math.min(localY, size - localY);
    if (cornerX >= radius || cornerY >= radius) return true;
    let dx = radius - cornerX;
    let dy = radius - cornerY;
    return dx * dx + dy * dy <= radius * radius;
}

function distanceToSegment(point: Point, a: Point, b: Point) {
    let abX = b.x - a.x;
    let abY = b.y - a.y;
    let lengthSquared = abX * abX + abY * abY;
    let t = lengthSquared ? Math.max(0, Math.min(1, ((point.x - a.x) * abX + (point.y - a.y) * abY) / lengthSquared)) : 0;
    let closestX = a.x + abX * t;
    let closestY = a.y + abY * t;
    return Math.hypot(point.x - closestX, point.y - closestY);
}

function renderIcon(size: number) {
    let padding = size === STORE_ICON_SIZE ? STORE_ICON_PADDING : 0;
    let art = size - 2 * padding;
    let radius = art * CORNER_RADIUS_FRACTION;
    let strokeHalf = Math.max(MIN_STROKE_WIDTH_PX, art * STROKE_WIDTH_FRACTION) / 2;
    let wheelRadius = Math.max(MIN_WHEEL_RADIUS_PX, art * WHEEL_RADIUS_FRACTION);
    let toPixels = ([fx, fy]: [number, number]): Point => ({ x: padding + art * fx, y: padding + art * fy });
    let cart = CART_POINTS.map(toPixels);
    let wheels = WHEEL_CENTERS.map(toPixels);
    let pixels = Buffer.alloc(size * size * 4);
    let samplesPerPixel = SUPERSAMPLES * SUPERSAMPLES;
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            let backgroundHits = 0;
            let foregroundHits = 0;
            for (let sy = 0; sy < SUPERSAMPLES; sy++) {
                for (let sx = 0; sx < SUPERSAMPLES; sx++) {
                    let point = { x: x + (sx + 0.5) / SUPERSAMPLES, y: y + (sy + 0.5) / SUPERSAMPLES };
                    if (!insideRoundedSquare(point, padding, art, radius)) continue;
                    let onCart = false;
                    for (let i = 0; i + 1 < cart.length && !onCart; i++) {
                        onCart = distanceToSegment(point, cart[i], cart[i + 1]) <= strokeHalf;
                    }
                    let onWheel = wheels.some(wheel => Math.hypot(point.x - wheel.x, point.y - wheel.y) <= wheelRadius);
                    if (onCart || onWheel) {
                        foregroundHits++;
                    } else {
                        backgroundHits++;
                    }
                }
            }
            let covered = backgroundHits + foregroundHits;
            let offset = (y * size + x) * 4;
            if (!covered) continue;
            let foregroundShare = foregroundHits / covered;
            pixels[offset] = Math.round(BACKGROUND.r + (FOREGROUND.r - BACKGROUND.r) * foregroundShare);
            pixels[offset + 1] = Math.round(BACKGROUND.g + (FOREGROUND.g - BACKGROUND.g) * foregroundShare);
            pixels[offset + 2] = Math.round(BACKGROUND.b + (FOREGROUND.b - BACKGROUND.b) * foregroundShare);
            pixels[offset + 3] = Math.round(255 * covered / samplesPerPixel);
        }
    }
    return { pixels, padding };
}

const crcTable = (() => {
    let table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) {
            c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        }
        table[n] = c >>> 0;
    }
    return table;
})();

function crc32(data: Buffer) {
    let crc = 0xffffffff;
    for (let byte of data) {
        crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer) {
    let length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    let typeAndData = Buffer.concat([Buffer.from(type, "ascii"), data]);
    let crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(typeAndData));
    return Buffer.concat([length, typeAndData, crc]);
}

function encodePng(size: number, pixels: Buffer) {
    let header = Buffer.alloc(13);
    header.writeUInt32BE(size, 0);
    header.writeUInt32BE(size, 4);
    header[8] = 8;
    header[9] = 6;
    let rowLength = size * 4;
    let raw = Buffer.alloc((rowLength + 1) * size);
    for (let y = 0; y < size; y++) {
        pixels.copy(raw, y * (rowLength + 1) + 1, y * rowLength, (y + 1) * rowLength);
    }
    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        pngChunk("IHDR", header),
        pngChunk("IDAT", zlib.deflateSync(raw)),
        pngChunk("IEND", Buffer.alloc(0)),
    ]);
}

function main() {
    fs.mkdirSync(OUTPUT_FOLDER, { recursive: true });
    for (let size of ICON_SIZES) {
        let { pixels, padding } = renderIcon(size);
        let png = encodePng(size, pixels);
        let outputPath = path.join(OUTPUT_FOLDER, `icon${size}.png`);
        fs.writeFileSync(outputPath, png);
        console.log(`Wrote ${outputPath}: ${size}x${size}, padding ${padding}px, ${png.length} bytes`);
    }
}

main();
