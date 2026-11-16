/*
 * Copyright (c) 2025 Element Creations Ltd.
 * Copyright 2023-2025 New Vector Ltd.
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial.
 * Please see LICENSE files in the repository root for full details.
 */

package io.element.android.features.messages.impl.timeline.factories.event

import io.element.android.features.messages.impl.timeline.model.event.TimelineItemTextContent
import io.element.android.features.messages.impl.timeline.model.event.AranCard
import io.element.android.features.messages.impl.timeline.model.event.AranContact
import dev.zacsweers.metro.Inject
import io.element.android.features.location.api.Location
import io.element.android.features.messages.impl.timeline.model.event.RtcNotificationState
import io.element.android.features.messages.impl.timeline.model.event.TimelineItemEventContent
import io.element.android.features.messages.impl.timeline.model.event.TimelineItemLegacyCallInviteContent
import io.element.android.features.messages.impl.timeline.model.event.TimelineItemLocationContent
import io.element.android.features.messages.impl.timeline.model.event.TimelineItemRtcNotificationContent
import io.element.android.features.messages.impl.timeline.model.event.TimelineItemUnknownContent
import io.element.android.libraries.dateformatter.api.DateFormatter
import io.element.android.libraries.dateformatter.api.DateFormatterMode
import io.element.android.libraries.matrix.api.core.EventId
import io.element.android.libraries.matrix.api.core.SessionId
import io.element.android.libraries.matrix.api.core.UserId
import io.element.android.libraries.matrix.api.room.RoomMember
import io.element.android.libraries.matrix.api.room.toMatrixUser
import io.element.android.libraries.matrix.api.timeline.item.event.CallNotifyContent
import io.element.android.libraries.matrix.api.timeline.item.event.EventContent
import io.element.android.libraries.matrix.api.timeline.item.event.EventTimelineItem
import io.element.android.libraries.matrix.api.timeline.item.event.FailedToParseMessageLikeContent
import io.element.android.libraries.matrix.api.timeline.item.event.FailedToParseStateContent
import io.element.android.libraries.matrix.api.timeline.item.event.LegacyCallInviteContent
import io.element.android.libraries.matrix.api.timeline.item.event.LiveLocationContent
import io.element.android.libraries.matrix.api.timeline.item.event.MessageContent
import io.element.android.libraries.matrix.api.timeline.item.event.PollContent
import io.element.android.libraries.matrix.api.timeline.item.event.ProfileChangeContent
import io.element.android.libraries.matrix.api.timeline.item.event.ProfileDetails
import io.element.android.libraries.matrix.api.timeline.item.event.RedactedContent
import io.element.android.libraries.matrix.api.timeline.item.event.RoomMembershipContent
import io.element.android.libraries.matrix.api.timeline.item.event.StateContent
import io.element.android.libraries.matrix.api.timeline.item.event.StickerContent
import io.element.android.libraries.matrix.api.timeline.item.event.UnableToDecryptContent
import io.element.android.libraries.matrix.api.timeline.item.event.UnknownContent
import io.element.android.libraries.matrix.api.timeline.item.event.getDisambiguatedDisplayName
import io.element.android.libraries.matrix.api.user.MatrixUser
import io.element.android.libraries.ui.strings.CommonStrings
import io.element.android.services.toolbox.api.strings.StringProvider

