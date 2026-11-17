/*
Copyright 2024 New Vector Ltd.
Copyright 2021 The Matrix.org Foundation C.I.C.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React from "react";

import MAudioBody from "./MAudioBody";
import MVoiceMessageBody from "./MVoiceMessageBody";
import { type IBodyProps } from "./IBodyProps";
import { isVoiceMessage } from "../../../utils/EventUtils";
import { AranTranscribe } from "../../../aranchat/AranTranscribe";

export default class MVoiceOrAudioBody extends React.PureComponent<IBodyProps> {
    public render(): React.ReactNode {
        const body =
            !this.props.forExport && isVoiceMessage(this.props.mxEvent) ? (
                <MVoiceMessageBody {...this.props} />
            ) : (
                <MAudioBody {...this.props} />
            );
        // AranChat: ปุ่ม "ถอดเป็นข้อความ" (ไม่แสดงตอนส่งออกแชท / ในข้อความที่อ้างถึง)
        if (this.props.forExport || this.props.inhibitInteraction) return body;
        return (
            <div className="mx_AranAudioWithTranscript">
                {body}
                <AranTranscribe mxEvent={this.props.mxEvent} />
            </div>
        );
    }
}
