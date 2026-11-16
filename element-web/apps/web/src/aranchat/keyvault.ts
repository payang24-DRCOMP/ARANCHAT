/*
 * AranChat — กุญแจกู้คืนแชทเข้ารหัส ฝากไว้ที่ server ของ รพ. (aranchat-ess/keyvault)
 *
 * แชทเข้ารหัสต้นทางถึงปลายทาง: กุญแจอยู่ในเครื่อง → เปลี่ยนเครื่อง/ล้างข้อมูลแล้วต้องกู้คืน
 * ผู้ใช้ไม่ต้องทำอะไร:
 *   - บัญชีที่ยังไม่มีที่เก็บกุญแจ: สร้าง recovery key → ฝาก keyvault ก่อน → ตั้ง cross-signing + สำรองกุญแจแชท (key backup)
 *   - เครื่องใหม่: ดึง recovery key จาก keyvault → ยืนยันเครื่องนี้ + เปิดสำรองกุญแจ → อ่านแชทเก่าได้
 *   - บัญชีที่ตั้งที่เก็บกุญแจไว้เองก่อนหน้า (ไม่มีใน keyvault): ถ้าเครื่องนี้มีกุญแจครบ ตั้ง recovery key ใหม่แล้วฝาก
 * ที่อยู่ keyvault มาจาก /.well-known/matrix/client "com.arankub.keyvault" (values/rtc.yaml.tpl)
 * ยืนยันตัวกับ keyvault ด้วย OpenID token (ไม่ส่ง access token ออกไป)
 * Android ทำแบบเดียวกัน (features/securebackup … AranKeyvault.kt) — recovery key ใช้ร่วมกันทุกเครื่อง
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { type MatrixClient } from "matrix-js-sdk/src/matrix";
import { decodeRecoveryKey, type GeneratedSecretStorageKey } from "matrix-js-sdk/src/crypto-api";
import { logger } from "matrix-js-sdk/src/logger";

import { withProvidedSecretStorageKey } from "../SecurityManager";
import { aranChatConfig } from "./config";

const log = logger.getChild("AranKeyvault");

function keyvaultUrl(cli: MatrixClient): string | undefined {
    const wk = cli.getClientWellKnown() as { "com.arankub.keyvault"?: { url?: string } } | undefined;
    // config.json aranchat.keyvault_url ใช้แทนได้ (เครื่องทดสอบที่ไม่มี well-known)
    const url = wk?.["com.arankub.keyvault"]?.url ?? aranChatConfig()?.keyvault_url;
    const ok = typeof url === "string" && (url.startsWith("https://") || url.startsWith("http://127.0.0.1:"));
    return ok ? url.replace(/\/+$/, "") : undefined;
}

async function call(
    cli: MatrixClient,
    base: string,
    action: "get" | "put" | "allow-reset",
    extra: Record<string, unknown> = {},
): Promise<{ status: number; recovery_key?: string; error?: string }> {
    const openid = await cli.getOpenIdToken();
    const r = await fetch(`${base}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ openid, ...extra }),
    });
    const body = r.headers.get("content-type")?.includes("json") ? await r.json() : {};
    return { status: r.status, ...body };
}

/** cross-signing ครั้งแรก: server ยอมให้อัปโหลดโดยไม่ถามรหัสผ่าน (ยังไม่เคยมีกุญแจ — MSC3967) */
const noAuth = async (makeRequest: (auth: null) => Promise<unknown>): Promise<void> => {
    await makeRequest(null);
};

/**
 * ตั้ง recovery key ใหม่ แล้วฝาก keyvault
 * เครื่องนี้ไม่มีกุญแจยืนยันตัวตน (cross-signing) ครบ → ตั้งชุดใหม่ (keyvault ขออนุญาต server ให้ไม่ต้องถามรหัสผ่าน)
 * ฝากหลังตั้งเสร็จ: ถ้าฝากไม่สำเร็จ เครื่องนี้ยังถือกุญแจครบ ครั้งหน้าตั้ง recovery key ใหม่แล้วฝากซ้ำได้
 */
async function createAndEscrow(cli: MatrixClient, base: string, replace: boolean): Promise<void> {
    const crypto = cli.getCrypto()!;
    const cached = (await crypto.getCrossSigningStatus()).privateKeysCachedLocally;
    const haveAll = cached.masterKey && cached.selfSigningKey && cached.userSigningKey;
    const generated: GeneratedSecretStorageKey = await crypto.createRecoveryKeyFromPassphrase();
    // ทำทุกขั้นด้วยกุญแจใหม่ — ห้ามแตะที่เก็บกุญแจเดิม (ไม่มีใครรู้กุญแจ จะกลายเป็นหน้าถาม recovery key)
    await withProvidedSecretStorageKey(generated.privateKey as Uint8Array<ArrayBuffer>, async () => {
        await crypto.bootstrapSecretStorage({
            createSecretStorageKey: async () => generated,
            setupNewSecretStorage: true,
            setupNewKeyBackup: !(await crypto.getSessionBackupPrivateKey()),
        });
        if (haveAll) {
            await crypto.bootstrapCrossSigning({ authUploadDeviceSigningKeys: noAuth });
        } else {
            await call(cli, base, "allow-reset").catch(() => undefined);
            await crypto.bootstrapCrossSigning({ authUploadDeviceSigningKeys: noAuth, setupNewCrossSigning: true });
        }
    });
    const put = await call(cli, base, "put", { recovery_key: generated.encodedPrivateKey, replace });
    if (put.status !== 200) throw new Error(`keyvault put ${put.status}`);
    log.info(replace ? "ตั้ง recovery key ใหม่และฝากแล้ว" : "ตั้งการเข้ารหัสและฝากกุญแจแล้ว");
}