@Inject
class TimelineItemContentFactory(
    private val messageFactory: TimelineItemContentMessageFactory,
    private val redactedMessageFactory: TimelineItemContentRedactedFactory,
    private val stickerFactory: TimelineItemContentStickerFactory,
    private val pollFactory: TimelineItemContentPollFactory,
    private val utdFactory: TimelineItemContentUTDFactory,
    private val roomMembershipFactory: TimelineItemContentRoomMembershipFactory,
    private val profileChangeFactory: TimelineItemContentProfileChangeFactory,
    private val stateFactory: TimelineItemContentStateFactory,
    private val failedToParseMessageFactory: TimelineItemContentFailedToParseMessageFactory,
    private val failedToParseStateFactory: TimelineItemContentFailedToParseStateFactory,
    private val sessionId: SessionId,
    private val dateFormatter: DateFormatter,
    private val stringProvider: StringProvider,
) {
    suspend fun create(eventTimelineItem: EventTimelineItem, roomMembers: List<RoomMember>): TimelineItemEventContent {
        val content = create(
            itemContent = eventTimelineItem.content,
            eventId = eventTimelineItem.eventId,
            isEditable = eventTimelineItem.isEditable,
            sender = eventTimelineItem.sender,
            senderProfile = eventTimelineItem.senderProfile,
            roomMembers = roomMembers,
        )
        // AranChat: ข้อความจากบอทแจ้งเตือนที่มีการ์ด → แสดงเป็นการ์ด (อ่านจาก JSON เดิมของเหตุการณ์ เพราะ SDK ไม่ส่งฟิลด์เสริมมา)
        if (content is TimelineItemTextContent && AranCard.isCardSender(eventTimelineItem.sender.value)) {
            // การแก้ไขล่าสุด = บอทแก้การ์ดหลังมีคนกดปุ่มสั่งงาน (แสดงผล + ซ่อนปุ่ม)
            val debug = runCatching { eventTimelineItem.timelineItemDebugInfoProvider() }.getOrNull()
            AranCard.fromEventJson(debug?.originalJson, debug?.latestEditedJson)?.let { return content.copy(aranCard = it) }
        }
        // AranChat: การ์ดแนะนำเพื่อน (ใครส่งก็ได้) — อ่าน JSON เฉพาะข้อความที่ขึ้นต้นแบบการ์ด
        if (content is TimelineItemTextContent && content.body.startsWith(AranContact.BODY_PREFIX)) {
            val json = runCatching { eventTimelineItem.timelineItemDebugInfoProvider().originalJson }.getOrNull()
            AranContact.fromEventJson(json)?.let { return content.copy(aranContact = it) }
        }
        // AranChat: การ์ดโน้ต/อัลบั้ม — body เป็นฉบับแก้ล่าสุดแล้ว · รหัสอยู่ใน JSON ต้นฉบับ
        if (content is TimelineItemTextContent && io.element.android.features.messages.impl.aranchat.AranBoardRef.isCandidate(content.body)) {
            val json = runCatching { eventTimelineItem.timelineItemDebugInfoProvider().originalJson }.getOrNull()
            io.element.android.features.messages.impl.aranchat.AranBoardRef.parse(content.body, json)?.let { return content.copy(aranBoard = it) }
        }
        return content
    }

    suspend fun create(
        itemContent: EventContent,
        eventId: EventId?,
        isEditable: Boolean,
        sender: UserId,
        senderProfile: ProfileDetails,
        roomMembers: List<RoomMember> = emptyList(),
    ): TimelineItemEventContent {
        val isOutgoing = sessionId == sender
        return when (itemContent) {
            is FailedToParseMessageLikeContent -> failedToParseMessageFactory.create(itemContent)
            is FailedToParseStateContent -> failedToParseStateFactory.create(itemContent)
            is MessageContent -> {
                messageFactory.create(
                    senderId = sender,
                    senderProfile = senderProfile,
                    content = itemContent,
                    eventId = eventId,
                )
            }
            is ProfileChangeContent -> {
                val senderDisambiguatedDisplayName = senderProfile.getDisambiguatedDisplayName(sender)
                profileChangeFactory.create(itemContent, isOutgoing, sender, senderDisambiguatedDisplayName)
            }
            is RedactedContent -> redactedMessageFactory.create(itemContent)
            is RoomMembershipContent -> {
                val senderDisambiguatedDisplayName = senderProfile.getDisambiguatedDisplayName(sender)
                roomMembershipFactory.create(itemContent, isOutgoing, sender, senderDisambiguatedDisplayName)
            }
            is LegacyCallInviteContent -> TimelineItemLegacyCallInviteContent
            is StateContent -> {
                val senderDisambiguatedDisplayName = senderProfile.getDisambiguatedDisplayName(sender)
                stateFactory.create(itemContent, isOutgoing, sender, senderDisambiguatedDisplayName)
            }
            is StickerContent -> stickerFactory.create(itemContent)
            is PollContent -> pollFactory.create(eventId, isEditable, isOutgoing, itemContent)
            is UnableToDecryptContent -> utdFactory.create(itemContent)
            is CallNotifyContent -> TimelineItemRtcNotificationContent(
                callIntent = itemContent.callIntent,
                state = when {
                    itemContent.activeMembers.isNotEmpty() -> {
                        RtcNotificationState.Active(
                            joinedMembers = itemContent.activeMembers.map { active ->
                                roomMembers.find {
                                    it.userId == active
                                }?.toMatrixUser() ?: MatrixUser(active)
                            },
                            isJoined = itemContent.isJoined,
                            callStartTsMillis = itemContent.callStartTsMillis,
                            callIntent = itemContent.callIntent
                        )
                    }
                    else -> {
                        if (itemContent.declinedBy.isEmpty()) {
                            RtcNotificationState.Started
                        } else {
                            RtcNotificationState.Declined(itemContent.declinedBy.any { it == sessionId })
                        }
                    }
                }
            )
            is UnknownContent -> TimelineItemUnknownContent
            is LiveLocationContent -> {
                val lastKnownLocation = itemContent.locations.mapNotNull { beacon ->
                    Location.fromGeoUri(beacon.geoUri)
                }.lastOrNull()

                val endsAt = dateFormatter.format(
                    timestamp = itemContent.endTimestamp,
                    mode = DateFormatterMode.TimeOnly
                )
                // Always create content, location can be null for "loading/waiting" state
                TimelineItemLocationContent(
                    description = itemContent.description?.trimEnd(),
                    assetType = itemContent.assetType,
                    senderId = sender,
                    senderProfile = senderProfile,
                    mode = TimelineItemLocationContent.Mode.Live(
                        lastKnownLocation = lastKnownLocation,
                        isActive = itemContent.isLive,
                        endsAt = stringProvider.getString(CommonStrings.common_ends_at, endsAt),
                        endTimestamp = itemContent.endTimestamp,
                        isOwnUser = sessionId == sender
                    ),
                )
            }
        }
    }
}
