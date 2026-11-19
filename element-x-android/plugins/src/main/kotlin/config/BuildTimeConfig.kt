/*
 * Copyright (c) 2025 Element Creations Ltd.
 * Copyright 2025 New Vector Ltd.
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial.
 * Please see LICENSE files in the repository root for full details.
 */

package config

object BuildTimeConfig {
    const val APPLICATION_ID = "com.arankub.aranchat"
    const val APPLICATION_NAME = "AranChat"
    val METADATA_HOST_REVERSED: String? = "com.arankub.aranchat"
    val OAUTH_CLIENT_URL_PATH: String? = "apps/android"
    val URL_WEBSITE: String? = "https://arankub.com"
    val URL_LOGO: String? = "https://chat.arankub.com/branding/icon-512.png"
    val URL_COPYRIGHT: String? = "https://arankub.com/terms"
    val URL_ACCEPTABLE_USE: String? = "https://arankub.com/terms"
    val URL_PRIVACY: String? = "https://arankub.com/privacy"
    val URL_POLICY: String? = "https://arankub.com/privacy"
    val SERVICES_MAPTILER_BASE_URL: String? = "https://chat.arankub.com/maps"
    val SERVICES_MAPTILER_APIKEY: String? = "aranchat"
    val SERVICES_MAPTILER_LIGHT_MAPID: String? = "light"
    val SERVICES_MAPTILER_DARK_MAPID: String? = "dark"
    val SERVICES_POSTHOG_HOST: String? = null
    val SERVICES_POSTHOG_APIKEY: String? = null
    val SERVICES_SENTRY_DSN: String? = null
    val SERVICES_SENTRY_DSN_RUST: String? = null
    val BUG_REPORT_URL: String? = null
    val BUG_REPORT_APP_NAME: String? = null
    const val PUSH_CONFIG_INCLUDE_FIREBASE: Boolean = true
    const val PUSH_CONFIG_INCLUDE_UNIFIED_PUSH: Boolean = true
    val PUSHER_APP_ID_RELEASE: String? = "com.arankub.aranchat.android"
    val PUSHER_APP_ID_DEBUG: String? = "com.arankub.aranchat.android.debug"
    val PUSHER_APP_ID_NIGHTLY: String? = "com.arankub.aranchat.android.nightly"
}
