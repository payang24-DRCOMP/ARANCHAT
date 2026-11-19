//
// Copyright 2025 Element Creations Ltd.
// Copyright 2023-2025 New Vector Ltd.
//
// SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial.
// Please see LICENSE files in the repository root for full details.
//

import UIKit

nonisolated struct TextRoomTimelineItemContent: Hashable {
    let body: String
    var formattedBody: AttributedString?
    /// The original textual representation of the formatted body directly from the event (usually HTML code)
    var formattedBodyHTMLString: String?
    /// AranChat: card from the notification bot (`com.arankub.card`), shown instead of the text.
    var aranCard: AranCard?
    /// AranChat: note/album card (`com.arankub.note` / `com.arankub.album`), shown instead of the text.
    var aranBoard: AranBoardRef?
}