/** กุญแจที่ฝากไว้ตรงกับที่เก็บกุญแจของบัญชีตอนนี้ไหม (กันกุญแจค้างจากการตั้งค่าที่ไม่สำเร็จ) */
async function matches(cli: MatrixClient, recoveryKey: string): Promise<boolean> {
    try {
        const found = await cli.secretStorage.getKey();
        return !!found && (await cli.secretStorage.checkKey(decodeRecoveryKey(recoveryKey), found[1]));
    } catch {
        return false;
    }
}

async function restore(cli: MatrixClient, recoveryKey: string): Promise<void> {
    const crypto = cli.getCrypto()!;
    await withProvidedSecretStorageKey(decodeRecoveryKey(recoveryKey), async () => {
        // ดึงกุญแจ cross-signing จากที่เก็บ → เครื่องนี้ได้รับการยืนยันเอง (ไม่ต้องสแกน/กดยืนยันจากเครื่องอื่น)
        await crypto.bootstrapCrossSigning({ authUploadDeviceSigningKeys: noAuth });
        await crypto.loadSessionBackupPrivateKeyFromSecretStorage();
    });
    await crypto.checkKeyBackupAndEnable();
    log.info("กู้กุญแจจาก keyvault แล้ว");
    // ดาวน์โหลดกุญแจของข้อความเก่าทั้งหมดเบื้องหลัง (ข้อความที่เปิดดูก่อนจะถอดรหัสได้ทันทีอยู่แล้ว)
    crypto.restoreKeyBackup().catch((e) => log.warn("restoreKeyBackup", e));
}

let running: Promise<void> | undefined;

/** เรียกหลัง sync ครั้งแรก — ทำงานเบื้องหลัง ไม่แสดงอะไรให้ผู้ใช้ */
export function aranKeyvaultSync(cli: MatrixClient): Promise<void> {
    running ??= (async (): Promise<void> => {
        const base = keyvaultUrl(cli);
        const crypto = cli.getCrypto();
        if (!base || !crypto || cli.isGuest()) return;

        const hasStorage = !!(await cli.secretStorage.getDefaultKeyId());
        const ready =
            hasStorage &&
            (await crypto.isCrossSigningReady()) &&
            (await crypto.isSecretStorageReady()) &&
            !!(await crypto.getSessionBackupPrivateKey());

        const got = await call(cli, base, "get");
        // 404 ที่นับว่า "ยังไม่เคยฝาก" ต้องมาจาก keyvault เอง ({error:"none"}) — 404 อื่น (บริการล่ม/ยังไม่ติดตั้ง)
        // ห้ามตั้งกุญแจใหม่ ไม่อย่างนั้นจะทับที่เก็บกุญแจเดิมของผู้ใช้
        if (got.status === 404 && got.error !== "none") throw new Error("keyvault ไม่พร้อม (404)");
        if (got.status !== 200 && got.status !== 404) throw new Error(`keyvault get ${got.status}`);
        const escrowed = got.status === 200 && got.recovery_key ? got.recovery_key : undefined;
        if (escrowed && (await matches(cli, escrowed))) {
            if (!ready) await restore(cli, escrowed);
            return;
        }
        // ไม่มีกุญแจที่ใช้ได้ใน keyvault (ยังไม่เคยฝาก / ฝากแล้วตั้งค่าไม่สำเร็จ / ตั้งที่เก็บกุญแจเองก่อนมี keyvault)
        // → ตั้งใหม่ · ถ้าเครื่องนี้ไม่มีกุญแจเดิม ข้อความเข้ารหัสเก่าที่เครื่องนี้ไม่เคยถอดได้จะยังอ่านไม่ได้เหมือนเดิม
        if (hasStorage && !ready) log.warn("ที่เก็บกุญแจเดิมไม่มีใครถือกุญแจ — ตั้งชุดใหม่");
        await createAndEscrow(cli, base, !!escrowed || hasStorage);
    })()
        .catch((e) => log.warn("ไม่สำเร็จ (จะลองใหม่เมื่อเปิดแอปครั้งหน้า)", e))
        .finally(() => {
            running = undefined;
        });
    return running;
}
