/*
 * AranChat — เวลาในรายการแชทแบบ LINE: วันนี้ "14:05" · "เมื่อวาน" · ในสัปดาห์ "จ." · เก่ากว่า "3/11" (ข้ามปี "3/11/68")
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export function listTime(ts: number, now = Date.now()): string | undefined {
    if (!ts || ts <= 0 || ts === Number.MAX_SAFE_INTEGER) return undefined;
    const d = new Date(ts);
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);
    const day = 86400_000;
    if (ts >= today.getTime()) return d.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit", hour12: false });
    if (ts >= today.getTime() - day) return "เมื่อวาน";
    if (ts >= today.getTime() - 6 * day) return d.toLocaleDateString("th-TH", { weekday: "short" });
    return d.toLocaleDateString("th-TH", {
        day: "numeric",
        month: "numeric",
        ...(d.getFullYear() !== today.getFullYear() ? { year: "2-digit" } : {}),
    });
}
