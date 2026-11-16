/*
 * AranChat — ค่าตั้งจาก config.json คีย์ "aranchat" (ไม่มีคีย์นี้ = หน้าตา/การทำงานแบบ Element เดิม)
 * แยกไฟล์ไว้ให้ส่วนอื่น (DeviceListener, MatrixChat ฯลฯ) เรียกได้โดยไม่ดึงคอมโพเนนต์แถบเมนูไปด้วย
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import SdkConfig from "../SdkConfig";

export interface AranChatApp {
    name: string;
    desc?: string;
    url: string;
    icon?: string;
    color?: string;
    /** เปิดในแท็บใหม่เสมอ (ไม่เปิดซ้อนในหน้าแชท) */
    external?: boolean;
}
export interface AranChatConfig {
    /** โลโก้บนสุดของแถบเมนู */
    logo?: string;
    bot_user?: string;
    news_room?: string;
    /** ไม่ถามยืนยันตัวตน/สำรองกุญแจเข้ารหัส (หน่วยงานปิดการเข้ารหัสเป็นค่าเริ่มต้น) */
    quiet_encryption?: boolean;
    /** ที่อยู่ keyvault (ปกติอ่านจาก well-known "com.arankub.keyvault" — ใช้ค่านี้เมื่อไม่มี) */
    keyvault_url?: string;
    /** API ลิงก์ชวน (notify) เช่น https://chat.arankub.com/api/notify — ไม่ใส่ = /api/notify ของโดเมนเดียวกัน */
    invite_api?: string;
    /** ชุดสติกเกอร์บน server (ค่าเริ่มต้น /stickers/index.json — Desktop ต้องเป็น URL เต็ม) */
    stickers_url?: string;
    /** รายการคำสั่ง/เมนูบอท (ค่าเริ่มต้น <invite_api>/bot หรือ /api/notify/bot — Desktop ต้องเป็น URL เต็ม) */
    bot_api?: string;
    apps?: AranChatApp[];
}

export function aranChatConfig(): AranChatConfig | undefined {
    return (SdkConfig.get() as unknown as { aranchat?: AranChatConfig }).aranchat;
}
