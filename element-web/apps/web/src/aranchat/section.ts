/*
 * AranChat — หมวดของคอลัมน์รายการ (แชท / เพื่อน) ที่แถบเมนูเลือก — ใช้ร่วมระหว่าง AranChatRail กับ LeftPanel
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { EventEmitter } from "events";
import { useEffect, useState } from "react";

export type AranChatSection = "chat" | "friends";

class SectionStore extends EventEmitter {
    private value: AranChatSection = "chat";

    public get(): AranChatSection {
        return this.value;
    }

    public set(v: AranChatSection): void {
        if (v === this.value) return;
        this.value = v;
        this.emit("change", v);
    }
}

export const aranChatSection = new SectionStore();

export function useAranChatSection(): AranChatSection {
    const [v, setV] = useState(aranChatSection.get());
    useEffect(() => {
        aranChatSection.on("change", setV);
        return () => {
            aranChatSection.off("change", setV);
        };
    }, []);
    return v;
}
